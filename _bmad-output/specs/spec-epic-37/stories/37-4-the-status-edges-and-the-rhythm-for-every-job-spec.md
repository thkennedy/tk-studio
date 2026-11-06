---
title: 'The Status Edges and the Rhythm for Every Job'
type: 'bugfix'
created: '2026-11-06'
status: 'done'
baseline_revision: '7087caca7f3e2fa74803e914ca79eccd55c473d9'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-37/plans/37-4.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized]
deferred: []
---

> Serve-process change: `planstatus.ts`, `closeout.ts`, `cli.ts` and `approve.ts` run inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge (plans/37-4.md Settled shape 5).

<intent-contract>

## Intent

**Problem:** After an unblock, the issue sits in `Block Resolved`. That status is In Progress-category, so `promote` never leaves it, and the pull-back reads it as canonical `blocked`, so a later `done` holds an AD-5 conflict (DW-151, B1). The picker's tie follows the site's list order (B2). The `review`/`done` phases spell `story_key` with `-spec` (A4). `plansync setup` drops a copied transition's `screen`/`rules` (DW-160). The launch duties filter on `isRunEpic`, so a `run-vertical-slice` run is neither marked In Progress nor armed (DW-159).

**Approach:** Fix the four Jira edges and add one `story_key` spelling. Carry `screen`/`rules`, and refuse by name a transition the update cannot accept. Replace `isRunEpic` with `runsStories` (by `target`) at all four sites and in `run_rhythm_row`. Give `run-vertical-slice.json` and the slice mint `after_stories: 1`. Add the contract's additive 0.1.32 (Story 37.4) entry.

**Acceptance criteria (verbatim, epics.md Story 37.4):**

AC1. **Given** an issue in `Block Resolved` after a successful unblock (canonical `blocked`, DW-151) and a promote into the In Progress category where two routes share the canonical's preferred name (B2) **When** the plan-status pass promotes `review` or `done`, and when the picker ranks the routes **Then** a promote out of a block status for a non-`blocked` canonical moves on (`Block Resolved` → `In Progress`/`Done` is never held as an AD-5 conflict once the block is resolved), the pull-back maps `Block Resolved` to canonical `in-progress` (not `blocked`), the picker breaks a tie by the exact name then by the lowest transition id (never the list order), and the `story_key` spelled by the `in-progress`, `review` and `done` phases is one spelling (the story's key, no `-spec` suffix; A4); `test_jirabackend` and `planstatus.test.ts` pin each

AC2. **Given** `plansync.py setup` copying a workflow's transitions (Story 36.6; DW-160) **When** it posts `POST /workflows/update` **Then** each copied transition carries its `screen` and `rules` (validators, conditions, post functions) as the v3 read returns them, a transition whose read has fields the update schema does not accept is reported by name and left unchanged, and the lib suite's fake pins the shape; the live call stays the operator's through the consult log (Story 36.6's CAP-16, after this story lands)

AC3. **Given** a `run-vertical-slice` job (a game project's story run) and any later job type that runs stories **When** the launched path runs its duties (Story 36.6: the `in-progress` phase, the `stop-armed` rhythm) **Then** the duties apply by the job's `target` (a story payload), not by `isRunEpic` (DW-159), `run-vertical-slice.json` carries `after_stories`, and the supervisor suites cover a vertical-slice run marked In Progress and armed; the contract names the rule (0.1.32, additive)

## Boundaries & Constraints

**Always:**
- The Settled shapes in plans/37-4.md (SPEC design notes CAP-10/11/12) are the design. Keep `Blocked - Awaiting User` winning while the block stands.
- Keep `ownerSpecPresent`'s and `plansync.stage_story`'s `-spec` strips, for events already recorded.
- Every text-mode open names `encoding="utf-8"`. Every `bun test` names `--timeout 30000`. Use stdlib-only Python and atomic writes.
- Contract: no header bump (it stays 0.1.33). Add the 37.4 clause after 37.3's clause and before `0.1.33 (DW-170, additive)`. Append `, Story 37.4` to line 6. Place the paragraph after 37.3's paragraph and before DW-170's. Supersede earlier clauses by statement: 0.1.26 "both canonical `blocked`", 36.6's "a `run-epic` job's type or id selects both duties", and 37.3's "figure-1 run-epic" `arming-refused` wording.
- Close ledger entries DW-151, DW-159 and DW-160 as `status: resolved 2026-11-06 by Story 37.4`. Re-grep them by id.

**Block If:**
- The fake's `allowed` set cannot accept the legacy `screen`/`rules` spellings, and no shape makes it accept them. Consult (bad_spec) before inventing v3 spellings.
- A test the AC implies needs a promote out of a standing `Blocked - Awaiting User`.
- The slice mint's explicit `stop` must vary by the engagement's autonomy.
- The Files list grows past the plan's band.

**Never:**
- Touch `transition_to_name`, `track.py`, the release motion or remotes.
- Fix `guards.test.ts`'s 2 baseline sbx-argv failures.
- Run the live `plansync setup` (CAP-16, the operator's).
- Edit epics.md, plan files, stories.yaml or anything under supervision/.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Resolved → review/in-progress | backend `Block Resolved`, front `review` or `in-progress` | transition to `In Progress` |
| Resolved → done | backend `Block Resolved`, front `done` | lands `Done`, `conflicts == []` |
| Pull-back | backend `Block Resolved` | canonical `in-progress`; `Blocked - Awaiting User` → `blocked` |
| Standing block | backend `Blocked - Awaiting User`, front `blocked` | unchanged |
| B2 name tie | canonical `blocked`, `In Progress` listed before `Blocked - Awaiting User` | picks `Blocked - Awaiting User` |
| B2 id tie | two `In Progress` routes, ids "31" then "7" | posts "7"; a non-numeric id ranks last |
| One key | in-progress / review / done events | same `story_key`, no `-spec` |
| Setup carry | transitions with `screen` and `rules` | posted with both, as read |
| Setup refuse | a transition has a field outside the accepted set | nothing posted for the workflow; `partial`, `refused_transitions: [name]`, drop note |
| Slice run | `run-vertical-slice` defn `target {skill: tk-studio-launch, payload {verb: start}}` | marked In Progress and stop armed; a sweep (`verb: sweep`) is excluded |

</intent-contract>

## Code Map

plans/37-4.md `## Code Map` and "Anchors after 37.3" are the investigation; the implementer reads them first. Anchors were spot-checked at 7087caca:
- `plugins/tk-studio/lib/jirabackend.py` -- `canonical_status` :128, `apply_statuses` :569, `_transition_to_category` :731, `promote` :835, `BLOCKED_STATUS`/`RESOLVED_STATUS` :1119-1120, `_v3_transition` :1633, `update_workflow` :1683.
- `plugins/tk-studio/lib/plansync.py` -- setup call site ~:1459-1495 (drop note), `stage_story` strip (keep).
- `plugins/tk-studio/lib/launch.py` -- `run_rhythm_row` :1477 (filter `type != "run-epic"`).
- `apps/supervisor/src/closeout.ts` -- `armingRefusedStop` :407, `RUN_EPIC_JOB_TYPE`/`isRunEpic` :1128-1131, `resumeDuties` :1239.
- `apps/supervisor/src/cli.ts` -- import :131, `launchDuties` :1756.
- `apps/supervisor/src/planstatus.ts` -- import :104, `specKey` :191, `doneStories` :205, `launchedPass` :494.
- `apps/supervisor/src/approve.ts` -- slice mint ~:709-711.
- `plugins/tk-studio/jobs/run-vertical-slice.json`, `plugins/tk-studio/contracts/job.schema.json` :58.
- `plugins/tk-studio/contracts/driver-contract.md` -- header lines 5-6; 37.3 paragraph; DW-170 paragraph.
- Tests: see plans/37-4.md "Tests" (flips and additions per file).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py` -- Change the mapping (`Block Resolved` → `in-progress`). Make `promote` exit a block status for a non-`blocked` canonical. Make `apply_statuses` read the move into `Block Resolved` as the resolution. Set the picker key to `(rank, exact name, numeric id)`. Carry `screen`/`rules` and add `refused_transitions`. -- AC1, AC2.
- `plugins/tk-studio/lib/plansync.py` -- Reword the setup note and return the `partial` answer with `refused_transitions`. -- AC2.
- `plugins/tk-studio/lib/inbox.py` -- Update the docstring :11-14. -- AC1 consistency.
- `plugins/tk-studio/lib/launch.py` -- Make `run_rhythm_row` use the `runsStories` rule. -- AC3.
- `apps/supervisor/src/closeout.ts` -- Export `runsStories`. Replace `isRunEpic` at `armingRefusedStop` and `resumeDuties`; remove `isRunEpic` if unused. -- AC3.
- `apps/supervisor/src/cli.ts`, `apps/supervisor/src/planstatus.ts` -- Use `runsStories`. In `doneStories`, strip `-spec`; update the header comment. -- AC1, AC3.
- `apps/supervisor/src/approve.ts` -- Give the slice mint an explicit `stop {on_status: ["blocked"], after_stories: 1}`. -- AC3.
- `plugins/tk-studio/jobs/run-vertical-slice.json` -- Add `after_stories: 1`. `plugins/tk-studio/contracts/job.schema.json` -- Reword the note. -- AC3.
- `plugins/tk-studio/contracts/driver-contract.md`, `apps/supervisor/README.md` -- Add the 37.4 clause and paragraph, and the README `story_key` line. -- AC3 ("contract names the rule").
- `kb/agent-pc-setup-runbook.md` -- In the hole-109 row, add B1/B2. `_bmad-output/implementation-artifacts/deferred-work.md` -- Resolve DW-151, DW-159 and DW-160.
- Tests: in `test_jirabackend.py`, `test_syncback.py`, `test_tracking_setup.py`, `test_job.py`, `test_launch.py` and `test_driver_contract.py`, apply the plan's flips and additions, and add `test_0_1_32_story_37_4_…` after 37.3's test and before DW-170's. In `planstatus.test.ts`, `autoresume.test.ts`, `approve.test.ts` and `closeout.test.ts`, do the same: give fixtures `payload {verb: "start"}`, flip M24, and add a vertical-slice case and a one-spelling case. -- Every matrix row.

**Acceptance Criteria:** AC1–AC3 above, each proven by the named suites. The matrix rows are the test cases.

## Spec Change Log

## Review Triage Log

### 2026-11-06 — Review pass
- review-input note: the 234 KB diff (/tmp/diff37-4.patch, base 7087caca) was given to both layers as a file path rather than inline, because of its size.
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 2, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` An owner's unvalidated move into `Block Resolved` (via `track validate`/`track reply`) was pulled back as `in-progress` and promoted to In Progress before 31.7's validation (both layers). Consult ruling `apply`: `apply_statuses` now holds a still-`blocked` entity `blocked` with snapshot canonical `blocked` and no conflict. Tested over two passes; the contract paragraph states the rule.
  - `[medium]` `[patch]` `plansync setup --dry-run` hid the refusal. The refusal check now runs before the dry-run branch, and a dry-run test was added.
  - `[medium]` `[patch]` When there was no route out of `Block Resolved`, the next pull-back's stale re-map silently rewrote `review` to `in-progress`. `Block Resolved` is now excluded from the re-map, and a no-route pass no longer rewrites the entity file. Test added.
  - `[low]` `[patch]` The `run_rhythm_row` docstring was stale about the slice mint's rhythm. Reworded.

### 2026-11-06 — Review pass (follow-up)
- review-input note: the diff (/tmp/rv374/diff.patch, base 7087caca, ~1450 lines, the story's own spec excluded) was given to both layers as a file path rather than inline, because of its size.
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 2
- addressed_findings:
  - `[medium]` `[patch]` A promoted `review`/`done` whose snapshot canonical already matched the local status was pulled back to `in-progress` when Jira reached `Block Resolved` between syncs, which went against the 0.1.32 contract sentence (both layers). `apply_statuses` now holds a promoted `review`/`done` (`RESOLVED_HELD_STATUSES`): the snapshot records `Block Resolved` with the local canonical, so the next promote exits to In Progress/Done. A promoted `draft`/`ready` still maps to `in-progress`, per AC1. Following the consult ruling (score 2), the contract sentence was narrowed to name the held set. Three test_jirabackend cases were added (review exit, done exit, no-route stability over two passes).
  - `[low]` `[patch]` The contract says `runsStories` holds "at every site", but the resume site had only a negative (sweep) test. A positive resume test for a `run-vertical-slice` run (in-progress call and re-armed stop) was added to planstatus.test.ts. closeout.ts is unchanged.
- rejected (one line each):
  - Blind Hunter: "a new local block over a stuck `Block Resolved` is swallowed". This predates the story: `blocked` and `In Progress` share the indeterminate category (jirabackend.py:94), so promote has never moved a local block into `Blocked - Awaiting User`. The hold branch is the earlier consult ruling.
  - Blind Hunter: "DW-160 resolved, but the legacy `screen`/`rules` spelling is not verified against Jira". AC2 requires the carry "as the v3 read returns them" and leaves the live call to the operator (CAP-16). It is recorded as an unverifiable-here residual risk, and the ledger is the orchestrator's to own.

## Design Notes

These are the SPEC design notes CAP-10, CAP-11 and CAP-12 (plans/37-4.md Settled shapes 1-4), as fixed:
- `runsStories(defn) = defn?.target?.skill === "tk-studio-launch" && defn?.target?.payload?.verb === "start"`.
- Promote transition condition: `backend_category != target or (backend_status == RESOLVED_STATUS and canonical != "blocked")`.
- Picker sort key: `(rank, 0 if name == exact else 1, int(id) if str(id).isdecimal() else inf)`. For `blocked`, the exact name is `Blocked - Awaiting User`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger` -- expected: green.
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000` -- expected: green except the 2 baseline `guards.test.ts` sbx-argv failures.
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit` -- expected: clean.

## Deviation Summary

Note (consult ruling): deviation (1) is an omission in plans/37-4.md's Files. The drive repeats the slice==epic-minus-after_stories pin that the plan already flips in test_driver_contract.py.

### pass 1 (2026-11-06, implementer)

- planned: the Files list in plans/37-4.md / actual: also edited `plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py` to remove its "`after_stories` is run-epic's alone" strip / why: the drive asserts the slice type is shaped like run-epic; with `after_stories: 1` on the slice it failed conformance (`headless-clean`) / may affect: none
- planned: promote counts a backend status in `SETUP_STATUSES` with a non-`blocked` canonical as changed / actual: only a snapshot status of `Block Resolved` counts / why: counting `Blocked - Awaiting User` would rewrite the entity every pass without moving it (the block wins while it stands); matrix behaviour is unchanged / may affect: none
- planned: refuse on the fake's 400 `bad transition shape` or a key outside the carried set / actual: refuse on the pre-post key check only (`jirabackend.refused_transitions`, used by `plansync.setup` and again in `update_workflow`); a site 400 stays the existing "workflow update refused" path / why: a 400 cannot be traced to a transition name / may affect: none
- planned: `update_workflow` keeps returning the dropped-config names / actual: returns `""` on success, and `_dropped_config`/`_holds_value` are removed; the 36.6 dropped/empties tests were rewritten as the 37.4 carried-as-read and empty-containers cases / why: nothing is dropped any more, so the helpers had no callers / may affect: none

DEVIATION SCORE: 1

DRIFT: e2e_vertical_slice.py edited outside Files — the drive's run-epic-shape strip failed conformance once the slice carried after_stories — affects: none
DRIFT: promote's status_changed widened only for Block Resolved, not every SETUP_STATUSES status — a standing block would otherwise be rewritten on every pass — affects: none
DRIFT: refused_transitions decided by the pre-post key check, not by the site's 400 — a 400 cannot name a transition — affects: none
DRIFT: update_workflow's dropped-config return, _dropped_config and _holds_value removed — dead once screen/rules are carried — affects: none

### pass 2 (2026-11-06, implementer, review patches)

- planned: the Story 37.4 design note's mapping rule, which on its own resolves a `blocked` entity whose issue is in `Block Resolved` / actual: such an entity is held `blocked`, with snapshot canonical `blocked`, until its local status changes, and `Block Resolved` no longer takes part in the stale re-map / why: the review finding and the consult ruling (an owner's move into `Block Resolved` must stay in place for `track.py validate`) / may affect: none
- planned: promote always writes the snapshot after a transition attempt / actual: a pass whose `Block Resolved` exit finds no route and has nothing else to record writes nothing / why: review finding 3, which this session directed as part of the patch, so a pass that cannot move the issue does not keep rewriting the file / may affect: none

DEVIATION SCORE: 1 (unchanged; the first entry is under the 2026-11-06 high-severity consult ruling)

DRIFT: a still-blocked entity whose issue is in Block Resolved is held blocked (snapshot canonical blocked) instead of mapping to in-progress — the 31.7 validation window needs the owner's Block Resolved left in place (consult ruling) — affects: none
DRIFT: a no-route Block Resolved exit writes nothing on that pass — avoids rewriting the entity on every pass (review finding) — affects: none

### pass 3 (2026-11-06, implementer, follow-up review patches)

- planned: on `Block Resolved`, no pull-back re-maps any non-`blocked` local status (the contract sentence as written) / actual: only a promoted `review` or `done` is held (`RESOLVED_HELD_STATUSES`); a promoted `draft`/`ready` still maps to `in-progress` / why: the strict reading breaks the AC1-pinned test `test_pull_back_maps_block_resolved_to_in_progress_for_a_non_blocked_entity`, and AC1's verbatim text wins (consult ruling 2026-11-06T06:23Z) / may affect: none (the contract sentence was narrowed in the same pass, so contract and code agree)
- planned: the resume positive test goes in autoresume.test.ts / actual: it went in planstatus.test.ts, where the resume tests (`resumed()`, M23/M24) live / why: fixture locality / may affect: none

DEVIATION SCORE: 2 (accepted by the consult; the 0.1.32 contract text was narrowed inside the story's own additive entry, header unchanged at 0.1.33)

DRIFT: the 0.1.32 Block Resolved rule was narrowed from "never re-maps a non-`blocked` local status" to "never re-maps a promoted `review` or `done`; a promoted `draft`/`ready` maps to `in-progress`" — AC1's verbatim mapping and its pinned test contradicted the wider sentence (consult ruling) — affects: none

## Consult Log

- 2026-11-06T05:42Z — trigger: deviation-gt-0 + file-outside-files — question: accept the implementer's four score-1 deviations (e2e_vertical_slice.py strip removed; status_changed widened only for Block Resolved; refusal by the pre-post key check; dropped-config helpers removed)? — ruling: accept-deviation score 1 — do: accept all four as reported and keep the diff; record (1) as a Files omission in the plan; confirm e2e_vertical_slice reports headless-clean before the gate — rule candidate: When a story changes a shipped job type's or schema's shape, the planner greps plugins/tk-studio/contracts/conformance/ for every pinned assertion of that shape and lists each hit in Files next to its test_driver_contract.py twin.
- 2026-11-06T05:56Z — trigger: high-severity-finding — question: the pull-back flip plus promote's resolved_exit moves an owner's unvalidated `Block Resolved` (track validate / track reply windows) to In Progress before 31.7 validation; which guard? — ruling: apply — do: in apply_statuses, backend `Block Resolved` with the local entity `blocked` keeps the entity `blocked`, records the snapshot canonical as `blocked`, and raises no conflict; canonical_status still returns in-progress and resolved_exit stays as written; add a test_jirabackend case (blocked entity, issue in Block Resolved → stays blocked, no transition, conflicts == [], same on a second pass), keep the review/done exits; do not key on inbox.json item state (it reads `resolved` for every Block Resolved issue) — rule candidate: When a story changes a status mapping or a promote exit, the planner lists every verb that reads or moves into that status (grep track.py/inbox.py for the status name) and names, in the SPEC note, the local signal that tells each verb's window apart from the new exit.
- 2026-11-06T06:23Z — trigger: deviation-gt-0 (follow-up review pass) — question: the strict contract sentence "a pull-back never re-maps a non-`blocked` local status off `Block Resolved`" conflicts with AC1's verbatim "the pull-back maps `Block Resolved` to canonical `in-progress`" (pinned by test_pull_back_maps_block_resolved_to_in_progress_for_a_non_blocked_entity); accept the implementer's scoped hold `RESOLVED_HELD_STATUSES = ("review", "done")`? — ruling: accept-deviation score 2 — do: keep RESOLVED_HELD_STATUSES and the scoped apply_statuses branch, leave the AC1 test unchanged; in driver-contract.md replace the sentence with wording that names the held set (a promoted `review` or `done` is never re-mapped off `Block Resolved`, the snapshot records `Block Resolved` with the local canonical so the next promote exits it; a promoted `draft` or `ready` maps to `in-progress`, work resumed), keeping the no-route parenthetical; record as a consult ruling score 2 and re-run conformance — rule candidate: When a contract paragraph a story adds states a rule wider than an AC of the same story, the AC's verbatim text wins and the implementer narrows the contract sentence in the same pass, scored 2, with no consult needed.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-37-20261106T051812Z-aa804b` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass on the implemented story (commit 0294f07fbc966b0b9abeecc8b5190497ac5559a5, base 7087caca7f3e2fa74803e914ca79eccd55c473d9).
- AC1 to AC3 stand as implemented.
- This pass fixed a backwards pull-back: a promoted `review`/`done` was mapped to `in-progress` when Jira reached `Block Resolved`. It is now held, and the next promote exits the block status.
- The narrowed rule is now in the 0.1.32 contract sentence.
- A positive resume-site test now covers the `runsStories` rule for a `run-vertical-slice` run.

**Files changed (this pass).**
- `plugins/tk-studio/lib/jirabackend.py`: `RESOLVED_HELD_STATUSES` and the scoped `Block Resolved` branch in `apply_statuses`.
- `plugins/tk-studio/lib/tests/test_jirabackend.py`: the `_promoted_then_resolved` helper and three `BlockResolvedExitTests` cases.
- `plugins/tk-studio/contracts/driver-contract.md`: the Story 37.4 sentence names the held set (`review`/`done`) and the `draft`/`ready` mapping. The header stays 0.1.33.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the 37.4 note pin follows the new wording.
- `apps/supervisor/test/planstatus.test.ts`: a positive vertical-slice resume test.

**Review findings.** Both layers ran (band L). There were 2 patches (medium 1, low 1), 0 deferred and 2 rejected.

**Follow-up review:** not recommended (`false`). The patched counts were high 0, medium 1 and low 1, so the score is 3×1 + 1×1 = 4.

**Verification.** These ran after the patches, from `plugins/tk-studio/lib` unless noted:
- `uv run python -m unittest discover tests`: 2905 tests, OK (4 skipped). It ran once after the code patch and again after the contract edit.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`. It also ran after both.
- `tests.test_release_roster tests.test_dwledger`: 95 tests, OK.
- `bun test --timeout 30000` in `apps/supervisor`: 1943 pass and 2 fail. Both failures are the baseline `guards.test.ts` sbx-argv cases, carried.
- `bunx tsc --noEmit`: clean.

**Residual risks.**
- This is a serve-process change, carried from pass 1: the operator stops the supervisor tab before building `apps/supervisor` and restarts it through the scheduled task after the merge.
- The live acceptance of the legacy `screen`/`rules` spellings is `unverifiable-here`. The operator runs `uv run plugins/tk-studio/lib/plansync.py setup --directory <project>`, attended, after 37.4 is on `main` (CAP-16).
- A local re-block over an issue left in `Block Resolved` is not raised in Jira by promote. This predates the story (`blocked` shares the In Progress category) and was rejected as out of this story's scope.

DRIFT: the 0.1.32 Block Resolved rule was narrowed from "never re-maps a non-`blocked` local status" to "never re-maps a promoted `review` or `done`; a promoted `draft`/`ready` maps to `in-progress`" — AC1's verbatim mapping and its pinned test contradicted the wider sentence (consult ruling) — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-02T21:12:25Z | 2026-11-02T21:26:53Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-06T04:05:23Z | 2026-11-06T04:07:05Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-06T05:19:50Z | 2026-11-06T06:08:57Z | c5078666-a86e-49e0-ad84-59935cef7696 | claude-opus-5-5 | medium | 23560804 | 137338 | 12.1503 | completed |
| review | 1 | 2026-11-06T06:08:58Z | 2026-11-06T06:27:21Z | 74c4bf51-c110-4d68-8f27-38a6f4a58058 | claude-opus-5-5 | medium | 9506546 | 75711 | 5.9738 | completed |
| gate | 1 | 2026-11-06T06:27:22Z | 2026-11-06T06:31:04Z | b59eb7c8-e579-4d42-93a1-1c733d94ac2c | claude-opus-5-5 | medium | 3145164 | 21397 | 2.0016 | completed |
| host-leg | 1 | 2026-11-06T06:31:44Z | 2026-11-06T07:28:09Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-06T07:28:09Z | 2026-11-06T07:28:17Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-06T07:29:41Z | 2026-11-06T07:29:41Z | — | — | — | — | — | — | merged |


## Reconcile

### 2026-11-06 — adjust-stories

- Score: 2
- Reasoning: Every deviation is internal to 37.4's own surfaces: the scoped `Block Resolved` holds, the pre-post refusal check, the removed dropped-config helpers, and the narrowed sentence inside the story's own additive 0.1.32 entry (header unchanged at 0.1.33, no AD-5 conflict raised). No later story's acceptance criteria rely on them. Three later plans were written against seams 37.4 moved. The contract's 37.x paragraphs now sit after 37.4's and before `0.1.33 (DW-170…)`, not before `## 8. Conformance`. The story duties and `armingRefusedStop` go by `runsStories`, so a `run-epic` fixture needs `target.payload.verb: "start"`. The live `plansync setup` answer can now read `partial` with `refused_transitions`.
- Affected: 37-5-the-sweeps-bugs-and-cost-lines-before-a-fourth-sweep — "a `**0.1.32 (Story 37.5, additive).**` paragraph before `## 8. Conformance`" (plans/37-5.md Code Map); `planstatus.ts` "(:519); header :97-100" (Files)
- Affected: 37-6-one-stop-path-and-the-gates-blind-spots — "the `**0.1.32 (Story 37.6, additive).**` paragraph before `## 8. Conformance`" (plans/37-6.md Code Map); `armStop`/`rearmStop` "fold into one arming" over duties now gated by `runsStories`
- Affected: 37-7-the-records-reconciled-and-the-proofs-captured — "the live `setup` ask gated on 37.4 being on `main`" (plans/37-7.md Settled shape 3): the ask's expected answer now includes 37.4's `partial`/`refused_transitions` shape
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 37-5-the-sweeps-bugs-and-cost-lines-before-a-fourth-sweep
