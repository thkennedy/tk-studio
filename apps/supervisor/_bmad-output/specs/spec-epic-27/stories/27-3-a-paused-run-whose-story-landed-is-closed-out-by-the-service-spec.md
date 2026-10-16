---
title: 'A Paused Run Whose Story Landed Is Closed Out by the Service'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_revision: '6b4b02df3bf1858d805a5b4616b58220524efb4a'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-27/plans/27-3.md'
  - '{project-root}/_bmad-output/specs/spec-epic-27/operator-decisions.md'
warnings: [oversized]
deferred:
  - summary: >-
      A paused run at a non-closable stage whose story spec is already `status: done` is a silent dead end: the pass leaves it (not landed) and `POST /runs/{id}/resume` refuses it `409 StoryLanded`, with nothing recorded or notified.
    evidence: |-
      `landing` answers `not-landed` for a stage outside {escalation, pre_commit, pre_commit_gate}; `storyLanded` checks only `status: done`. The plan's Block If says to record such a stage and not widen AC1, so routing it is a planner/operator decision, not a patch. Deferral class (a): AC3's resume path refuses it.
    location: >-
      src/closeout.ts (landing, storyLanded)
    severity: medium
  - summary: >-
      A supervisor (serve) restart while a `POST /runs/{id}/resume` is in flight ends the run `partial` with `orphaned: supervisor restart` while the resumed engine keeps working, and the engine's real end is never mirrored.
    evidence: |-
      `resumePaused` moves the run to `running` owned by the serve process, and the `launched` event that hands it to the engine-end sweep is written only when the `bmad-loop resolve` child exits. Until then `LAUNCHED_SQL` reads the run as not launched, so `recover` treats it as orphaned once the owner is dead, and `respawnHolds` re-holds only launched or paused runs. The fix moves where the resume hands the run over, which is the consult-1-accepted design (score 2, affects 27-4/27-5), so it is a planner decision, not a patch. Deferral class (a): AC3's resume path.
    location: >-
      src/closeout.ts (resumePaused, handBack); src/queue.ts (recover, LAUNCHED_SQL)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** After 27.1/27.2 a launch run whose engine paused rests `paused` (worktree, checkout lock, pin and draft PR kept), and nothing moves it on: an operator follows the attended recipe of 2026-10-14 (verdict, harvest commit, meter, archive, relaunch; hole 9).

**Approach:** A tick pass over `paused` runs with three outcomes: a landed story with a closable verdict is closed out and the epic relaunched under the same queue run (`close-out` event); a landed story with no verdict or `escalate` waits for a human (one notification, page row "awaiting a ruling"); a story with no landed work is left for `POST /runs/{id}/resume` (`bmad-loop resolve`).

Story acceptance criteria (verbatim, `epics.md` "### Story 27.3"):

- **AC1:** **Given** a run that paused at the commit gate or on an escalation with the story's spec at `status: done` and a `reconcile_verdict` other than `escalate` recorded **When** the supervisor's tick sees it **Then** it commits the engine's staged harvest on the run branch with a named message, harvests the story's meter observation to the host ledger (Story 26.4's `meter.py harvest`), archives the run (`bmad-loop archive`, through `sbx exec`), relaunches the epic through `tk-studio-launch` (which skips done stories) under the same queue run with a `close-out` event, and never re-implements the story
- **AC2:** **Given** the same run with no verdict, or `escalate` **When** the tick sees it **Then** it stays paused, one notification names the story and the reason, and the run's page row says "awaiting a ruling"
- **AC3:** **Given** a story that halted before any commit **When** the tick sees it **Then** nothing is closed out; the run stays paused for the resume path (`bmad-loop resolve`), which the supervisor exposes as `POST /runs/{id}/resume` with an optional restore patch
- **AC4:** **Given** the supervisor's test suite **When** it runs **Then** all three cases are pinned with a fake engine, on both hosts

## Boundaries & Constraints

**Always:**
- Close out in the run's kept worktree on its `supervisor/run-<id>` branch; reuse the draft PR recorded on `paused` (never a second `gh pr create`).
- Order: harvest commit → `meter.py harvest` → `bmad-loop archive` → relaunch. Each step idempotent (clean tree = `nothing to commit`; `harvested.json` markers; an archived run dir counts done). A failed step leaves the run `paused` with one `close-out-failed` event per (step, error), never undoes done steps, and the next tick retries.
- Harvest commit: argv-only `git add -A` then `git commit -m "supervisor: close-out harvest for <story key> (run <queue run id>, engine <engine run id>)"`. Never `reset --soft`, squash or force-push.
- Meter: `uv run <pluginRoot()>/lib/meter.py harvest --run-dir <worktree>/.bmad-loop/runs/<engine id>` on the host via `uvRunner`/`studioScript`; `{ok:false}` or non-zero exit is a failed step.
- Archive: `bmad-loop archive --project <vm worktree> <engine id>` (no `--force`); on sbx through `sbx exec <sb> <vm HOME>/.local/bin/bmad-loop …` (HOME from `sbx exec <sb> printenv HOME`), argv only; host tier runs the same argv without `sbx exec`.
- Relaunch: new `Queue` move `paused` → `running` with a `close-out` event `{story_key, verdict, commit, meter, archive}`, owner set to this process (as `claim`). Rebuild `Started` with `rebuildStarted(queue, run, wake)`, fresh `sessionId: randomUUID()` (never `--resume`), driven through `finishRun` with `queueRecorder(queue, runId, sbxDeps(worktree))` so `InvokeOptions.pin` is passed (idempotent re-pin) and `markLaunched` records the new engine id, pid and hold. The queue state after the relaunch comes from the engine, not from `launched.detail.end`. Pass nothing story-specific; `tk-studio-launch` skips done stories itself.
- `releasePin` is never called between the harvest, the archive and the relaunch; only at the final `ended`.
- Closable verdict: any non-empty `reconcile_verdict` other than `escalate`. Missing key/empty = no verdict.
- No `paused_story_key`, or no spec found (`_bmad-output/implementation-artifacts/spec-<key>.md`, else single match of `_bmad-output/specs/*/stories/<key>-*.md` in the worktree), or spec not `status: done` → AC3: nothing closed out.
- AC2: record `awaiting-ruling` `{story_key, engine_run_id, reason, notify}`; a tick that finds that (story_key, engine_run_id) already recorded sends nothing. Notify via `notify(selected, notice, fetch)` with `notifier(env)`.
- `takeForCloseOut`/`releaseCloseOut` guard the pass so serve and tick never close the same run twice.
- `recover` and `awaitingEngine` read "launched" as "a `launched` event after the latest `close-out`/`engine-resume`".
- `POST /runs/{id}/resume`: POST, bearer only (never cookie session). Body `{restore_patch?: string}` relative to the worktree, must resolve inside it (`isWithin`), passed as the VM path; other field/type → `400 SchemaError`. Runs `bmad-loop resolve --project <vm worktree> --no-interactive --resume [--restore-patch <vm path>] <engine id>` (sbx through `sbx exec`) as the supervisor's child (the hold); run `paused` → `running` with `engine-resume`; pid re-read through `recordEnginePid`. Answers: `200 {ok, run_id, state:"running", engine_run_id}`, `404 RunNotFound`, `409 RunNotPaused`, `409 ExternalRun`, `409 StoryLanded` (paused story's spec `status: done`).
- `postCancel` maps `ExternalRunRefused` to `409 ExternalRun` (DW-26).

**Block If:**
- The relaunch needs `tk-studio-launch` told which stories to skip.
- A paused stage other than the commit gate or an escalation is found with a `status: done` spec (record; do not widen AC1).
- The Files list must grow past the plan's 11 files (oversize; record for `bmad-correct-course`).

**Never:**
- Reuse 27.1's `closing-out`/`closed_out` kinds or touch the PR close-out lease semantics.
- Re-implement or re-drive the landed story; `--dangerously-skip-permissions`; shells (`bash`, `sh`, `-c`, `-lc`) in `src/closeout.ts`; fakes in production resolution (fake `meter.py` only under a temp `TK_STUDIO_ROOT` in tests); push, PR, tag from the loop itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Close-out | paused, story key K, spec `done`, verdict `no-impact` | commit, meter, archive, `close-out` event, run `running`, relaunch via pinning recorder, new `launched` | — |
| Step fails | meter exits 1 | run stays `paused`, one `close-out-failed {step:"meter", error}` | next tick retries from meter (commit is `nothing to commit`) |
| Awaiting | spec `done`, no verdict / `escalate` | stays `paused`, one `awaiting-ruling` + one notification over two ticks, page "awaiting a ruling" | notify failure recorded in event |
| Not landed | no story key / no spec / spec not done | nothing done, stays paused | — |
| Resume | POST resume `{restore_patch:"p.patch"}` | `bmad-loop resolve … --restore-patch <vm>`, `engine-resume`, 200 | 400/404/409 per matrix above |
| Dead relaunch driver | relaunch driver dies before new `launched` | `recover` handles the run (not skipped), archived engine id not probed | — |

</intent-contract>

## Code Map

The plan `plans/27-3.md` Code Map is the investigation (anchors re-checked at HEAD `6b4b02d`, unchanged since `258c04c`):

- `src/worktree.ts:487` `engineStatus` -- add `paused_story_key` to `detail` beside `paused_stage`/`paused_reason` (:495). `git(deps, …)` at :117; `uvRunner`/`studioScript` seams used by `engineStatus`. `sweepEngines` :540 skips a paused run still reporting paused (:586) and an archived (`unknown`) one.
- `src/cli.ts` -- `sweepEngines` call sites :576 (`recoverQueue`), :640, :958 (tick/drain): run the new pass after them. `rebuildStarted` :1574 (wake parse :1635), `finishRun` :1701, `queueRecorder` :1211 (pin + `mirror` writing `launched`), drive pattern :1003, `ExternalRunRefused` :860.
- `src/queue.ts` -- `markLaunched` :1373 (requires `running`), `recordEnginePid` :1394, `awaitingEngine` :1453-1457, `releaseCloseOut` :1470, `takeForCloseOut` :1535, `markPaused` :1550, `recover` :1749 (skips `launched` runs at :1755).
- `src/api.ts` -- `postCancel` :210, `route` with `/runs/{id}/cancel` regex; cookie session only for GETs and cancel.
- `src/page.ts` -- run card (~:394-401): add "awaiting a ruling".
- `src/hygiene.ts:244` `notify`; `src/env.ts:278` `notifier`, :38 `pluginRoot`; `src/server.ts:407` `toVmPath`; `src/transcript.ts:208-216` `printenv HOME` probe; `src/sandbox.ts` argv builders (`agentSessionArgv`, kill argv) to mirror.
- `test/fakes.ts` -- `fakeLauncher` :10, `fakeStudioRoot` :75, `fakeSbx` :164, `gitRepo` :244; `test/worktree.test.ts` pause → draft PR flow (`fx.answers.launch`).
- tk-studio `plugins/tk-studio/lib/launch.py:473-500` returns `run.paused_story_key`; `meter.py harvest` CLI (`meter.py:784-790`).

## Tasks & Acceptance

**Execution (Files = the plan's 11):**
- `src/closeout.ts` (new) -- the paused-run pass: spec/verdict read, three outcomes, commit/meter/archive/relaunch with `close-out`, `close-out-failed`, `awaiting-ruling`; resume verb with `engine-resume`; deps injected like `WorktreeDeps`/`SandboxDeps`.
- `src/worktree.ts` -- `engineStatus` carries `paused_story_key`.
- `src/queue.ts` -- `paused` → `running` moves for close-out relaunch and resume (owner, event); `recover`/`awaitingEngine` "launched after latest `close-out`/`engine-resume`".
- `src/cli.ts` -- pass after both sweep sites; relaunch driver; `resume` verb the API calls.
- `src/api.ts` -- `POST /runs/{id}/resume`; `ExternalRunRefused` → `409 ExternalRun`.
- `src/page.ts` -- "awaiting a ruling" (story key + reason) on a paused run whose latest pass event is `awaiting-ruling`.
- `test/closeout.test.ts` (new) -- AC1 (order, named message, idempotent retry after failed step, pin on relaunch, story not re-driven), AC2 (one notification across two ticks, page row), AC3 (nothing closed out; resume with/without patch; 409s), restart caution.
- `test/fakes.ts` -- `fakeSbx` answers `bmad-loop archive|resolve` and `printenv HOME`; fake `meter.py`.
- `test/api.test.ts` -- resume answers; external cancel → 409 ExternalRun.
- `README.md` -- queue/lock/restart rules (pass, new events, awaiting a ruling), worktrees and PRs (relaunch reuses draft PR), HTTP API table (resume row; cancel 409).
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` -- `## Story 27.3`: replace runbook "When a run pauses" rows and `resume-run.sh` header with the service's pass and route.

**Acceptance Criteria:** AC1–AC4 in the intent contract, each pinned in `test/closeout.test.ts` / `test/api.test.ts`. AC4 "both hosts": the win32 run is `unverifiable-here` (operator-decisions §5).

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 1, medium 4, low 5)
- defer: 1: (high 0, medium 1, low 0)
- reject: 1: (high 0, medium 1, low 0)
- addressed_findings:
  - `[high]` `[patch]` a relaunch that threw after its new `launched` re-paused the run on the archived engine (both layers; consult 2: apply) — falls back to `paused` only with no `launched` after the latest `close-out`, else one `close-out-failed {step:"relaunch"}` and the run stays `running`
  - `[medium]` `[patch]` a fall-back to `paused` left the checkout lock as this process's run lock — `Queue.returnToPause` restores the pre-move lock row
  - `[medium]` `[patch]` `escalate # note`, `Escalate`, `null`, `~`, empty or block-scalar verdicts read as closable (AC2 bypass) — frontmatter parsed with js-yaml, case-insensitive `escalate`, non-string counts as missing
  - `[medium]` `[patch]` the harvest commit did not check the worktree is on `supervisor/run-<id>` — branch check fails the `commit` step otherwise
  - `[medium]` `[patch]` a failed `bmad-loop resolve` child was never recorded — `launched` carries `resolve: {exit, error?}`
  - `[low]` `[patch]` hold note / `markLaunched` failures swallowed after a resume spawn — retry once, then back to `paused` with `resume_failed`
  - `[low]` `[patch]` a fresh pause on the same (story, engine) after a resume got no `awaiting-ruling` and the page row hid — dedupe only after the latest `paused`
  - `[low]` `[patch]` the `engine-resume` branch of the restart rule was untested — test added
  - `[low]` `[patch]` bearer-only resume route unasserted against a cookie session — test added
  - `[low]` `[patch]` README / `api.ts` header omitted `400 MalformedJson` and `500 ResumeFailed` — documented
- rejected: the relaunch drive running inline in the tick/recover/drain `finally` blocks — the plan places the pass at the `sweepEngines` sites and the drain already drives workers inline; not a defect in a named criterion

### 2026-10-16 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 7: (high 0, medium 4, low 3)
- addressed_findings:
  - `[medium]` `[patch]` a retry after a successful archive and a failed relaunch made a second harvest commit containing `.bmad-loop/archive/<engine id>/` (blind-hunter, reproduced) — `commitStep` stages `git add -A` minus `:(exclude,glob)` pathspecs for `.bmad-loop/runs` and `.bmad-loop/archive`; tests: no engine-state path on the run branch after the retry, and a project ignoring both dirs still commits (consult 3)
  - `[medium]` `[patch]` a relaunched run's end came from the relaunch's `launched.end` (`complete` at detach), contrary to the Always rule "the queue state after the relaunch comes from the engine" (blind-hunter) — `sweepEngines` takes a relaunched run's end from `engineEndState`; a killed relaunch keeps its recorded trip end (consult 3: accept-deviation score 1); tests for `crashed`/`finished` and for the killed case
  - `[low]` `[patch]` "nothing to commit" was detected by matching English git output (edge-case-hunter) — `git diff --cached --quiet` after the add decides
- deferred: a serve restart during an in-flight resume orphans the run while its engine runs (blind-hunter) — see frontmatter `deferred`; class (a), AC3
- rejected: spec `done` at an escalation with no story commit is closed out — AC1 defines the landing by the spec's `status: done` at the commit gate or an escalation, which this is
- rejected: non-closable stage with a done spec is a dead end — already deferred in this spec (DW-28)
- rejected: a run paused before this change has no `paused_story_key` — the plan's Settled shape rules no key as AC3 (stays paused for the resume)
- rejected: a run dir missing before metering — the plan's Settled shape counts an archived run dir as done; a hand archive is the attended recipe, which meters first
- rejected: the close-out move proceeds when another run holds the checkout lock — a paused run keeps its checkout lock (27.1), and the move records `taken: false`
- rejected: `git add -A` stages untracked non-harvest files — the plan settles `git add -A` as `finalize_commit`'s staging; the engine-runtime part is the patched finding
- rejected: `status: Done`/`DONE` read as not landed — bmad specs and bmad-loop write lowercase `done`

### 2026-10-16 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 11: (high 0, medium 6, low 5)
- addressed_findings:
  - `[medium]` `[patch]` the harvest commit staged the supervisor's own materialised `COPIED_RUNTIME` copies (`.bmad-loop/policy.toml`, `.bmad-loop/routing.current.json`, the machine-local `.tk-studio/config.local.yaml`) in a project that does not gitignore them, so they reached the run branch and PR (AD-15; both layers) — `ENGINE_STATE` also excludes every `COPIED_RUNTIME` path in the `:(exclude,glob)` form, built from the exported constant; tests: unignored copies stay untracked and out of the commit, ignored copies still commit
  - `[low]` `[patch]` a throw from the `close-out` move (`resumeFromPause`) after commit/meter/archive escaped to the pass's bare catch with no `close-out-failed` (both layers) — guarded: one `close-out-failed {step:"relaunch"}`, run stays `paused`, drive never runs; `noteFailed` never throws (consult 4)
  - `[low]` `[patch]` a relaunch drive that resolved with the run still `running` and no `launched` after the `close-out` (`mirror` swallows its own queue errors) left the run stuck under the live process; and a drive that went back to `paused` was still reported in `closed` (edge-case-hunter, blind-hunter) — such a drive records `close-out-failed {step:"relaunch"}` (`NOT_HANDED`) and goes back to `paused`; `closed` lists only runs that left `paused`; tests added
  - `[low]` `[patch]` nothing pinned `engineStatus` carrying launch.py's `run.paused_story_key` into the `paused` event the sweep writes (blind-hunter) — test: the sweep's `paused` event carries the key and the next pass reads it; no key, no field
- rejected: non-closable stage with a done spec is a dead end — already deferred (DW-28)
- rejected: a serve restart during an in-flight resume orphans the run — already deferred (DW-29)
- rejected: the close-out move proceeds when another run holds the checkout lock (both layers) — the lock key is the project checkout and a paused run keeps its lock (27.1); settled in the previous pass
- rejected: the relaunch's fresh session id is never stored — `queueRecorder.session` stores it before the spawn (`src/cli.ts:1797`)
- rejected: a relaunch whose launch returns a non-engine terminal outcome (e.g. `blocked`) ends the run instead of going back to `paused` — the failure rule covers steps the pass could not perform; a launch's own outcome is mirrored as any launch's, with its reason and end notification
- rejected: notify succeeded but the `awaiting-ruling` write failed, so the next tick notifies again — a local queue write failure; plumbing
- rejected: a story key matching spec files in two spec folders reads as no spec — story keys carry the epic number and the plan settles "single match"
- rejected: the README's "never a second `gh pr create`" for a relaunch, and a relaunch with no stories left, are unasserted — 27.1 PR behaviour through the unchanged `mirror`; plumbing
- rejected: no git identity for the harvest commit on a service account — the supervisor runs as the operator, and a failed commit is a recorded `close-out-failed {step:"commit"}`
- rejected: the tk-studio hand-over does not require launch.py to emit `run.paused_story_key` — launch.py already returns it (plan Code Map, `launch.py:473-500`)
- note: the verify re-run found `a resumed run's end is its engine's own terminal status` timing out deterministically; it also fails at HEAD `57bd71a` (a test wait loop on "last event is `launched`" that the later `engine-pid` event never satisfies). Fixed in the test only (`handedBack` via `launchedSinceMove`); not a review finding

## Design Notes

Settled shapes are the plan's "Settled shape" section (commit message, closable verdict, order and failure, event kinds, no-key case, resume route). Restart caution: a relaunched run carries the old `launched` event, so without the "after latest `close-out`" reading a dead relaunch driver is never recovered and the archived engine id is probed forever.

## Verification

**Commands:**
- `bun test` -- all green
- `bunx tsc --noEmit` -- clean
- `bun test test/closeout.test.ts` -- green
- `grep -nE '"(bash|sh|-c|-lc)"' src/closeout.ts` -- no hits
- `bun install --frozen-lockfile` -- may EPERM on the `/c` mount (environment; never touch `bun.lock`)

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- planned: relaunch = move paused → running, then `rebuildStarted`, then `finishRun` / actual: rebuild first, then the `close-out` move, then the drive / why: a failed rebuild must leave the run `paused` with `close-out-failed` / may affect: none
- planned: a `resume` CLI verb the API calls / actual: exported `resumeRun` function, no `main()` subcommand / why: the resolve child is the engine's hold and must live in the long-lived serve process / may affect: none
- planned: the move sets this process as owner "as claim" / actual: the close-out move also makes the checkout lock this process's run lock until `markLaunched` hands it to the new engine; resume leaves the engine lock alone / why: a dead relaunch driver's orphan end then releases the lock normally / may affect: none
- planned: AC1 "paused at the commit gate or on an escalation" / actual: closable `paused_stage` ∈ {`escalation`, `pre_commit`, `pre_commit_gate`} / why: the spec names no stage values; bmad-loop has no separate commit-gate stage / may affect: none
- planned: `src/worktree.ts` only carries `paused_story_key` / actual: also exports `runner`, `uvRunner`, `studioScript` / why: closeout.ts reuses the argv-only and studio-script spawners / may affect: none
- planned: story key from `engineStatus` / actual: read from the latest `paused` event's `engine` detail (filled by the sweep from `engineStatus`) / why: after the archive the probe answers unknown, so a retry needs the stored key / may affect: none
- planned: resume moves with `engine-resume` and re-reads the pid / actual: also writes a `hold` event for the resolve child, and a fresh `launched` event (same engine id) when that child exits / why: under the "launched after latest engine-resume" rule the sweep could never reclaim a resumed run otherwise / may affect: 27-5
- planned: resume answers 200/400 SchemaError/404/409 / actual: also `400 MalformedJson` and `500 ResumeFailed` / why: those failures need a named answer / may affect: none
- planned: pass after "both" sweep sites / actual: after all three `sweepEngines` calls / why: the Code Map lists three call sites / may affect: none

DRIFT: relaunch rebuilds before the `close-out` move — a failed rebuild must leave the run paused — affects: none
DRIFT: resume is an exported `resumeRun`, not a CLI verb — the resolve child must live in the serve process — affects: none
DRIFT: close-out move takes the checkout lock as this process's run lock until `markLaunched` — orphan end releases it normally — affects: none
DRIFT: closable paused stages are `escalation`, `pre_commit`, `pre_commit_gate` — no stage values named by the story — affects: none
DRIFT: `runner`, `uvRunner`, `studioScript` exported from `src/worktree.ts` — reuse of the spawners — affects: none
DRIFT: paused story key read from the `paused` event's engine detail — the probe answers unknown after archive — affects: none
DRIFT: resume writes a `hold` event and a fresh `launched` (same engine id) when the resolve child exits — the sweep must reclaim a resumed run — affects: 27-5
DRIFT: resume also answers `400 MalformedJson` and `500 ResumeFailed` — named failures — affects: none
DRIFT: pass runs after all three `sweepEngines` sites — three sites exist — affects: none


### pass 1b (2026-10-16, implementer, applying consult 1)

- planned: the sweep takes a resumed run's end state from `engineStatus` (consult 1) / actual: new `engineEndState` in `src/worktree.ts`: `finished` → `complete`, any other engine status → `partial`, modelled on `finishStateFor` (`src/server.ts`) / why: no engine-status → TerminalState mapping existed / may affect: 27-4, 27-5
- planned: same / actual: the reason also comes from the engine status (`resumed engine ended '<status>'`); `end.detail`/`end.stop` still carried over; resume writes `end: {}` when no prior end exists / why: a non-finished end needs a reason; minimal change / may affect: none

DRIFT: resumed run's end state from the engine status (`finished` → complete, else partial) via new `engineEndState` — consult 1 ruling; no mapping existed — affects: 27-4, 27-5
DRIFT: resumed end reason `resumed engine ended '<status>'`; resume writes `end: {}` with no prior end — consult 1 ruling — affects: none


### pass 2 (2026-10-16, implementer, review patches; no spec deviation)

- P2 lock restore through a new `Queue.returnToPause` (the `close-out` event records `lock: {before, taken}`), `markPaused` unchanged — the sweep also uses `markPaused`
- P6 both: retry the hand-back once, then back to `paused` with `resume_failed`
- P7 the page's `ruling` also treats `paused` as a pass event — a record from before a fresh pause must not show

Stage-name citation (consult 1): bmad-loop `model.py:31` `PAUSE_ESCALATION = "escalation"`; `engine.py:2753` `_run_workflows("pre_commit_gate", …)` (the commit-gate workflow point); `engine.py:2787` `_emit("pre_commit", …)` (the commit hook whose veto escalates). The set {escalation, pre_commit, pre_commit_gate} is exactly AC1's two cases.

### pass 3 (2026-10-16, implementer, follow-up review patches; consult 3)

- planned (brief): exclude `.bmad-loop/runs` and `.bmad-loop/archive` with literal `:(exclude)` pathspecs / actual: `:(exclude,glob).bmad-loop/run[s]/**` and `:(exclude,glob).bmad-loop/archiv[e]/**` / why: the literal form makes `git add` exit 1 when the project's .gitignore covers the dir / may affect: none
- planned (brief): a relaunched run ends from the engine status / actual: unless the supervisor killed the engine; a killed relaunch keeps its recorded `launched.end` (the trip's state and guard reason) / why: a killed engine writes no end, so its status reads running/unknown; same as the first-launch killed path / may affect: none

DRIFT: harvest commit excludes the engine's runtime dirs with glob pathspecs — a retry after the archive committed `.bmad-loop/archive/<id>/` — affects: none
DRIFT: a relaunched run's end comes from the engine status except when the supervisor killed the engine — the spec's Always rule for the relaunch; a killed engine writes no end (consult 3) — affects: none

### pass 4 (2026-10-16, implementer, follow-up review 2 patches; consult 4)

- planned (brief): guard only the new `close-out` move's `noteFailed` call / actual: `noteFailed` never throws, for every step; a note it fails to write is retried by the next pass / why: every caller already returns false or falls through to the pass's catch; at the post-drive site it keeps `backToPaused` from being skipped (consult 4) / may affect: none
- planned (brief): P1–P4 only / actual: also `NOT_HANDED` exported for the test, an extra "drive ended the run: left as it is, closed" test, and a `paused?: boolean` option on the `pausedRun` fixture / why: exact-message match and fixture reuse / may affect: none
- verify fix (implementer, second launch): `test/closeout.test.ts` resume wait loops wait on `handedBack` (`launchedSinceMove`) instead of "the last event is `launched`" — the pre-existing loop could never exit early because `engine-pid` follows the hand-back's `launched`; the test failed at HEAD too / may affect: none

DRIFT: `noteFailed` never throws for any step, and `NOT_HANDED` is exported — every caller already returns or falls to the pass's catch; the test matches the message (consult 4) — affects: none

## Consult Log

- 2026-10-16T05:44:44Z — trigger: deviation-gt-0 — question: accept the resume path's `hold` + synthetic `launched` (same engine id) on child exit, and the closable stage set? — ruling: accept-deviation score 2 — do: keep the `hold` and `launched` (resumed: true) events, score 2, 27-4/27-5 must not count `launched` events or read it as "tk-studio-launch returned"; the engine-end sweep must take a resumed run's end state from `engineStatus`, not from the `end` resume copies or defaults to {state:"complete"} (src/closeout.ts:415); keep the stage set and cite bmad-loop's stage names — rule candidate: when a restart rule resets an event marker ("X after the latest Y"), every path writing Y must say how its X is written, in the plan's Settled shape, any reuse of an event kind's meaning marked as a seam (score 2)
- 2026-10-16T05:54:18Z — trigger: high-severity-finding — question: `backToPaused` re-pauses a run whose relaunch already wrote its new `launched`; patch, bad_spec or escalate? — ruling: apply — do: in `src/closeout.ts` fall back to `paused` only when no `launched` follows the latest `close-out`, otherwise record one `close-out-failed {step:"relaunch"}` and leave the run `running`; add a test (mirror throws after `markLaunched`: stays running with the new engine id, one `close-out-failed`, next pass runs no meter/archive/relaunch) — rule candidate: when a step hands ownership to another process mid-way, the plan's Settled shape states the failure rule on each side of the handoff
- 2026-10-16T06:22:03Z — trigger: deviation-gt-0 — question: follow-up pass: accept the implementer's two deviations from the patch brief (glob-form `:(exclude,glob)` pathspecs for .bmad-loop/runs|archive in commitStep; a killed relaunched engine keeps its recorded `launched.end` in sweepEngines)? — ruling: accept-deviation score 1 — do: keep both as implemented; add tests if not pinned: (a) harvest commit in a worktree whose .gitignore covers both dirs exits 0 and commits nothing under them, (b) a killed relaunched run ends with its `launched.end` trip state and guard reason; re-run bun test and tsc — rule candidate: in close-out sweeps a run whose engine the supervisor killed always finishes with its latest `launched.end`; engine-state pathspec excludes are written as `:(exclude,glob)<dir-wildcard>/**` so gitignored dirs never fail `git add`
- 2026-10-16T06:41:32Z — trigger: deviation-gt-0 — question: follow-up pass 2: accept the implementer's departures from the patch brief (`noteFailed` never throws for every caller; `NOT_HANDED` exported; extra test; `pausedRun` fixture option)? — ruling: accept-deviation score 1 — do: keep all four departures as implemented, do not narrow `noteFailed`; record (b) as "noteFailed never throws, for every step; a note it fails to write is retried by the next pass" — rule candidate: a best-effort event-recording helper whose failure the next pass retries may swallow its own errors for every caller; score 1 when every caller already returns or falls through to the pass's own catch

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Pass:** the second follow-up review of the story (implemented in `cfe00b5`, first follow-up `57bd71a`). The spec was `done`, so step-01 routed it to a fresh review pass (`review_loop_iteration` 0). The diff covered everything since baseline `6b4b02df3bf1858d805a5b4616b58220524efb4a`, excluding the spec and the deferred-work ledger. Both layers ran (band L).

**Summary:** the story's behaviour is unchanged. This pass fixed four close-out defects:
- the harvest commit no longer commits the supervisor's own materialised runtime copies (`COPIED_RUNTIME`), including the machine-local overlay;
- a failed `close-out` move is recorded as `close-out-failed {step:"relaunch"}`;
- a relaunch that resolves without handing the run to an engine goes back to `paused`, and `closed` lists only runs that left `paused`;
- the `paused_story_key` seam from the sweep to the pass is pinned by a test.

**Files changed in this pass:**
- `src/closeout.ts`: `ENGINE_STATE` adds `:(exclude,glob)` excludes built from `COPIED_RUNTIME`; the `close-out` move is guarded; the post-drive check (`NOT_HANDED`) runs; `noteFailed` never throws; `closeOutLanded` answers whether the run left `paused`.
- `test/closeout.test.ts`: new tests for the unignored copied runtime, the throwing move, a drive that resolves unhanded, a drive that ended the run, and the sweep → `paused_story_key` → pass seam. The ignored-dirs commit test is extended, and the failed-drive test asserts `closed: []`. The resume wait loops now wait on `handedBack` (a pre-existing timing bug: the test timed out at HEAD too).
- The spec (this file): the triage, the deviation lines, consult 4 and this result.
- `_bmad-output/implementation-artifacts/deferred-work.md`: committed as the orchestrator left it (DW-29 added by the orchestrator; no entry changed by this session).

**Review findings:** 15 raised after dedupe (9 blind-hunter, 7 edge-case-hunter, with overlap).
- 4 patches applied: high 0, medium 1, low 3.
- 0 deferred.
- 11 rejected, with a reason for each in the Review Triage Log (two of them already deferred as DW-28 and DW-29).
- **Follow-up review recommended: true.** The score is 3×1 + 1×3 = 6, which is 5 or more.

**Consults:** one (consult 4, `deviation-gt-0`), ruled accept-deviation score 1: `noteFailed` never throws for every step, and `NOT_HANDED` is exported. The consult is logged and its observation recorded.

**Verification** (this session re-ran the gate after the final change):
- `bun test`: 756 pass, 4 skip, 0 fail (760 tests, 16 files). The first re-run had 1 fail: `a resumed run's end is its engine's own terminal status` timed out deterministically. The implementer's second launch traced it to the test's wait loop, confirmed it also fails at HEAD `57bd71a`, and fixed the loop in the test only.
- `bun test test/closeout.test.ts`: 31 pass, run by the implementer.
- `bunx tsc --noEmit`: clean.
- `grep -nE '"(bash|sh|-c|-lc)"' src/closeout.ts`: no hits.
- `bun install --frozen-lockfile`: EPERM linking js-yaml and typescript on the `/c` mount. This is the environment; `bun.lock` is untouched.

**unverifiable-here** (unchanged):
- the win32 `bun test` run (AC4 "both hosts", operator-decisions §5);
- the real `sbx exec … bmad-loop archive|resolve`;
- the `sbx run -d` re-pin;
- the real `meter.py harvest` into the host ledger;
- the tk-studio-side runbook change.

**Residual risks:**
- A relaunch whose launch returns a non-engine terminal outcome ends the run (mirrored as any launch's), rather than going back to `paused`.
- Two dead ends stay deferred: the non-closable stage (DW-28) and the restart during a resume (DW-29).
- The relaunch drive still runs inline in the pass.

DRIFT: `noteFailed` never throws for any step, and `NOT_HANDED` is exported — every caller already returns or falls to the pass's catch; the test matches the message (consult 4) — affects: none

## Reconcile

### 2026-10-16 — adjust-stories

- Score: 2
- Reasoning: The close-out relaunch and the resume add engine iterations under one queue run, and their end state now comes from the engine status (`engineEndState` in `sweepEngines`), not from `launched.detail.end`; the resume writes a synthetic `launched` (`resumed: true`, same engine id), and "launched" now means a `launched` after the latest `close-out`/`engine-resume` (consult 1). 27-4's verify override and 27-5's cost sum and orphan close-out were planned against the old single-launch reading; notes in their `invoke_dev_with` absorb it, and no acceptance criterion changes. DW-26 is closed here (`409 ExternalRun`), so 27-5's conditional is moot.
- Affected: 27-4-a-host-tier-verify-leg-runs-before-any-pr-opens — "A red verify overrides `launched.detail.end` (`partial` naming the command) for both `ended` and the deferred `jobrun finish`" (a relaunched or resumed run's end comes from `engineEndState`)
- Affected: 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid — "In recovery, close out a worktree run `recover` ends as an orphan" and "`total_cost_usd` is the sum across every iteration" (iterations now include close-out relaunches and resumes; `launched` events are not iterations; DW-29 orphans a run mid-resume)
- Invariant: none (the relaunch ends on the launch core's block, contract 0.1.21 `tk-studio-launch` row; AD-15 overlay kept off the branch)

Gate: Part A adjust-stories; Part B story accepted, planned 27-4-a-host-tier-verify-leg-runs-before-any-pr-opens
