---
title: 'Approval, Autonomy and the First Run'
type: 'feature'
created: '2026-10-25'
status: done
# Operator ruling 2026-10-25 (session 11): option (c) — a base_ref approval drives only after the engagement PR merges; see the Consult Log's last line
# Operator ruling 2026-10-25 (session 11), second: re-approval pushes fast-forward on engagement/ENG-NNN, never force (option 2); see the Consult Log's last line
baseline_revision: 'a99e58ee6f2ca99e5721a42b2293c72f65631814'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-6.md'
  - '{project-root}/_bmad-output/specs/spec-epic-32/SPEC.md'
warnings: [oversized]
deferred:
  - summary: >-
      The served root's uncommitted budget-bands.yaml (left by 32.5's quote) can block the plan pull-back after the approve PR merges, so the queued step keeps retrying.
    evidence: |-
      The approve PR changes .tk-studio/budget-bands.yaml; the served root holds the quote's uncommitted copy of it, and queueStep submits against the served root, which the pass never pulls (ruling (c)). Recorded against SPEC Open Question 3 / plans/32-6.md risk.
    location: >-
      apps/supervisor/src/approve.ts queueStep
    severity: medium
  - summary: >-
      Nothing closes a cap or ask block after go or continue, and the questions pass will not close an owed questions block while the newest block is cap or ask.
    evidence: |-
      runStep only blocks (step 5); questions.ts closeStep skips while the newest block kind is cap/ask. The issue stays Blocked - Awaiting User after the owner answers. Meets DEFERRAL DISCIPLINE (a).
    location: >-
      apps/supervisor/src/approve.ts runStep; apps/supervisor/src/questions.ts closeStep
    severity: medium
  - summary: >-
      ask autonomy on a project not bound to Jira pauses with no question to the owner and no route to continue.
    evidence: |-
      The ask block is skipped when !jiraBound(root), and run-resumed is applied only from a Jira owner comment `continue`; paused takes only run-resumed, revise or cancel. Meets DEFERRAL DISCIPLINE (a).
    location: >-
      apps/supervisor/src/approve.ts runStep steps 5-6
    severity: medium
  - summary: >-
      Two engagements approved before either PR merges both run plansync sync from the same default-branch counter and mint the same EP/ST ids.
    evidence: |-
      plansync's plan-counter.yaml is branch-local; reservedEpics reserves only ## Epic numbers, so the second PR adds the same EP-<n>.md (an add/add conflict GitHub surfaces, not a silent duplicate). Pre-existing property of plansync's counter across unmerged branches. Meets DEFERRAL DISCIPLINE (b): AD-4 id uniqueness at risk.
    location: >-
      apps/supervisor/src/approve.ts reservedEpics / the sync step
    severity: medium
  - summary: >-
      Two engagements quoted before either approves predict the same EP id, so the shared budget-bands.yaml entry holds only the later quote's estimate and the re-key can move the other engagement's figure.
    evidence: |-
      32.5's quote writes epics.<predicted EP>.usd_estimate into the served root's shared bands file and basis.epics[] carries no per-epic usd, so approve's rekeyBands reads the shared entry. Pre-existing in 32.5. Meets DEFERRAL DISCIPLINE (a): AC2's band re-key.
    location: >-
      apps/supervisor/src/approve.ts rekeyBands call in the job step
    severity: medium
  - summary: >-
      A re-approval after revise, before the first PR merges, resets the approve worktree to the default branch's tree, so the second plansync sync promotes fresh EP/ST entities to Jira and the first cycle's promoted issues are left orphaned (duplicate epics and stories in Jira).
    evidence: |-
      approve.ts re-approval path (operator ruling (2), pass 5): `git read-tree -u --reset origin/<default>` drops the first cycle's entity files holding external.jira.key and resets plan-counter.yaml; the following `plansync.py sync` mints keyless entities and jirabackend.promote POSTs a new issue for each. Consequence of ruling (2)'s wholesale replacement; reconciling the earlier promote (drop/transition the orphans, or carry keys forward) needs an operator decision. Meets DEFERRAL DISCIPLINE (a): AC1's plansync sync (the promote to Jira).
    location: >-
      apps/supervisor/src/approve.ts re-approval cut (read-tree reset) and the sync step
    severity: medium
---

<intent-contract>

## Intent

**Problem:** In `quoted`, the owner's `approve {autonomy, base_ref?}` already moves the record to `approved` (32.1's `record-approval`), but nothing yet does what approval means: no plan is written, nothing is published, no job is declared, no run starts, and no run-driven row (`launched`, `cap`, `run-paused`/`run-resumed`) has a caller.

**Approach:** A supervisor approve pass (new `apps/supervisor/src/approve.ts`) runs on the host against the served root's repository in a dedicated worktree on `engagement/ENG-NNN`: append the scope's proposed epics and stories to `epics.md`, `plansync sync` (normalize then sync), declare the `run-epic-N` job, re-key the budget band, commit, push, open the PR, and queue the first run (at once with `base_ref`, else on the PR's merge). An engagement-run pass applies `launched`, the three autonomy levels and the cap; `engagementRunSpendPass` sums `spend.runs_usd` beside `chatSpendPass`. Every settled shape is the plan's (`plans/32-6.md` "Settled shape" 1–6), which this spec adopts verbatim.

### Story (verbatim, epics.md "### Story 32.6")

As the owner,
I want one verb to approve with the autonomy I choose at that moment,
So that approval alone creates the plan, publishes it and starts the work (F2 step 5; B5 item 5).

- **AC1** — **Given** `quoted` **When** `POST /engagements/{id}/input {verb: approve, autonomy: ask | steady | full, base_ref?}` arrives (the bearer or a cookie with `X-CSRF-Token`; nothing else approves: no chat line, no planner proposal, no timer) **Then** the supervisor runs on the host in the served root: the scope's proposed epics and stories appended to `epics.md` as `## Epic N` sections carrying `engagement: ENG-NNN`, `plansync normalize` (the EP- and ST- entities, the index, the backlog mirrors), `plansync sync` (the promote to Jira with the design pages' links), the engagement's `run-epic-N` job declared under `.tk-studio/jobs/` and in `.tk-studio/config.yaml`'s `jobs` (the placement from the project's default worker placement), one commit on a branch `engagement/ENG-NNN` opened as a PR (main is protected: the plan change is reviewed like any change; the run cuts from `base_ref` when given, else from main once the PR merges, the supervisor queuing it on the merge as the plan pull-back watches today); `autonomy` and `approved_at` are recorded, the state moves `quoted → approved`, and `approved → in-progress` on the first run's `launched` event; `ask` = a graceful stop after every story and a `question` to the owner before the next, `steady` = one story per run, resubmitted by the supervisor on each merge, `full` = the epic end to end
- **AC2** — **Given** `in-progress` **When** runs end **Then** `spend.runs_usd` sums the engagement's runs' `job-run` costs and the board draws the band against it; at the cap the supervisor stops the live run with a graceful stop, marks the engagement `partial`, blocks its issue (the inbox) with the figures, and waits for `go` (`{cap}` raises it by the owner's figure, back to `in-progress`) or `cancel`; `bun test` covers the approve path with a fake adapter (what is written, the PR, the job, the three autonomy levels, the cap) and every refusal

## Boundaries & Constraints

**Always:**
- Only the owner's typed `approve` (bearer, or cookie + `X-CSRF-Token`) starts the approve pass; its triggers are `afterEngagementInput` after `approve` and the `finally` sites retrying an unfinished pass.
- The served root's checkout is never switched or dirtied: the approve work runs in a dedicated worktree cut from origin's default branch (`prepareWorktree`'s pattern) and is removed afterwards. Inputs (`scope.md`, the record, budget-bands values) are read from the served root.
- The commit stages only the union of plansync's `written[]` and the files the pass wrote; exactly one commit; push; `gh pr create` with base = the default branch.
- Each step (`append`, `sync`, `job`, `commit`, `pr`, `queued`) emits `serviceEvent("engagement-approve", {id, project, step, ok, detail})`; `detail.pr {number, url}` on `pr`, `detail.run_id` (and the placement) on `queued`. A failed step is retried at the next pass and never moves the state. The pass writes nothing into the record.
- `## Epic N` = highest `## Epic` number in `epics.md` + k; first body line `engagement: ENG-NNN`; stories re-emitted as `### Story N.M:` in `epics.md`'s line shape. The scope's stories are split on `####` headings and their As a / I want / So that / Acceptance Criteria parts found as substrings (`engage.py STORY_SHAPE`).
- Every engagement run is enqueued with `payload {engagement, project}` (`submitJob` gains optional `payload`) and followed by `engagement-run-queued {engagement, project, run_id, job}`. `enqueue`'s `stack` is never passed for `run-epic-N`.
- `launched` on a linked run applies `applyEvent(launched)` once per engagement. Autonomy is read from `record.autonomy`: `full` as today's run-epic; `steady` graceful stop once `storyLanded` names a story, resubmit (same payload) on that story PR's merge, state stays `in-progress`; `ask` the same stop, then `run-paused`, a `kind: ask` block of the engagement's issue, and an owner comment line `continue` (32.3 comment-reader rule) applies `run-resumed` and resubmits.
- `engagementRunSpendPass`: same three `finally` sites and mapping as `chatSpendPass`, sums `job-run` `total_cost_usd` over runs named by `engagement-run-queued`, merges only `spend.runs_usd` into a fresh read, never throws.
- At step `job`, re-key `budget-bands.yaml` from each `basis.epics[].ep_id` to the minted EP id in `quote.epic_bands_text`'s byte shape, keeping other entries; a `null` `ep_id` writes no band and is named in the step's detail.
- Cap: when `spend.runs_usd >= quote.cap` on `in-progress` — `launchStopGraceful` on the live linked run, `applyEvent(cap)` → `partial`, a `kind: cap` block with `runs_usd`, `cap`, `band85.usd`, `band95.usd` and "reply with `go {cap}` from the web or the API, or `cancel`", one notifier line. `partial + go {cap}` (existing `raise-cap`) then resubmits; `cancel` stops the live run gracefully.
- `track.py block --engagement` gains `--kind questions|cap|ask` (default `questions` = today) with `--reason`; `cap`/`ask` need no open questions and keep the 31.5 prefix `[~accountid:<owner>] Blocked: ENG-NNN …`; `engagement-issue {action: blocked}` carries `kind`, and `questions.ts closeStep` closes only a `questions` block.
- Job placement: the approve pass declares the job in the repo only (job file + `jobs:` id, every other byte kept), never writes `TK_SUPERVISOR_CONFIG`. At enqueue, with no `<project>/run-epic-N` entry, placement = the project's highest-numbered `run-epic-*` entry in that config, else the host tier.
- Contract: one `0.1.27 (Story 32.6) adds to this same entry …` clause after 32.5's, no `**0.1.28**`; update §1 input row, the state-table text, the `tk-studio-track` row; a 32.6 pin in `test_driver_contract.py` keeping every earlier pin. Stdlib-only Python, atomic writes, AD-11 status blocks, no credentials in files.

**Block If:**
- Any `TRANSITIONS` row or effect must change (including making `raise-cap` add rather than replace). HALT.
- The approve commit can only be made by switching or dirtying the served root's checkout. HALT naming the cause.
- Something other than the owner's `approve` input must start the approve pass. HALT.
- The Files list must grow beyond `plans/32-6.md`'s Files list. HALT.

**Never:** no new `TRANSITIONS` row; no `**0.1.28**`; no edit of `epics.md`/plan files/`stories.yaml` in this repo; no push/tag/PR/release from the loop itself (tests use fakes); no live Atlassian or `gh` in tests; no timer or chat line that approves.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approve with base_ref | `quoted`, `approve {autonomy: full, base_ref: X}` | state `approved`; epics appended, sync run, job + config id, one commit on `engagement/ENG-NNN`, PR opened; run queued at once from X with payload; events per step | No error |
| Approve, no base_ref | as above, no `base_ref` | same through `pr`; run queued only when `gh pr view` says MERGED | OPEN PR: no queue, retried at next pass |
| First launch | linked run `launched` | `approved → in-progress` once | second launched: no-op |
| steady | linked run lands a story | graceful stop; story PR merge resubmits same payload | — |
| ask | linked run lands a story | graceful stop, `paused`, `kind: ask` block; owner `continue` → `in-progress` + resubmit | no `continue`: stays paused |
| Cap | `runs_usd >= cap`, `in-progress` | graceful stop, `partial`, `kind: cap` block with figures, one notice; `go {cap}` resubmits | `cancel` stops gracefully |
| No proposed story | scope without stories | step `append` fails `NoScope`; state unchanged | retried, refused by name |
| Malformed story | story missing a part | `StoryShape: <k>.<m>` | refused by name |
| Not approved | record not `approved` | `NotApproved` | refused by name |
| Null ep_id | `basis.epics[].ep_id: null` | no band written, named in `job` detail | — |
| Not via API | chat line / proposal / timer | never starts the pass | — |

</intent-contract>

## Code Map

The investigation is `plans/32-6.md` "Code Map" (loaded in `context`); anchors spot-checked against baseline `a99e58e` and still valid. The essentials:

- `apps/supervisor/src/engagement.ts` -- `TRANSITIONS` :200 (unchanged; `quoted+approve` :213, `partial+go raise-cap` :228), `EFFECTS` :270-271, `applyEvent` :321 (first caller is this story), `readEngagement` :407, `writeEngagement` :421. `engagement.test.ts:569` pins table = contract.
- `apps/supervisor/src/api.ts` -- `postInputRoute` :537; `afterInput` fire-and-forget :566-567 runs only for `answer`/`go`/`revise` today: add `approve` and `go` from `partial`. `ApiDeps.afterEngagementInput` :217, default :388.
- `apps/supervisor/src/cli.ts` -- `afterEngagementInput` :758 (add approve + engagement-run passes); `jobPlacement` :571, `resolveBeforeStart` :408; `chatSpendQuietly` :733 at `recoverQueue` :657, `drainQueue` :865, `runJob` :1227; `submitJob` :876 (add `payload`); `launchStopGraceful` :924; `afterCloseOuts` :705-710.
- `apps/supervisor/src/worktree.ts` -- `WorktreeDeps` :75, `runner` :99, `uvRunner` :101, `studioScript` :102, `gh()` :155, `defaultBranch` :164, `prepareWorktree` :258. No non-run PR helper exists; write one in `approve.ts`.
- `apps/supervisor/src/scope.ts:102 scopePass` -- the model for `approvePass(queue, deps, only?)`.
- `apps/supervisor/src/chat.ts:242-298 chatSpendPass`, `mintChatTurn` :197-210 -- spend mapping and payload linkage precedent.
- `apps/supervisor/src/queue.ts` -- `enqueue` :1070 stores `payload` (`runPayload` :1127), `stack` :1084 engagement-chat only, `markLaunched` :1534.
- `apps/supervisor/src/closeout.ts` -- `storyLanded` :171, `landing` :156.
- `apps/supervisor/src/planstatus.ts` -- `callStatus` :233 (how to call plansync), `mergePass` :330 (`gh pr view` merge watch :342).
- `apps/supervisor/src/questions.ts` -- `blockStep` :244, `closeStep` :347 (hazard: closes any block once not `awaiting-answers`).
- `apps/supervisor/src/board.ts` -- `jobRunCosts` :194, `spendByEpic` :226, `readBands` :242.
- `plugins/tk-studio/lib/plansync.py` -- CLI `normalize|sync --directory` :2062-2069, `sync()` :667 runs `normalize()`, `written[]` :715-733, `EPIC_HEAD_RE`/`STORY_HEAD_RE` :148-149.
- `plugins/tk-studio/lib/engage.py` -- `STORY_SHAPE` :696, scope proposed-epics shape :1376-1384. `plugins/tk-studio/lib/quote.py:248 epic_bands_text` (byte shape pinned by `test_quote.py`).
- `plugins/tk-studio/lib/track.py` -- `block_engagement` :667, summary :543, `NoOpenQuestions` :690-693, `engagement_comment` :569.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 version entry, §1 input row :117, state table text :238, §2 engage row :389 (keep verbatim), `tk-studio-track` row. `test_driver_contract.py` pins 32.1–32.5 :964-1300; add 32.6 before `test_section_8_names_the_cli_drives` :1301.
- Tests: `test/fakes.ts` `fakePlansync` :118 (extend for normalize/sync + `written[]`), `fakeGh` :150, `gitRepo`/`gitInit` :303-330, `fakeStudioRoot` :75; `api.test.ts` "Story 32.1" `routed()` :1343-1360; `scope.test.ts:67 fakeUv`; `closeout.test.ts:102`. The "fake adapter" = injected `uv` and `run` + `fakeGh` + `fakePlansync`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/approve.ts` (new) -- `approvePass` (append, sync, job, commit, PR, queued, band re-key), approve-PR merge watch, engagement-run pass (launched, steady/ask stop, resubmit, ask resume), `engagementRunSpendPass`, the cap -- AC1, AC2
- `apps/supervisor/src/api.ts` -- `afterInput` also for `approve` and `go` from `partial` -- AC1, AC2
- `apps/supervisor/src/cli.ts` -- `afterEngagementInput` runs approve; `finally` sites run the new passes; `submitJob` `payload`; placement fallback -- AC1, AC2
- `apps/supervisor/src/questions.ts` -- `blockStep`/`closeStep` keyed by `kind` -- AC2
- `apps/supervisor/src/queue.ts` -- only if `payload` is unreachable via `submitJob` otherwise
- `apps/supervisor/test/approve.test.ts` (new) -- the approve path with the fakes (what is written, the PR, the job, the three autonomy levels, the cap) and every refusal (`NoScope`, `StoryShape`, `NotApproved`, null `ep_id`, OPEN PR not queued) -- AC1, AC2
- `apps/supervisor/test/api.test.ts` -- approve (bearer and cookie+CSRF) starts the pass; cookie without CSRF refused; `go` from `partial` resubmits
- `apps/supervisor/test/questions.test.ts` -- a cap or ask block is not closed by the questions pass
- `apps/supervisor/test/fakes.ts` -- `fakePlansync` normalize and sync with `written[]`
- `apps/supervisor/test/engagement.test.ts` -- only if a new case needs it; table unchanged
- `apps/supervisor/README.md` -- the approve pass, autonomy levels, the cap
- `plugins/tk-studio/lib/track.py` + `tests/test_track.py` -- `--kind questions|cap|ask`, `--reason`
- `plugins/tk-studio/lib/tests/test_quote.py` -- pin the re-keyed `epics` literal `approve.test.ts` uses
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- 0.1.27 (Story 32.6) clause, §1 row, state-table text, track row; 32.6 pin
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- the `--kind` flag

**Acceptance Criteria:**
- Given `quoted`, when the owner POSTs `approve {autonomy, base_ref?}` with the bearer or cookie+CSRF, then `approve.test.ts`/`api.test.ts` show the record `approved` with `autonomy`/`approved_at`, `epics.md` gains `## Epic N` sections with `engagement: ENG-NNN`, plansync sync ran, the job file and `jobs:` id exist, one commit on `engagement/ENG-NNN`, a PR was created, and the run queued (at once with `base_ref`, on merge without).
- Given a linked run's `launched` event, when the engagement-run pass runs, then the state is `in-progress`, and the `ask`/`steady`/`full` behaviours hold as the matrix says.
- Given `in-progress`, when runs end, then `spend.runs_usd` equals the sum of the runs' `job-run` costs, the band is re-keyed to the minted EP id, and at the cap the record is `partial` with a graceful stop, a `kind: cap` block and one notice; `go {cap}` returns it to `in-progress` and resubmits.
- Given a refusal case (`NoScope`, `StoryShape: k.m`, `NotApproved`), when the pass runs, then the `append` step emits `ok: false` naming it and the state is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 2, medium 3, low 4)
- defer: 3 (medium 3)
- reject: 2 (medium 2)
- addressed_findings:
  - `[high]` `[patch]` H1 re-approval after revise was a no-op: step/done/launched/linksOf checks scoped to the newest approve line
  - `[high]` `[patch]` H2 a retry after an ok sync re-promoted to Jira: the worktree is kept and resumed until the push; cross-process lockfile per engagement under TK_SUPERVISOR_WORK
  - `[medium]` `[patch]` queued-not-launched linked runs cancelled at cancel/partial (`cancelQueued`)
  - `[medium]` `[patch]` two unmerged approvals no longer take the same `## Epic N` (`reservedEpics`)
  - `[medium]` `[patch]` rekeyBands moves the predicted EP id entry to the minted id
  - `[low]` `[patch]` ask continue does not resubmit at or past the cap
  - `[low]` `[patch]` scope `### Epic 0` refused `NoScope`; a repeated `#### Story k.m` refused `StoryShape: k.m repeated`
  - `[low]` `[patch]` contract and track.py docstring reworded to "need no open questions"
  - `[low]` `[patch]` approve.ts header and cli.ts engagementQuietly comment updated
- rejected: cap trips only after a run ends (AC2 "When runs end"; 32.2's job-run cost model); go {cap} with no stopped run not resubmitting (a run that ended on its own is 32.8's run end)
- open: the H1 patch's `git push --force` on `engagement/ENG-NNN` — consult escalated (see Consult Log); story halted blocked

### 2026-10-25 — Review pass (session 12)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (medium 4, low 4)
- defer: 2 (medium 2)
- reject: 2 (medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` P1 a `NonFastForward` push never recovered on resume: the commit step moves HEAD onto origin's fetched tip with `reset --soft` and commits on top, plain push
  - `[medium]` `[patch]` P2 plansync's `removed[]` was not staged: deletions staged and kept through resume
  - `[medium]` `[patch]` P3 a failed sync that already wrote (possible partial Jira promote) dropped the worktree: kept and re-synced in place, no second append
  - `[medium]` `[patch]` P7 an ask stop whose `run-paused` failed was never paused and could be resubmitted without `continue`: pause re-applied once; no resubmit from an ask stop without `run-resumed`
  - `[low]` `[patch]` P4 `#### Story 2.1` under `### Epic 1` refused `StoryShape`
  - `[low]` `[patch]` P5 appended epics numbered contiguously, k kept for the band re-key
  - `[low]` `[patch]` P6 the catch-all reports a throw on the running step, not `append`
  - `[low]` `[patch]` P8 the steady story-PR merge gate applies when any ok stop of the previous run was `steady`
- deferred: concurrent approvals minting the same EP/ST ids (plansync's branch-local counter, AD-4, (b)); concurrent quotes sharing one predicted EP band entry (32.5's shared bands file, (a))
- rejected: "the board draws the band against runs_usd" unimplemented — the board draws the re-keyed band against the minted epic's ledger `job-run` spend, the same figures, the adjustment the 32-5 replan names; a lost kept worktree re-running sync — the worktree lives under TK_SUPERVISOR_WORK and is only lost by external deletion
- skipped-layer: none (band L, both layers ran)

### 2026-10-25 — Review pass (follow-up, session 13)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (medium 1, low 1)
- defer: 1 (medium 1)
- reject: 6 (medium 4, low 2)
- addressed_findings:
  - `[medium]` `[patch]` F1 a run linked under an earlier approval, still live after revise + re-approve, was never stopped at the cap or on cancel (its cost still counted): runStep's early return, the cap notice run and step 4's graceful stop/cancel now cover every approve cycle's links; launched (step 1), steady/ask stops (step 3) and the resubmit (step 7) stay on the newest cycle
  - `[low]` `[patch]` F2 an ok `append` whose sync failed (kept worktree, review P3) reserved no `## Epic N`, so a second engagement approved meanwhile took the same number and `run-epic-N`: `reservedEpics` now reserves ok `append` steps too, deduped
- deferred: re-approval before merge orphans the first cycle's promoted Jira issues (consequence of operator ruling (2), (a))
- rejected: first run never queued because nothing pulls the served root after merge — duplicate of DW-46 and the plan's recorded served-root pull-back risk; cap/ask block may meet a `Done` issue with no transition to `Blocked - Awaiting User` — speculative (site workflow), a missing transition is refused by name and recorded as `engagement-issue {action: refused}`; steady stop with no PR on the run's `ended`/`closed_out` never resubmits — a run ending without its PR is visible on its own `ended` event and is the existing run end's failure (32.8); cross-process race of two engagements' approve passes on `## Epic N` — same class as DW-49 (concurrent approvals, GitHub surfaces the conflicting PRs); ask on a non-Jira project — duplicate of DW-48; cap/ask block never closed after go/continue — duplicate of DW-47
- review-input: the 348 KB diff (baseline a99e58e, spec and ledger excluded) was handed to both layers as a scratchpad file path rather than inline text
- skipped-layer: none (band L, both layers ran)

## Design Notes

- `raise-cap` replaces `quote.cap` with the owner's figure (32.1's published effect, pinned by the contract's state table). The story's "raises it by the owner's figure" is satisfied by the owner supplying the new, higher cap; changing it is a Block If.
- "On the host in the served root" is realised as a worktree of the served root's repository so the served checkout — shared by live runs and chat turns under the checkout lock — is never switched (plan Settled shape 1).
- The served root's plan counter keeps its uncommitted `engagement` series until the plan pull-back brings main in (plan risk, not a Block If).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green except the 3 released-roster guards (`unverifiable-here` until the release motion)
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH=~/.bun/bin:$PATH TK_STUDIO_ROOT=<root> bun test test/approve.test.ts test/api.test.ts test/questions.test.ts test/engagement.test.ts test/board.test.ts`, then `bun test` -- expected: 0 fail (`TK_ATLASSIAN_*` unset)
- `cd apps/supervisor && bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean
- `grep -n "0.1.27 (Story 32.6)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" …` is 0
- `git status --porcelain` -- expected: only the Files above

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: `afterInput` also runs for `approve` and for `go` from `partial` / actual: also added for `cancel` / why: so `cancel` stops the live run without waiting for a `finally` site / may affect: 32-8
- planned: events `engagement-approve`, `engagement-run-queued`, `engagement-issue` with `kind` / actual: added `engagement-run-stop`, `engagement-cap`, `engagement-continue`; optional `after_run` on `engagement-run-queued`; `detail.root` on `engagement-approve`; cap/ask refusals as `engagement-issue {action: refused, kind, step: "block"}` / why: dedupe, resubmit bookkeeping, finding targets at the `finally` sites / may affect: 32-7, 32-8
- planned: steady/ask stop once `storyLanded` names a story / actual: `storyLanded`, else the run's newest `close-out` event's story key; tests exercise the close-out path only / why: the paused-run pass relaunches before this pass runs / may affect: none
- planned: the engagement's `run-epic-N` job / actual: one job declared per appended epic, only the first queued / why: the scope may propose several epics / may affect: 32-8
- planned: `NotApproved` for a record not approved / actual: reported only when the record has an applied `approve` line and no `queued` yet / why: the pass sees every engagement at every `finally` site / may affect: none
- planned: each step emits an event / actual: a step event identical to that step's newest one is not repeated / why: avoids one event per tick for a permanent refusal / may affect: none
- planned: worktree setup failures not named / actual: reported on step `append` / why: no dedicated step exists / may affect: none
- planned: `closeStep` closes only a questions block / actual: it also closes nothing while the newest block is `cap` or `ask` / why: same Jira issue / may affect: none
- planned: band re-key in `epic_bands_text`'s byte shape / actual: TypeScript `rekeyBands`, identical output on an `epic_bands_text` block, pinned by `test_quote.py` / why: the supervisor does not call `quote.py` / may affect: none
- planned: "every other byte kept" / actual: contract says "the rest of the file kept byte for byte" / why: the 32.5 pin forbids the phrase "every other byte" in the contract / may affect: none
- planned: `api.test.ts`: approve starts the pass / actual: asserts the injected hook is called; the real pass is covered in `approve.test.ts` / why: the routed fixture has no git repo / may affect: none

Implementer DEVIATION SCORE: 2. Implementer-reported risks: (1) with `base_ref`, `submitJob` resolves the job in the served root where `run-epic-N` lands only after the approve PR merges, so "queued at once" likely retries until then (untested live; tests use a fake submitter); (2) the graceful stop for steady/ask usually hits a relaunched engine; (3) later epics of a multi-epic scope are declared but never queued; (4) nothing closes a `cap`/`ask` block once answered.

DRIFT: afterInput also fires on `cancel` — so cancel stops the live run without waiting for a finally site — affects: 32-8
DRIFT: extra service events `engagement-run-stop`, `engagement-cap`, `engagement-continue`; `after_run` on `engagement-run-queued`; `detail.root` on `engagement-approve`; cap/ask refusals as `engagement-issue {action: refused}` — dedupe, resubmit bookkeeping and target finding at the finally sites — affects: 32-7, 32-8
DRIFT: one `run-epic-N` job declared per appended epic, only the first queued — the scope may propose several epics — affects: 32-8
DRIFT: steady/ask stop keys on `storyLanded` else the newest `close-out` story key — the paused-run pass relaunches first — affects: none
DRIFT: budget-bands re-key is a TS `rekeyBands` matching `epic_bands_text`'s bytes, pinned by `test_quote.py` — the supervisor does not call quote.py — affects: none

### pass 2 (2026-10-25, implementer, consult-directed patch)

- planned: `submitJob` and `validate` resolve the job in the served root (Settled shape 3: `submitJob` gains only `payload`) / actual: both also take an optional `definitionRef`, resolving from the approve commit through `git show` into a temp directory; `Submitter` gains `definitionRef` / why: the consult's required patch, so a `base_ref` run queues before the PR merges / may affect: 32-8

Pass 2 score: 1. Open (inferred, untested): at drive time `runJob` (`apps/supervisor/src/cli.ts:1250`) re-validates without `definitionRef`, and `startRun` (`cli.ts:1673-1697`) runs `jobrun.py submit --directory <served root>`, which resolves the definition, project key and routing from one root (`plugins/tk-studio/lib/jobrun.py:460,465,475`). Before merge and pull-back the job file is absent there, so a `base_ref` run would end `blocked` and the engagement would stay `approved`.

DRIFT: `submitJob`/`validate` take an optional `definitionRef` (the approve commit) for a `base_ref` enqueue — the job exists only on `engagement/ENG-NNN` before merge — affects: 32-8

### pass 3 (2026-10-25, implementer, after operator ruling (c); tracked-file edits of passes 1-2 were absent from the tree, redone)

- planned: run queued at once with `base_ref` (I/O matrix, AC1) / actual: queued only on the PR's merge in every case, `base_ref` passed to that run; the OPEN-PR real-`submitJob` test and the `definitionRef` path removed / why: operator ruling 2026-10-25 option (c) / may affect: 32-8
- planned: events `engagement-approve`, `engagement-run-queued`, `engagement-issue` with `kind` / actual: also `engagement-run-stop`, `engagement-cap`, `engagement-continue`; `after_run` on `engagement-run-queued`; `detail.root` on `engagement-approve`; cap/ask refusals as `engagement-issue {action: refused, kind, step: "block"}` / why: dedupe, resubmit bookkeeping, finding targets at the `finally` sites / may affect: 32-7, 32-8
- planned: the engagement's `run-epic-N` job / actual: one job declared per appended epic, only the first queued / why: a scope may propose several epics / may affect: 32-8
- planned: steady/ask stop once `storyLanded` names a story / actual: `storyLanded`, else the run's newest `close-out` story key / why: the paused-run pass relaunches before this pass runs / may affect: none
- planned: `NotApproved` for a record not approved / actual: reported only when the record has an applied `approve` line and no `queued` step yet / why: the pass sees every engagement at every `finally` site / may affect: none
- planned: each step emits an event / actual: a step event identical to that step's newest one is not repeated; worktree-setup failures reported on step `append` / why: avoids one event per tick for a permanent refusal; no dedicated setup step / may affect: none
- planned: `closeStep` closes only a questions block / actual: it also closes nothing while the newest block is `cap` or `ask` / why: same Jira issue / may affect: none
- planned: re-key in `epic_bands_text`'s byte shape / actual: TypeScript `rekeyBands`, identical output, pinned by `test_quote.py` / why: the supervisor does not call `quote.py` / may affect: none
- planned: "every other byte kept" / actual: contract says "the rest of the file kept byte for byte" / why: the 32.5 pin forbids the phrase "every other byte" / may affect: none
- planned: `--kind questions|cap|ask` with `--reason` / actual: added refusals `UnknownKind`, `ReasonMissing`, and `--reason` refused with `--kind questions` (and on `--story` blocks); result carries `kind` / why: refusals by name before any call / may affect: none
- planned: placement fallback in `cli.ts` / actual: new exported `engagementSubmitter`/`engagementPlacement` passing tier/sandbox to `submitJob`; new `RunOptions.approve`, `RunOptions.runSpend` / why: keeps `submitJob`'s only new input `payload` / may affect: none
- planned: `api.test.ts` shows approve starts the pass / actual: asserts the injected hook is called; real pass covered in `approve.test.ts` / why: routed fixture has no git repo / may affect: none
- planned (pass 1 actual): `afterInput` also on `cancel` / actual: not on `cancel`; a cancel's graceful stop applies at the next `finally` tick / why: spec names only `approve` and `go` from `partial` / may affect: none

Implementer DEVIATION SCORE: 2. Implementer-reported risks: no live Jira/`gh` run; later epics of a multi-epic scope declared but not queued; nothing closes a `cap`/`ask` block once answered; steady/ask graceful stop usually lands on a relaunched engine; `cancel` applied at the next tick.

DRIFT: first run queued on the approve PR's merge in every case, `base_ref` passed to it — operator ruling (c) 2026-10-25 — affects: 32-8
DRIFT: extra service events `engagement-run-stop`, `engagement-cap`, `engagement-continue`; `after_run` on `engagement-run-queued`; `detail.root` on `engagement-approve`; cap/ask refusals as `engagement-issue {action: refused}` — dedupe, resubmit bookkeeping, target finding at the finally sites — affects: 32-7, 32-8
DRIFT: one `run-epic-N` job declared per appended epic, only the first queued — the scope may propose several epics — affects: 32-8
DRIFT: steady/ask stop keys on `storyLanded` else the newest `close-out` story key — the paused-run pass relaunches first — affects: none
DRIFT: budget-bands re-key is a TS `rekeyBands` matching `epic_bands_text`'s bytes, pinned by `test_quote.py` — the supervisor does not call quote.py — affects: none
DRIFT: `track.py block --engagement` refusals `UnknownKind`, `ReasonMissing` — refusals by name before any call — affects: none

### pass 4 (2026-10-25, implementer, review patches)

- planned: commit step pushes with `git push -u origin <branch>` / actual: `git push -q --force -u origin engagement/ENG-NNN` (approve.ts:679) / why: a re-approval after revise cuts a fresh branch from origin's default branch; with the earlier PR unmerged a plain push is non-fast-forward and fails every retry / may affect: anything else pushed to `engagement/ENG-NNN`; an open earlier-cycle PR updated in place — HELD, escalated
- planned: (not in the brief) / actual: on resume an existing `run-epic-N.json` in the kept worktree is not rewritten / why: avoids a second commit for no content change / may affect: none
- planned: queued-run cancel through the existing cancel path / actual: injectable `ApproveDeps.cancelQueued` wired to cli.ts `cancelRun`, `Queue.end(cancelled, {from: "queued"})` fallback / why: approve.ts cannot import cli.ts / may affect: none

Implementer DEVIATION SCORE: 1 (story overall stays 2).

DRIFT: the approve pass force-pushes `engagement/ENG-NNN` — a re-approval after revise could otherwise never push its fresh branch — affects: none (HELD: escalated, not accepted)
DRIFT: the queued-run cancel is an injectable `ApproveDeps.cancelQueued` wired to `cancelRun` — approve.ts cannot import cli.ts — affects: none

### pass 5 pre-check (2026-10-25, orchestrator, session 12)

- The tree at resume holds only the untracked `apps/supervisor/src/approve.ts` and `apps/supervisor/test/approve.test.ts` (from pass 4); every tracked-file edit of passes 3-4 (api.ts, cli.ts, questions.ts, queue.ts if any, fakes.ts, api.test.ts, questions.test.ts, README.md, track.py, test_track.py, test_quote.py, driver-contract.md, test_driver_contract.py, tk-studio-track SKILL.md) is absent and must be redone against the current approve.ts.
- `approve.ts:679` still carries `git push -q --force -u origin <branch>`; the operator ruling (2), never force (Consult Log, last line), is not yet applied.

### pass 5 (2026-10-25, implementer, tracked edits redone + operator ruling (2) applied)

- planned: the commit stages only the union of plansync's `written[]` and the pass's files / actual: on a re-approval cut from an unmerged `origin/engagement/ENG-NNN`, the worktree is first reset to the default branch's tree (`git read-tree -u --reset`) so the new commit replaces the earlier plan wholesale; merged is decided by git ancestry (a squash-merged earlier PR counts as unmerged: cut from the branch, new PR opened); new named refusals `OriginUnreachable`, `NoMergeBase`, `NonFastForward`; the `commit` event gains `cut` / why: operator ruling (2), "replacing the earlier sections and entities wholesale in content" / may affect: none
- planned: `engagement-issue` events carry `kind` / actual: only `blocked` events carry `kind`; questions-pass `refused`/`closed` events do not, and an event without `kind` reads as `questions` / why: keeps 32.3 events and assertions stable / may affect: 32-8
- planned: `track.py --kind` with `--reason` / actual: also refuses `--kind` with `--story` and `--reason` with `--kind questions`; result carries `kind` / why: each refusal named before any Atlassian call / may affect: none
- planned: contract clause, §1 row, state-table text, track row / actual: also "Story 32.6" in the contract's "Story / rulings" header row, pinned / why: every earlier 32.x story is listed and pinned there / may affect: none
- planned: `submitJob` gains `payload`, placement fallback in `cli.ts` / actual: exported `engagementPlacement`/`engagementSubmitter`, `RunOptions.approve`/`RunOptions.runSpend` (accepted at pass 3) / why: keeps `submitJob`'s only new input `payload` / may affect: none
- planned: `api.test.ts` shows approve starts the pass / actual: asserts the injected hook is called; the real pass in `approve.test.ts` (accepted at pass 3) / why: routed fixture has no git repo / may affect: none
- planned: `fakePlansync` normalize and sync with `written[]` / actual: also mints one `EP-<next>.md` per new `## Epic N`, advances `plan-counter.yaml`, gains a `sync(answer)` setter / why: tests check the minted EP id, the band re-key and the commit's file list / may affect: none
- carried, already accepted (unchanged): extra events `engagement-run-stop`/`engagement-cap`/`engagement-continue`/`after_run`; one job per appended epic, first queued; steady/ask stop on `storyLanded` else newest close-out; `NotApproved` only after an approve line; identical step events not repeated; `closeStep` skips while newest block is cap/ask; TS `rekeyBands`; first run queued on merge (ruling (c)); injectable `cancelQueued` / may affect: 32-7, 32-8

Implementer DEVIATION SCORE: 2. Implementer-reported verification: lib unittest 1973 OK (2 skipped), conformance `ok: true`, `bun test` 1340 pass / 0 fail, `tsc` clean. Risks: no live Jira/`gh`; squash-merged earlier PR read as unmerged; D1-D3 open; later epics not queued; cancel at next tick; steady/ask stop lands on a relaunched engine.

Consult (pass 5) recorded seams: a kind-less `engagement-issue` event reads as `questions` (`apps/supervisor/src/questions.ts`), a seam 32-8 relies on; a squash-merged earlier PR is cut from the old branch and gets a new PR. (b)-(e) accepted at score 1; story score stays 2.

DRIFT: re-approval after revise cuts from unmerged `origin/engagement/ENG-NNN`, resets to the default branch's tree and commits fast-forward; refusals `OriginUnreachable`, `NoMergeBase`, `NonFastForward`; `commit` event gains `cut` — operator ruling (2), never force — affects: none
DRIFT: only `blocked` `engagement-issue` events carry `kind`; a kind-less event reads as `questions` — keeps 32.3 events stable — affects: 32-8
DRIFT: `track.py` also refuses `--kind` with `--story` and `--reason` with `--kind questions` — refusals named before any call — affects: none
DRIFT: contract "Story / rulings" header row names Story 32.6, pinned — every 32.x story is listed there — affects: none
DRIFT: `fakePlansync` mints EP files and advances the plan counter — the tests check minted ids — affects: none

### pass 6 (2026-10-25, implementer, review patches P1-P8)

- planned: P1 fetch `origin/engagement/ENG-NNN` on resume / actual: the commit step on every pass reuses the per-pass fetch into `refs/remotes/origin/<branch>` and, when origin's tip is not an ancestor of HEAD, runs `git reset -q --soft <origin tip>` and commits on top (no `--amend` after it), so the push stays a plain fast-forward — the recovery path for `NonFastForward` / why: the ref is already fresh at commit time; also covers a remote that moves during a fresh cut / may affect: none
- planned: P2/P3 record `removed[]` in the sync step detail / actual: `removed` added to the ok sync and commit details only when non-empty; a failed partial sync's detail carries `partial: true, written, removed` / why: keeps existing event shapes unchanged when nothing is removed / may affect: none
- planned: P4 refusal `StoryShape: <k>.<m>` / actual: `StoryShape: 2.1 (under ### Epic 1: …)`, the story heading's own number / why: names the heading the owner must fix / may affect: none

Implementer DEVIATION SCORE: 1 (story overall stays 2).

DRIFT: NonFastForward recovery is `reset --soft` onto origin's fetched tip plus one commit on top, pushed plainly — operator ruling (2), never force — affects: none
DRIFT: `removed` / `partial` fields added to approve step event details — keeps event shapes stable when empty — affects: none
DRIFT: misnumbered story refused as `StoryShape: <story k>.<m> (under ### Epic <k>: …)` — names the heading to fix — affects: none

### pass 7 (2026-10-25, implementer, follow-up review patches F1-F2)
- F1: `runStep` adds `allLinks` (every approve cycle) and `liveAll()`; the early return keys on `allLinks`, so steps 5/6 also run when only earlier-cycle runs are linked (they still gate on `partial`/`paused` + `blockOwed`); step 7 returns without a current-cycle link. Consult: accept-deviation score 1.
- F2: `reservedEpics` reserves ok `append` steps as well as ok `job` steps. Score 0.
- The full `bun test` needs `TK_STUDIO_ROOT` set (as Verification already states); 6 closeout/sandbox tests fail identically without it on the unpatched code. Consult: not a deviation.
- Overall `deviation_score` stays 2 (the earlier passes).

## Consult Log

- 2026-10-25T13:09:28Z — trigger: deviation-gt-0 — question: accept the implementer's score-2 deviations, and is `base_ref` "queued at once" failing validate in the served root acceptable? — ruling: accept-deviation score 2 — do: accept (a)-(d) as DRIFT for 32-7/32-8; treat the base_ref risk as a required patch: with base_ref the queued step must resolve and enqueue run-epic-N before the PR merges, validating against the definition on engagement/ENG-NNN (or its worktree), never writing it into the served root; add an approve.test.ts case using the real submitJob validation path showing the job queued while the PR is OPEN — rule candidate: When a story enqueues a job the same pass declares on an unmerged branch, its tests exercise the real submitJob validation (or name the branch it resolves from); a fake submitter alone does not satisfy an "at once" AC.
- 2026-10-25T13:21:32Z — trigger: deviation-gt-0 (second question: the drive-time half of the base_ref first run) — question: with base_ref, runJob re-validates and jobrun.py submit resolves the job from the served root, where it is absent before merge; patch within Files, accept as DRIFT, or escalate? — ruling: escalate — do: halt blocked under the plan's Files-boundary Block If; keep the enqueue-time patch; record the drive-time gap as unverifiable-here; the operator chooses (a) add jobrun.py to Files so submit takes a definition source separate from its --directory project key (a §4 contract surface), (b) allow the engagement job file and config entry to be written untracked into the served root (lifts "never dirtied"), or (c) amend AC1 so a base_ref run drives only after merge and pull-back — rule candidate: When a story queues a job the same pass declares on an unmerged branch, the plan's Files lists every drive-time resolver (runJob validate and jobrun.py submit), or the plan records that the run drives only after merge.
- 2026-10-25T13:4xZ — operator ruling on the escalation — Operator ruling 2026-10-25 (session 11), on the second consult's `escalate`: **(c)**. A `base_ref` approval never drives before the engagement PR merges. The merge watch queues the first `run-epic-N` in every case (the job resolves from the served root only once the PR lands); `base_ref`, when given, is recorded on the input and passed to that queued run as its `base_ref` (its worktree is cut from it), nothing else. No untracked file reaches the served root (never dirtied), and `jobrun.py` keeps its `--directory` definition source (no new §4 surface). AC1's clause reads: queued on the merge in both cases, cut from `base_ref` or main. The first consult's enqueue-time patch (resolve and enqueue before the merge, the OPEN-PR test) is withdrawn: remove it, or keep the branch-definition validation as a pre-check that never enqueues, the implementer's choice within Files. The drive-time gap is closed by construction (not `unverifiable-here`). Proceed to review (step 04) and commit.

- 2026-10-25T13:42:22Z — trigger: deviation-gt-0 (pass 3: track.py UnknownKind/ReasonMissing refusals; engagementSubmitter/engagementPlacement + RunOptions.approve/runSpend; no afterInput on cancel) — question: accept or reject the pass-3 new deviations, at what score? — ruling: accept-deviation score 2 — do: accept (1)-(3), overall score stays 2 (each new item alone is 1); keep the refusals as the contract row states them, add no afterInput on cancel; carry "cancel applied at the next tick" to the 32-8 hand-off as a known latency — rule candidate: A deviation that brings the code back to the spec's own Tasks list, or that adds a named refusal the same story already writes into its driver-contract row, scores 1 and needs no consult.
- 2026-10-25T13:47:35Z — trigger: high-severity-finding (review pass 1: H1 re-approval after revise is a no-op; H2 sync retry re-promotes to Jira) — question: patch H1/H2 within Files, and is the rest of the triage (6 medium/low patches, defer D1-D3 under (a), reject cap timing) correct? — ruling: apply — do: patch H1 (scope okStep/done/launched/linksOf to the newest approve line, spend unscoped) and H2 (resume in the kept worktree after an ok sync until the push; cross-process lockfile under TK_SUPERVISOR_WORK); apply the medium/low patches, defer D1-D3 under (a) with D1 against SPEC Open Question 3, reject cap timing — rule candidate: Any pass that is idempotent through its own step events scopes those events to the newest triggering input line, and any step with an external side effect (a Jira promote, a PR) keeps its local state until the next durable checkpoint (a push), so a retry never repeats it.
- 2026-10-25T14:04:44Z — trigger: deviation-gt-0 (pass 4: `git push --force` on engagement/ENG-NNN; resume keeps run-epic-N.json; injectable cancelQueued) — question: accept the force push at score 1, require --force-with-lease, reject, or escalate under the PR-only / deny-list hard rule? — ruling: escalate — do: hold deviation (a); the operator decides whether the supervisor may force-push its own engagement/ENG-NNN branch, or whether a re-approval after revise must reach origin without a force push (a fast-forward commit on top of origin/engagement/ENG-NNN replacing the earlier plan, or closing/superseding the unmerged PR); (b) and (c) recommended accepts at score 1 — rule candidate: Any supervisor git step that would rewrite a remote branch, including the supervisor's own feature branches, is an operator decision; implementers choose a fast-forward or new-branch design and never add --force or --force-with-lease.
- 2026-10-25T14:1xZ — operator ruling on the review-patch pass 4 escalation — Operator ruling 2026-10-25 (session 11), on the review-patch pass 4 escalation: **(2), never force.** The supervisor never force-pushes (the `permissions.deny` list keeps `git push --force*`; `--force-with-lease` is a force too). On a re-approval after `revise`, the approve worktree is cut from `origin/engagement/ENG-NNN` when that branch exists on origin (else from the default branch), the new plan lands as one more commit on top of it, replacing the earlier sections and entities wholesale in content, and the push is a plain fast-forward `git push -u origin engagement/ENG-NNN`; an open PR on that branch carries the new commit (no new PR), a merged earlier PR means the branch is cut from the default branch again and a new PR is opened; a push the remote rejects as non-fast-forward is a named refusal retried at the next pass, never forced. (b) the resume not rewriting `run-epic-N.json` and (c) the injectable `cancelQueued` are accepted at score 1. Proceed to review and commit.
- 2026-10-25T14:29:14Z — trigger: deviation-gt-0 (pass 5: re-approval cut from unmerged origin/engagement/ENG-NNN + read-tree reset to the default tree, refusals OriginUnreachable/NoMergeBase/NonFastForward, `cut` field; kind-less issue events read as questions; track.py extra refusals; contract header row; fakePlansync minting) — question: do the pass-5 deviations conform to operator ruling (2), at what score? — ruling: accept-deviation score 2 — do: keep (a) as written (no merge-base reset, no gh squash detection); accept (b)-(e) at score 1 and record the kind-less=questions seam (32-8) and the squash-merge new-PR behaviour in the pass-5 Deviation Summary; proceed to review — rule candidate: A supervisor branch that must reach origin is cut from its own remote ref when one exists, reset to the current default branch's tree and pushed fast-forward; merged means git ancestry, so a squash-merged branch counts as unmerged and gets a new PR.
- 2026-10-25T14:50:16Z — trigger: deviation-gt-0 (pass 6: P1 reset --soft onto origin's tip + plain push; removed/partial event details; StoryShape text) — question: accept the pass-6 deviations, and does P1 conform to ruling (2)? — ruling: accept-deviation score 1 — do: keep (a)-(c) as written (plain push, NonFastForward retried, never forced); record the reset --soft recovery path in the pass-6 Deviation Summary; proceed to review and commit — rule candidate: Recovering a non-fast-forward push of a supervisor branch is re-fetch origin's tip, reset --soft onto it, commit on top and push plainly; never amend a commit already on origin and never force — conforms to ruling (2) at score 1.
- 2026-10-25T15:16:10Z — trigger: deviation-gt-0 (follow-up review F1: runStep's early return and step 2/4 over every approve cycle's links; full bun test needs TK_STUDIO_ROOT) — question: accept the F1 deviation (steps 5/6 reachable with only earlier-cycle links), at what score, and is the TK_STUDIO_ROOT need a deviation? — ruling: accept-deviation score 1 — do: keep the patch as written (allLinks gates the early return and feeds the cap notice and step-4 stop/cancel; links still scopes step 1 and step 7); record (b) as no deviation (Verification already sets TK_STUDIO_ROOT; the 6 closeout/sandbox failures without it are pre-existing); add an approve.test.ts assertion that the earlier-cycle cap case writes the `kind: cap` block and resubmits nothing — rule candidate: When a review patch scopes per-cycle reads (launched/resubmit) to the newest approve line, enforcement over unscoped totals (cap, stop, cancel) must iterate every cycle's links. — observe.py record: ok

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass (session 13) over story 32.6, which was already done at `112fddc`. Both review layers ran against the 32.6 diff from baseline `a99e58e`. Two findings were patched, both in the engagement-run and approve passes:
- **F1 (medium):** the cap's graceful stop and `cancel` now reach a run linked under an earlier approval that is still live after revise + re-approve. Its cost already counted toward the cap.
- **F2 (low):** an ok `append` whose sync failed now reserves its `## Epic N` against a second engagement approved meanwhile.

**Files changed (this pass):**
- `apps/supervisor/src/approve.ts`:
  - `runStep` gains `allLinks`/`liveAll()`. The early return, the cap notice run and step 4's stop/cancel now cover every approve cycle; steps 1, 3 and 7 stay on the newest cycle.
  - `reservedEpics` also reserves ok `append` steps, deduped.
- `apps/supervisor/test/approve.test.ts`: `reapprovedWithLiveRun` plus three tests:
  - F1 cap: graceful stop, `partial`, one notice, the `kind: cap` block, once only, no resubmit.
  - F1 cancel.
  - F2: the second engagement takes `## Epic 42` / `run-epic-42`.
- This spec: triage log, the D6 deferral, deviation pass 7, the consult log and this result.

**Review findings:**
- Patches applied: 2 (medium 1, low 1).
- Deferred: 1 (medium; DEFERRAL DISCIPLINE (a)): a re-approval before merge orphans the first cycle's promoted Jira issues, a consequence of operator ruling (2).
- Rejected: 6 (medium 4, low 2). Three duplicate already-deferred DW-46, DW-47 and DW-48, and one is in DW-49's class.

**Follow-up review recommended:** false. The patched findings are medium 1 and low 1, so the score is 3×1 + 1×1 = 4, below 5.

**Verification:**
- `cd apps/supervisor && TK_STUDIO_ROOT=<root> bun test` (`TK_ATLASSIAN_*` unset): 1352 pass, 5 skip, 0 fail.
- After the F1 cap-block assertion was added, `bun test test/approve.test.ts`: 40 pass, 0 fail.
- `tsc --noEmit`: clean.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: 1973 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `0.1.27 (Story 32.6)` appears once in the contract; `**0.1.28**` appears 0 times.

**Residual risks:**
- Without `TK_STUDIO_ROOT` set, 6 closeout and sandbox tests fail. They fail the same way on the unpatched code; Verification already sets the variable.
- With only earlier-cycle runs linked, steps 5 and 6 (the cap/ask block and the ask `continue`) now run too. They still gate on `partial`/`paused` and `blockOwed`, and the consult accepted this at score 1.
- The earlier risks still stand: nothing has run against live Jira or `gh`; the served root is not pulled after merge (DW-46); and D1–D6 are open.

DRIFT: engagement-run pass early return, cap notice run and cap/cancel stop over every approve cycle's linked runs (launched/steady/ask/resubmit stay on the newest cycle) — a run linked before revise + re-approve kept spending past the cap — affects: none

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: Both escalations raised during the build were ruled by the operator (ruling (c): the first run is queued on the approve PR's merge in every case, `base_ref` only cuts it; ruling (2): never force-push), and the code conforms, so no AD, contract surface or ruling is contradicted (0.1.27 additive, no 0.1.28). What later work relies on is the set of seams the approve and engagement-run passes leave: the service events, one job per appended epic with only the first queued, approve cycles scoped to the newest approve line, kind-less issue events read as `questions`, and `cancel` applied at the next `finally` tick. Notes in 32-7's and 32-8's `invoke_dev_with` can absorb all of them; no Given/When/Then has to change.
- Affected: 32-7-the-chat-screen — "an **Approve** control with the autonomy choice (sends `approve`)": with `base_ref` the run still waits for the approve PR's merge, and the pass's progress (PR link, queued run) is only in `engagement-approve` service events, never in the record
- Affected: 32-8-delivery-the-closeout-report-and-change-requests — "the engagement's last run ending": a multi-epic scope declares one `run-epic-N` per epic but queues only the first, `steady`/`ask` end one run per story, and runs span approve cycles; "moves the engagement's Jira issue to `Done`": cap/ask blocks are never closed by 32.6
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 32-7-the-chat-screen
