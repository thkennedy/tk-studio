---
title: 'The `run-sweep` Job Type'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: 'c1bb9a900a72c06b78b98c2fd52840e2007331dc'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-7.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The deferred-work sweep runs only inside a bmad-loop sweep session and no studio job starts one (`[sweep] auto = "never"`), so DW-46 to DW-65 and the retrospective's deferred findings (DW-85 to DW-87) have no path to a PR.

**Approach:** Ship a `run-sweep` job type in `run-epic.json`'s shape whose `tk-studio-launch` `sweep` verb starts `bmad-loop sweep` detached in the supervisor run's worktree; the supervisor records the triage, runs the host leg once, opens one close-out PR listing bundles, blocked entries and human decisions, and after the merge a `ledgerPass` flips the entries to `resolved … by #N` through a new `plansync.py ledger-resolve` verb. Contract 0.1.30 gains an additive Story 35.7 clause.

**User story (epics.md §Story 35.7, verbatim):** As the owner, I want a shipped job type that runs a deferred-work sweep through the supervisor: the triage in the sandbox (`bmad-loop-sweep` in a sweep session, `BMAD_LOOP_MODE=1`), each bundle executed as a run with a worktree, a host leg and a PR, and the ledger's entries closed by the merge, So that DW-46 to DW-65 and the retrospective's deferred findings (DW-85 to DW-87 and whatever this epic leaves) have a path to main that keeps every rule a story run keeps (the planning finding: no job starts a sweep today, `[sweep] auto = "never"`).

**Acceptance criteria (epics.md §Story 35.7, verbatim):**

- **AC1.** **Given** `plugins/tk-studio/jobs/run-sweep.json` (one-shot, guards, `stop.on_status`, effort, in `run-epic.json`'s shape) and a project instance naming it **When** `POST /jobs {project, job}` queues it **Then** the supervisor pins the sandbox and starts the engine's sweep session detached (the triage pass: `bmad-loop-sweep` reads `deferred-work.md` and returns the partition; `max_bundles` and the attempt caps from `.bmad-loop/policy.toml`), records the triage result in the run workspace and a `sweep-triage` event (the taxonomy extended additively), and the launch's status block names the bundles, the blocked entries and the human decisions
- **AC2.** **Given** a validated triage **When** the bundles execute **Then** each bundle is one engine dev pass in the run's worktree followed by the host leg and the close-out's PR (one PR per bundle, or one per sweep with the bundles listed: the planner decides and the contract names it), the `blocked` and `human decision` entries are listed in the PR body and the inbox line, a merged PR flips its entries to `resolved … by #N` through the plan pull-back, and the sweep ends `complete | partial | blocked` with the status block and a `job-run` ledger line
- **AC3.** **Given** tk-studio **When** the operator queues `run-sweep` once on the sandbox tier at the engine's request through the consult log **Then** one real sweep runs over the open ledger (its first targets: DW-46 to DW-65 and the consolidation entries DW-85 to DW-87; `max_bundles` bounds it), its PRs are merged on green by the operator, the ledger reads the closures; conformance drives the surface with a fake engine; the contract (0.1.30, additive) names the job type; the cost lands in the ledger

**Planner's settled shape (SPEC Design notes CAP-15, CAP-16; plans/35-7.md `## Settled shape` 1-6):** the job JSON and the `launch.py sweep` verb (refusals, spawn, triage wait 1500 s, block `triage{…}` and the one-line reason); `sweep-triage` as two records (the ledger event emitted by `launch.py sweep` alone; the queue event noted once per engine run by the supervisor's watch with the copy to `<run workspace>/sweep/triage.json`); one PR per sweep with `## Sweep` before `## Host verify` and the `sweep:` notice line; the end-state rule and the paused sweep closed out, never relaunched; `plansync.py ledger-resolve` and the leased `ledgerPass`; the `e2e_run_sweep.py` drive. These are binding as written in the plan; the dev session does not reopen them.

## Boundaries & Constraints

**Always:**
- The plan's `## Files` list (20 entries) is the boundary; any other file is a deviation recorded as `DRIFT:` and triggers the `file-outside-files` consult. A Files list growing past the plan's is a `halt` consult. Never split the story.
- Stdlib-only Python via `uv run`; atomic writes; every headless surface ends in the JSON status block (AD-11); nothing in the plugin imports a driver/supervisor/Hermes (AD-2); credentials never land in files or events (NFR5).
- Contract changes are additive on 0.1.30: no `0.1.31` anywhere; the existing `0.1.31` absence checks stay.
- The supervisor commits nothing to the ledger; `ledger-resolve` writes at the owner root as the Stage Log rows do. Every ledger write and every triage copy is atomic and idempotent.
- `sweep-triage` (ledger) has `launch.py sweep` as its only emitter; the supervisor's `sweep-triage` queue note is a different store, and nothing is recorded under bmad-loop's journal `sweep-triage` key.

**Block If:**
- `bmad-loop sweep` refuses the materialised run worktree as dirty because `COPIED_RUNTIME` (`worktree.ts:232`) files are not gitignored (the fix is outside Files: consult).
- `bmad-loop status --json` does not report a sweep run's end or pause the way `ENGINE_ENDED`/`paused_stage` expect (consult before a sweep-specific status read).
- A landed bundle cannot be told from the journal or `tasks/dw-<name>/result.json` without patching bmad-loop.
- The ledger rewrite needs a commit the supervisor makes itself.

**Never:**
- Patch bmad-loop (read-only), edit `.bmad-loop/policy.toml` (`[sweep] auto` stays `never`), `epics.md`, `stories.yaml`, `routing.toml`, or `_bmad-output/implementation-artifacts/deferred-work.md`.
- Run a real sweep or fix a DW entry in this story (AC3's real sweep is the operator's). `bmad-loop sweep --dry-run` as a read-only sanity read is the only engine invocation allowed.
- Take a sweep run through `closeOutPaused`'s epic relaunch.
- Push, tag, open a PR, or bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sweep launch, triage read | clean tree, policy + ledger present; fake engine writes `state.json` + valid `triage.json` (2 bundles, 1 blocked, 1 decision) | `complete` block, intent `tk-studio-launch`, artifacts `.bmad-loop/runs/<rid>` + `…/triage.json`, `triage{…}`, reason `bundles: a (DW-1, DW-2); b (DW-3); blocked: DW-4; decisions: DW-5`; one `sweep-triage` ledger event | none |
| Triage still running | engine running, no `triage.json` within `--triage-wait` | `complete`, reason `triage still running`, no ledger event | supervisor's watch records it later |
| Triage escalated | engine ended/paused with no `triage.json` | `blocked` naming the escalation | nothing else |
| Dirty tree / missing policy or ledger | `git status --porcelain` non-empty, or file absent | `blocked` naming the paths / the gap; nothing spawned | no state written |
| Existing run dir | `--run-id` names an existing `.bmad-loop/runs/<rid>` | refused as `start` refuses | — |
| Watch sees triage | `run-sweep` run, `<worktree>/.bmad-loop/runs/<eid>/triage.json` first appears | atomic copy to `<studioHome>/projects/<key>/runs/<id>/sweep/triage.json`; one `sweep-triage` queue note; never re-noted | unparseable → one note `{engine_run_id, error}` |
| End state | bundles landed/not, host leg result | all landed (or 0 bundles) + host green/skipped → `complete`; mixed, or host red/inconclusive → `partial`; no triage, or >0 bundles and none landed → `blocked` | paused sweep closed out the same way, paused bundle `not landed — paused at <stage>`, engine stopped |
| `ledger-resolve` | entries `status: done <date>` | rewritten `resolved <date> by <owner/repo>#N (sweep bundle dw-<name>; <resolution, clipped>)`; second call `unchanged`; still-`open` → `pending` | `ok` block always; atomic write |
| `ledgerPass` | terminal `run-sweep` run, PR `MERGED` | under `plan-lease {phase: "ledger"}`, one `ledger-resolve {pr, ids, resolved, pending, ok, settled?}` event per attempt; `pending` retries bounded by `PLAN_RETRY_LIMIT` | idempotent across ticks |

</intent-contract>

## Code Map

The plan's `## Code Map` (plans/35-7.md, loaded via `context:`) is the investigation and is binding; anchors are as of 2026-10-29, not pins. Key anchors, spot-checked at baseline `c1bb9a9`:

- BL (read-only) `~/.local/share/uv/tools/bmad-loop/lib/python3.14/site-packages/bmad_loop`: `cli.py:1277 cmd_sweep`, `:1189 _start_sweep`, flags `:2610-2633` (`--no-prompt`, `--max-bundles`, hidden `--run-id`); `sweep.py:34 TRIAGE_KEY`, `:811 _ensure_triage`, `:877 sweep-triage-result`, `:1271` bundle ledger-close kind, `:98 validate_triage` (partition schema).
- `plugins/tk-studio/lib/launch.py` -- `start` (~:1227), `RUN_ID_RE`/`mint_run_id`, `spawn_detached` (~:204), `with_block`/`check_block`/`start_block` (~:664-688), `main` (~:1340); fake substrate `tests/test_launch.py:100-143`.
- `apps/supervisor/src/cli.ts:1586 launchedEngine` -- requires intent `tk-studio-launch` + artifact `.bmad-loop/runs/<id>`; unchanged, the verb keeps both.
- `apps/supervisor/src/worktree.ts` -- `COPIED_RUNTIME` :232, `prBody` :405, `closeOut` :613, `engineStatus` :878, `finishStudio` :904, `sweepEngines` :944, host leg :1005-1045; `hostverify.ts:234 isSlice/SLICE_JOB_TYPE` is the branch-point precedent.
- `apps/supervisor/src/closeout.ts:773 closeOutPaused` -- a sweep must never take it.
- `apps/supervisor/src/hygiene.ts:188 noticeText`, `endNotice` :156.
- `apps/supervisor/src/planstatus.ts` -- `mergePass` :367-415, `stagePass` :552 (lease/retry/event pattern for `ledgerPass`), `PLAN_RETRY_LIMIT`.
- `plugins/tk-studio/lib/plansync.py` -- `status_pull_back` :820, `stage_append` :2563 (CLI-verb idempotent-write precedent).
- `plugins/tk-studio/jobs/run-epic.json` (shape), `contracts/job.schema.json:39` (tier note), `lib/job.py:308 load_types`; tests `test_job.py:248/:256/:334`, `test_driver_contract.py:2536/:2614/:2680/:2746/:2812/:2821/:2871`.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` (`stage` :111 → add `sweep-triage`), `driver-contract.md` :5/:6/:784/:826-935/:1929-1981, `conformance/manifest.json` :94-170 (`e2e_vertical_slice.py` precedent), `apps/supervisor/test/fakes.ts` (`fakeGh` :220, `fakeStudioRoot` :76, `gitRepo` :399).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/jobs/run-sweep.json` -- new, key-for-key `run-epic.json` shape per Settled shape 1 -- AC1.
- `plugins/tk-studio/contracts/job.schema.json` -- check/adjust the `requires.tier` note naming `run-sweep` -- AC1.
- `plugins/tk-studio/lib/launch.py` -- `sweep` subparser + verb (refusals, spawn, wait, block, reason) and the `sweep-triage` `ledger.emit` -- AC1.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- `sweep` verb, payload `max_bundles`, block fields -- AC1.
- `plugins/tk-studio/lib/plansync.py` -- `ledger-resolve` verb -- AC2.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- `sweep-triage` after `stage` -- AC1.
- `apps/supervisor/src/sweep.ts` -- new: `SWEEP_JOB_TYPE`, `isSweep`, `readTriage`, `recordTriage`, `sweepSection`, `sweepEndState`, `ledgerPass` helpers -- AC1/AC2.
- `apps/supervisor/src/worktree.ts` -- triage record in the watch, `## Sweep` in `prBody`, the end state, paused-sweep close-out + `endEngine` -- AC1/AC2.
- `apps/supervisor/src/closeout.ts` -- sweep never takes the paused relaunch -- AC2.
- `apps/supervisor/src/planstatus.ts` -- `ledgerPass` after `stagePass` in the merge pass -- AC2.
- `apps/supervisor/src/hygiene.ts` -- `sweep:` notice line -- AC2.
- `apps/supervisor/README.md` -- run-sweep runbook bullet -- AC3.
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.30 Story 35.7 clause, Stories row, §4 `run-sweep` bullet, launch row `sweep` verb, 35.7 paragraph naming one PR per sweep -- AC3.
- `plugins/tk-studio/contracts/conformance/e2e_run_sweep.py` + `manifest.json` -- new drive under `tk-studio-launch` per Settled shape 6 -- AC3.
- `apps/supervisor/test/sweep.test.ts` -- new `describe("Story 35.7 …")` covering the matrix's supervisor rows (triage record + idempotence + unparseable, `## Sweep` body, notice line, end-state rule, paused sweep not relaunched, `ledgerPass` merged/pending/idempotent) -- AC1/AC2.
- `plugins/tk-studio/lib/tests/test_launch.py`, `test_plansync.py`, `test_job.py`, `test_driver_contract.py` -- the matrix's lib rows, the shape/sbx pins, the widened Stories-row pins and `test_0_1_30_story_35_7_the_run_sweep_job_type` -- AC1-AC3.

**Acceptance Criteria:**
- Given the verify gate and the plan's bun steps, when they run, then the lib suite is OK, conformance is `ok: true` with `e2e_run_sweep.py` among the drives, the named bun tests have 0 fail, `bunx tsc --noEmit` exits 0, and full `bun test` adds no failure beyond the residual 4.
- Given AC3's real sweep, when this story closes, then it is recorded `unverifiable-here` with the operator's exact command asked through the Consult Log.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 3, low 3)
- defer: 0
- reject: 2 (medium 2: `ledgerPass --directory` ignores `run.prefix` — false positive, `run.root` is already the served root below the git top-level (`cli.ts:402-415`), a prefixed-run test now pins it; `pending` counting toward `PLAN_RETRY_LIMIT` — pinned by Settled shape 5 "bounded by `PLAN_RETRY_LIMIT`")
- addressed_findings:
  - `[high]` `[patch]` a paused sweep whose `launch.py stop` failed was closed out under a live engine — stop now precedes `takeForCloseOut`; a failed stop notes `engine-stop` once and is retried next tick; close-out only after `stopped` or `ended` (consult ruling)
  - `[medium]` `[patch]` `launch.py sweep` waited the full triage wait and read `complete` on an unparseable triage after the engine ended/paused — now `blocked` naming the unreadable triage at once
  - `[medium]` `[patch]` the late close-out path skipped the sweep end rule and the inbox `sweep:` line — `closed_out` carries `sweep` + `sweep_end`; `endNotice` reads it
  - `[medium]` `[patch]` a guard-killed sweep's state/reason was replaced by the end rule — kill state kept, `; sweep: <notice>` appended
  - `[low]` `[patch]` bundles dropped by `max_bundles` or skipped by the engine read "no ledger close" — now `not landed — dropped by max_bundles` / `skipped by the engine`, still counted in n
  - `[low]` `[patch]` `ledger-resolve` lost `dw-<name>` when the resolution was clipped first — name extracted before the clip
  - `[low]` `[patch]` `ledgerPass` give-up at `PLAN_RETRY_LIMIT` and the CLOSED-PR branch had no test — both added

### 2026-10-29 — Review pass (follow-up, pass 2)
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 3, low 3)
- defer: 0
- reject: 6 (medium 2, low 4: a paused sweep stranded in `paused` — unreachable, a sweep never takes `markPaused` (`worktree.ts:1029,1066`, `closeOutPaused` skips it by design); the sbx-tier stop argv is untested — plumbing, already a recorded residual risk; the host leg for a paused sweep is unasserted — the code runs it (`worktree.ts:1042`, `paused` false for a sweep), plumbing; a persistently unreadable `triage.json` never noted — `mtimeMs: Date.now()` on a read failure is deliberate, a transient read must not seal a permanent error note; `ledgerPass` counting `pending` toward `PLAN_RETRY_LIMIT` — pinned by Settled shape 5, rejected the same way in pass 1; a failed run-workspace copy never retried — `copy_error` on the note is an accepted pass-1 DRIFT)
- addressed_findings:
  - `[high]` `[patch]` the skill's single `launch.py sweep` Bash call blocked up to 1500 s, past the Bash tool's 600 s cap, losing the AD-11 block (the supervisor's only source of the engine id) — consult ruling A: the skill passes `--triage-wait 540` under a 600000 ms Bash timeout, core default 1500 s kept; SKILL.md and contract say so; a test pins `--triage-wait 540`
  - `[medium]` `[patch]` `launch.py sweep` had no live-engine refusal (a retried call spawned a second engine on the checkout) — refuses as `start` does via `live_runs(list_runs(root))`, the shared `owning_runs_text`; test; SKILL.md and contract refusal lists
  - `[medium]` `[patch]` an empty ledger (`sweep-nothing-open`, no `triage.json`) was reported as a triage escalation by both `launch.py` and `sweepEndState` — status stays `blocked`, reason now `nothing open in the ledger`; tests on both sides
  - `[medium]` `[patch]` `[sweep] repeat = true` cycles (`triage-<N>.json`, `dw<N>-<name>`) were left out of the summary, the PR, the inbox line and the ledger flip — the supervisor reads every cycle in order, keys bundles by the full cycle key; two-cycle test
  - `[low]` `[patch]` the inbox notice repeated the sweep line (once in `reason:`, once as `sweep:`) — the separate line is dropped only when the clipped reason carries it verbatim; three-case test
  - `[low]` `[patch]` the contract named `<worktree>/.bmad-loop/runs/<id>/triage.json` — now the served root (below the run's prefix)
  - `[low]` `[patch]` the contract's `ledger-resolve` shape omitted `error?`, `skipped?`, `reason?` — added with when each appears; pin updated

### 2026-10-29 — Review pass (follow-up, pass 3)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 2 (medium 1, low 1: no `sweep-triage` ledger event when the triage outlasts the skill's 540 s wait — pinned by the intent matrix's "Triage still running" row (no ledger event, the watch records it later) and the Always rule that `launch.py sweep` is the only emitter; a bundle `result.json` reading done with no journal ledger-close leaves its entries `pending` until the bounded give-up — the `result.json` landed fallback is the planned reading (Design Notes), and the outcome is bounded and recorded as one settled `gave up` event)
- addressed_findings:
  - `[medium]` `[patch]` a sweep cancelled (made terminal) before its close-out was notified with no `sweep:` inbox line — `sweepEnds` claims and sends the end before the late `closed_out` exists, and nothing re-notifies. `endNotice` now falls back to a live `sweepNotice(sweepSummary(…))` through a reader `sweep.ts` registers with `hygiene.ts` (`registerSweepLine`; the direct import would be a cycle). A test drives the real `cancelRun`
  - `[medium]` `[patch]` `launch.py sweep`'s total wait was not bounded by `--triage-wait` (the state wait came first, and the deadline's last status probe had a 120 s timeout), so 540 s could pass the Bash tool's 600 s cap — the deadline is now taken at the call's entry, and the post-spawn waits are clamped to the time remaining. SKILL.md and the contract say the wait counts from the call's start. A test pins the bound
  - `[low]` `[patch]` the race path's `closed_out` (a cancel won mid-close-out) had no `sweep_end` — it now carries the computed `{state, reason}`. Test added
  - `[low]` `[patch]` README said a still-`open` entry is "retried until the checkout has pulled the merge" — it now names the `PLAN_RETRY_LIMIT` give-up and says to pull the merge promptly. The behaviour is unchanged (pinned by the intent matrix)
  - `[low]` `[patch]` the contract's `tk-studio-launch` row did not list `sweep`'s outcomes or refusals — added (complete / triage still running / blocked: escalation, nothing open, unreadable; refusals: no policy, no ledger, live engine, dirty tree, existing run dir). Seven phrases are pinned in `test_0_1_30_story_35_7_the_run_sweep_job_type`

## Design Notes

One PR per sweep is forced by the engine: bmad-loop 0.9.1 commits each bundle in place (`scm.isolation = "none"`) on the checked-out `supervisor/run-<id>`, and one supervisor run is one branch and one PR. A bundle has landed when the journal holds its bundle ledger-close kind for `dw-<name>`, else from `tasks/dw-<name>/result.json`. `doneStories` finding no `N.M` spec on a sweep branch is expected; the ledger pass carries the closures.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, `e2e_run_sweep.py` among the drives
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && unset TK_STUDIO_ROOT && bun test test/sweep.test.ts test/worktree.test.ts test/closeout.test.ts test/planstatus.test.ts test/hygiene.test.ts` -- expected: 0 fail
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: exit 0
- `cd apps/supervisor && bun test` -- expected: no new failure versus the residual 4 in `plugins/tk-studio/README.md`
- `bmad-loop sweep --dry-run --project .` -- expected: lists the open ledger, spawns nothing (sanity read only)

## Deviation Summary

### pass 1 (implementer, 2026-10-29)

- planned: `launch.py sweep` result carries `triage{…}` + block / actual: also `triage_pending`, `triage_error`, `engine`, `ledger_event` or `ledger_error` / why: a still-running triage, an escalation or a failed ledger write is named, not lost / may affect: none
- planned: an escalated triage `blocked` "naming the escalation; nothing else" / actual: the `blocked` block still lists `.bmad-loop/runs/<rid>` in `artifacts` / why: the supervisor adopts the engine, stops it and closes it out instead of leaving a paused engine unwatched / may affect: none
- planned: unparseable `triage.json` noted once `{engine_run_id, error}` / actual: noted only once the file is 60 s old; the success note may carry `copy_error` / why: the engine writes in place; an early read of a half-written file would record a permanent error / may affect: none
- planned: "`endEngine` stops the engine as on an end" for a paused sweep / actual: paused engine stopped first with `launch.py stop` (in the sandbox on sbx), recorded `engine_stop` on the `ended` event, then `endEngine` / why: `endEngine` kills nothing / may affect: none
- planned: `ended` detail and `EndNotice` unchanged / actual: a sweep's `ended` (and late `closed_out`) carries a `sweep` record; `EndNotice` gains optional `sweep` / why: the notice line and the ledger pass read from it / may affect: none
- planned: `ledger-resolve {pr, ids, resolved, pending, ok, settled?}`, `--pr <owner/repo#N>` at the owner root / actual: event may also carry `error`/`skipped`/`reason`; CLI also accepts a GitHub PR URL; directory is the run's project root; a missing entry is `pending`; an already-resolved id reads `(sweep; <resolution>)` / why: the supervisor holds the PR as a URL; the ledger belongs to the run's project / may affect: none
- planned: landed by journal kind "else from `tasks/dw-<name>/result.json`" / actual: fallback counts landed only on `status: done` in that file / why: the plan names no field / may affect: none

DEVIATION SCORE: 1

DRIFT: `launch.py sweep` result carries `triage_pending`/`triage_error`/`engine`/`ledger_event|ledger_error` beyond `triage{…}` — a pending, escalated or failed-emit triage is named, not lost — affects: none
DRIFT: an escalated-triage `blocked` block keeps `.bmad-loop/runs/<rid>` in `artifacts` — the supervisor must adopt, stop and close out the paused engine — affects: none
DRIFT: an unparseable `triage.json` is noted only once 60 s old; the success note may carry `copy_error` — a half-written file would record a permanent error — affects: none
DRIFT: a paused sweep's engine is stopped by `launch.py stop` before `endEngine`, recorded `engine_stop` — `endEngine` kills nothing — affects: none
DRIFT: a sweep's `ended`/`closed_out` events carry a `sweep` record and `EndNotice` gains optional `sweep` — the notice line and ledger pass read it — affects: none
DRIFT: `ledger-resolve` event adds `error`/`skipped`/`reason`; `--pr` also takes a PR URL; directory is the run's project root; missing entry `pending`; already-resolved ids read `(sweep; …)` — the supervisor holds a URL; no bundle name for already-resolved — affects: none
DRIFT: the `result.json` landed fallback reads `status: done` — the plan names no field — affects: none

### pass 2 (review patches, 2026-10-29)

- planned: patch "pass `<root>/<prefix>` to `ledger-resolve`" / actual: `--directory run.root` unchanged, a prefixed-run test pins it / why: `run.root` is already the served root; the change would double the prefix / may affect: none
- planned: apply `sweepEndState` on the late close-out / actual: recorded as `sweep_end {state, reason}` on `closed_out`; an already-terminal run keeps its row / why: the queue never rewrites a terminal row / may affect: none
- planned: failed-stop note (consult) / actual: new queue event `engine-stop {engine_run_id, error, engine}` (`SWEEP_ENGINE_STOP`) / why: the consult's once-per-engine-run note needs a kind; kebab-case like `graceful-stop` / may affect: none
- planned: patch 3 in `launch.py` / actual: plus one clause each in `SKILL.md` and the contract's 35.7 paragraph for the unreadable-triage `blocked` / why: keep the documented block true / may affect: none

DEVIATION SCORE: 1

DRIFT: a late close-out of an already-terminal sweep records the three-way end as `sweep_end` on `closed_out` and keeps the terminal row — the queue never rewrites a terminal row (consult) — affects: none
DRIFT: a failed stop of a paused sweep notes a new queue event `engine-stop` once per engine run and retries next tick — consult ruling, a close-out over a live engine is outside Settled shape 4 — affects: none
DRIFT: the unreadable-triage `blocked` case is named in `SKILL.md` and the contract's 35.7 paragraph — the documented block stays true — affects: none
DRIFT: the skill's sweep call passes `--triage-wait 540` under a 600000 ms Bash timeout, while the core's default stays 1500 s — the block must print inside the Bash tool's 600 s cap (consult, score 1) — affects: none
DRIFT: the `sweep` record's bundles gain an optional `cycle` (above 1 only), later-cycle PR lines read `(cycle N)`, and the contract's 35.7 note documents the repeat-cycle reading — a bundle name reused across cycles must be told apart (consult, score 1) — affects: none
DRIFT: the e2e drive's fake engine answers `bmad-loop list` — the new live-engine refusal probes it before spawning (consult, score 1) — affects: none
DRIFT: a sweep run's notice shows its sweep line only inside `reason:` when the clipped reason carries it verbatim; the contract's inbox-line clause says so — de-duplication without losing AC2's inbox listing (consult, score 1) — affects: none

### pass 3 (review patches, 2026-10-29)

- planned: `endNotice` calls `sweepNotice(sweepSummary(...))` directly / actual: `sweep.ts` registers the reader with `hygiene.ts` (`registerSweepLine`) at module load; `endNotice` uses it only when neither the ending event nor a `closed_out` carries `sweep.notice` / why: a direct import is a cycle (sweep → worktree → hygiene), and injecting it via `HygieneDeps` would need `cli.ts` / may affect: none
- planned: clamp every subprocess timeout after the deadline / actual: deadline taken at entry; the `state.json` wait and the in-loop status probe clamped to `max(1, min(cap, remaining))`; the pre-spawn `bmad-loop list` / `git status` keep their own timeouts, counted against the deadline / why: clamping the refusal probes would make a short wait risk a spurious refusal; the total stays about max(wait, ≤180 s probes) + 2 s / may affect: none

DEVIATION SCORE: 1

DRIFT: a sweep's inbox line is read live by a reader `sweep.ts` registers with `hygiene.ts` when the run is terminal before any close-out — a direct import would be a cycle (consult, score 1) — affects: none
DRIFT: `launch.py sweep`'s `--triage-wait` counts from the call's start, clamping only the post-spawn waits; the pre-spawn refusal probes keep their own timeouts — the AD-11 block must print inside the Bash tool's 600 s cap without spurious refusals (consult, score 1) — affects: none

## Consult Log

- 2026-10-29T14:26Z — trigger: deviation-gt-0 — question: are pass 1's seven deviations score-1 additive refinements, esp. #2 (escalated blocked keeps the run dir artifact) and #6 (ledger-resolve directory = run's project root)? — ruling: accept-deviation score 1 — do: keep all seven as built, score 1; do not change taxonomy `sweep-triage` or the `--directory` flag; carry on to review — rule candidate: in plan matrices "nothing spawned"/"nothing else" binds only pre-spawn refusals; extra optional keys on a launch result or queue event (not a taxonomy payload) are score 1 when the pinned fields stay byte-identical
- 2026-10-29T14:30Z — trigger: high-severity-finding — question: a paused sweep whose `launch.py stop` fails is still closed out (worktree removed under a live engine); does Settled shape 4 close out unconditionally (a) or only after a confirmed stop (b)? — ruling: apply — do: reading (b), a patch inside Settled shape 4 (no deviation); stop before `takeForCloseOut` (or release the take on failure); on a non-`stopped` result note `engine_stop` once per engine run, leave run/worktree/branch and continue, the next tick retries; closeOut only after `stopped` or `engineStatus` reads `ended`; add a failed-stop test (no close-out, worktree kept, one note, close-out next tick) — rule candidate: any supervisor close-out that removes a worktree must first see the engine read `ended` or a confirmed stop; a failed stop leaves the run for the next tick and is never recorded as an end
- 2026-10-29T14:49Z — trigger: deviation-gt-0 (pass 2) — question: accept pass 2's late-close-out `sweep_end` record, the `engine-stop` queue event and the unreadable-triage doc clauses at score 1? — ruling: accept-deviation score 1 — do: keep (A) as built (terminal row kept, `sweep_end` on `closed_out`, inbox line from it); keep (B) `engine-stop`, do not rename to `engine_stop` (a detail key); keep the SKILL.md/contract clause; carry on — rule candidate: a Settled-shape end rule applies to runs the supervisor ends; an already-terminal run keeps its row and the rule's result rides its late `closed_out` (score 1)
- 2026-10-29T14:49Z — trigger: operator step (AC3, not a consult) — question: ASK THE OPERATOR — once this story's PR is merged, queue one real `run-sweep` on the sandbox tier: add a project instance naming `run-sweep` placed `{tier: "sbx", sandbox: "<name>"}` in `TK_SUPERVISOR_CONFIG`, then `POST /jobs {project: "tk-studio", job: "<instance id>"}` (optional `max_bundles`); merge its PR on green; confirm the ledger reads `resolved … by #N` for the closed entries (first targets DW-46 to DW-65, DW-85 to DW-87) and the `job-run` cost line; answer here with the PR number and the ledger diff — ruling: n/a — do: record AC3 `unverifiable-here` — rule candidate: none
- 2026-10-29T14:58Z — trigger: high-severity-finding (follow-up review pass) — question: the skill's single `launch.py sweep` Bash call blocks up to the core's 1500 s triage wait, past the Bash tool's 600 s cap, so the AD-11 block (the only source of the engine run id, `cli.ts:1585-1590`) is lost: keep 1500 s and pass a shorter `--triage-wait` from the skill, lower the default, HALT, or reject? — ruling: accept-deviation score 1 — do: follow option A: keep `DEFAULT_TRIAGE_WAIT_S = 1500.0`; SKILL.md's `sweep` runs `launch.py sweep --directory <root> --triage-wait 540 [--max-bundles <n>]` with the Bash tool timeout 600000 ms, one line saying why (the block prints inside the tool's 600 s cap; a longer triage ends `complete`/`triage still running` and the watch records it) | change the "up to 1500 s" wording in SKILL.md and the contract's 35.7 paragraph to the same words (the skill waits 540 s, the core default stays 1500 s); add one test or conformance assertion that the skill's sweep command passes `--triage-wait 540` | log DRIFT score 1, local to the skill's call site — rule candidate: a headless skill's single blocking core call must have its total wait bounded under the Bash tool's 600 s cap, with the timeout set explicitly; longer waits belong to the supervisor's watch, never the tool call
- 2026-10-29T15:12Z — trigger: deviation-gt-0 (follow-up review pass) — question: accept the patch pass's three new drifts at score 1: P4's optional `cycle` on the `sweep` record's bundles and `(cycle N)` PR lines for repeat cycles, P2's fake engine answering `bmad-loop list` in `e2e_run_sweep.py`, P5's notice dropping the separate `sweep:` line when the clipped reason already carries it verbatim? — ruling: accept-deviation score 1 — do: keep P4, P2 and P5 as patched and record the three DRIFT lines at score 1 | leave the settled forms untouched (cycle-1 bundle line, the first-triage `sweep-triage` note, the four plan refusals with the live-engine probe as a fifth) | make sure the hygiene tests cover both P5 branches (line dropped when the clipped reason carries it; kept when clipping cut it) — rule candidate: additive fields or qualifiers that appear only in states the plan did not enumerate, leaving every settled form byte-identical in the enumerated states, are score-1 deviations the monitoring session may accept without a consult

- 2026-10-29T15:35Z — trigger: deviation-gt-0 (follow-up review pass 3) — question: accept the pass-3 patches' two deviations at score 1: the `registerSweepLine` reader `sweep.ts` registers with `hygiene.ts` (no import cycle) and the triage deadline taken at entry with only the post-spawn waits clamped? — ruling: accept-deviation score 1 — do: keep both patches as built and log two DRIFT lines at score 1 | change no settled form, taxonomy field or contract surface; carry on to closeout — rule candidate: a headless core call's total-wait bound counts from entry and clamps only post-spawn waits; pre-spawn refusal probes keep their own timeouts while their worst case plus the wait stays under the Bash tool's 600 s cap — score 1, acceptable without a consult

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T135643Z-058c6e` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Follow-up review pass 3 over the shipped `run-sweep` job type (pass 1: 86791f5, pass 2: 474a1ba). Both review layers ran, the blind hunter and the edge-case hunter, over the code diff since `c1bb9a9`. Their 9 findings came to 7 after deduplication. 5 were patched by a relaunched implementer and 2 were rejected. One consult ruled `accept-deviation score 1`. The fixes:
- A sweep cancelled before its close-out now has its `sweep:` inbox line.
- `launch.py sweep`'s wait is bounded from the call's start, so the block prints inside the Bash cap.
- The raced `closed_out` carries `sweep_end`.
- The README names the retry bound.
- The contract's launch row lists `sweep`'s outcomes and refusals.

**Files changed (this pass).**
- `apps/supervisor/src/hygiene.ts`: `registerSweepLine` and `endNotice`'s live sweep-line fallback.
- `apps/supervisor/src/sweep.ts`: registers the live sweep-line reader.
- `apps/supervisor/src/worktree.ts`: `sweep_end` on the raced `closed_out`.
- `apps/supervisor/README.md`: the ledger pass's `PLAN_RETRY_LIMIT` give-up, and pull the merge promptly.
- `plugins/tk-studio/lib/launch.py`: `sweep`'s deadline at entry; post-spawn waits clamped (`left()`); `_sweep_engine_phase` takes a timeout.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`: the wait counts from the call's start.
- `plugins/tk-studio/contracts/driver-contract.md`: the launch row's `sweep` outcomes and refusals; the 35.7 paragraph's wait clause (still 0.1.30).
- `apps/supervisor/test/sweep.test.ts`, `plugins/tk-studio/lib/tests/test_launch.py`, `test_driver_contract.py`: tests for each patch.

**Review.** 5 patches applied (high 0, medium 2, low 3). 0 deferred. 2 rejected, with reasons in the Review Triage Log. Follow-up review recommended: true, with score 3×2 + 1×3 = 9.

**Verification.**
- `uv run python -m unittest discover tests`: OK (2508 tests, 4 skipped).
- `runner.py run`: `ok: true`, failures [], with `e2e_run_sweep.py` in the manifest.
- Named bun tests (sweep, worktree, closeout, planstatus, hygiene): 305 pass, 2 skip, 0 fail. The new `review 6` (cancel) and `review 7` (race) tests ran and passed; the sweep file went from 19 to 21 tests.
- `bunx tsc --noEmit`: exit 0.
- Full `bun test`: 1656 pass, 92 skip, 4 fail. The 4 failures are exactly the known sbx residuals in `plugins/tk-studio/README.md` (the wall-clock guard and `invokeSkill` sbx tests).
- `bmad-loop sweep --dry-run --project .`: listed the open ledger and spawned nothing.

**AC3: `unverifiable-here`**, unchanged. The real sweep is the operator's step:
1. Add an instance naming `run-sweep`, placed `{tier: "sbx", sandbox: "<name>"}`, in `TK_SUPERVISOR_CONFIG`.
2. Run `POST /jobs {project: "tk-studio", job: "<instance id>"}`.
3. Merge its PR on green and pull the merge into the owner checkout promptly.
4. Confirm that the ledger reads `resolved … by #N` and that the `job-run` cost line is present.

**Residual risks.**
- A triage longer than 540 s ends the launch `complete` / `triage still running`, and that run gets no `sweep-triage` ledger event (by design: the watch's queue note records it).
- `ledgerPass` gives up after `PLAN_RETRY_LIMIT` passes while the owner checkout has not pulled the merge.
- A cancelled sweep's live inbox line is a snapshot taken at the cancel.
- The live line depends on `sweep.ts` being loaded in the notifying process (it always is through `worktree.ts`).
- A host-leg re-run rewrites the PR body without `## Sweep`.
- `launch.py stop` via `sbx exec` on a live sandbox has not been exercised.

DRIFT: a sweep's inbox line is read live by a reader `sweep.ts` registers with `hygiene.ts` when the run is terminal before any close-out — a direct import would be a cycle (consult, score 1) — affects: none
DRIFT: `launch.py sweep`'s `--triage-wait` counts from the call's start, clamping only the post-spawn waits; the pre-spawn refusal probes keep their own timeouts — the AD-11 block must print inside the Bash tool's 600 s cap without spurious refusals (consult, score 1) — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-29T13:12:09Z | 2026-10-29T13:20:02Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-29T13:58:46Z | 2026-10-29T14:50:01Z | d57d9b73-349d-40f1-8619-6c0492cc938d | claude-opus-5-5 | medium | 36839674 | 203818 | 17.0011 | completed |
| review | 1 | 2026-10-29T14:50:02Z | 2026-10-29T15:19:17Z | 0db6a934-8b29-4bcd-8215-f7520e12a88c | claude-opus-5-5 | medium | 13207750 | 109149 | 7.9629 | completed |
| review | 2 | 2026-10-29T15:19:17Z | 2026-10-29T15:41:58Z | 530b3370-635a-4976-a494-4b099f5c1ce6 | claude-opus-5-5 | medium | 17006608 | 96557 | 8.7621 | completed |
| gate | 1 | 2026-10-29T15:41:58Z | 2026-10-29T15:43:06Z | 1e3c82c8-a01d-4fa9-ad31-000c2be990b2 | claude-opus-5-5 | medium | 703658 | 5543 | 0.7984 | completed |

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, epic complete: no next story
