---
title: 'Setup and the Launch Check, by Evidence'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
baseline_revision: '9a27518073afdb601d04b86041694c80bb05160b'
deviation_score: 2
reconcile_verdict: adjust-stories
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-6.md'
warnings: ['oversized', 'multiple-goals']
deferred:
  - summary: >-
      `plansync setup` posts copied transitions without their `screen` and `rules`, which can erase a site's configuration, and the v3 update schema may have spellings that would carry them.
    evidence: |-
      Deferral class (a), AC1. `_v3_transition` sends a whitelist, so `POST /workflows/update` omits them, and the loss is named only afterwards in `notes` with the setup still `complete`. From a reviewer's and this session's memory, not verified (Atlassian's docs page answered 403 here), the v3 schema has `conditions`, `validators`, `actions`, `triggers` and `transitionScreen`. The consult of 2026-10-31T17:47:31Z ruled that a loss or a v3 spelling found by the operator's live call becomes a follow-up. The legacy rule shapes do not map one to one, so a mapping needs the site's real read.
    location: >-
      plugins/tk-studio/lib/jirabackend.py:1638
    severity: medium
  - summary: >-
      A figure 1 run whose arming was refused still relaunches at close-out, so one queue run can build a second story.
    evidence: |-
      Deferral class (a), AC5's "never builds two stories in one run". `closeOutLanded` reads only `gracefulStopInForce` and `storyBoundaryRecorded`, never the job's rhythm. It needs a double fault: a refused stop, which already sends one notifier line, and then a pause that lands the story. The fix means ending at a boundary with no stop in force, and the `story-boundary` event's `graceful_stop` and `StopInForce.source` have no value for that today.
    location: >-
      apps/supervisor/src/closeout.ts:577
    severity: medium
  - summary: >-
      `rearmFailedLine` still prints a `launch.py stop` command with no `--directory`, which fails argument parsing.
    evidence: |-
      Deferral class (a), filed by the consult of 2026-10-31T19:40:00Z. `launch.py stop` declares `--directory` as required, and on the sbx tier the host has no `bmad-loop`. The line predates this story; `armRefusedLine` was fixed here and `gracefulStopCommand` is the form to reuse.
    location: >-
      apps/supervisor/src/closeout.ts:1068
    severity: low
---

<intent-contract>

## Intent

**Problem:** As the owner, I want `plansync setup` to write the workflow it needs without my hand (uppercase transition types, the version from the v3 search, any status in the To Do category, the global transitions it adds carrying ids), the launch check to refuse writing a tracked `policy.toml` and to know whether the engine sandbox has Godot, `scope`'s game-project rule to read the registry rather than a name prefix, the launch to mark the story it starts In Progress and to arm the one-story-per-run stop itself from the job's declared rhythm.

**Approach:** So that a fresh project's setup needs no manual workflow edit, a game project is one by evidence, and a story being built reads In Progress from its launch with no operator step between the POST and the stop (holes 92, 104 and 105; DW-127, DW-62, DW-71, DW-90, DW-146, DW-147). The shapes are settled in `plans/36-6.md` "Settled shape" 1-6, SPEC.md's CAP-17 design note, and the consult ruling in `## Consult Log`.

**Acceptance criteria (verbatim, epics.md Story 36.6):**

AC1. **Given** `plansync.py setup` against a simplified-workflow project **When** it updates the workflow **Then** the transitions copied from `GET /workflow/search` carry `INITIAL`/`GLOBAL`/`DIRECTED` types, the version comes from the v3 workflows search, the setup accepts any status in the To Do category where it asked for a literal `To Do`, the global transitions it adds (Blocked → Block Resolved, into To Do, into Blocked) carry ids in the `POST /workflows/update` payload and the legacy `from`/`to` keys are dropped (`jirabackend.py update_workflow`; DW-127, hole 92); the live call runs once by the operator through the consult log against the owner's site and the spec records the answer

AC2. **Given** `launch.py check` on a served project whose `.bmad-loop/policy.toml` is tracked, and an `engine.verify_commands` gate on a sandbox **When** `reconcile_verify_commands` would write the policy, and when the engine-gate clause reads the sandbox **Then** the write is refused or reported through `pipeline.unignored_writes` and the tree stays clean (`launch.py`; DW-62), and the clause reads whether the sandbox was provisioned `WITH_GODOT` from a record the pin writes (the tracked config or the sandbox's own marker) and warns on a gate without it (`launch.py engine_gate_clause`; DW-71)

AC3. **Given** a project whose working set confirms the plugin-shipped `gds-engine-godot-4` alone **When** `engage.py scope` decides `is_game_project` **Then** it reads the registry's evidence that the `gds` module is installed, not a `gds-` name prefix (`engage.py:797-799`), and the contract's CAP-15 rule follows (DW-90); the lib suite covers each with fakes; the contract (0.1.31, additive) names the rules; the entries close by this PR

AC4. **Given** a story the launch is about to run (`tk-studio-launch` for a `run-epic` job: the first story and every later one, a resume included) **When** the engine starts on it **Then** the launch calls `plansync.py status --directory <owner root> --id ST-NNN --status in-progress` once (the verb the review and done phases use), recorded as a `plan-status` event with `phase: in-progress`, `ok` and `previous_status`, so the story's issue reads In Progress from the build's start instead of Backlog; a refusal or a blocked re-sync is one event and never stops the launch; the review phase at PR open and the done phase at the merge follow as now, a block's `Blocked - Awaiting User` wins while it stands, and the plan-status suite covers the third phase with a fake; the contract names it (hole 104, DW-146)

AC5. **Given** a `run-epic` job whose declaration names its rhythm (one story per run, or a stories-per-run figure; the shipped `run-epic.json` and the project instances carry it as a field, not prose) **When** the launch starts the engine **Then** the launch arms the graceful stop itself from that figure (the `launch.py stop --graceful` the operator issued by hand after every Epic 35 launch), recorded as a `stop-armed` event with the figure and the engine id; a job with no rhythm declared runs to the epic's end and the launch check says so; a `run-epic` instance that declares one story per run never builds two stories in one run again; the launch suite covers the arming with a fake; the contract names the field and the event (hole 105, DW-147)

## Boundaries & Constraints

**Always:** Settled shapes 1-6 of `plans/36-6.md` stand, read with the consult ruling. Name `encoding=` on every new text-mode open (`AGENTS.md`). Multi-file bun runs pass `--timeout 30000`. A failed status call or a refused arming is recorded and never stops the launch, and a refusal is never retried. The contract extends 0.1.31 additively (no version bump), its 36.6 paragraph between 36.5's and `## 8. Conformance`.

**Block If:** the plan's Risks name a Block If that fires: `sbx exec` refused by policy on the box; `test_engine_pin.py`'s needle words would have to go. A site answer on `statusReference` is a follow-up DW, never a block.

**Never:** edit `sandbox_login.py`, `_bmad-output/specs/spec-epic-34/SPEC.md`, `epics.md`, the canonical plan, `stories.yaml`, `routing.toml` or `policy.toml`; run the live `plansync setup` (operator's); put an async call in `queue.ts` or add a value edge that creates a new import cycle; pin or start a sandbox from the launch check; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| M1 v3 payload | setup on a simplified workflow | every transition has `id`, uppercase `type`, `toStatusReference`, `links`; no `from`/`to`; new ids above the copied max; GLOBALs have empty `links` | a site refusal → the existing notes + owner steps |
| M2 setup rerun | workflow already updated (either shape) | reports found, writes nothing | none |
| M3 tracked policy, commands to add | real git repo, policy committed | `policy: "refused"`, row gap, bytes unchanged, porcelain clean | `check` blocked |
| M4 tracked policy, nothing to add | same repo | `unchanged`, no refusal | none |
| M5 tracked and ignored policy | tracked file matching an ignore pattern | refused (the `ls-files` leg) | as M3 |
| M6 ignored untracked policy | | written as today | none |
| M7 gate, marker present | fake running sandbox with marker | `sandbox <sb>: provisioned WITH_GODOT <ver>` | advisory, `ok` unchanged |
| M8 gate, older sandbox | no marker, `godot` executable | not warned | advisory |
| M9 gate, nothing | running, no marker, no godot | `warning: sandbox <sb> has no WITH_GODOT record; an engine.verify_commands gate there refuses` | advisory |
| M10 gate, unknowable | not running, sbx absent, daemon down | no Godot claim, no warning | advisory |
| M11 engine skill alone | `gds-engine-godot-4`, no `gds` in manifest (or no manifest) | not a game project; `scope` with docs → `NotAGameProject` | none |
| M12 engine skill + module | manifest lists `gds` | game project | `GameDocsMissing` as today without docs |
| M13 `gds` entry, no manifest | | not a game project | none |
| M14 first story in progress | launched `run-epic` run, story in Backlog | one `plan-status` `in-progress` with `ok`, `previous_status`, `story_key`, `id` | none |
| M15 later story | a new journal `story-start` in a running run | one more event for that story; a repeat pass records none | none |
| M16 resume | event already recorded for the story | no second call | none |
| M17 resume over Block Resolved | no event yet, issue canonical `blocked` | `status: "partial"` with `conflict`, one event, launch unaffected, not re-asked | never stops the launch |
| M18 refusal or blocked re-sync | `callStatus` answers refused/blocked | one event `ok: false`; launch continues; a Blocked issue stays Blocked | no retry |
| M19 transient | runner throws | no event; asked again next tick, bounded by `PLAN_RETRY_LIMIT` then one give-up event | never stops the launch |
| M20 figure 1 | `stop.after_stories: 1` | armed once on the launched path through `stopEngine` `{graceful: true}`; `stop-armed {figure, engine_run_id, ok, detail, tier}` | refusal: `ok: false`, recorded, not retried |
| M21 figure N>1 | `after_stories: 3` | not armed at launch; armed once when 2 stories have `story-done` | as M20 |
| M22 no rhythm | field absent | no arming, no `stop-armed`; `check` says the run goes to the epic's end | none |
| M23 resume, no stop in force | figure 1 | armed after `engine.pid` is rewritten, one `stop-armed` since that `engine-resume`; a stop in force stays `rearmStop`'s | pid not rewritten: no arming, one notifier line |
| M24 not run-epic | a sweep or other job | neither call | none |
| M25 job validation | `after_stories` 0, `true`, `"1"`; or `stop: {after_stories: 1}` alone | refused; the last by AD-10's "at least one" rule | named problem |

</intent-contract>

## Code Map

`plans/36-6.md` Code Map is the investigation; start there and confirm anchors with `Grep -n`. Additions and corrections from this session:

- `apps/supervisor/src/cli.ts:1671 mirror`, `:1717 markLaunched`, `:1724 holdEngine` -- the launched path; make the calls after `holdEngine`, before the return. `v.defn` is the resolved job.
- `apps/supervisor/src/cli.ts:720, :768, :1584` -- `afterCloseOuts` and its `finally` sites; the new pass sits beside `reviewPass` (:768). It does not run on a timer of its own.
- `apps/supervisor/src/closeout.ts:1188 gracefulStopInForce read`, `:1219-1223` -- the resume; `stop` is read before the resume, `found` says whether `engine.pid` was rewritten, then `rearmStop`, then `unblockTracked`. Both new calls go after `unblockTracked`. Grep the exact lines.
- `apps/supervisor/src/sweep.ts:532 stopEngine`, `:84 isSweep`; `queue.ts:84 LAUNCH_SKILL` -- the arming and the job filter. `closeout.ts` already imports `stopEngine`.
- `apps/supervisor/src/planstatus.ts:126 Phase`, `:289 callStatus` (passes `phase` as `--status`), `:187 planOwner`, `:261 planEntity`, `:333 record`, `:115 PLAN_RETRY_LIMIT`. `claimPlanPhase` (`queue.ts:2082`) refuses a phase with any record, so a per-run lease allows one story only: dedupe `in-progress` per `story_key` from the events, and do not route it through `leased` unchanged.
- `stageTodo` (`planstatus.ts:594`) and `queue.ts:68` filter on `done`, so an `in-progress` record owes no stage row. `board.ts:281, :295` read `plan-status` story keys with no phase filter; check that the board's story still reads right.
- `apps/supervisor/src/office.ts:161 readJournal`, `:445-475` -- the journal reader and its `story-start`/`story-done` kinds. The figure counts this run's `story-done`. Story key at launch: the journal's `story-start` when present; otherwise the pass picks it up on the next tick.
- `plugins/tk-studio/lib/job.py:73, :201-214 _validate_stop` -- `STOP_KEYS` comes from the schema's fields; validate `after_stories` here and leave it out of the "at least one" check. `:345-364 resolve_instance` overlays `stop` whole, so an instance with its own `stop` must carry the field: `run-epic-36.json` does; `.tk-studio/jobs/run-epic-24`..`35` stay as closed history.
- `plugins/tk-studio/lib/launch.py:1317 check` -- the rhythm row (advisory). Find the `run-epic` instance by `target.payload.epic` from the `spec-epic-<N>` folder through `joblib.load_instance`/`instances_dir`.
- **Serve process:** yes, this story changes it. `mirror`, `afterCloseOuts` and `resumePaused` run in serve, so the operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge. Confirm from `mirror`'s callers (`cli.ts:618, :1573, :2269, :2377`) and say so in the 36.6 contract paragraph if the trace differs.

## Tasks & Acceptance

**Execution:**
- Every file in `plans/36-6.md` Files -- per that plan's Code Map and Settled shape -- the plan's list is the boundary, plus the two accepted below.
- `plugins/tk-studio/lib/job.py`, `plugins/tk-studio/lib/tests/test_job.py` (or the file that pins `_validate_stop`) -- `stop.after_stories` integer > 0, excluded from AD-10's "at least one" -- accepted outside Files by the consult.
- `plugins/tk-studio/contracts/job.schema.json` -- the optional field, its note saying a rhythm alone is no stop condition; `run-epic.json` and `run-epic-36.json` carry `after_stories: 1` -- AC5.
- `apps/supervisor/src/planstatus.ts` -- the `in-progress` phase and a per-story function that never throws -- AC4.
- `apps/supervisor/src/cli.ts`, `closeout.ts` -- the launched-path and resume calls, and the one pass in `afterCloseOuts` over running launched `run-epic` runs, per the consult -- AC4, AC5.
- `apps/supervisor/test/planstatus.test.ts`, `test/queue.test.ts`, `test/command-line.test.ts` -- matrix rows M14-M24; a stale exact-sequence pin in `command-line.test.ts` is edited in place and reported as a deviation.
- `plugins/tk-studio/lib/tests/` -- rows M1-M13, M22 (check row) and M25; `test_0_1_31_story_36_6_setup_and_launch_by_evidence`.
- `driver-contract.md`, `deferred-work.md`, `kb/`, launch `SKILL.md` -- as the plan says, adding the `in-progress` phase, the `stop.after_stories` field, `stop-armed` and the serve-process note; also close DW-146 and DW-147 with DW-62, DW-71, DW-90 and DW-127 if they are open entries.

**Acceptance Criteria:**
- AC1 to AC5 above, each proven by a named test or command; AC1's live call is `unverifiable-here`, and the operator ask below stands in the Consult Log.

## Spec Change Log

## Review Triage Log

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 2, medium 4, low 2)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` the shipped `after_stories: 1` reached an engagement's minted `run-epic-N`, ending `full` after one story: `approve.ts` mints `stop: {on_status: ["blocked"]}` (consult)
  - `[high]` `[patch]` figure 1 had no backstop if the process died before arming: `launchedPass` arms an unarmed run after a grace period
  - `[medium]` `[patch]` figure N>1 counted per engine and was not re-armed after a consumed stop: `stories_done` on `close-out`, the once-only check scoped since the latest `engine-resume`
  - `[medium]` `[patch]` the marker was written after a failed Godot download: written only after `--version` succeeds
  - `[medium]` `[patch]` the engine-gate clause warned about other projects' sandboxes: only this project's `jobs` keys are probed
  - `[medium]` `[patch]` `rules` could be erased silently: `find_workflow` expands `transitions.rules`
  - `[low]` `[patch]` the runbook still told the operator to arm by hand: holes 104 and 105 read fixed, the checklist and launch duties named
  - `[low]` `[patch]` the third-phase test did not assert its "no stage row" claim: it runs `stagePass`, with a `done` control

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 4, low 4)
- defer: 0
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` a refused arming told nobody: `armStop` sends one notifier line, its outcome on the event's `notify`, never retried
  - `[medium]` `[patch]` the launched path armed with no engine pid, and a stop sent then can be refused or deleted: `launchDuties` holds off on an unknown pid and the backstop arms after the grace; the backstop is now per engine (consult)
  - `[medium]` `[patch]` copied transition `properties` were lost: `find_workflow` expands `transitions.properties`, and a test pins them reaching the POST
  - `[medium]` `[patch]` a failed provision left an executable shim that read as an older sandbox with Godot, and the marker comment was false: marker and shim are removed first, and the shim and export are written only after `--version` answers
  - `[low]` `[patch]` `_dropped_config` named transitions whose `rules` held only empty containers: it counts a value only if one is non-empty at some depth
  - `[low]` `[patch]` the `run rhythm` row was wrong for an engagement-minted instance: it adds that autonomy can stop the run at a story boundary
  - `[low]` `[patch]` AC4/AC5 wiring was not asserted: tests added for `afterCloseOuts` → `launchedPass` and `resumeRun`; `pausedDeps.startedStories` (`cli.ts`, about :2294) stays unasserted
  - `[low]` `[patch]` the gate clause's host and both branches were not asserted: tests added

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 2, low 3)
- defer: 3: (high 0, medium 2, low 1)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[high]` `[patch]` a stop armed before the engine's first `_check_graceful_stop` ended the run with no story built, and a relaunched engine at N-1 stopped a story short: arming now waits for this engine's `story-start`, the grace backstop narrowed to an unreadable journal (consult)
  - `[medium]` `[patch]` a refused arming's notifier command could not run: `gracefulStopCommand` gives the run's tier and `--directory`
  - `[medium]` `[patch]` an earlier engine's refused `stop-armed` or `graceful-stop` left a relaunched figure N>1 engine unarmed: another engine's `ok: false` no longer counts (consult)
  - `[low]` `[patch]` the runbook and contract said without qualification that a minted instance declares no rhythm: qualified for files minted before this change, with the operator's check
  - `[low]` `[patch]` the auto-resume's in-progress call and figure 1 arming had no wiring test: added in `autoresume.test.ts`
  - `[low]` `[patch]` the docstring and contract claimed `screen` and `rules` have no v3 spelling, unverified: reworded to "not mapped by this code"
- rejected, one line each: a `pgrep`-sourced pid cannot have its stop deleted on a fresh launch, since bmad-loop clears `stop-request.json` before `write_pid` only on resume (`cli.py:1399`); an armed N>1 stop lost before a relaunch is not reachable, since a stop in force ends at the boundary; the undercount after a failed relaunch and the missing lease on arming were accepted earlier and stay residuals; DW-127's closure stands because AC3 says the entries close by this PR, and this dispatch leaves the ledger alone.
- the relaunched-engine edge case was merged into the high finding, as it had the same claim and fix.

## Design Notes

Consult ruling (Consult Log) is binding on the per-story trigger. A late tick can overshoot a figure above 1, and figure 1 now arms on the first `story-start` the launched path or a tick sees, per the ruling of 2026-10-31T19:20:00Z. `stop-armed` is the once-only check: per engine id on a launch and in the pass, and since the latest `engine-resume` on a resume, so an arming consumed before a pause does not block the resume's own.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- `cd apps/supervisor && env -u TK_SUPERVISOR_NOTIFY -u TK_SUPERVISOR_TELEGRAM_TOKEN -u TK_SUPERVISOR_TELEGRAM_CHAT -u TK_SUPERVISOR_NTFY_URL bun test --timeout 30000` -- expected: green
- `cd apps/supervisor && TK_STUDIO_ROOT=<project root> bun test --timeout 30000 test/command-line.test.ts` with `TK_ATLASSIAN_*` unset -- expected: green

## Deviation Summary

### pass 1 (implementer, 2026-10-31)

- planned: Files list is the boundary / actual: edited `contracts/conformance/e2e_run_sweep.py`, `e2e_vertical_slice.py` and the 34.8 slice pin in `test_driver_contract.py` to compare `stop` without `after_stories` / why: adding the field only to run-epic broke those three pins, and adding it to sweep or slice would contradict M24 / may affect: none
- planned: Files list / actual: also edited `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` / why: it restates the game-project rule / may affect: none
- planned: `closeout.ts` makes the in-progress call after `unblockTracked` / actual: an injected `startedStories` seam on `ResumeDeps` and `PausedDeps`, wired in `cli.ts` / why: a value import of `planstatus` in `closeout` adds a new cycle / may affect: 36-7
- planned: the pass reads `office.readJournal` / actual: `launchedPass` and `startedStories` take the reader as a parameter; `cli.ts` passes it; `runDirOf` exported from `closeout.ts` / why: `planstatus` importing `office` adds a cycle / may affect: 36-7
- planned: `sbx exec <sb> cat ~/.tk-studio/provisioned`, `test -x ~/.local/bin/godot` / actual: through `sh -c` with `$HOME`; only `test -x` exit 1 warns / why: a bare exec has no shell to expand `~`; other exits must not claim Godot is missing / may affect: none
- planned: copied transitions keep everything except `from`/`to` / actual: only `id`, `name`, `description`, `properties`, `type`, `toStatusReference`, `links` are sent; legacy `screen` and `rules` dropped / why: no v3 spelling here and the stricter fake rejects unknown keys; a copied transition's screen or rules would be lost on the site / may affect: copied screens and rules on the owner's site
- planned: job filter from `isSweep` and `LAUNCH_SKILL` / actual: `isRunEpic` in `closeout.ts`, `type` or `id` is `run-epic`; `run-vertical-slice` gets neither duty / why: M24 / may affect: game-project `run-vertical-slice` runs get no In Progress and no rhythm
- planned: per-run lease through `leased` / actual: `leased` gains an optional lease name; `plan-lease` events carry `phase: "in-progress:<story_key>"` / why: a per-run lease allows one story only / may affect: none
- planned: M14-M24 in `planstatus.test.ts`, `queue.test.ts`, `command-line.test.ts` / actual: all in `planstatus.test.ts`, M22's check row in `test_launch.py` / why: one fixture covers the paths with a fake `uv` / may affect: none

DRIFT: conformance drives and the 34.8 slice pin compare `stop` without `after_stories` — the field lands only on run-epic — affects: none
DRIFT: `tk-studio-engage/SKILL.md` edited, outside Files — it restates the rule — affects: none
DRIFT: `startedStories` injected into `ResumeDeps` and `PausedDeps` — a `planstatus` import in `closeout` adds a cycle — affects: 36-7
DRIFT: the journal reader is a parameter, `runDirOf` exported — `planstatus` importing `office` adds a cycle — affects: 36-7
DRIFT: the marker probe runs through `sh -c` — a bare exec does not expand `~` — affects: none
DRIFT: copied transitions drop legacy `screen` and `rules` — not carried as legacy keys, the drop is surfaced and the live call compares — affects: copied screens and rules on the owner's site
DRIFT: `isRunEpic` filter — M24 — affects: game-project `run-vertical-slice` runs get no In Progress and no rhythm (a DW records the gap)
DRIFT: `plan-lease` phase `in-progress:<story_key>` — a per-run lease allows one story — affects: none
DRIFT: M14-M24 tests all in `planstatus.test.ts` — one fixture covers the paths — affects: none

### pass 2 (implementer, consult patch, 2026-10-31)

DEVIATIONS: none by the implementer's report. The session records that `plugins/tk-studio/lib/plansync.py` changed, as the ruling's "setup prints them" requires, though the plan said the caller needs no change.

DRIFT: `plansync.py setup` gains one note naming copied transitions whose `screen` or `rules` were dropped — the consult's ruling — affects: none
DRIFT: `find_workflow`'s expand is unchanged, so `rules` may never be read and the note may stay silent for them on a live site — the ruling named no expand change; the operator's before/after comparison is the backstop — affects: copied screens and rules on the owner's site

### pass 3 (implementer, review patches, 2026-10-31)

- planned: a run with a rhythm and no `stop-armed` is armed by the pass / actual: figure 1's backstop waits `LAUNCH_ARM_GRACE_MS` (5 min, an implementation constant for crash recovery, not a design figure) after `launched`, never fires once a resume of this engine is recorded (superseded per the consult of 2026-10-31T18:53:07Z); `PlanStatusDeps` gains `now` / why: `markLaunched` precedes `holdEngine`, and a refusal is never retried / may affect: none
- planned: count earlier engines' stories from recorded events / actual: `closeOutLanded` adds an additive `stories_done` to `close-out`, read before the archive, named in the 36.6 paragraph / why: a `close-out` names only the landed story / may affect: none
- planned: scope the once-only check since the latest `engine-resume` / actual: the N>1 arming also waits for the resume's `engine-pid`; an unrewritten pid sends one notifier line for any figure / why: bmad-loop can delete a stop sent before that write / may affect: none
- planned: contract edit limited to the minted-instance sentence / actual: the 36.6 rhythm sentences rewritten for the backstop, count and scope / why: the patches made the old text false / may affect: none
- planned: resolve the project id as `launch.py` already does / actual: added `_supervisor_project_id`, importing `config`, mapping a worktree to its main checkout's basename / why: `launch.py` had no resolver, and a worktree basename never matches a `<project id>/<job id>` key / may affect: none

DRIFT: figure 1's backstop waits `LAUNCH_ARM_GRACE_MS` and yields to a resume of this engine; a relaunched engine owes its own arming, after the grace, including a crash during a relaunch's launched path — an early stop could be refused and a refusal is never retried — affects: none
DRIFT: `close-out` gains additive `stories_done` — N>1 counts across engine relaunches — affects: none
DRIFT: N>1 arming on a resume waits for `engine-pid`, one notifier line on an unrewritten pid — a stop sent earlier can be deleted — affects: none
DRIFT: the 36.6 rhythm sentences rewritten — the patches made the old text false — affects: none
DRIFT: `launch.py` gains `_supervisor_project_id` — it had no resolver — affects: none

### pass 4 (implementer, follow-up review patches, 2026-10-31)

- planned: `launchDuties` holds off on an unknown pid and the backstop picks the run up / actual: `backstopOwed` also became per engine, on that engine's `stop-armed` or resume / why: an earlier engine's `stop-armed` would otherwise leave a relaunched engine with an unknown pid unarmed / may affect: 36-7
- planned: `_holds_value` for dropped configuration / actual: the fixture `rules: {"validators": [{}]}` became `[{"type": "x"}]` / why: the old value is empty under the new rule / may affect: none
- planned: the contract's 36.6 paragraph gains the refusal line / actual: its "truthy", rhythm-row and rhythm sentences are also corrected, and "in the pass" narrowed to "in figure N > 1's pass" / why: the patches made the old text false; the last is the consult's / may affect: none
- planned: wiring tests for every AC4/AC5 call site / actual: `pausedDeps.startedStories` has none / why: it needs a stale-render auto-resume fixture local to `autoresume.test.ts` / may affect: none

DRIFT: `backstopOwed` is per engine, reversing the residual accepted at 2026-10-31T18:28:26Z — the launched path's hold-off makes it a relaunched engine's only route to arming — affects: 36-7
DRIFT: `stop-armed` gains an additive `notify` on a refusal, and `armStop` sends one line — a refusal is otherwise silent and never retried — affects: none

### pass 5 (implementer, second follow-up review patches, 2026-10-31)

- planned: M20 "armed once on the launched path" / actual: the launched path arms only with a `story-start` in this engine's journal, otherwise the pass arms on the first tick that shows one; the grace backstop applies only to a journal read with `problem` / why: the consult of 2026-10-31T19:20:00Z / may affect: 36-7
- planned: only the M20 test edited / actual: about 20 other `planstatus.test.ts` tests gained a `story-start` line, plus the `journalAt` helper and an interim assertion in M21 / why: their old journals no longer arm under the ruling / may affect: none
- planned: no such guard / actual: an in-process `arming` set in `armStop` / why: without the grace the pass and the launched path can overlap / may affect: two processes can still record two `stop-armed` events, a repeat request on the same control file
- planned: `armRefusedLine(runId, …)` / actual: `(run, engineRunId, detail, env)` and an exported `gracefulStopCommand` / why: the command must run on the run's tier / may affect: none

DRIFT: M20 and M21 arm on this engine's `story-start`, not at launch or on the count alone — the engine honours a stop before its first story, so an earlier arming can build nothing — affects: 36-7
DRIFT: about 20 `planstatus.test.ts` fixtures gained a `story-start` line — the ruling changes what arms — affects: none
DRIFT: `armStop` holds an in-process `arming` set; two processes can still record two `stop-armed` — the grace no longer separates the pass from the launched path — affects: none
DRIFT: `armRefusedLine` takes the run and env, `gracefulStopCommand` exported — the old command could not run — affects: none

## Consult Log

- 2026-10-31T17:12:34Z — trigger: file-outside-files — question: AC4's "every later one" and AC5's figure N>1 have no launch moment in the plan, and `job.py` validation is outside Files; which build? — ruling: accept-deviation score 2 — do: option 2: arm figure 1 at launch and on a resume with no stop in force; one pass beside `reviewPass` in `afterCloseOuts` over running launched `run-epic` runs reads the journal, calls in-progress once per new `story-start`, and for N>1 arms through `stopEngine` `{graceful: true}` once N-1 stories have `story-done`, never retrying a refusal; one `stop-armed` per arming with figure and engine id, the once-only check, none when the field is absent; edit `job.py` and its test so `stop.after_stories` is an integer > 0, bool refused, excluded from AD-10's "at least one", and say so in the schema note — rule candidate: when a plan names a launch-moment call for an AC that says "every later" or carries a per-run figure, the planner states the per-story trigger and any validator file in Files, and any non-terminating field under `stop` is excluded from AD-10's "at least one" check.
- 2026-10-31 — operator ask (AC1, tier ask, unverifiable-here): before the POST, save `GET /workflow/search?queryString=<KEY>&expand=statuses,transitions,transitions.rules,transitions.properties`; run `uv run plugins/tk-studio/lib/plansync.py setup --directory <root>` against the owner's site; paste the `POST /workflows/update` status and body, and `GET /workflows/search?expand=statuses,transitions` for the project; re-read and compare against the saved read, and record the answer here. Any lost configuration or a v3 spelling for it becomes a follow-up DW, not a block (amended by the consult of 2026-10-31T17:47:31Z).
- 2026-10-31T17:47:31Z — trigger: deviation-gt-0 — question: accept the implementer's pass 1 deviations, chiefly the dropped `screen`/`rules` and the loosened conformance compares? — ruling: accept-deviation score 2 — do: leave the conformance and pin edits, do not carry legacy `screen`/`rules`; correct both `may affect` lines and open a DW for the slice gap; `update_workflow` returns the names of copied transitions with a truthy `screen` or `rules` in its second value on success, `setup` prints them, a fake-backed test pins this, the contract's 36.6 paragraph states the drop; amend the operator ask to save the read before the POST and compare after — rule candidate: when a plan rewrites a payload to a remote API by whitelist, it names every source key not carried and says how a site-side loss is surfaced, and the operator ask captures the read before the write.
- 2026-10-31T18:01:53Z — trigger: high-severity-finding — question: the shipped `after_stories: 1` reaches an engagement's minted `run-epic-N`, cutting `full` autonomy to one story; which fix? — ruling: accept-deviation score 2 — do: `approve.ts` mints `stop: {on_status: ["blocked"]}` with no `after_stories` for `run-epic`, the `run-vertical-slice` mint keeps no `stop`; extend the approve test pin and the contract's rhythm paragraph (an engagement's minted instance declares no rhythm, its autonomy sets it); flag as open that `run-epic-N` files minted before this change inherit `after_stories: 1` and are kept on resume, and the operator checks served projects for unfinished engagements before restarting the supervisor — rule candidate: when a story changes a shipped job type's default, the plan greps every minter of that type's instances and states in Files whether each inherits the new default.
- 2026-10-31T18:28:26Z — trigger: deviation-gt-0 — question: accept the review-patch pass's five deviations and two residuals? — ruling: accept-deviation score 2 — do: keep all five and both residuals, no further edit; record `LAUNCH_ARM_GRACE_MS` as an implementation constant and that a crash during a relaunch's launched path is not backstopped — rule candidate: when a plan adds a duty after a synchronous record on a launched path, it states the crash-window recovery and whether its timing constant is design or implementation, and any event field a later pass reads is named in the story's contract paragraph.
- 2026-10-31T18:53:07Z — trigger: deviation-gt-0 — question: accept the per-engine `backstopOwed`, which reverses the residual accepted at 2026-10-31T18:28:26Z? — ruling: accept-deviation score 2 — do: keep the per-engine `backstopOwed` and the `launchDuties` hold-off, no code edit for `engine-resume` since it carries `engine_run_id`; correct the spec's two stale statements and log this ruling as superseding the "not backstopped" residual; in the contract's 36.6 paragraph narrow "in the pass" to "in figure N > 1's pass" — rule candidate: when a patch adds a hold-off that defers a duty to a backstop, the plan re-checks that the backstop's settle condition can still fire for every path deferred to it, including relaunches, and names any accepted residual this reverses.
- 2026-10-31T19:20:00Z — trigger: high-severity-finding — question: the engine honours a stop before its first `story-start`, so does "the launch arms" allow a zero-story run (M20 literally), or do the launch's duties finish in the next pass? — ruling: apply — do: Reading A: `launchDuties` arms figure 1 only if this engine's journal shows a `story-start`, otherwise the launched pass arms it on the first tick that shows one with no grace wait, and figure N>1 also needs a `story-start` in this engine's journal with no `story-done`; all other gates stay and `stop-armed` keeps its fields and stays once-only; narrow the grace backstop to a journal read that returns `problem` (widen `JournalReader`), so a readable journal with no `story-start` or a missing file never arms; edit the M20 test at `planstatus.test.ts:1102` and the contract's 36.6 rhythm sentences, add tests for a first tick arming on `story-start`, a past-grace readable journal not arming, and a relaunched engine at N-1 not arming until its own `story-start`, and record the M20/M21 reading as a DRIFT line — rule candidate: a spec that arms an engine control file must name the engine event proving the control lands at the intended boundary, and the arming must wait for that event rather than for the launch returning.
- 2026-10-31T19:40:00Z — trigger: deviation-gt-0 — question: accept the patch pass's five score-1 deviations (order-aware `storyInFlight`, test fixture edits, the in-process `arming` set, `armRefusedLine`'s signature, the `stop-armed`-only refused exception)? — ruling: items 2, 3, 4 accept-deviation score 1; item 1 accept-deviation score 1 for order-aware counting and `story-escalated`, reject-deviation for `story-deferred` and `story-skipped`; item 5 reject-deviation; overall score 1 — do: in `storyInFlight` make `story-deferred` and `story-skipped` close the key as `story-done` does and leave `story-escalated` open, say so in the contract's 36.6 "no `story-done`" sentence, add tests (figure 3 with K1 deferred, and with K1 skipped, and K2, K3 done does not arm until K4's `story-start`; an escalated key still counts as in flight); in `stopArmedSinceResume` apply the `ok !== false || engine_run_id === engineRunId` test to `graceful-stop` too, add a test that an earlier engine's refused re-arm followed by a relaunch arms the new engine once, correct the doc comment and the contract's parenthesis; log items 2, 3, 4 as DRIFT with the two-process `stop-armed` residual, file a DW that `rearmFailedLine` still prints the old command with no `--directory`, change nothing else including figure 1's gate — rule candidate: when a spec reads engine journal state, the planner lists every engine event that ends the state (story in flight: `story-done`, `story-deferred`, `story-skipped`; not `story-escalated`, which pauses), and an exception added for one refused-event kind is applied to its sibling kinds or the difference is justified in the plan.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:44Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-31T15:30:45Z | 2026-10-31T15:31:04Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-31T17:08:11Z | 2026-10-31T18:28:38Z | e7b18cc3-56f9-4bd4-8986-928c0c1b31aa | claude-opus-5-5 | medium | 15924078 | 265846 | 18.0034 | completed |
| review | 1 | 2026-10-31T18:28:38Z | 2026-10-31T19:02:38Z | 90f40fcc-7226-4768-b1d9-f8b067a5f399 | claude-opus-5-5 | medium | 6161386 | 120823 | 8.8783 | completed |
| review | 2 | 2026-10-31T19:02:38Z | 2026-10-31T19:49:58Z | 690e2239-9bbb-4ec7-a454-5e3baea71e12 | claude-opus-5-5 | medium | 8167975 | 158765 | 10.5045 | completed |
| gate | 1 | 2026-10-31T19:49:59Z | 2026-10-31T19:54:16Z | 7002149b-5a2a-45e3-b604-acbcc0d70a1b | claude-opus-5-5 | medium | 1230336 | 19479 | 1.5744 | completed |
| host-leg | 1 | 2026-10-31T19:54:25Z | 2026-10-31T20:46:04Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-10-31T20:46:04Z | 2026-10-31T20:46:12Z | — | — | — | — | — | — | PR |
| merge | — | 2026-10-31T20:46:42Z | 2026-10-31T20:46:42Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory <root>` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** A second follow-up review of the committed story (dispatched on a `done` spec). `plansync setup` posts v3 transitions with ids and no `from`/`to`, and names any dropped `screen` or `rules`. `launch.py check` refuses to write a tracked policy and reads the sandbox's `WITH_GODOT` marker for this project's sandboxes. `is_game_project` requires `gds` in the installed manifest. The supervisor marks each `run-epic` story In Progress and arms the graceful stop from `stop.after_stories`, recording `stop-armed`. This pass fixed a run that could end with no story built: arming now waits for this engine's `story-start`.

**Files changed in this pass.**
- `apps/supervisor/src/planstatus.ts`, `cli.ts` -- arming waits for `story-start`, the narrowed backstop, `storyInFlight`
- `apps/supervisor/src/closeout.ts` -- `gracefulStopCommand`, the runnable refusal line, per-engine refusals, the `arming` set
- `apps/supervisor/test/planstatus.test.ts`, `autoresume.test.ts` -- the new arming, refusal and auto-resume wiring tests
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- the 36.6 paragraph kept true, new pinned phrases
- `plugins/tk-studio/lib/jirabackend.py` -- docstring only: `screen` and `rules` are not mapped by this code
- `kb/agent-pc-setup-runbook.md`, `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- the pre-minted instance check, the refusal line's exception
- `deferred-work.md` not touched, as the dispatch required. This pass's three deferrals are in this spec's frontmatter for the orchestrator.

**Review.** Both layers ran. Patches 6 (high 1, medium 2, low 3), deferred 3, rejected 5. Follow-up review: true (a patched high; score 3×2 + 3 = 9).

**Verification (session's own rerun, after the last patch).** Lib suite 2794 OK, 4 skipped. Conformance `ok: true`, 23 surfaces, 166 checks. `test_release_roster` 86 OK. `bun test --timeout 30000`: 1885 pass, 95 skip, 0 fail. `command-line.test.ts` with `TK_STUDIO_ROOT`: 109 pass, 0 fail. `bunx tsc --noEmit`: exit 0 (`bun run typecheck` cannot find `tsc` here). Both bun runs had every `TK_ATLASSIAN_*` unset: with them set, the implementer's run had 4 failures in `guards.test.ts` and `tier.test.ts`, because the argv picks up `-e TK_ATLASSIAN_*` from the shell.

**Criteria.** AC2 to AC5 proven by tests. AC1's code is proven by a fake only; its live call is `unverifiable-here`, and the operator ask stands in the Consult Log. The operator runs: `uv run plugins/tk-studio/lib/plansync.py setup --directory <root>`.

**Residual risks.**
- Credential exposure: an implementer's diagnostic in this pass printed the start of `TK_ATLASSIAN_AGENT_TOKEN` and `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, with the agent email and site, into that subagent's tool output. Neither token's first 40 characters appear in the story's diff. Rotate both if session logs are retained.
- Operator, before restarting the supervisor: this story changes the serve process. Stop the supervisor tab before the build and restart through the scheduled task after the merge. First check served projects for unfinished engagements: a `run-epic-N` minted before this change has no `stop`, is kept on resume, and inherits `after_stories: 1`.
- `plansync setup` can erase copied `screen` and `rules` on a live site (deferred). Save the read before the POST, as the operator ask says. `statusReference` as a status id and the copied `properties` also stay unproven until the live call. DW-127 is closed while that answer is still owed: only the Consult Log tracks it.
- A figure 1 run whose arming was refused can still relaunch and build a second story (deferred). Its notifier line says so.
- A figure 1 story deferred before the first tick can still arm between stories, and a figure 1 resume with nothing in flight stops before building one. The rulings left both as they are.
- `launchedPass` now owes figure 1's arming to the next tick when the launched path sees no `story-start`, so with the supervisor down in that window the engine runs unarmed.
- Rejected, and still true: `launch.py check` run inside the engine sandbox names no Godot state and warns nothing (matrix M10). The check must run on the host to get the warning.
- Two supervisor processes can record two `stop-armed` for one engine, and a second refusal would send a false "not armed" line.
- A relaunch that fails after the archive can undercount `stories_done`, overshooting a figure above 1 (accepted at 2026-10-31T18:28:26Z).
- A failed re-provision leaves an earlier `export GODOT=` in `~/.profile`, and the `grep -q` guard means a new version never updates it. The launch check reads the marker and the shim, not the profile.
- The review subagents read the diff from a file (385 KB, too large to inline), and the corrections went to fresh implementer launches.

DRIFT: M20 and M21 arm on this engine's `story-start`, not at launch or on the count alone — the engine honours a stop before its first story, so an earlier arming can build nothing — affects: 36-7
DRIFT: about 20 `planstatus.test.ts` fixtures gained a `story-start` line — the ruling changes what arms — affects: none
DRIFT: `armStop` holds an in-process `arming` set; two processes can still record two `stop-armed` — the grace no longer separates the pass from the launched path — affects: none
DRIFT: `armRefusedLine` takes the run and env, `gracefulStopCommand` exported — the old command could not run — affects: none
DRIFT: `backstopOwed` is per engine, reversing the residual accepted at 2026-10-31T18:28:26Z — the launched path's hold-off makes it a relaunched engine's only route to arming — affects: 36-7
DRIFT: `stop-armed` gains an additive `notify` on a refusal, and `armStop` sends one line — a refusal is otherwise silent and never retried — affects: none
DRIFT: conformance drives and the 34.8 slice pin compare `stop` without `after_stories` — the field lands only on run-epic — affects: none
DRIFT: `tk-studio-engage/SKILL.md` edited, outside Files — it restates the rule — affects: none
DRIFT: `startedStories` injected into `ResumeDeps` and `PausedDeps` — a `planstatus` import in `closeout` adds a cycle — affects: 36-7
DRIFT: the journal reader is a parameter, `runDirOf` exported — `planstatus` importing `office` adds a cycle — affects: 36-7
DRIFT: the marker probe runs through `sh -c` — a bare exec does not expand `~` — affects: none
DRIFT: copied transitions drop legacy `screen` and `rules` — not carried as legacy keys, the drop is surfaced and the live call compares — affects: copied screens and rules on the owner's site
DRIFT: `isRunEpic` filter — M24 — affects: game-project `run-vertical-slice` runs get no In Progress and no rhythm (DW-159)
DRIFT: `plan-lease` phase `in-progress:<story_key>` — a per-run lease allows one story — affects: none
DRIFT: M14-M24 tests all in `planstatus.test.ts` — one fixture covers the paths — affects: none
DRIFT: `plansync.py setup` gains one note naming dropped configuration, outside Files — the consult's ruling — affects: none
DRIFT: `approve.ts` and its test changed, outside Files — the consult's ruling on engagement autonomy — affects: none
DRIFT: figure 1's backstop now applies only to an unreadable journal; a relaunched engine owes its own arming — an early stop could be refused or build nothing, and a refusal is never retried — affects: none
DRIFT: `close-out` gains additive `stories_done` — N>1 counts across engine relaunches — affects: none
DRIFT: N>1 arming on a resume waits for `engine-pid`, one notifier line on an unrewritten pid — a stop sent earlier can be deleted — affects: none
DRIFT: the 36.6 rhythm sentences rewritten — the patches made the old text false — affects: none
DRIFT: `launch.py` gains `_supervisor_project_id` — it had no resolver — affects: none

## Reconcile

### 2026-10-31 — adjust-stories

- Score: 2
- Reasoning: The contract, job schema and event changes are additive, and `after_stories` stays out of AD-10's stop conditions. AC5's arming on `story-start` rather than at launch is this story's own reading, ruled by the consult of 2026-10-31T19:20:00Z, and no later criterion relies on it. Only 36-7, the last story, reads what changed: it plans cuts through these modules. No 36-7 criterion changes; its plan's map of the `planstatus → closeout` edge and some anchors are stale, and notes absorb that. The value-import SCCs re-derived at HEAD match the baseline's; `cli → office` is the only new edge among the modules checked.
- Affected: 36-7-the-cycles-cut-and-the-docs-caught-up — "`planstatus → closeout` is `frontmatter, jiraBound` :98, kept"
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 36-7-the-cycles-cut-and-the-docs-caught-up
