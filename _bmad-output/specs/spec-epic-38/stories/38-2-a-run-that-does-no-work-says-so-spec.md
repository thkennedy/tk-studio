---
title: 'A Run That Does No Work Says So'
type: 'bugfix'
created: '2026-11-07'
status: 'done'
baseline_revision: 'd793349cb19741c1f016298dc1b0b106a719cbb5'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-2.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized, multiple-goals]
deferred: []
deviation_score: 2
reconcile_verdict: adjust-stories
---

> **Serve process changes.** `worktree.ts`, `closeout.ts` and `planstatus.ts` run inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** The first 37.6 run did no work. Both dev attempts halted on a stale render snapshot and wrote `status: 'halted'`. Because that word is not `blocked`, nothing paused and the hole-65 auto-resume never fired. The close-out still ran a 2134 s host leg over a tree equal to the base, the run ended `complete`, the plan entry stayed `in-progress`, and the halted attempts left no Stage Log row (hole 114, DW-180, AI-2, the retrospective's C3).

**Approach:** Everything is read on the supervisor's side, and the engine is never edited (AD-4). A no-story end becomes `partial` with the engine's last record as its reason and no host leg. The auto-resume keys on the render failure's signature whatever status word the session wrote; on the ended path it relaunches once. The plan-status pass returns the story to `draft`. A halted attempt keeps its Stage Log row. The renderer re-reads its outputs after the staging rename and falls back to a direct write into a fresh destination (a base patch registered beside DW-110's).

**Acceptance criteria (verbatim from epics.md, Story 38.2):**

- AC1. **Given** `closeout.ts`'s "no changes" end (`no_changes: true`, the run `complete`) and the leg over a tree equal to the base **When** the engine ends with no commits and the story's spec not `done` **Then** the run ends `partial` with the engine's last record as the reason (the session's `halted`/HALT text and the attempt count), the close-out skips the host leg when the tree equals the base (one `host-verify` note `skipped: no changes`), the notifier line reads `partial: no story landed`, and the `job-run` ledger line carries the worker's cost; the supervisor suites pin it with a fake
- AC2. **Given** the hole-65 auto-resume (`closeout.ts`, Story 33.6: keyed on a `blocked` draft and a CRITICAL escalation) and the first 37.6 run's two halted attempts (`refs/attempt-preserve-dirty/20261106-102516-76a4-*`, `status: 'halted'`, five of ten generation files `-?????????` from inside the sandbox) **When** a dev session halts on the render failure's signature (the HALT text naming a generation file, a generation folder with unreadable entries) **Then** the auto-resume fires on the signature whatever status word the session wrote (`halted` included), removes the snapshot and resumes once (a second pause of the story pauses with the owner told, as today), and the plan-status pass returns the story to `draft` with the halt note when a run ends without a PR, so a plan entry never reads `in-progress` for a story no run holds; `closeout.test` and `planstatus.test.ts` pin each; the retrospective's open question (a HALT on a missing skill file as a CRITICAL escalation) is answered by the signature keying on the supervisor's side, not by the engine
- AC3. **Given** the halted attempt's Stage Log (Story 37.3 gives a timed-out attempt its row; the 37-6 log goes from its plan row to the second run's dev row) and `_bmad/scripts/render_skill.py`'s `_publish` (the staging rename across the sbx mount; DW-110's retry patch in `kb/bmad-base-patches.md`) **When** an attempt ends halted, and when a render's rename lands **Then** the attempt writes its row (`outcome: halted`, start and stop, tokens and cost from the session record) through the timeout row's path and `test_stage_log` pins it; both tracked copies of `render_skill.py` verify every output by reading it after the rename and, on a stat failure, remove the generation and write the outputs straight into a fresh destination, registered as a base patch beside DW-110's with a test for both branches; the runbook's hole-65 and hole-114 rows read fixed; the contract names the `partial` rule (0.1.34, additive)

## Boundaries & Constraints

**Always:**
- Follow the plan's `## Settled shape` 1–8 (`plans/38-2.md`). It is the design. Its `## Files` list (18 files, all modified) is the boundary.
- House rules: stdlib-only Python run via `uv run`, atomic writes, and an encoding named on every text open (`encoding="utf-8"`). `render_skill.py` I/O is binary. Every `bun test` names `--timeout 30000`. A renamed folder goes only onto a fresh name (WinError 183). Normalise a `path.join` path before a POSIX assertion.
- The two `render_skill.py` copies stay byte-identical and carry the marker `tk-studio base patch render-skill-reread-fresh-destination` once each.
- A skipped leg notes no `host-verify-leg` lease, so the skip sits before `noteCloseOutLease`.
- The relaunch event for a halted story carries no `story_key` (`planstatus.finishedStories` would count it).
- The contract appends to 0.1.34 and bumps nothing. DW-180 resolves `by Story 38.2`, and DW-110 is left as it stands.

**Block If:**
- The ended engine's relaunch (shape 3) cannot be driven from the paused pass without a new queue transition beyond `markPaused` → `resumeFromPause`. Consult (`bad_spec`).
- `stage --from-pass --worktree <checkout>` cannot place the halted rows in the checkout's buffer, because there is no `spec_folder` to derive one from. Consult (`bad_spec`).
- A pinned stage-log test expects `outcome: completed` for a `blocked`/`halted` session record. Consult (`deviation-gt-0`) before narrowing `_session_outcome` to `halted` alone.
- The Files list must grow beyond the plan's 18. Consult (`halt`), and never split the story.

**Never:** Edit the engine (bmad-loop) or resume an ended engine through `resolve --resume`. Write a spec into the checkout by hand. Add a `patches.json` entry without an upstream issue URL. Patch `apps/supervisor/_bmad/scripts/render_skill.py.bak`. Push, tag, open a PR, or touch remotes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No-story end | Engine ended, 0 commits ahead, story spec (or stashed copy) `halted`, 2 `dev-decision`s | `state: partial`; reason `no story landed: story <key> ended halted after 2 dev attempt(s): <HALT text>; engine ended '<status>'`; one `host-verify {skipped: true, reason: "no changes"}`; no lease; notice `ended partial` + `reason: no story landed`; `finish` argv carries the worker cost | A failed commits probe → the leg runs as today |
| Commits ahead | Engine ended with ≥1 commit | The leg runs as today | — |
| No `story-start` | 0 commits, no story key in the segment | Today's end state; the leg still skipped | — |
| Ended path + signature | No-story end whose spec carries the render signature, the snapshot ready, no attempt-1 marker | Paused (`paused_stage: "no-story"`); the pass relaunches once (`via: "relaunch"`), with no `story_key` on the relaunch event | Attempt 2 → `secondHaltLine`, stays paused |
| Paused path, `halted` word | Paused escalation, spec `halted`, HALT text naming a generation file / `-?????????` | Auto-resume fires (`via: "resume"`) | A tracked spec → refused |
| No PR | Terminal run with no PR, story `in-progress` ok | One `plan-status {phase: "draft"}` under lease `draft:<key>`, note `run <id> ended without a PR: <reason>` | Transient → retried up to `PLAN_RETRY_LIMIT`; a run with a PR → no call |
| Halted stage row | Session `completed`, `result_json.status: halted` | `outcome: halted` in both `stage_from_pass` and `_backfill_rows` | A spec absent → buffered, then flushed |
| Render rename | Outputs re-read OK | Unchanged result | Stat/read failure or mismatch → rmtree (else rename to `.stale-<pid>`), mkdir, direct write (manifest last), re-read; a second failure → `RenderError("failed to verify <path> after a direct write: …")` |

</intent-contract>

## Code Map

The plan `plans/38-2.md` `## Code Map` is the full investigation. Use its **"Refreshed at the 38-1 gate"** anchors. They were re-grepped at `d793349c` and still hold:

- `apps/supervisor/src/worktree.ts`:
  - `PAUSED_DIRTY` :625, `closeOut` :720 (`git log --oneline` :794, `no_changes` :798), `launchedCloseOutInput` :910, `closeOutDetail` :966, `engineEndState` :990, `storyLandedBeforeStop` :1000 (the journal-segment reader to copy), `engineStatus` :1021, `finishStudio` :1047, `notifyText` :1084, `sweepEngines` :1095.
  - The `PAUSED_DIRTY` skip :1238, then the leg `legGuard` :1243 → `noteCloseOutLease` → `hostVerify`, then `finishStudio` call :1306.
  - Cost fallback precedent: `cli.ts cancelCostUsd` (`queue.accountedCost(run_id, "worker")`).
- `apps/supervisor/src/closeout.ts`: `pausedStory` :140, `findSpec` :166, `closeOutLanded` (the relaunch tail to extract as `relaunchEpic`), `blockingCondition`, `STALE_RENDER_VIEW`/`DEV_ESCALATION`/`RENDER_HALT_MESSAGES`, `snapshotFolders`, `staleRenderView` (drop the stage/DEV_ESCALATION/`blocked` checks), `snapshotReady`, `autoResumeAttempt`, `autoResume`, `closeOutPaused`.
- `apps/supervisor/src/planstatus.ts`: `Phase` (add `"draft"`), `reviewPass` (the no-PR `continue`: draft goes there), `storyInProgress` (lease/retry pattern), `callStatus`, `finishedStories` (the `story_key` pitfall).
- `plugins/tk-studio/lib/plansync.py`: `stage_from_pass` (outcome from `current.get("status")`), `_backfill_rows` (outcome from `session.get("status")`), `_StageDoc` buffer/commit.
- `_bmad/scripts/render_skill.py` = `apps/supervisor/_bmad/scripts/render_skill.py` (identical): `_verify_existing`, `_publish` (36.3 retry block), `render`, `main`; the existing marker form at :146.
- Tests: `apps/supervisor/test/{worktree,closeout,autoresume,planstatus}.test.ts` (autoresume :163/:246 flip; :558/:573/:583 stay green); `plugins/tk-studio/lib/tests/test_stage_log.py` (`add_pass` :124, 37.3 cases :272-389); `test_basepatch.py StagingRenameRetryTests` :132-215; `test_driver_contract.py` `test_0_1_34_story_38_1_…` :3449 (add 38.2's after it, model `test_0_1_32_story_37_6_…`).
- Records: `driver-contract.md` line 5 (0.1.34), 38.1's paragraph before `## 8. Conformance`; `kb/bmad-base-patches.md` `render-skill-staging-rename-retry` section; `kb/agent-pc-setup-runbook.md` hole 65 / hole 114 rows; `deferred-work.md` DW-180.
- Engine (read only): a `halted` spec synthesizes `result_json.status: "halted"` with no escalation → RETRY then DEFER. `_stash_deferred_artifacts` moves the spec to `<run dir>/deferred/<key>/`. The journal carries `dev-decision` and `session-end`. An ended engine can only be relaunched.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/worktree.ts` -- `commitsAhead` (factored from `closeOut`), `NO_CHANGES_SKIP`, the leg skip before the lease, `noStoryReason`, the `partial` end, the ended-path pause on the signature, the `stage-carry` call, the `finishStudio` cost fallback -- AC1, AC2, AC3 (shapes 1, 3, 5)
- `apps/supervisor/src/closeout.ts` -- `RENDER_UNREADABLE_RE`, `renderSignature`, the generalised `staleRenderView` (stashed-spec fallback), `relaunchEpic` extracted from `closeOutLanded`, `autoResume`'s relaunch branch and marker fields `via`/`status_word`, the header -- AC2 (shapes 2, 3)
- `apps/supervisor/src/planstatus.ts` -- `Phase` `"draft"`, the draft call in `reviewPass` under lease `draft:<key>`, the header -- AC2 (shape 4)
- `plugins/tk-studio/lib/plansync.py` -- `_session_outcome`, used by `stage_from_pass` and `_backfill_rows` -- AC3 (shape 5)
- `_bmad/scripts/render_skill.py` + `apps/supervisor/_bmad/scripts/render_skill.py` -- `_verify_published` and the fresh-destination fallback, identical, with the marker -- AC3 (shape 6)
- `apps/supervisor/test/worktree.test.ts`, `closeout.test.ts`, `autoresume.test.ts`, `planstatus.test.ts` -- pin every matrix row on the TS side (the fake engine's two halted attempts, the 37.6 shape with five of ten files `-?????????`, the stashed spec, relaunch once, attempt 2, draft once, no draft with a PR) -- AC1, AC2
- `plugins/tk-studio/lib/tests/test_stage_log.py`, `test_basepatch.py` (`RereadFreshDestinationTests`) -- the halted row, its backfilled twin, buffered then flushed; both render branches, the marker, identical copies, no registry entry -- AC3
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the 38.2 clause in line 5, `, Story 38.2` in the Stories row, the `**0.1.34 (Story 38.2, additive).**` paragraph opening with the partial-rule sentence (shape 7), and `test_0_1_34_story_38_2_a_run_that_does_no_work_says_so` -- AC3
- `kb/bmad-base-patches.md`, `kb/agent-pc-setup-runbook.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- the register entry, hole 65 and hole 114 rows reading fixed, DW-180 resolved -- AC3

**Acceptance Criteria:** AC1–AC3 above, verbatim. Each is proven by the suites named in Verification.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- Note: the 276 KB diff was handed to both layers as a file (`/tmp/rv382/38-2.diff`), not inlined; the Blind Hunter was told to read only that file.
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 4, low 2)
- defer: 0
- reject: 4 (medium 2, low 2)
- addressed_findings:
  - `[high]` `[patch]` `storiesToDraft` drafted stories another run holds or landed (historic 37.6/ST-166, later in-progress, commits without a PR) — guarded per consult ruling: own close-out `no_changes`, no later run's ok in-progress/review/done, no run's ok review/done; each guard pinned alone
  - `[medium]` `[patch]` the `partial` end keyed on `c.no_changes`, so an errored close-out with zero commits ended `complete` — now keyed on the zero-commit probe; the halt pause without `no_changes` ends `partial`
  - `[medium]` `[patch]` the no-story override softened any end — now replaces only `complete`
  - `[medium]` `[patch]` the signature ran over the 300-char clipped reason, so a cut generation path defeated it — computed over the unclipped HALT text
  - `[medium]` `[patch]` the render fallback leaked raw `OSError` (mkdir/rename/write) and could rename onto an existing `.stale-<pid>` — every fallback `OSError` is a `RenderError("failed to verify … after a direct write")`; fresh stale names
  - `[low]` `[patch]` missing pins: failed commits probe runs the leg, the draft pass skips `external`, `noStoryEnd` fallbacks — added
  - `[low]` `[patch]` the ended path's failed relaunch leaves the run paused — pinned: `auto-resume {via: relaunch, resumed: false, error}` plus the owner's refused line
- rejected (one line each): fallback writes non-atomically into the generation — the AC orders a direct write into a fresh destination; recognition broadened to generic ENOENT text — plan shape 2 pins `RENDER_UNREADABLE_RE` and AC2 keys on the signature whatever the status word, with untracked-spec and single-folder checks kept; DW-180 resolved while registration is owed — `kb/bmad-base-patches.md` carries "Registration is owed" on DW-110's precedent; `_session_outcome` reports `in-progress` for an unfinished session — the plan's rule, and the word is accurate for an attempt that did not finish

### 2026-11-08 — Review pass (follow-up)
- Note: the 321 KB diff (baseline `d793349c` to the working tree) was handed to both layers as a file (`/tmp/review-38-2-fu/diff.patch`), not inlined. Both layers ran (band L).
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 3, low 1)
- defer: 0
- reject: 1 (medium 1)
- addressed_findings:
  - `[medium]` `[patch]` The sweep signed the unclipped HALT text, but the pause stored the 300-char-clipped `paused_reason`, which `staleRenderView` signed. A cut inside the generation path named a second folder, so the pass left the `no-story` pause stuck and silent. Fix: the pause carries `no_story.halt_text` and the pass signs it. The 300-char worktree test now runs `closeOutPaused` through to the one relaunch.
  - `[medium]` `[patch]` `haltedOnRender` paused a no-story end the pass refuses (spec absent, or tracked), leaving the run paused with nobody told. Fix: a shared `specUntracked` predicate in `worktree.ts`; the sweep pauses only when the spec is found and untracked, otherwise the `partial` end stands. Absent-spec and tracked-spec cases pinned.
  - `[medium]` `[patch]` The operator's `POST /runs/{id}/resume` of an ended-engine pause would spawn `resolve --resume` on an ended engine, which the spec's Never list forbids. Fix: `resumePaused` refuses `RunNotPaused` (`engine <eid> ended '<status>' — a resume never re-drives an ended engine; cancel the run`) before any spawn. Pinned: no spawn, no `engine-resume`, run still paused.
  - `[low]` `[patch]` The contract's draft paragraph omitted the three draft guards that `storiesToDraft`/`heldElsewhere` apply. Fix: one appended sentence in 0.1.34 (Story 38.2), pinned in `test_0_1_34_story_38_2_…`.
- rejected (one line): the ended-path auto-resume and the draft require zero commits on the whole branch — AC2's Given anchors the 37.6 shape (a first engine, two halted attempts, no commits, the one-story stop); a multi-story engine defers a halted story and moves on rather than ending, and AC2 scopes the draft to "a run ends without a PR".

### 2026-11-08 — Review pass (follow-up 2)
- Note: the 307 KB diff (baseline `d793349c` to the working tree, the spec excluded) was handed to both layers as a file (`/tmp/review-38-2-fu2/diff.patch`). Both layers ran (band L).
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 2, low 0)
- defer: 0
- reject: 5 (medium 4, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `noStoryEnd` read only the journal segment after the latest `run-resume`. A resumed engine journals no fresh `story-start`, so if it ended `finished` with zero commits the run ended `complete` with no `no story landed` reason, which AC1 forbids. Fix: when the segment has no `story-start`, fall back to the whole journal's latest `story-start` and count attempts from it onward (`journalEntries` helper). The contract's 0.1.34 paragraph gains a "The resumed segment:" sentence, and it is pinned.
  - `[medium]` `[patch]` `_verify_published` ended in a `RenderError` when the stale view hid the destination folder itself: `rmtree` and the rename-aside both raised `FileNotFoundError`, so the direct write that AC3 requires never ran. Fix: an absent destination skips the rename-aside and goes straight to `mkdir` and the direct write (manifest last), then re-reads every file. Both copies are identical, the marker appears once, and the register entry is amended. Pinned by `test_an_unseen_destination_skips_the_rename_and_writes_it_direct`.
- rejected (one line each):
  - **Recognition across any pause stage**, so an unrelated halt that quotes a render path is auto-resumed. The plan drops the stage check, and a non-dev session halting with a render path plus an unreadable entry is the same stale-render failure. The untracked-spec, one-folder, ready-snapshot and attempt-1 checks still bound it.
  - **The ended-path relaunch bypasses the operator's graceful stop.** AC2 orders the one resume. The relaunched engine gets its own figure-1 stop armed per `engine_run_id` (`planstatus.ts` `backstopOwed`/`armStop`; `cli.ts:1755`).
  - **`autoResume` and `resumePaused` disagree on "engine ended".** This cannot happen: the sweep pauses `no-story` only on `phase: "ended"`, which requires `status ∈ ENGINE_ENDED` (`worktree.ts` `engineStatus`).
  - **Sweep runs keep the host leg on an unchanged tree.** AC1's When clause names a story's spec, and a sweep drives bundles, not a story.
  - **The render fallback may remove a generation another renderer published.** AC3 orders the removal and the direct write when a re-read fails. The generation is content-addressed, so equal bytes never trigger the fallback; only a failed view does.

## Design Notes

The plan's Settled shape 1–8 is binding. Key choices, restated so review can check them:
- The "no changes" end lives in `worktree.ts sweepEngines`/`closeOut`, not `closeOut.ts`. The AC's file name is loose. That is no deviation.
- A `halted` word never pauses the engine. So the 37.6 shape is the **ended** path: the supervisor pauses it itself, then relaunches it through the 27.3 relaunch. The paused path keeps covering a `blocked` render HALT. This is the supervisor-side answer to the retrospective's open question.
- The notifier's `partial: no story landed` is the `noticeText` pair `ended partial` / `reason: no story landed: …`. The suite pins both substrings.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` (includes `e2e_windows_semantics`, `e2e_text_encoding`)
- `cd apps/supervisor && env $(env | grep -o '^TK_ATLASSIAN_[A-Z_]*' | sed 's/^/-u /') PATH=$HOME/.bun/bin:$PATH bun test --timeout 30000` (every `TK_ATLASSIAN_*` unset: `guards.test.ts`'s two sbx cases fail with them exported, pre-existing, pinned by 38.6) -- expected: green (the four story suites included)
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bunx tsc --noEmit -p .` -- expected: no errors

**Manual checks (if no CLI):**
- Unverifiable here: the Windows host leg (`tools/verify_host.py`) and a live stale-render recurrence. Those are the operator's, on the box.

## Deviation Summary

### pass 1 (2026-11-07)

- planned: `renderSignature`/`RENDER_UNREADABLE_RE` in `closeout.ts` / actual: they and the spec/snapshot helpers (`frontmatter`, `findSpec`, `blockingCondition`, `RENDER_HALT_MESSAGES`, `snapshotFolders`, `snapshotComplete`, `failedFirstRender`, `snapshotReady`, new `stashedSpec`, `autoRunResult`, `renderSnapshot`) moved to `worktree.ts`, re-exported by `closeout.ts` / why: the ended-path pause in `worktree.ts` needs them, and importing `closeout.ts` would form a cycle `cycles.test.ts` rejects (precedent: `engineState`) / may affect: none
- planned: relaunch = archive → relaunch → resumeFromPause → drive / actual: `autoResume` also records the halted engine's metered cost before `relaunchEpic` / why: otherwise the archived engine's cost drops out of the run's total (guarded the same way in `closeOutLanded`) / may affect: none
- planned: `--worktree <run.root>[/<prefix>]` / actual: `--worktree <run.root>` / why: `run.root` is already the project root, and the prefix is relative to the worktree top / may affect: none
- planned: `stage-carry` recorded once / actual: once per engine completion (after the latest `launched`), with `rows` as plansync's row keys / why: a retried sweep must not write it twice / may affect: none
- planned: `relaunchEpic(queue, run, detail, deps)` / actual: `relaunchEpic(queue, run, key, detail: (archive) => Record, deps)` → `{moved, error?}` / why: the landed path's detail includes the archive result, and the auto-resume needs the failure text / may affect: none
- planned: only the autoresume :163/:246 tests re-pinned / actual: also the two attempt-1 exact-match records (`via`, `status_word`); the `planstatus.test.ts` fixture gains an `end` option; the ended-path relaunch is also covered in `worktree.test.ts` / why: the new marker fields break exact matches, and terminal rows are immutable / may affect: none

DEVIATION SCORE: 1 (implementer); 2 by consult ruling (deviation 1 touches 38-5's planned `findSpec` edit)

Forward note for 38-5: findSpec / frontmatter / snapshot helpers now live in apps/supervisor/src/worktree.ts (closeout.ts:269 re-exports them, so `closeout.findSpec` still resolves); 38-5's findSpec edit goes to worktree.ts, and its tests may import from either module.

DRIFT: render-signature and spec/snapshot helpers (findSpec included) live in worktree.ts, re-exported by closeout.ts — worktree.ts importing closeout.ts forms a cycle cycles.test.ts rejects — affects: 38-5
DRIFT: autoResume records the halted engine's metered cost before relaunchEpic — the archived engine's cost would drop out of the run total — affects: none
DRIFT: stage carry passes --worktree <run.root> with no prefix — run.root is already the project root — affects: none
DRIFT: stage-carry noted once per engine completion — a retried sweep must not write it twice — affects: none
DRIFT: relaunchEpic signature takes key and a detail builder, returns {moved, error?} — landed and auto-resume paths need archive result and failure text — affects: none
DRIFT: autoresume attempt-1 exact records, planstatus fixture end option, worktree.test relaunch coverage beyond the plan's named re-pins — new marker fields and immutable terminal rows — affects: none

### pass 2 (2026-11-08, review patches)

- planned: pin that a `failed`/`cancelled` end is never softened / actual: the test uses a `blocked` end / why: a worker `failed` ends the run directly and never reaches the no-story end; the code keeps every non-`complete` end / may affect: none
- planned: add a notifier line for the ended path's failed relaunch if missing / actual: test only / why: `autoResume` already sends `autoResumeRefusedLine` with the error / may affect: none

DEVIATION SCORE (pass 2): 0. The story's score stays 2 (pass 1, by consult ruling).

DRIFT: non-softening pin uses a `blocked` end — `failed` never reaches the no-story end — affects: none
DRIFT: the 0.1.34 (Story 38.2) paragraph also names `no_story.halt_text`, the found-and-untracked pause condition and the ended-engine resume refusal (beyond the instructed guard sentence) — without it the paragraph's `no_story` shape and pause conditions no longer match the code; append-only, pinned (consult: accept-deviation score 1) — affects: none

### pass 3 (2026-11-08, follow-up-2 review patches)

- Two patches: the `noStoryEnd` whole-journal fallback for a resumed engine (`worktree.ts`), and the unseen-destination direct write (both `render_skill.py` copies). The contract append ("The resumed segment:") follows the 2026-11-08T00:34:51Z rule candidate: a review patch that changes a condition the story's paragraph already describes also updates that paragraph and its pin. It is not a deviation. Every file is inside the plan's Files list.

DEVIATION SCORE (pass 3): 0. The story's score stays 2 (pass 1, by consult ruling).

## Consult Log

- 2026-11-07T23:43:58Z — trigger: deviation-gt-0 — question: accept pass-1's six deviations at score 1, or does any touch a later Epic 38 story's seam? — ruling: accept-deviation score 2 — do: accept all six, record the set at score 2 (38-5's plan edits findSpec in closeout.ts, now in worktree.ts:1031 with a re-export at closeout.ts:269); add a forward note for 38-5; deviations 2–6 local — rule candidate: when an implementer moves an exported symbol to another module, grep the later stories' plans in the epic for the symbol and its old file; any hit makes the move score 2 with a forward note naming the new home
- 2026-11-07T23:48:34Z — trigger: high-severity-finding — question: storiesToDraft drafts stories other runs hold or landed (historic 37.6/ST-166, later in-progress, commits without PR); patch a guard, bad_spec, or escalate? — ruling: apply — do: guard storiesToDraft: (i) this run's last ended/paused close-out has no_changes: true; (ii) no later run has an ok plan-status in-progress/review/done for the key; (iii) no run at all has an ok review/done for the key (read other runs' plan-status events, not finishedStories); pin each guard alone in planstatus.test.ts — rule candidate: a plan shape that writes plan/Jira state backwards must name the cross-run "nobody else holds or landed it" guard and the historic-run backfill behaviour
- 2026-11-08T00:34:51Z — trigger: deviation-gt-0 — question: accept the follow-up patch round's extra 0.1.34 contract text (`no_story.halt_text`, the found-and-untracked pause rule, the ended-engine resume refusal) at score 1, at score 2, or cut it back? — ruling: accept-deviation score 1 — do: keep the extra text inside the 0.1.34 (Story 38.2, additive) paragraph with no bump; keep each clause pinned in `test_0_1_34_story_38_2_a_run_that_does_no_work_says_so` — rule candidate: a review-pass patch that changes a field or condition already described in the story's contract paragraph also updates that paragraph and its pinned test in the same append-only version entry; a score-0 implementation detail, not a deviation

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-07T21:53:49Z | 2026-11-07T21:54:50Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-07T23:10:24Z | 2026-11-08T00:10:03Z | e59c5a1d-6b89-454c-94ce-5daa5c136340 | claude-opus-5-5 | medium | 37297348 | 202864 | 16.4423 | completed |
| review | 1 | 2026-11-08T00:10:03Z | 2026-11-08T00:35:55Z | dd8a965c-4f6d-4733-9baa-dfe36abb1899 | claude-opus-5-5 | medium | 9117349 | 78093 | 6.8797 | completed |
| review | 2 | 2026-11-08T00:35:55Z | 2026-11-08T00:53:32Z | 2b361a37-5179-43e4-ad92-4163a0aa56e5 | claude-opus-5-5 | medium | 6291114 | 58785 | 4.6501 | completed |
| gate | 1 | 2026-11-08T00:53:32Z | 2026-11-08T00:56:37Z | c60da882-8d03-4a2f-a4a5-9c361c6842a9 | claude-opus-5-5 | medium | 3020185 | 18478 | 1.8172 | completed |
| host-leg | 1 | 2026-11-08T00:56:39Z | 2026-11-08T02:00:58Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-08T02:00:58Z | 2026-11-08T02:01:06Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-08T02:02:21Z | 2026-11-08T02:02:21Z | — | — | — | — | — | — | merged |


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261107T230900Z-cc0a55` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review pass on the committed story. Its behaviour is as the first pass recorded it. This pass closes two edge cases that the acceptance criteria name:
- **AC1, resumed engine.** A resumed engine journals no fresh `story-start`. If it ended `finished` with zero commits, the run ended `complete`. `noStoryEnd` now falls back to the whole journal's latest `story-start` and counts attempts from it, so the run ends `partial` with `no story landed: …`.
- **AC3, unseen destination.** A stale view that hides the generation folder itself made the fallback raise before writing anything. `_verify_published` now goes straight to the direct write into a fresh destination, then re-reads every file.

**Files changed (this pass).**
- `apps/supervisor/src/worktree.ts`: the `journalEntries` helper; the `noStoryEnd` whole-journal fallback; doc comments.
- `apps/supervisor/test/worktree.test.ts`: the resumed-engine `partial` end, and a guard test confirming a segment with its own `story-start` is unchanged.
- `_bmad/scripts/render_skill.py` and `apps/supervisor/_bmad/scripts/render_skill.py`: the unseen-destination branch of `_verify_published`. The two copies are byte-identical and the marker appears once.
- `plugins/tk-studio/lib/tests/test_basepatch.py`: `test_an_unseen_destination_skips_the_rename_and_writes_it_direct`.
- `plugins/tk-studio/contracts/driver-contract.md` and `plugins/tk-studio/lib/tests/test_driver_contract.py`: the "The resumed segment:" sentence in 0.1.34 (Story 38.2), append-only, plus its pin.
- `kb/bmad-base-patches.md`: the `render-skill-reread-fresh-destination` entry now names the unseen-destination case.
- This spec.

**Review.** Both layers ran (band L). 2 patches applied (medium 2), 0 deferred, 5 rejected (see the Review Triage Log). No consult was triggered: deviation score 0, no high-severity finding, and verify was green.

**Follow-up review.** Recommended: true. Patched counts: high 0, medium 2, low 0. Score 3×2 + 0 = 6, which is 5 or more.

**Verification.**
- `uv run python -m unittest discover tests`: 2945 OK (4 skipped).
- `runner.py run`: `ok: true`.
- `bun test --timeout 30000` (with `TK_ATLASSIAN_*` unset): 2032 pass, 95 skip, 0 fail.
- `bunx tsc --noEmit -p .`: clean.
- `cmp` of the two `render_skill.py` copies: identical.
- Each new test fails against the pre-patch source (the implementer's report).

**Unverifiable here.** The operator runs these on the box:
- The Windows host leg: `uv run tools/verify_host.py`.
- A live stale-render recurrence.

**Residual risks.**
- Recognising a stale render is deliberately broad: any pause stage, with an OS-error phrase and one render folder named. It is bounded by the untracked-spec, one-folder, ready-snapshot and attempt-1 checks.
- The hole-65 runbook row still does not name cancel as the route for a stuck `no-story` pause.
- Unchanged from the first pass:
  - Every skill re-renders once, because `renderer_sha256` changes.
  - The serve process must be stopped before building `apps/supervisor` and restarted after the merge.

## Reconcile

### 2026-11-08 — adjust-stories

- Score: 2
- Reasoning: One deviation reaches later work. Pass 1 moved `findSpec`, `frontmatter` and the snapshot/render helpers from `closeout.ts` to `worktree.ts`, and `closeout.ts:272` re-exports them. 38-5 plans to edit `findSpec`'s rule in `closeout.ts`, so that edit now goes to `worktree.ts` (`findSpec` :1032). Epics AC3's `closeout.findSpec` still resolves through the re-export, so 38-5's acceptance criteria hold and no correct-course is needed. The other DRIFT lines say `affects: none` and are local. No later plan names `relaunchEpic`, `staleRenderView`, `autoResume` or the moved helpers other than `findSpec` (searched in plans 38-3 to 38-7 and the Epic 39 narrative).
- Affected: 38-5-the-pause-path-finished — plans/38-5.md Files: "`apps/supervisor/src/closeout.ts` (modify) — … `findSpec`'s rule" and Code Map: "`closeout.ts findSpec` :166-181"
- Invariant: none (AD-4 held: the engine was not edited; the contract change was append-only, 0.1.34)


Gate: Part A adjust-stories; Part B story accepted, planned 38-3-the-sweeps-path-cleared (refreshed in place; replan entry for 38-5 applied to its invoke_dev_with and closed; plan stage row buffered)
