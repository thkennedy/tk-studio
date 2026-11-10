---
title: "The Run's Timeline and the Progress in View"
type: 'feature'
created: '2026-11-10'
status: done
# Operator ruling 2026-11-10 (agent seat, the run paused): option (ii) — the open host-verify leg travels on the office snapshot and deltas as `leg` (plan Settled shape 11); no fetch timer; see the Consult Log's last line
baseline_revision: 702d340a4ec06a1050de395e9f652ac36b91f0fe
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
context:
  - '{project-root}/_bmad-output/specs/spec-epic-39/plans/39-5.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized, multiple-goals]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The owner cannot tell at a glance whether a run is healthy and how long it has left (addendum §3.2 F-A): the web has no run page, the Status screen lists live run ids with no job, story, clock or Cancel, and the office HUD shows `done / total` with no stage, clock or phased bar. Canonical: ST-178.

**Approach:** Transcribed from `epics.md` "### Story 39.5" (authoritative; never re-derived):

AC1. **Given** `GET /runs/{id}` (`api.ts:1249-1262`: the run row, its events, `cost_usd`) and the host-leg measures of Story 38.1 (`guard: host_verify_seconds`, the suite durations on the `host-verify` event) **When** Story 39.5 lands **Then** a run page at `/app/run/<id>` (`apps/studio-web/src/run/*`, new) draws the timeline from the run's events: `claimed`, `launched`, each engine session (`session-start/end` by role from the journal, carried on the snapshot's `sessions[]` once 39.6 lands and from the events until then), each review pass, the host leg with its per-suite durations when the event carries them, the close-out; the clock shows elapsed against the run's guard (`worker.guard_s`, and the leg's own guard during the leg) with the label "01:12:40 of 02:00:00"; the cost per stage comes from the Stage Log rows (`GET /stories/{id}`) when the story is known, else the run total; the events list sits below with `detail` folded; Cancel calls `POST /runs/{id}/cancel` and names its consequence first; a run that ended shows its final state and reason in words.

AC2. **Given** the Status screen (`apps/studio-web/src/status/*`) and the office snapshot **When** opened after this story **Then** it lists the queue (queued, claimed, running, paused runs with their job, story, start and clock) above the counts, each a link to its run page, with Cancel and, for a paused run, the reason in words and the inbox item that resolves it; the office HUD shows the current stage ("review pass 2 of 2") from `office.progress`, which gains the `stage` field (`office.ts`, the contract 0.1.35, additive), and its progress reads as a phased bar — the epic as the project bar, its stories as phases, the open review findings as a count to drain (the 2026-09-01 office grammar, addendum §3.4) — fed from `office.progress` and the board; every HUD value is held at least 1 s before it may change and the clock and the bars lerp between values (`src/office/model.test.ts` pins the hold); `src/status/model.test.ts` and `office.test.ts` pin the new fields.

The shape of every rule above is SETTLED in `plans/39-5.md` "## Settled shape" items 1–11 (item 11, `leg`, by the operator ruling of 2026-11-10) and its "## Refresh — 39-4 gate" (they mirror SPEC.md design notes CAP-16/CAP-17). Implement them as written there.

## Boundaries & Constraints

**Always:**
- Files boundary = `plans/39-5.md` "## Files" (19 files, 3 new). Anything else is a deviation the implementer reports.
- Every pending value reads in words (`Loading the run…`, `Loading the clock…`, `Loading the Stage Log…`, `Loading the findings…`, `no story yet`), never a bare `—` (owner rule 2026-11-05).
- Pure model functions (`runTimeline`, `runClock`, `costView`, `eventRows`, `canCancel`, `queueRows`, `phasedBar`, `hold`, `tween`, `valueAt`) take an injected `now`; no fetch timer anywhere (reads are triggered by store changes; a 1 s tick / rAF drives clocks and tweens only).
- Operator ruling 2026-11-10 (plan Settled shape 11): the open host-verify leg reaches the store as `leg` (`null`, or `{since}` = the open lease's `at`) on the snapshot's `runs[]` and on every `office.progress`; every re-read of `GET /runs/{id}` (the run page, the Status screen, the office HUD) is keyed on the row's `state`, `stage` and `leg`. "No fetch timer anywhere" stands.
- Contract change is additive inside 0.1.35 (no version pin flips); the 39.4 contract test re-bounds its clause/note at 39.5's (planned, local).
- AGENTS.md Windows rules: every `bun test` names `--timeout 30000`; no new text-mode open, `path.join` before a POSIX tail, or subprocess.
- `office.ts` runs in `serve`: the operator stops the supervisor before `apps/supervisor` is built and restarts it after the merge (recorded in the README/contract paragraph).

**Block If:**
- A supervisor test other than `office.test.ts`'s stream test pins the frame sequence/`OfficeRun` exactly and widening it would change an existing field's meaning (consult `deviation-gt-0`). Widening to the new field alone is local (score 1).
- The Files list must grow beyond the plan's list for a reason other than the 39.1/39.4 substitutions the plan's Refresh already names (consult `file-outside-files`).

**Never:**
- No supervisor route change; `api.ts`, `stories.ts`, `board.ts`, `board/*` in the web untouched (moving the kanban card to `stage` is out of scope).
- No `sessions[]`, `office.session` or any 39.6+ field; no movement toggle (39.8).
- No edits to `epics.md`, plan files (the one exception is not the implementer's: the operator wrote Settled shape 11 and its contract text into `plans/39-5.md` on 2026-11-10, while the run was paused; that edit rides this story's commit as it is), `stories.yaml`, `routing.toml`, `policy.toml`, or anything under `supervision/`. No push/tag/PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Worker guard clock | running, `worker` event `guard_s: 7200`, now = worker.at + 4360 s | `01:12:40 of 02:00:00`, guard `worker` | — |
| Leg guard clock | open `host-verify-leg` lease `guard_s: 7200` | counts from lease `at`, guard `host leg` | lease without `guard_s` → `legGuard(definition)`, else 600 |
| Over the guard | elapsed > guard | label ends `(over the guard)`, `over: true` | — |
| Unguarded | queued / claimed-no-worker / paused / close-out / ended | words: `queued (no guard until a worker starts)`, `since the claim (…)`, `paused`, `in close-out`, `in all, claim to end` | — |
| Review stage | `policy_snapshot.limits.max_review_cycles: 2`, open `<story>-review-2` session | `stage: "review pass 2 of 2"` | limits absent → defaults 2/3; `<m>` never below `<n>` |
| Stage-only change | stage changes, epic/stories unchanged | one epic-only `office.progress` `{run_id, epic, stage}` | — |
| Leg-only change | a `host-verify-leg` lease with an owner lands while the stage already reads `host verify leg` | one epic-only `office.progress` `{run_id, epic, stage, leg: {since: <the lease's at>}}`, stage unchanged; the web re-reads `GET /runs/{id}` and the clock reads `… of <the leg's guard>`, guard `host leg` | the leg's `host-verify`, or a release (`owner: null`) → one delta with `leg: null` and one more re-read |
| Cost source | story known, Stage Log rows in claim→end window | `Cost by stage, from the Stage Log of ST-NNN` | no costed rows / unknown story / 404 → run total with named label; `cost_usd` null → `Not metered yet` |
| Cancel | 200 / 409 RunTerminal / 409 ExternalRun / 403 CsrfRefused / 404 | `Cancelled.` + re-read / `Already ended: <state>` / external words / `reload the page` / not found | other → `<url> answered <status> <error>` |
| HUD hold | A→B→A within 1 s | B never shown | first value shows at once |
| Paused queue row | agent `current_run` = run with reason + `blocked_issue` | `Paused: <reason>`, inbox link `/app/inbox/<KEY>` | no reason → `Paused: no reason recorded` |

</intent-contract>

## Code Map

The investigation is `_bmad-output/specs/spec-epic-39/plans/39-5.md` — read its "## Code Map", "## Settled shape" (1–10, the design), "## Files", "## Verify" and "## Refresh — 39-4 gate". Anchors re-checked at HEAD `702d340a` by this session:

- `apps/supervisor/src/office.ts` -- `OfficeSignals` :48, `OFFICE_MAP` :88, `OfficeRun` :314, `analyseRun` :516, `NO_SIGNALS` :569, `liveRuns` :615, progress emit :839-840 (916 lines). Add `stage` column/signals; the hub compares `stage`.
- `apps/supervisor/test/office.test.ts` -- 1391 lines; stream test's first-progress flip (plan Code Map: :559/:569).
- `apps/supervisor/src/stories.ts` -- READ ONLY. `STORY_ID_RE = /^ST-\d{3,}$/` :46; answer `stage_log {specs, rows, total}` :71; rows `{stage, pass, started, ended, cost_usd, …}`; `?project=` required; 404 `UnknownStory`.
- `apps/studio-web/src/screen.ts` -- `PLACEHOLDER` :32 (currently `{run, checkin, settings}`); drop `run`.
- `apps/studio-web/src/App.tsx` -- :106 shared `run || checkin` branch; give `run` its own branch rendering `RunScreen` before it (39.4's `story` precedent), `checkin` stays a placeholder.
- `apps/studio-web/src/screen.test.ts` -- :136-150 PLACEHOLDER pins and the App.tsx source-read pin; flip `run`.
- `apps/studio-web/src/story/model.ts` -- `runPath` already links runs to `/app/run/<id>`; reuse, don't change.
- `apps/studio-web/src/inbox/model.ts` -- `csrfOf` (CSRF from `GET /inbox?project=`) reuse for Cancel.
- `apps/studio-web/src/live/store.ts`, `src/status/*`, `src/office/*`, `src/board/model.ts` (`fetchBoard`, read-only) -- per plan Code Map.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- header clause, rulings row, `**0.1.35 (Story 39.5, additive).**` paragraph before `## 8. Conformance`; text settled in plan "The contract text (settled)".

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/office.ts` + `test/office.test.ts` + `apps/supervisor/README.md` -- `stage` per plan Settled shape 1 and its tests -- AC2 (`office.progress.stage`).
- `apps/studio-web/src/live/store.ts` + `store.test.ts` -- `OfficeRun.stage?`, `applyProgress` carries it -- AC2.
- `apps/studio-web/src/run/model.ts` (new) + `model.test.ts` (new) + `RunScreen.tsx` (new) -- Settled shapes 2–6, 10 -- AC1.
- `apps/studio-web/src/screen.ts` + `App.tsx` + `screen.test.ts` -- route `/app/run/<id>` to `RunScreen` -- AC1.
- `apps/studio-web/src/status/model.ts` + `model.test.ts` + `StatusScreen.tsx` -- Settled shape 7 -- AC2.
- `apps/studio-web/src/office/model.ts` + `model.test.ts` + `OfficeScreen.tsx` -- Settled shapes 8–9 -- AC2.
- `apps/studio-web/README.md` -- "The run page and the progress in view (Story 39.5)" section; revise "never polls".
- `apps/supervisor/src/office.ts` + `test/office.test.ts` + `apps/supervisor/README.md`; `apps/studio-web/src/live/store.ts` + `store.test.ts`; `src/run/RunScreen.tsx`; `src/status/model.ts` (`liveSignature`) + `model.test.ts` + `StatusScreen.tsx`; `src/office/OfficeScreen.tsx`; `apps/studio-web/README.md`; the contract + `test_driver_contract.py` -- `leg` per plan Settled shape 11 and its contract text (operator ruling 2026-11-10; no file outside the plan's list) -- AC1 ("the leg's own guard during the leg").
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- the settled 0.1.35 text and `test_0_1_35_story_39_5_the_runs_timeline_and_the_progress_in_view`; re-bound 39.4's test.

**Acceptance Criteria:**
- Given a full run's events (queued, launch, engine with Stage Log sessions incl. two review passes, host leg with `suite_durations`, close-out, ended), when `runTimeline` runs, then `src/run/model.test.ts` pins each segment, suite sub-cells and the ended words.
- Given the Status screen, when rendered, then the Queue section precedes the counts and each row links to `/app/run/<id>`.
- Given a live run whose stage already reads `host verify leg`, when its `host-verify-leg` lease lands, then `office.test.ts` pins exactly one epic-only `office.progress` with `leg: {since}` and the stage unchanged, and `leg: null` after the leg's `host-verify` and after a release; `store.test.ts` pins `leg` from the snapshot, set and cleared by a delta and kept by a delta without the key; the web's tests pin that a change of `leg` changes every key that triggers the `GET /runs/{id}` re-read.
- Given the verify gate, when run, then lib suite green and conformance `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-11-10 — Review pass
- layers: blind-hunter and edge-case-hunter, both on claude-opus-5-5 / medium (band L). The diff (~337 KB) was handed over as a file path (/tmp/rev395/diff.patch) because it was too large to put inline.
- After deduplication there were 7 distinct findings. The pass stopped at triage, because the high finding was escalated by the consult (see Consult Log):
  - `[high]` The clock never takes the host leg's guard. `GET /runs/{id}` is re-read only on a state or stage change. Stage row 10 `host verify leg` is already set before the close-out writes its `host-verify-leg` lease, so nothing in the store changes when the lease lands (RunScreen.tsx:65, StatusScreen.tsx:51, OfficeScreen.tsx:157). This breaks AC1's "the leg's own guard during the leg". Both layers reported it. The consult ruled that this is a contradiction inside the story, so it was escalated.
  - `[medium]` A failed read shows a loading label forever: the HUD clock, the Status start and clock, and the run page's Stage Log when `project_id` is null. An error is shown as a pending state. Not processed (halted).
  - `[medium]` Some HUD values are not held: state, phase, the done text and failed/total (OfficeScreen.tsx:356-385). AC2 says every HUD value is held at least 1 s. Not processed (halted).
  - `[medium]` The clock's guard and its elapsed time are held and lerped under separate keys. When the guard changes, the elapsed time counts backwards or a false "(over the guard)" appears (office/model.ts:393-399). Not processed (halted).
  - `[medium]` An ended run whose leg lease was never followed by a `host-verify` still reads the host-leg clock, not "in all, claim to end" (run/model.ts:419-422). Not processed (halted).
  - `[low]` When a `pending-N` placeholder phase is replaced by a real story, its fill jumps instead of lerping (office/model.ts:313, :402-405). Not processed (halted).
  - `[low]` Cancel on the Status screen still posts with no CSRF token when `project_id` is null or the inbox read fails. Contrast 39.4's `requestReady` (StatusScreen.tsx:67-70). Not processed (halted).
- intent_gap: 1 (high 1). The attempt is saved as `_bmad-output/implementation-artifacts/39-5-attempt-1.patch`. Per the consult's DO line the code was NOT reverted.
- bad_spec: 0
- patch: 0 (the 6 remaining findings were never triaged, because the pass halted)
- defer: 0
- reject: 0
- addressed_findings:
  - none

### 2026-11-10 — Review pass (pass 2, after the operator's ruling and the `leg` patch)
- layers: blind-hunter and edge-case-hunter, both claude-opus-5-5 / medium (band L); the diff (~350 KB, tracked since baseline plus untracked `apps/studio-web/src/run/`) handed over by scratchpad path. The six findings the halted pass never processed were re-found by blind-hunter and are triaged here with the new ones.
- intent_gap: 0
- bad_spec: 0
- patch: 10 (medium 7, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` HUD re-read of `GET /runs/{id}` keyed on run id, stage and leg but not `state` (OfficeScreen.tsx:159), and the web README says "run, stage or `leg`" against the contract's "`state`, `stage` or `leg`" — key it on state too (share `runRowKey`), fix the README sentence
  - `[medium]` `[patch]` the HUD's re-read key is unpinned though AC names "every key" — move it into a pure, tested function
  - `[medium]` `[patch]` HUD state, phase and the done/failed/total text drawn from `hud`, not held (OfficeScreen.tsx:358/361/383), against AC2 — hold them
  - `[medium]` `[patch]` clock guard and elapsed held under separate keys, so a guard hand-over shows a false "(over the guard)" and lerps backwards (office/model.ts:393/397) — hold them as one value
  - `[medium]` `[patch]` an ended run whose leg lease saw no `host-verify` keeps a live host-leg clock (run/model.ts:425-429) — ended state wins: "in all, claim to end"
  - `[medium]` `[patch]` the run page ignores the `orphaned` end event (run/model.ts:315/454/481): segments stay open, no end segment, cost window to now — treat `orphaned` as an end like `ended`
  - `[medium]` `[patch]` a failed read shows a loading label forever (HUD clock, Status start/clock with `setDetails` replacing the map, the run page's Stage Log when `project_id` is null) — show a could-not-be-read label, keep earlier reads, fall back to the run total
  - `[low]` `[patch]` Status Cancel posts with no CSRF token when `project_id` is null or the inbox read fails; the run page likewise on a failed inbox read — refuse up front with a stated reason
  - `[low]` `[patch]` a `pending-N` placeholder phase replaced by a real story jumps instead of lerping (office/model.ts:313/404) — tween by position
  - `[low]` `[patch]` a takeover `host-verify-leg` while a leg is open may leave the earlier leg segment open (run/model.ts:272-276) — verify and close it

## Design Notes

All design is settled in the plan (SPEC.md design notes CAP-16/CAP-17). One reading to keep: `<m>` in `review pass <n> of <m>` is the engine's `policy_snapshot.limits.max_review_cycles` (default 3), not the band's budget `review_cycles_max`. Before 39.6 the timeline's sessions come from the Stage Log rows plus the live `stage` (the queue events carry no engine session boundaries).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test --timeout 30000` -- expected: 0 fail
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bunx tsc --noEmit -p .` -- expected: clean
- `cd apps/studio-web` -- tsc --noEmit, vitest run, vite build (via `bun node_modules/...` if `bun install` EPERMs, as 39.4 did) -- expected: clean / all pass / ok

**Manual checks (unverifiable here, operator after merge + serve restart):**
- `/app/run/<id>` of a live sbx run shows `HH:MM:SS of 01:00:00`, and during the close-out leg `… of 02:00:00`.
- Office HUD reads `review pass <n> of <m>` during a review session; Status lists the queue above the counts.

## Deviation Summary

### pass 1 (2026-11-10, implementer)

- planned: header clause/paragraph say "one per `OFFICE_MAP` row" / actual: "one per row of the office mapping table" (39.5 test phrase matches) / why: `test_0_1_24_names_the_web_and_the_supervisor_surfaces` forbids supervisor internals such as `OFFICE_MAP` in the contract / may affect: none
- planned: Status test changes for the queue rows only / actual: Story 30.6's "src/status holds no interval timer and no fetch" check rewritten to "one interval that only ticks `now`; `fetch` only as the model's default" / why: the settled design adds store-triggered reads and a 1 s clock tick / may affect: none
- planned: `App.tsx` only swaps `run` to `RunScreen` / actual: `StatusScreen` also gets an `onNavigate` prop for router links / why: avoid full reloads on queue links / may affect: none
- planned: `runClock` answers `{elapsed_s, guard_s, guard, label, over}` / actual: also `mode`, `context`; new `clockLabel(mode, elapsed, guard_s)`; `HudLive.clockText` / why: the HUD re-labels its eased elapsed; the page names the guard / may affect: none (consult ruling)
- planned: `costView({storyId, stageRows, cost_usd, window})` / actual: also takes `error` and `now` (`stageRows: null` = pending) / why: the "could not be read" label and an open window / may affect: none
- planned: paused segment `paused: <run.reason or detail.reason>` / actual: `run.reason` only for the latest pause while still paused, then `detail.reason`, then `detail.engine.paused_reason`, then "no reason recorded" / why: `markPaused` never sets `run.reason`; the engine's reason sits in `detail.engine.paused_reason` / may affect: none
- planned: no rule for a released lease / actual: a `host-verify-leg` with `owner: null` closes an open host-leg/re-run segment / why: otherwise the segment stays open forever / may affect: none
- planned: `inconclusive (guard)` when "no suite is red" / actual: "no suite red" = no `verdicts` line containing `FAILED` or `red` / why: no per-suite verdict field on the event / may affect: none
- planned: close-out clock counts from "the segment's start" / actual: from the first engine-gone, owned lease or `host-verify` after the latest claim/close-out/engine-resume, for running or external runs / why: the plan left the anchor undefined / may affect: none
- planned: three existing whole-object assertions unmentioned / actual: store progress-born row and two HUD tests widened to the new fields / why: whole-object compares / may affect: none
- planned: model exports as listed / actual: extra exports (`hudMotion`, `inFlight`, `epicNumberOf`, `BoardRead`, `LOADING_FINDINGS`, `legOutcome`, `suitesOf`, `runWindow`, `liveSignature`, `fetchStatus`, loading constants) / why: screens and tests use them / may affect: none

### pass 2 (2026-11-10, implementer — Settled shape 11, `leg`)

- planned: the run page's key inline in `RunScreen.tsx` / actual: pure exported `runRowKey(row)` in `run/model.ts`, used by `RunScreen.tsx`, tested in `run/model.test.ts` / why: shape 11's "the run page's key changes when `leg` does" runs without a DOM / may affect: none (score 1, consult accepted)
- planned: the supervisor README's `GET /office/events` row only / actual: also `leg` on the `GET /office` row's `runs[]` shape / why: that row already lists `stage`; shape 11 puts `leg` on every snapshot entry / may affect: none (score 1, consult accepted)
- planned: the HUD's re-read key from its model / actual: `OfficeScreen.tsx` reads `leg.since` from the store row; `office/model.ts` unchanged / why: smallest change / may affect: none (score 0)

### pass 3 (2026-11-10, implementer — the ten review patches)

- planned: hold the clock's guard and elapsed together / actual: mode, guard, context and elapsed are one held value, and the elapsed tween is keyed by mode and guard, so a hand-over swaps after the hold with no lerp / why: a lerp from the worker's elapsed to the leg's ran backwards and showed a false "(over the guard)" / may affect: none (score 1, consult accepted)
- planned: hold state, phase and counts / actual: the HUD's engine id is held too / why: AC2 "every HUD value" / may affect: none (score 1, consult accepted)
- planned: no new export for Cancel / actual: `requestCancel(runId, project, readInbox, fetchFn)` in `run/model.ts`, modelled on 39.4's `requestReady`, inbox read passed in to avoid an import cycle / why: never post Cancel without a CSRF token / may affect: none (score 1, consult accepted)

DEVIATION SCORE: 1

DRIFT: contract text says "one per row of the office mapping table" instead of naming `OFFICE_MAP` — an existing contract test forbids supervisor internals in the contract — affects: none
DRIFT: Story 30.6's no-timer/no-fetch status check relaxed to one now-tick interval and fetch only as a model default — the settled design adds store-triggered reads and a 1 s tick — affects: none
DRIFT: StatusScreen gains an `onNavigate` prop wired in App.tsx — router links instead of full reloads — affects: none
DRIFT: `runClock` answer widened with `mode`/`context`, plus `clockLabel` and `HudLive.clockText` — the HUD re-labels eased elapsed time — affects: none
DRIFT: `costView` input gains `error` and `now` — the could-not-be-read label and open windows — affects: none
DRIFT: paused segment reason falls back through `detail.engine.paused_reason` — `markPaused` never sets `run.reason` — affects: none
DRIFT: a released `host-verify-leg` lease (`owner: null`) closes the host-leg segment — the table had no closing rule for it — affects: none
DRIFT: "no suite red" read from `verdicts` lines — the event has no per-suite verdict field — affects: none
DRIFT: close-out clock anchor defined as the first engine-gone/owned lease/host-verify after the latest claim/close-out/engine-resume — the plan left it undefined — affects: none
DRIFT: three whole-object test assertions widened to the new fields — additive fields break whole-object compares — affects: none
DRIFT: extra model exports for screens and tests — needed by the hold/lerp wiring and pins — affects: none

DRIFT: `runRowKey` moved into `run/model.ts` as a pure export — shape 11's key test runs without a DOM — affects: none
DRIFT: `leg` also on the supervisor README's `GET /office` runs[] row — that row lists `stage`; shape 11 puts `leg` on every snapshot entry — affects: none
DRIFT: the HUD clock is one held value with its elapsed tween keyed by mode and guard — a cross-clock lerp ran backwards past a guard that does not apply — affects: none
DRIFT: the HUD's engine id is held — AC2 "every HUD value" — affects: none
DRIFT: `requestCancel` added to `run/model.ts` — never post Cancel without a CSRF token; the inbox read is a parameter to avoid an import cycle — affects: none

## Consult Log

- 2026-11-10T07:54:04Z — trigger: deviation-gt-0 — question: accept the 11 implementer deviations at score 1, or does any (contract wording vs test_0_1_24, runClock widening vs 39.6, Story 30.6 status-test relaxation) rise to 2 or need rejection? — ruling: accept-deviation score 1 — do: Record all 11 deviations at score 1; change deviation (d)'s "may affect: 39.6" and its DRIFT line to "affects: none"; keep the contract wording and the rewritten Story 30.6 Status check — rule candidate: when a plan's settled contract text names an identifier an earlier contract pin forbids, use the plain-words paraphrase and record a score-1 deviation without a consult; a widening of a web-internal function's answer scores 1 unless a later plan names that symbol.
- 2026-11-10T08:05:07Z — trigger: high-severity-finding — question: the web re-reads GET /runs/{id} only on a state or stage change, so the host-verify-leg lease never reaches the clock (AC1, "the leg's own guard during the leg"). Is this bad_spec or a patch, and which fix fits inside "no fetch timer" and contract 0.1.35? — ruling: escalate — do: HALT and keep the working tree as it is. This is a contradiction inside the story, not a bad_spec, so do not revert. The operator picks one: (i) relax "no fetch timer anywhere" to allow one deferred GET /runs/{id} re-read while a live run's clock has no leg guard after the engine ended, or (ii) make an additive contract change that puts the open lease on the office snapshot or deltas (for example a lease flag on runs[] in the signature). Changing stage values and a store-only signature are both ruled out. — rule candidate: when a SPEC pins "reads only on store changes", the planner checks that every input an AC's display needs changes some field in the store's signature, or adds that field to the contract in the same story.
- 2026-11-10T08:05:07Z — trigger: halt — not consulted again: this halt is the escalate ruling above, and the policy forbids a second consult on the same question.
- 2026-11-10T08:21:00Z — operator ruling on the escalation (agent seat; the run paused, nothing committed) — ruling: **(ii)**, an additive field inside contract 0.1.35. The open host-verify leg travels on the office snapshot's `runs[]` and on every `office.progress` as `leg` (`null`, or `{since}` = the open lease's `at`); a change of `leg` alone is an epic-only delta; the web's store carries it, and every re-read of `GET /runs/{id}` is keyed on `state`, `stage` and `leg`. The shape is plan Settled shape 11 and its contract text, written by the operator; this spec's Boundaries, matrix, Tasks and Acceptance Criteria are amended to match. Option (i) is refused: "no fetch timer anywhere" stands (Story 39.4 ruled a timer re-read out as well). The 11 accepted deviations stand. — do: the attempt is restored from `39-5-attempt-1.patch` and this spec is `in-review`. Implement Settled shape 11 on top of the restored code as a `patch` (the code does not yet match the amended spec; this is NOT a `bad_spec`, revert nothing), re-run the Verification commands, then triage the six findings the halted pass never processed, with whatever the new pass finds, as usual. No consult is owed on `leg` itself: it is in the plan now. — why (ii): the epic's design is "reads follow store changes, the tick drives clocks only"; the snapshot already carries data rather than triggering extra reads (0.1.25); `office.ts` already reads the run's queue events (`closingOutHeld`), so no route, no timer and no file outside the plan's list is needed.
- 2026-11-10T08:35:43Z — trigger: deviation-gt-0 — question: accept the leg patch's deviations ((a) pure `runRowKey` in run/model.ts, (b) `leg` also on the supervisor README's `GET /office` runs[] row, (c) HUD key read from the store row) at score 1? — ruling: accept-deviation score 1 — do: keep (a) runRowKey in run/model.ts with its RunScreen use and test; keep (b) the README `GET /office` row; keep (c) at score 0; record all three as reported and continue — rule candidate: a test-driven move of a screen key into its sibling model.ts is a planned move (score 0); adding a ruled field to every README row listing the same shape is following the ruling, not a deviation.
- 2026-11-10T08:48:57Z — trigger: deviation-gt-0 — question: accept the patch pass's deviations ((a) one held clock value with the elapsed tween keyed by mode+guard, so a worker→leg hand-over swaps without a lerp; (b) engine id held; (c) `requestCancel` in run/model.ts) at score 1, given AC2's "the clock … lerp[s] between values"? — ruling: accept-deviation score 1 — do: keep (a), (b) and (c) as they are; report all three at score 1; pin a hand-over with no backward lerp and no false "(over the guard)" in model.test.ts (already pinned: office/model.test.ts:449) — rule candidate: a tween runs only between successive values of the same quantity; when its identity changes (the clock's mode or guard, a phase's key) the new value replaces the old after the hold and starts its own tween, never a lerp from the old one.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-09T17:24:14Z | 2026-11-09T17:48:19Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-10T05:56:44Z | 2026-11-10T05:57:45Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-10T07:30:37Z | 2026-11-10T08:05:36Z | 99f3ce2c-d9b8-42e6-ac88-55cb620d6a77 | claude-opus-5-5 | medium | 25448085 | 170398 | 13.0363 | blocked |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory <project-root>` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This session resumed the spec at `in-review` after the operator's ruling (ii). The implementer added Settled shape 11: the open host-verify leg goes on the office snapshot and on every `office.progress` as `leg` (`null` or `{since}`). A change of `leg` alone is an epic-only delta. The web store carries `leg`, and every key that triggers a `GET /runs/{id}` re-read includes it (run page `runRowKey`, Status `liveSignature`, HUD `hudRunKey`). There is no fetch timer. A second review pass (both layers) re-found the six findings the halted pass never processed and added four new ones. All ten were triaged `patch` and fixed with pinning tests.

**Files changed (whole story, since baseline 702d340a4ec06a1050de395e9f652ac36b91f0fe):**
- `apps/supervisor/src/office.ts` — the `stage` column and the stage computation; `leg` from the run's queue events; the hub emits a delta on a `stage` or `leg` change.
- `apps/supervisor/test/office.test.ts` — the stage values, the stage-only and leg-only epic deltas, `leg` across the lease, its `host-verify`, a release and a takeover.
- `apps/supervisor/README.md` — the `GET /office` and `GET /office/events` shapes with `stage` and `leg`.
- `apps/studio-web/src/live/store.ts`, `store.test.ts` — `stage` and `leg` on the mirrored run.
- `apps/studio-web/src/run/model.ts`, `model.test.ts`, `RunScreen.tsx` (new) — the run page: timeline, clock, cost, events, Cancel (`requestCancel`), with `orphaned` handled as an end.
- `apps/studio-web/src/status/model.ts`, `model.test.ts`, `StatusScreen.tsx` — the queue above the counts, links, Cancel, the paused reason and its inbox item, `mergeDetails` keeping the last read.
- `apps/studio-web/src/office/model.ts`, `model.test.ts`, `OfficeScreen.tsx` — the HUD's stage, clock and phased bar; hold and lerp; `hudRunKey`.
- `apps/studio-web/src/screen.ts`, `screen.test.ts`, `App.tsx` — the route `/app/run/<id>` goes to `RunScreen`.
- `apps/studio-web/README.md` — the 39.5 section.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` — 0.1.35 additive: `stage` and `leg`, and their pin.

**Review findings.** Pass 2: 10 patches applied (medium 7, low 3), 0 deferred, 0 rejected, 0 bad_spec, 0 intent_gap.

**Follow-up review recommendation:** true. Patched findings: high 0, medium 7, low 3. Score = 3×7 + 1×3 = 24, which is ≥ 5.

**Verification (run by this session after the patch pass):**
- `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: 3167 tests, OK (skipped=5).
- `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `apps/supervisor`, `bun test --timeout 30000`: 2358 tests, 0 fail (88 skip). `bunx tsc --noEmit -p .`: clean.
- `apps/studio-web`, run through `bun node_modules/...`: tsc `--noEmit` clean; vitest 15 files, 304 passed; vite build ok (only the usual chunk-size warning).

**Unverifiable here (the operator runs these after the merge and the serve restart):**
- Open `/app/run/<id>` for a live sbx run. The clock reads `HH:MM:SS of 01:00:00`, and during the close-out leg `… of 02:00:00`.
- During a review session the office HUD reads `review pass <n> of <m>`.
- The Status screen lists the queue above the counts.
- `office.ts` runs in serve. Stop the supervisor before building `apps/supervisor`, then restart it through the scheduled task.

**Residual risks:**
- The story is oversized (band L, about 20 files), and the follow-up review is recommended.
- At a clock hand-over the HUD swaps clocks after the hold rather than lerping. This is the consult-accepted reading of AC2.
- The web gate ran through `bun node_modules/...`. `bun run verify` (the frozen install) was not run here.

DRIFT: contract text says "one per row of the office mapping table" instead of naming `OFFICE_MAP` — an existing contract test forbids supervisor internals in the contract — affects: none
DRIFT: Story 30.6's no-timer/no-fetch status check relaxed to one now-tick interval and fetch only as a model default — the settled design adds store-triggered reads and a 1 s tick — affects: none
DRIFT: StatusScreen gains an `onNavigate` prop wired in App.tsx — router links instead of full reloads — affects: none
DRIFT: `runClock` answer widened with `mode`/`context`, plus `clockLabel` and `HudLive.clockText` — the HUD re-labels eased elapsed time — affects: none
DRIFT: `costView` input gains `error` and `now` (and `project`) — the could-not-be-read label, open windows and the no-project fallback — affects: none
DRIFT: paused segment reason falls back through `detail.engine.paused_reason` — `markPaused` never sets `run.reason` — affects: none
DRIFT: a released `host-verify-leg` lease (`owner: null`) closes the host-leg segment — the table had no closing rule for it — affects: none
DRIFT: "no suite red" read from `verdicts` lines — the event has no per-suite verdict field — affects: none
DRIFT: close-out clock anchor defined as the first engine-gone/owned lease/host-verify after the latest claim/close-out/engine-resume — the plan left it undefined — affects: none
DRIFT: three whole-object test assertions widened to the new fields — additive fields break whole-object compares — affects: none
DRIFT: extra model exports for screens and tests — needed by the hold/lerp wiring and pins — affects: none
DRIFT: `runRowKey` moved into `run/model.ts` as a pure export — shape 11's key test runs without a DOM — affects: none
DRIFT: `leg` also on the supervisor README's `GET /office` runs[] row — that row lists `stage`; shape 11 puts `leg` on every snapshot entry — affects: none
DRIFT: the HUD clock is one held value with its elapsed tween keyed by mode and guard — a cross-clock lerp ran backwards past a guard that does not apply — affects: none
DRIFT: the HUD's engine id is held — AC2 "every HUD value" — affects: none
DRIFT: `requestCancel` added to `run/model.ts` — never post Cancel without a CSRF token; the inbox read is a parameter to avoid an import cycle — affects: none
