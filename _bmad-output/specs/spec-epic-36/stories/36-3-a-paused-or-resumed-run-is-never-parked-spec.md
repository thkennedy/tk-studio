---
title: 'A Paused or Resumed Run Is Never Parked'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
baseline_revision: '4a7535875641633a129f66d3c1f951d4ff9e6b80'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-3.md'
warnings: ['oversized']
deferred:
  - summary: >-
      After a successful unblock the issue reads `Block Resolved`, canonical `blocked`, so a later `done` can still hold an AD-5 conflict for a block already closed.
    evidence: |-
      `jirabackend.canonical_status` maps both template statuses to `blocked`; `pull_back` conflicts when the backend status moved since the snapshot and canonical `done` differs. The hand repair of hole 101 moved the issue to `Done` and re-synced; DW-130's fix as written does not. Meets deferral (a): behaviour AC1 names; AC1 pins the target status and AD-5 keeps the side-pick human.
    location: >-
      plugins/tk-studio/lib/jirabackend.py:609
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Every pause path either parks the run or strips it. As the operator, I want every pause to have a bounded, recorded exit: the resume's stop re-arm routed by tier, the story's Jira block closed by the resume, a failed first render auto-resumed once, a paused sweep's stop retry bounded and its WIP kept out of the leg, a story-boundary refusal ending the run rather than parking it, a killed resumed engine's PR left a draft with its guard reason kept, and an engagement's cap or ask block closed by the owner's go, so that the operator path for a pause is the API, never a hand edit of the worktree or the issue (holes 95 and 101; AI-2's B2, B3; the retrospective's B3/B4 decided; DW-110, DW-115, DW-120, DW-121, DW-130; DW-64, DW-65, DW-47).

**Approach:** Transcribed acceptance criteria below (epics.md §Story 36.3, authoritative); the shapes are `plans/36-3.md` §Settled shape 1-8 and SPEC.md's CAP-7/CAP-8 design notes. **The serve process changes:** the operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge.

**AC1 (verbatim).** **Given** a sandbox-tier run resumed over `POST /runs/{id}/resume` or the hole-65 auto-resume **When** `closeout.ts` re-arms the graceful stop (`:919 launchStopGraceful`) and the run had ended `blocked` with a `track-block` **Then** the re-arm runs on the run's tier as `stopSweepEngine` does, with a test that has no host injection (DW-120); the resume calls a story-side `track.py unblock --story <key> --reason` once per `track-block` since the latest pause (`Blocked - Awaiting User` → `Block Resolved` with a `Resolved:` agent comment and no owner mention, idempotent), recorded as `track-unblock`, and a plan-status pass that holds an AD-5 conflict ends `partial` and notifies instead of `ok: true` (DW-130, hole 101); a failed first render (an empty or absent generation beside its staging folder) counts as the one snapshot and auto-resumes once, and `render_skill.py`'s staging rename retries on `EACCES`/`EPERM` as a studio-managed base patch (DW-110, hole 95)

**AC2 (verbatim).** **Given** a paused sweep, and a run refused at a story boundary **When** the stop does not answer `stopped`, and when `resume` answers `StoryLanded` **Then** the stop retry is bounded (a count or a deadline), then a notifier line and a `blocked` end that releases the lock and the pin, and a paused bundle's WIP is committed as WIP on the run branch or the sweep is kept paused for the operator, never the leg on a half-written tree (`worktree.ts:1012-1021`; DW-121); the story-boundary refusal ends the run at the boundary (push, PR, release) rather than parking it (`queue.ts:1254`; DW-115; B3/B4 decided here, the contract naming it)

**AC3 (verbatim).** **Given** a resumed or relaunched engine the supervisor killed, and an engagement whose owner answered go or continue after a cap or ask block **When** the close-out skipped the host verify, and when `approve.ts runStep` runs **Then** the PR stays a draft (`worktree.ts closeOut ~:480-483`; DW-64), a killed relaunch keeps `launched.end` with the guard's reason (`sweepEngines`' relaunched predicate; DW-65), and the cap or ask block is closed and the owed questions block after it (`approve.ts runStep`, `questions.ts closeStep`; DW-47); the supervisor suites cover each with fakes; the contract (0.1.31, additive) names `track-unblock` and the bounded stop; the entries close by this PR

**Replan (36-2 gate, 2026-10-30).** The paused-sweep deadline starts only from an `engine-stop` note carrying `error`, as 36.2's note may be `{stopped: true}`. The deadline's `blocked` end is set explicitly, not through `sweepEndState`, whose engine cap reads it `partial`. A WIP-committed sweep whose bundles all landed ends `partial`, naming the WIP (`engineEndStatus` exempts the stop, so it would otherwise read `complete`).

## Boundaries & Constraints

**Always:** `plans/36-3.md` §Files is the boundary; any other file is a recorded deviation. Studio scripts are stdlib-only; writes atomic; headless surfaces end in the JSON status block; contract change additive on 0.1.31 (36.3's paragraph after 36.2's, its test pins 36.2 < 36.3). A failed unblock or re-arm never fails a resume. Every `track.py` call in tests is faked through `deps.uv`; the Jira seat is never called. No new import edge among `sweep.ts`/`worktree.ts`/`closeout.ts` (36.7 cuts that cycle): `wipCommit` beside `proofCommit`, `stopEngine` in `sweep.ts`.

**Block If:** the Files list must grow past the band (consult `file-outside-files`; every narrowing is a `DRIFT:` line naming the entries left open, order of value per the plan's oversize risk). The AD-5 re-ask would need a new lease phase or a `stagePass` owed-row change beyond keeping `stage: true` (consult `deviation-gt-0`). A reading of AC1 would require a stop that cannot succeed (`GracefulStopError` on a dead engine records `ok: false` and the resume proceeds; never a retry loop).

**Never:** an invented upstream issue URL, or a registry entry with an empty `upstream_issue`: with no URL in the Consult Log, Settled shape 4 applies (the retry ships in both `render_skill.py` copies by hand-identical edit, the registry entry waits, DW-110's status reads `narrowed: patch registration owed the upstream issue URL`, and a `DRIFT:` line says so). Never push, tag, release, bump the gate x3 versions, or touch remotes. Never change the late terminal close-out (`worktree.ts` ~:973), `closeOutNow` or `cancel`'s draft behaviour: record them on DW-64's status line as the remainder. Never "sweep kept paused for the operator" (Settled shape 5 took the WIP commit). Never edit `epics.md`, `plan/`, `stories.yaml`, `routing.toml`, `policy.toml` or `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-arm on sbx tier | sbx run, stop in force, resume, no `launchStop` injected | `sbx exec … launch.py stop --graceful` via `deps.sbx.run`; `graceful-stop` event carries `tier` | Refusal: `ok: false`, resume proceeds |
| Re-arm on host tier | host run | host `uvRunner` as today | same |
| Unblock once | one `track-block` since latest pause, resume | one `track.py unblock`; one `track-unblock`; a second resume with no new block records none | Fail: `ok: false, retry: true`, one notify, resume proceeds, next resume retries |
| Unblock idempotent | issue not Blocked (31.7 already moved it) | `skipped[]`, no transition, no owner mention | Transient: `retry: true` |
| Dependents | `block` moved dependent stories | `unblock` moves them too | same |
| AD-5 conflict | `sync.projection.conflicts` non-empty | `done` record `partial` with `conflict`, `stage: true` kept, one notifier line, re-asked on later ticks counted against `PLAN_RETRY_LIMIT` until no conflict | Never auto-resolved |
| Failed first render | reason names staging + generation; generation empty or absent | counts as one snapshot; leftovers removed; one auto-resume, `attempt: 1` | Second failure `attempt: 2`, no resume |
| Stop unanswered | paused sweep, `engine-stop` with `error`, under 30 min | retried, one note | |
| Stop past deadline | first `engine-stop` carrying `error` older than `SWEEP_STOP_DEADLINE_MS` | one notifier line; explicit `blocked` end; lock and pin released; WIP committed first | |
| Stop note `{stopped: true}` only | 36.2's success note | no deadline starts | |
| Paused sweep with WIP | stop answered, dirty tree | `wip: sweep bundle <key> paused (run <id>)` on `supervisor/run-<id>`; leg skipped with `verify.skipped`; PR draft; landed bundles flip, WIP bundle's stay open | All bundles landed: end `partial` naming the WIP |
| Paused sweep clean | stop answered, nothing to commit | proceeds as today | |
| Story boundary | landed story, graceful stop in force | commit, meter, host leg (reused when recorded; none for a killed engine, `killed: true`), archive, push + PR, lock and pin released, `story-boundary.ended: true`; green or skipped leg: PR ready, `endEngine("complete", "story boundary: <key> landed under a graceful stop")`; red or inconclusive: PR draft, `partial`, the reason plus `redReason`/`inconclusiveReason` | `resume` on it: 409 `StoryLanded` naming the end |
| Killed engine, existing PR | `killed`, no verify | no `markPrReady`, body still edited, `out.draft: true` | |
| Killed engine, new PR | `killed`, no verify | opened draft | |
| Killed relaunch | close-out then launched, `killedEngine` true, status `stopped` | `launched.end` state and guard's reason kept | |
| Engagement go/continue | cap or ask `blocked` event, owner answers | `unblock --engagement <id> --kind cap\|ask --reason` once per event (`Block Resolved`, never `Done`); `engagement-issue {action: "unblocked", kind}`; owed questions block follows | |

</intent-contract>

## Code Map

`_bmad-output/specs/spec-epic-36/plans/36-3.md` §Code Map is this story's investigation, with its refreshed anchors (the "Anchors after 36.2" paragraph wins over older numbers; `Grep -n` before trusting a line). Confirmed 2026-10-31: `worktree.ts` paused-sweep stop ~:1031, `paused` :1049, `notKilled` :1059, `relaunched` :1071; `sweep.ts` `sweepEndState` :370, `engineEndStatus` :388, `stopSweepEngine` :512; `closeout.ts` `rearmStop` :911, stopper :921, call :991; `cli.ts` `launchStopGraceful` :1053, `cancelRun` stop :1124, wiring :2216, :2223; `driver-contract.md` 36.2 paragraph :2123, `## 8. Conformance` :2204; existing patch's issue `BMAD-METHOD#2718` is another defect's, never reused.

## Tasks & Acceptance

**Execution:** the plan's §Files, one task per file, each with the action named there and shaped by §Settled shape 1-8:
- `apps/supervisor/src/sweep.ts`, `cli.ts`, `closeout.ts`, `approve.ts` -- Settled 1 -- the tier-routed stop seam (DW-120).
- `plugins/tk-studio/lib/track.py`, `skills/tk-studio-track/SKILL.md`, `closeout.ts`, `planstatus.ts` -- Settled 2, 3 -- `unblock` both forms, `track-unblock`, the AD-5 `partial` (DW-130).
- `closeout.ts`, `base-patches/patches.json`, both `render_skill.py`, `kb/bmad-base-patches.md` -- Settled 4 -- the failed first render and the retry (DW-110).
- `worktree.ts`, `sweep.ts` -- Settled 5 with the replan above -- the deadline, `wipCommit`, leg skip (DW-121).
- `closeout.ts`, `worktree.ts` -- Settled 6 -- the boundary end; `finishStudio`/`applyTransition`/`release` exported (DW-115).
- `worktree.ts` -- Settled 7 -- `killed` → draft; `relaunched` requires `notKilled` (DW-64, DW-65).
- `approve.ts`, `questions.ts` -- the cap/ask unblock and `closeStep` honouring `unblocked` (DW-47).
- `driver-contract.md`, `test_driver_contract.py`, `conformance/e2e_paused_exits.py`, `conformance/manifest.json` -- the 0.1.31 (36.3) paragraph naming `track-unblock`, the bounded stop and B3/B4 decided (35.2's park superseded), the track row; the drive (`FILTER = "Story 36.3"`, bound under its manifest `timeout`).
- Tests per the plan's §Tests: `closeout`, `autoresume`, `sweep`, `worktree`, `queue`, `approve`, `questions`, `planstatus` `.test.ts`; `test_track.py`, `test_basepatch.py` -- every matrix row covered, each test title carrying `Story 36.3`; the plan's named flips (`expectRefused`, the DW-65 pin) flip.
- `deferred-work.md` (DW-47, 64, 65, 110, 115, 120, 121, 130), `kb/agent-pc-setup-runbook.md` (holes 95, 101) -- statuses per plan.

**Acceptance Criteria:** AC1, AC2, AC3 above, and the CAP-7/8/9 success lines of SPEC.md: the re-arm test has no host injection; a resume after a `track-block` records one `track-unblock` and a second resume records none; an AD-5 conflict ends the pass `partial`; a failed first render auto-resumes exactly once under test; a stop that never answers ends `blocked` with the lock and pin released after the bound under test; no leg runs on a half-written tree; a `StoryLanded` resume ends the run with its PR, the lock and the pin released.

## Spec Change Log

- 2026-10-31T05:07:57Z — trigger: a high-severity review finding (the boundary end marks a PR ready with no host leg), consult ruling `apply`, option 1. Amended: the matrix's Story boundary row, on the ruling's explicit DO, inside the intent contract. Known-bad state avoided: a ready PR and a `complete` end on a tree no leg checked. KEEP: never a park; every end pushes, finishes, releases the lock and pin. No code reverted: patched forward.

## Review Triage Log

### 2026-10-31 — Review pass 1 (both layers, band L; the diff passed by path, 360 KB)
- intent_gap: 0
- bad_spec: 1: (high 1, medium 0, low 0)
- patch: 14: (high 1, medium 10, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` an agent-seat unblock re-queued validation and a re-block: `resolution.ts` skips it (consult)
  - `[high]` `[bad_spec]` the boundary end marked a PR ready with no host leg: the end now follows the leg (consult; matrix amended, code patched forward)
  - `[medium]` `[patch]` a failing boundary end retried unbounded: archive failure ends `partial`, a throw bounded by `STUDIO_END_RETRY_LIMIT`
  - `[medium]` `[patch]` a failed spawn's `paused` lost the owed unblock
  - `[medium]` `[patch]` a dependent refused by name recorded success: `partial` is `ok: false`
  - `[medium]` `[patch]` dependents matched by substring and moved under another open block: `_open_blocks`
  - `[medium]` `[patch]` conflicts read project-wide: filtered to the moved entity
  - `[medium]` `[patch]` the notifier printed a path and key, not the sides: reads `fields`, fixture corrected
  - `[medium]` `[patch]` give-ups inferred from a missing id: `gave_up: true`
  - `[medium]` `[patch]` a transient during a re-ask dropped a conflict: retries
  - `[medium]` `[patch]` a killed engine's adopted ready PR claimed draft: `markPrDraft`
  - `[medium]` `[patch]` a past-deadline sweep deleted a possibly live engine's tree: `keepWorktree`
  - `[low]` `[patch]` an `ok: false` by-name block owed an unblock
  - `[low]` `[patch]` the contract's Story / rulings row omitted 36.3
  - `[low]` `[patch]` `manifest.json`'s broken line
- deferred (a): `Block Resolved` maps canonical `blocked`, so `done` can still hold an AD-5 conflict; on DW-130's status line

### 2026-10-31 — Review pass 2 (follow-up; both layers, band L; the diff passed by path, 433 KB)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 4, low 2)
- defer: 0
- reject: 2: (high 0, medium 1, low 1)
- addressed_findings:
  - `[high]` `[patch]` the stop's deadline was never read when the status probe failed too (a stopped sandbox, the case the bound exists for): a sweep's `unknown` past the deadline stops once, then ends `blocked` (consult)
  - `[medium]` `[patch]` a block whose move landed and whose comment was refused owed no unblock: read `issues[].transitioned`; the contract sentence corrected
  - `[medium]` `[patch]` a commit or meter failure under a stop retried unbounded: both count toward `STUDIO_END_RETRY_LIMIT`; a commit give-up ends `partial` with the tree kept; a meter give-up pushes and opens the PR, ends `partial`, the worktree kept (consult)
  - `[medium]` `[patch]` the rename retry raised at once over an empty destination: it raises early only over a non-empty one, both copies identical
  - `[medium]` `[patch]` a cap's retried unblock could close the shared issue under a newer block: a kind whose block is not the engagement's newest makes no call
  - `[low]` `[patch]` the `review` phase's AD-5 `partial` had no test: added
  - `[low]` `[patch]` the runbook's hole 101 row read fixed with no remainder: names DW-151
- rejected: DW-64's `resolved` status with its remainder open: the intent contract's Never puts the remainder on that status line, and the ledger is the orchestrator's
- rejected: a resolve child exiting before `engine.pid` is rewritten still closes the block: the re-pause opens a new window and re-blocks, and the proposed `if (found)` guard would strand the block of an engine slower than the five-second poll

### 2026-10-31 — Review pass 3 (follow-up; both layers, band L; the diff passed by path, 470 KB)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 3, low 0)
- defer: 0
- reject: 1: (high 0, medium 1, low 0)
- addressed_findings:
  - `[medium]` `[patch]` a commit give-up's ended run answered `RunNotPaused`, not the contract's `StoryLanded`: `resumePaused` also reads the `ended` event's `detail.story_boundary`
  - `[medium]` `[patch]` the sbx branch of `launchStopGraceful`, the route production injects, ran under no test: two tests against a fake `sbx`, one of them through `resumePaused`; the branch had no bug
  - `[medium]` `[patch]` a reason naming only a staging folder read as a failed first render with no generation checked: `failedFirstRender` answers false when the named folder is itself a staging folder
- rejected: a failed unblock retried only by a later resume: the intent contract's matrix row says "next resume retries"; kept as a residual risk below

## Design Notes

`bun` is at `~/.bun/bin/bun`, not on `PATH`: `export PATH="$HOME/.bun/bin:$PATH"`. `apps/supervisor/node_modules` is absent: run `bun install --frozen-lockfile` there first and commit nothing it produces. `EPERM` link errors can leave `.bin` empty, so typecheck with `bun node_modules/typescript/bin/tsc --noEmit`. `test/tier.test.ts` and `guards.test.ts` fail at baseline with `TK_ATLASSIAN_*` set (4 cases; 0 with them unset): compare against that.

Bound `sweep.test.ts` and `closeout.test.ts`'s added time: conformance drives run them under a manifest timeout (hole 97). Bound any command that may hang with `timeout -k 5 <s>`.

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: green
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- From project root: `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- From `apps/supervisor`: `bun test` -- expected: green over the baseline above, `Story 36.3` tests ran
- From `apps/supervisor`: `bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean
- From project root: `uv run python plugins/tk-studio/contracts/conformance/e2e_paused_exits.py` -- expected: `ok`

## Deviation Summary

### pass 1

- planned: the plan's §Files is the boundary / actual: a one-line change to `queue.ts` `claimPlanPhase` plus an exported `openConflicts` / why: the claim refused any phase with a `plan-status` record, so the AD-5 re-ask could not re-claim `done`; no new lease phase / may affect: 36-7
- planned: an AD-5 conflict ends `partial` instead of `ok: true` / actual: the record has `status: "partial"` and `conflict`, keeps `ok: true` / why: `stageTodo` owes rows only for `ok === true`, changing that rule is a Block If / may affect: none
- planned: `stageTodo` unchanged beyond keeping `stage: true` / actual: added a dedupe by `story_key` / why: a re-asked story's partial and clean records would owe rows twice; the owed set is unchanged / may affect: none
- planned: the unblock hook right after `resumeFromPause` / actual: `unblockTracked` runs at the end of `resumePaused` / why: a failed spawn returns the run to `paused` and must leave the block open; Jira calls do not delay the engine / may affect: none
- planned: `resumePaused` answers `StoryLanded` only for an already-ended run / actual: also refuses a paused run whose story landed with no stop in force / why: otherwise a resume re-drives a landed story before the pass closes it out / may affect: none
- planned: `verify.skipped: "paused sweep: WIP committed, leg skipped"` / actual: `{skipped: true, reason: "..."}` / why: `HostVerifyResult.skipped` is the boolean every reader uses; the contract states the shape / may affect: none
- planned: `wipCommit` beside `proofCommit`, no other moves / actual: also lifted `ENGINE_STATE`, `globLiteral`, `engineState` into `worktree.ts`, re-exported from `closeout.ts` / why: `wipCommit` needs the excludes; importing `closeout.ts` would add a cycle edge / may affect: 36-7
- planned: `closeOut` input gains `killed` / actual: also `keepWorktree`, `WorktreeDeps.hygiene`, `clockMs`, and a WIP-commit-failed path (leg skipped, draft, worktree kept) / why: a failed WIP commit must not delete the tree; the deadline line needs a notifier seam; tests need a clock / may affect: none
- planned: `killed: !notKilled` / actual: `(!notKilled && !verify)` OR the sweep's WIP or unanswered stop / why: AC3 covers a skipped verify; a leg recorded before a later kill still vouches for the tree / may affect: none
- planned: unanswered stop past the deadline with no WIP unspecified / actual: leg skipped (`paused sweep: stop unanswered, leg skipped`), PR draft / why: the engine may still be alive / may affect: none
- planned: `endEngine("complete", …)` at the boundary / actual: a failed close-out ends `partial` with `; close-out failed: …` / why: never a park, never `complete` over an unpushed branch / may affect: none
- planned: `story-boundary` gains `ended: true` when the run ends / actual: the one event is written before the archive with `ended: true`; the skip at `closeOutPaused` :818 removed / why: the archive moves `stop-request.json`; a retried pass needs the record or it relaunches across the boundary / may affect: none
- planned: `engine-stop` noted once per engine run / actual: a first `error` note may follow a `stopped` one / why: only an `error` note starts the deadline / may affect: none
- planned: `unblock` posts the comment and moves dependents / actual: comment first; a Blocked dependent is skipped unless its newest agent comment names `Blocked by: <key>` / why: a retry must not lose or repeat the comment; only dependents `block` moved should move / may affect: none
- planned: `patches.json`, `basepatch.py apply`, patch-1 test / actual: no registry entry; both copies edited identically; `StagingRenameRetryTests` pins both and asserts no entry exists / why: Settled shape 4, no URL in the Consult Log / may affect: none
- planned: DW-110 closes by this PR / actual: DW-110 reads `narrowed: patch registration owed the upstream issue URL` / why: Settled shape 4 / may affect: none

DEVIATION SCORE: 2

DRIFT: a one-line change to `queue.ts` `claimPlanPhase` plus an exported `openConflicts` — the claim refused any phase with a `plan-status` record, so the AD-5 re-ask could not re-claim `done`; no new lease phase — affects: 36-7
DRIFT: the record has `status: "partial"` and `conflict`, keeps `ok: true` — `stageTodo` owes rows only for `ok === true`, changing that rule is a Block If — affects: none
DRIFT: added a dedupe by `story_key` — a re-asked story's partial and clean records would owe rows twice; the owed set is unchanged — affects: none
DRIFT: `unblockTracked` runs at the end of `resumePaused` — a failed spawn returns the run to `paused` and must leave the block open; Jira calls do not delay the engine — affects: none
DRIFT: also refuses a paused run whose story landed with no stop in force — otherwise a resume re-drives a landed story before the pass closes it out — affects: none
DRIFT: `{skipped: true, reason: "..."}` — `HostVerifyResult.skipped` is the boolean every reader uses; the contract states the shape — affects: none
DRIFT: also lifted `ENGINE_STATE`, `globLiteral`, `engineState` into `worktree.ts`, re-exported from `closeout.ts` — `wipCommit` needs the excludes; importing `closeout.ts` would add a cycle edge — affects: 36-7
DRIFT: also `keepWorktree`, `WorktreeDeps.hygiene`, `clockMs`, and a WIP-commit-failed path (leg skipped, draft, worktree kept) — a failed WIP commit must not delete the tree; the deadline line needs a notifier seam; tests need a clock — affects: none
DRIFT: `(!notKilled && !verify)` OR the sweep's WIP or unanswered stop — AC3 covers a skipped verify; a leg recorded before a later kill still vouches for the tree — affects: none
DRIFT: leg skipped (`paused sweep: stop unanswered, leg skipped`), PR draft — the engine may still be alive — affects: none
DRIFT: a failed close-out ends `partial` with `; close-out failed: …` — never a park, never `complete` over an unpushed branch — affects: none
DRIFT: the one event is written before the archive with `ended: true`; the skip at `closeOutPaused` :818 removed — the archive moves `stop-request.json`; a retried pass needs the record or it relaunches across the boundary — affects: none
DRIFT: a first `error` note may follow a `stopped` one — only an `error` note starts the deadline — affects: none
DRIFT: comment first; a Blocked dependent is skipped unless its newest agent comment names `Blocked by: <key>` — a retry must not lose or repeat the comment; only dependents `block` moved should move — affects: none
DRIFT: no registry entry; both copies edited identically; `StagingRenameRetryTests` pins both and asserts no entry exists — Settled shape 4, no URL in the Consult Log — affects: none
DRIFT: DW-110 reads `narrowed: patch registration owed the upstream issue URL` — Settled shape 4 — affects: none

### pass 2 (2026-10-31, review patches)

- planned: the boundary ruling names no end state for a killed engine / actual: a killed engine with no recorded leg ends `partial`, reason names it, PR a draft / why: a `complete` end on a tree no leg checked is the state the ruling avoids / may affect: none
- planned: a red or inconclusive PR stays or returns to draft / actual: at the boundary an inconclusive leg also passes `killed: true`; `closeOut`'s inconclusive branch yields to `killed` / why: that branch never undoes a ready PR; other callers are unchanged / may affect: none
- planned: a dependent moves only when no other `Blocked by:` comment remains / actual: another blocker counts only while its own issue reads Blocked; a `Blocked:` comment with no `Blocked by:` line also holds it / why: read literally, a dependent whose first blocker closed would be stranded / may affect: none
- planned: the failed-spawn `paused` does not reset the unblock window / actual: a block already closed by a later `ok: true` `track-unblock` is also not owed / why: keeps "a second resume records none" / may affect: none
- planned: the boundary's `closeOut` inputs only / actual: `finishStudio` also receives the playable judge's cost / why: a slice leg's judge spend would miss the ledger / may affect: none
- planned: `gave_up` for the `done` re-ask / actual: `leased` writes `gave_up: true` on every phase's give-up record / why: `leased` is the one give-up site; only `openConflicts` reads it / may affect: none
- planned: no new edge among `sweep.ts`/`worktree.ts`/`closeout.ts` / actual: `closeout.ts` has a value edge to `hostverify.ts`, SCCs unchanged and no cycle added; `closeout → sweep` now carries `stopEngine`, so 36.7's `isSweep` only anchor is stale (its re-derive step covers it) / why: the boundary leg; `hostverify.ts` is outside the named set / may affect: 36-7
- planned: §Files is the boundary / actual: `resolution.ts` and `test/resolution.test.ts` added / why: the consult's ruling on the agent seat's unblock / may affect: none

DEVIATION SCORE: 1 (pass 2 only; the story's score stays 2 per the ruling)

DRIFT: a killed engine with no recorded leg ends `partial`, reason names it, PR a draft — a `complete` end on a tree no leg checked is the state the ruling avoids — affects: none
DRIFT: at the boundary an inconclusive leg also passes `killed: true`; `closeOut`'s inconclusive branch yields to `killed` — that branch never undoes a ready PR; other callers are unchanged — affects: none
DRIFT: another blocker counts only while its own issue reads Blocked; a `Blocked:` comment with no `Blocked by:` line also holds it — read literally, a dependent whose first blocker closed would be stranded — affects: none
DRIFT: a block already closed by a later `ok: true` `track-unblock` is also not owed — keeps "a second resume records none" — affects: none
DRIFT: `finishStudio` also receives the playable judge's cost — a slice leg's judge spend would miss the ledger — affects: none
DRIFT: `leased` writes `gave_up: true` on every phase's give-up record — `leased` is the one give-up site; only `openConflicts` reads it — affects: none
DRIFT: `closeout.ts` has a value edge to `hostverify.ts`, SCCs unchanged and no cycle added; `closeout → sweep` now carries `stopEngine`, so 36.7's `isSweep` only anchor is stale (its re-derive step covers it) — the boundary leg; `hostverify.ts` is outside the named set — affects: 36-7
DRIFT: `resolution.ts` and `test/resolution.test.ts` added — the consult's ruling on the agent seat's unblock — affects: none

### pass 3 (2026-10-31, follow-up review patches)

- planned: a stop in force is read from `gracefulStopInForce` / actual: a recorded `story-boundary` event also counts / why: on a retried pass the archive has moved the run dir, so the file read alone would drop the bound / may affect: none
- planned: reuse `boundaryThrew`'s attempt count / actual: the count covers every `close-out-failed` with a numeric `attempt`, across `commit`, `meter` and `boundary-end` / why: one bound per boundary; no-stop failures stay uncounted / may affect: none
- planned: one test per patch / actual: added a `wip.error` case and a non-empty-destination case / why: each pins a behaviour the patch keeps / may affect: none
- planned: the give-up records `story-boundary` / actual: `noteStoryBoundary` gained `line`, the meter give-up passes `false` / why: the ruling allows one line on that path / may affect: none

DEVIATION SCORE: 1 (pass 3 only; the story's score stays 2 per the ruling)

DRIFT: a recorded `story-boundary` event also counts as a stop in force — on a retried pass the archive has moved the run dir, so the file read alone would drop the bound — affects: none
DRIFT: the attempt count covers every `close-out-failed` with a numeric `attempt`, across `commit`, `meter` and `boundary-end` — one bound per boundary; no-stop failures stay uncounted — affects: none
DRIFT: added a `wip.error` case and a non-empty-destination case — each pins a behaviour the patch keeps — affects: none
DRIFT: `noteStoryBoundary` gained `line`, the meter give-up passes `false` — the ruling allows one line on that path — affects: none

### review pass 3 (2026-10-31, follow-up review patches)

No deviations. All edits are inside the plan's Files. DEVIATION SCORE: 0 (this pass only; the story's score stays 2).

## Reconcile

### 2026-10-31 — adjust-stories

- Score: 2
- Reasoning: Three later stories' plans name things this unit changed, and notes in their `invoke_dev_with` absorb all three; no acceptance criterion changes. 36-4 counts four bun-suite drives, and this unit added a fifth with its own bound copy. 36-6's arming and in-progress status meet the moved stopper and the `Block Resolved` an unblock leaves. 36-7's `closeout → sweep` now also carries `stopEngine`, and the dodge it plans to cut is already gone. No deviation contradicts an AD or the contract: the `partial`-with-`ok: true` record and the widened `StoryLanded` are consult-accepted and stated in the 0.1.31 paragraph; 36-5 only meets moved anchors.
- Affected: 36-4-the-host-leg-goes-red-for-code-only — "Four drives run bun suites" and "the four `MANIFEST_TIMEOUT_S` copies and their module asserts go"
- Affected: 36-6-setup-and-the-launch-check-by-evidence — "The graceful stop today: `closeout.ts launchStopGraceful` (:919, host-side `launch.py stop --graceful`, refused on sbx with `bmad-loop is not on PATH`, DW-120)"; AC4's "every later one, a resume included" also meets DW-151's conflict shape
- Affected: 36-7-the-cycles-cut-and-the-docs-caught-up — "`closeout → sweep` is `isSweep` only" and "`closeout.ts:919` `(await import("./cli")).launchStopGraceful` dodges `closeout → cli → closeout`"
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 36-4-the-host-leg-goes-red-for-code-only

## Consult Log

- 2026-10-31 — operator step (plan Settled shape 4): file or locate the BMAD-METHOD upstream issue for the Windows-mounted staging rename `[Errno 13]` and answer with its URL here. Unanswered at dispatch; Settled shape 4's fallback applies until it lands.
- 2026-10-31T05:00:51Z — trigger: deviation-gt-0, file-outside-files — question: accept the 16 deviations, including `queue.ts` outside Files, `partial` with `ok: true`, the `stageTodo` dedupe, and DW-110 narrowed? — ruling: accept-deviation score 2 — do: keep the code as it stands; keep DW-110 narrowed with its DRIFT line, no registry entry, no URL (a URL's registration flips `test_no_registry_entry_without_an_upstream_issue`); AC1's "`partial` ... instead of `ok: true`" reads as the pass ending `partial` instead of a bare clean `ok: true`, `ok` on the record meaning the status verb landed and rows stay owed; `epics.md` untouched — rule candidate: When a plan's Block If protects a consumer's filter on a record field, an AC's "instead of <field value>" on that record reads as a new status field beside it, unless the AC also names the filter change.
- 2026-10-31T05:07:57Z — trigger: high-severity-finding, file-outside-files — question: does an agent-seat unblock re-trigger validate-resolution and a re-block, and which fix? — ruling: apply — do: in `resolution.ts` `queueResolved` skip an item, before any mint and with no `validate-queued`, when a `track-unblock` on that project's runs has an `issues[]` entry with `key` equal to the issue and `to: "Block Resolved"` and `at` later than `item.blocked_since`, reading the entry's `to`, not `ok`; `resolution.test.ts` cases; add both to Files with a DRIFT line, one contract sentence pinned — rule candidate: When a story adds an agent-seat move into a status another pass consumes, the plan's Code Map names that status's consumers and its Files include each one that must tell the new mover apart.
- 2026-10-31T05:07:57Z — trigger: high-severity-finding — question: does the boundary end run the host leg? — ruling: apply — do: option 1: before `archiveStep` reuse `recordedVerify` else `hostVerify` with one `host-verify`; a killed engine runs no leg and passes `killed: true`; pass `verify`, `slice`, `legs` to `closeOut`; green or skipped ready and `complete`, red or inconclusive draft and `partial`; tests for green, red, inconclusive, a retry not re-running the leg; change the 0.1.31 paragraph and the matrix row, logged in the Spec Change Log — rule candidate: A plan's "close-out tail" or any new path to `closeOut(paused: false)` includes the host leg (or `killed: true` with the reason) unless the AC explicitly names the leg as skipped; a parenthetical list of end steps never exempts it.
- 2026-10-31T05:36:02Z — trigger: deviation-gt-0 (pass 2) — question: accept pass 2's seven deviations, including `closeout.ts` → `hostverify.ts`? — ruling: accept-deviation score 1 — do: keep all seven with one DRIFT line each; the story's `deviation_score: 2` stands; note the edge's unchanged SCCs and the stale 36.7 anchor; `epics.md` and `plans/36-7.md` unchanged — rule candidate: When a plan bars new import edges among named modules, a new edge to a module outside that set is no deviation if the value-import SCCs are unchanged from baseline; the implementer records that check in the DRIFT line.
- 2026-10-31T05:46:00Z — trigger: high-severity-finding — question: does AC2's bound cover a sweep whose stop already failed and whose status now reads `unknown` past the deadline? — ruling: apply — do: option A, `running` and the killed path unchanged; in `sweepEngines`' `!killed` branch keep the `continue` unless a sweep's `unknown` phase is past `sweepStopPastDeadline`, then call `stopSweepEngine` once: `stopped` continues to the next tick, otherwise `stopUnanswered = true` and fall through; add `|| stopUnanswered` to `stoppedSweep` so the WIP commit is attempted; keep `verify.skipped`, the draft PR, `keepWorktree`, one notifier line, the explicit `blocked` end, the lock and pin release, a `wip.error` that never stops the end; a Story 36.3 test with status turning `unknown` after the first failed stop (under the deadline retries with no end; past it with the stop failing ends `blocked` with the commit made; a stop answering `stopped` past it does not end; `running` past it does not end) — rule candidate: A bound stated for a failing external call is keyed on the recorded failure, not on a status read from the same channel, so an `unknown` from that channel never suspends the bound.
- 2026-10-31T05:58:00Z — trigger: deviation-gt-0 (pass 3) — question: accept the three deviations and a no-push give-up after a commit or meter failure under a stop? — ruling: reject-deviation — do: keep deviations 1-3 with a DRIFT line each, score 1, and the commit and boundary-end throw give-ups as no-close-out `partial` ends with the residual risk recorded; the meter give-up sends the one line, records `story-boundary` if a stop was read, runs `boundaryLeg`, skips `archiveStep` and `noteEngineCost`, calls `endAtBoundary` with `keepWorktree: true` passed to `closeOut` and `meter failed: <error>` in `why`, a throw there going to `boundaryThrew`; tests (meter give-up: push and PR, `partial` naming the meter, run dir and worktree kept; a throw during it ends the run on that pass; commit give-up: no close-out, tree kept) and one contract sentence naming both give-ups; the pass scores 1, `deviation_score: 2` stands — rule candidate: When a bounded give-up ends a run early, the plan names per failing step which later end steps still run, and any end that skips a step whose input lives in the run dir or worktree passes `keepWorktree` and skips the archive.
- 2026-10-31T06:12:00Z — trigger: deviation-gt-0 (pass 3, the give-up line) — question: accept `noteStoryBoundary`'s `line` flag and `boundaryThrew`'s line gated on the attempt count? — ruling: reject-deviation — do: keep the `line` flag (accepted, score 1); replace the count gate with one helper at both give-up sends that sends only if no `close-out-failed` note with `step: "give-up-line"` exists, then records that note (`notify`, no `attempt`) after the send whatever the answer, a failed answer not re-sent; keep `notify` on the `ended` detail when this pass sent the line, no new event kind or contract text; tests: attempts past the limit with no recorded line send exactly one line; a 503 notifier is recorded and not re-sent; the existing one-line pins stay green — rule candidate: A once-only notifier line is gated on a recorded send, written after the send with its answer, and never on an attempt count, so a crash can repeat the line but never lose it.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261031T042139Z-d85b61` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A third review pass over the done story, the follow-up the previous pass recommended. It found four things: three were real defects, now patched, and one was rejected because the story's matrix settles it. No consult trigger fired and no deviation was recorded. The ledger was not touched.

**Files changed in this pass:**
- `apps/supervisor/src/closeout.ts`: `resumePaused` answers `StoryLanded` for a give-up's ended run; `failedFirstRender` refuses a named staging folder.
- `apps/supervisor/test/closeout.test.ts`: the commit give-up's refusal; the real `launchStopGraceful` sbx route and its wiring through `resumePaused`.
- `apps/supervisor/test/autoresume.test.ts`: a staging folder named alone, gone or empty, is not recognised; a complete one keeps its handling.
- The spec itself; the Stage Log row and the removed result block were already in the working tree at dispatch, the orchestrator's.

**Review:** patches 3 (high 0, medium 3, low 0); deferred 0; rejected 1. Follow-up review: true (patched high 0, medium 3, low 0; score 9).

**Verification (run by this session on the final code):**
- `uv run python -m unittest discover tests`: 2707 tests, OK (skipped=4).
- `runner.py run`: `ok: true`, 23 surfaces.
- `tests.test_release_roster`: 86 tests, OK.
- `e2e_paused_exits.py`: exit 0, `ok: true`; its suite step ran `closeout` and `sweep` with `-t "Story 36.3"`, green.
- `bun test`, `TK_ATLASSIAN_*` unset: 1778 pass, 0 fail, 92 skip. The skips were not compared against baseline.
- `tsc --noEmit`: exit 0.

**Residual risks:**
- A failed unblock is retried only by a later resume, as the matrix says. A run that goes on to end after that resume keeps its issue `Blocked - Awaiting User` with the owner tagged, and the operator gets one notifier line. A supervisor death between the resume and the unblock loses the owed unblock once a new pause opens. Either way the plan-status pass can hold the AD-5 conflict until the owner picks a side.
- A commit give-up and a boundary-end throw give-up end `partial` with nothing pushed and the tree kept: the operator repairs them by hand.
- A meter give-up with a green or skipped leg marks the PR ready though the end is `partial`; the harvest is repeatable by hand from the kept worktree.
- The rename retry over an empty destination was tested on POSIX only. A native Windows rename would likely raise `FileExistsError`, which skips the retry; the hole-95 mount itself has not been exercised.
- During a commit failure's retries, before the give-up, the run is still `paused` with no `story-boundary` record, so a `resume` may not answer `StoryLanded`. Untested.
- The give-up line can repeat if the process dies between the send and its note; it cannot be lost. Its wording says the close-out "threw" for step failures too.
- With no stop in force, a failing commit or meter at a landed story still retries with no bound: unchanged, pre-existing.
- **DW-110 stays narrowed.** The registry entry is owed the upstream issue URL, so a `tk install` reinstall can revert the retry.
- DW-64's remainder (the late terminal close-out, `closeOutNow`, `cancel`) has no open entry of its own: the status line records it, as the contract required.
- The serve process changes: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:43Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-30T23:41:25Z | 2026-10-30T23:44:23Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-31T04:24:17Z | 2026-10-31T05:36:13Z | 341603ea-e4c0-431a-962a-e6656c9554d1 | claude-opus-5-5 | medium | 15986658 | 282040 | 17.8273 | completed |
| review | 1 | 2026-10-31T05:36:14Z | 2026-10-31T06:38:23Z | 5aec9229-2bd8-4dbd-9cb9-23eb5b42e625 | claude-opus-5-5 | medium | 8332962 | 170881 | 10.1689 | completed |
| review | 2 | 2026-10-31T06:38:23Z | 2026-10-31T06:59:21Z | 814834bf-e075-4769-b043-71744c985bb5 | claude-opus-5-5 | medium | 4688020 | 92426 | 6.2574 | completed |
| gate | 1 | 2026-10-31T06:59:22Z | 2026-10-31T07:05:31Z | 3971569c-542b-4258-9696-16a50af0bb4b | claude-opus-5-5 | medium | 1544956 | 27164 | 2.3750 | completed |
| host-leg | 1 | 2026-10-31T07:06:07Z | 2026-10-31T07:48:35Z | — | — | — | — | — | — | red |
| close-out | 1 | 2026-10-31T07:48:35Z | 2026-10-31T07:48:42Z | — | — | — | — | — | — | draft PR |
| re-run | 1 | 2026-10-31T08:26:32Z | 2026-10-31T09:09:49Z | — | — | — | — | — | — | green |
| merge | — | 2026-10-31T09:12:13Z | 2026-10-31T09:12:13Z | — | — | — | — | — | — | merged |

