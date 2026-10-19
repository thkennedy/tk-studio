---
title: 'The Office Screen'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '88e1c074f9255a93db0f5996c19e9a0ac846d520'
deviation_score: 2
reconcile_verdict: adjust-stories
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-4.md'
  - '{project-root}/_bmad-output/specs/spec-epic-30/SPEC.md'
warnings: [oversized]
deferred:
  - summary: >-
      A run entering the live set after the snapshot shows the HUD's current-story phase as "—" until that story next changes.
    evidence: |-
      Category (a), a defect in behaviour AC2 names ("the current story's phase"). driver-contract.md:151 pins "A run new to the live set sends an epic-only office.progress beside its office.run", so the store holds no stories for that run. A consult (pass 2) ruled it a contract or operator decision (an additive per-story office.progress for a new run), not a 30-4 patch. A reconnect snapshot fills it.
    location: >-
      plugins/tk-studio/contracts/driver-contract.md:151; apps/studio-web/src/office/model.ts hudModel
    severity: medium
  - summary: >-
      A run that becomes live, or reaches `launched`, after the page's snapshot keeps the HUD's engine run id at "—" until a reconnect snapshot brings it.
    evidence: |-
      Category (a), a defect in behaviour AC2 names ("the engine run id"). The `office.run` delta has the pinned shape {run_id, project, state, from} with no engine_run_id, and the hub emits it only on a state change (apps/supervisor/src/office.ts:663). The web store's applyRun creates new rows with engine_run_id null and never updates it (apps/studio-web/src/live/store.ts:151). The fix is an additive delta field, so it is a contract or operator decision, the same class as the existing phase deferral. Found by follow-up review pass 4.
    location: >-
      apps/supervisor/src/office.ts:663; apps/studio-web/src/live/store.ts:151; plugins/tk-studio/contracts/driver-contract.md (office.run delta)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The web (30.1 spike, 30.3 store) shows a debug HUD and one sprite, not the studio. Story 30.4 (CAP-10…12): as the operator, I want the office floor to show each project's agents as characters whose pose follows their semantic state, with a HUD for the run and the story in flight, so that a glance at the screen says what the studio is doing (§6.3, §7.3).

**Approach:** Per the operator ruling (2026-10-19, session 11, replan queue's 30-3 operator entry, option (a)): first extend the supervisor's office projection additively (AD-2): agent rows and `office.agent` carry `reason`, and the snapshot and `office.run` carry the project's last ended run `last_run {run_id, state, pr, ended_at}`, with contract §1 bumped to 0.1.25 (additive). Then the web store mirrors both, pure `src/office/model.ts` holds the rules, `scene.ts` gains frame sets, desks and in-place pose swaps, and `OfficeScreen.tsx` composes the canvas, the bubbles, the HUD and the switcher.

### Acceptance criteria (verbatim, epics.md "### Story 30.4")

- **AC1:** **Given** the registry's agents for the selected project (`GET /agents?project=<id>`) and the store of Story 30.3 **When** the Office screen renders **Then** each agent is one character at a desk on the PixiJS floor, named by its role, whose pose is one of the eight office states of §7.3 (`offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`), each state a distinct, looping frame set from the sheet; a state change swaps the frame set within one frame without a flicker; `waiting-for-human` and `blocked` add a React DOM bubble over the character naming what it waits for (the projection's reason)
- **AC2:** **Given** a project with a live run **When** the HUD renders **Then** it shows the project, the run id and state, the story in flight with its progress (`office.progress`: done, failed and total stories, the current story's phase), the engine run id and the time since the last event; with no live run it shows the last ended run's end state and PR link; a project switcher lists the registry's projects and remembers the choice per browser
- **AC3:** **Given** the screen **When** it is tested **Then** vitest covers the state-to-frames mapping for all eight states, the bubble rule, the HUD's fields from a fixture store, and the project switcher; the canvas is driven through the renderer's exported scene functions so the tests need no WebGL

## Boundaries & Constraints

**Always:**
- One loader (`loadSheet`/`SHEET_URL` in scene.ts), one store (`createOfficeStore`, module-level in App.tsx), one stream (`openOfficeStream`). Extend them; never add a second.
- A pose change sets the new frames on the SAME sprite (`AnimatedSprite.textures = frames; play()`, or an equivalent in-place swap). It never destroys or re-adds the sprite, and it never calls `layoutScene`.
- Pure logic lives in `.ts` modules that vitest drives in `environment: "node"`. `fetch`, `localStorage` and the clock are injectable.
- Use absolute URLs (`/agents`, `/agents?project=<id>`), because the page has `<base href="/app/">`.
- Null seams: a run row with `state: null` renders as "pending" and `engine_run_id: null` as "—". A missing `last_run`, a null `pr` or a null `reason` renders as "pending"/"—", never as a crash. Count live runs as App.tsx does (`state !== null && LIVE_RUN_STATES.has(state)`).
- The projection change is additive. Existing fields, kinds, ids, grace and the `office.run` sentence pinned by `test_driver_contract.py` stay as they are.
- AD-11, NFR5 and AD-2 hold: the change is a supervisor surface, and nothing in the plugin's own surfaces changes.

**Block If:**
- The Files list must grow beyond the plan's Files plus the ruling's additions (listed in Tasks).
- A schema or conformance surface for the office turns out to exist and to need a shape the ruling does not settle.

**Never:**
- `git push`, tag, release, or bump the gate x3 versions.
- Edit epics.md, SPEC.md, stories.yaml, plans, or anything under `supervision/`.
- Read `GET /runs/{id}` or `GET /jobs` from the web; the ruling chose (a), not (b).
- Add new web dependencies (none expected). Add per-role art (30.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Waiting agent | orchestrator `waiting-for-human`, awaiting-ruling reason "reconcile_verdict: escalate" | `reason` on the row and the `office.agent` delta; the web shows a bubble naming it | reason null → bubble says "waiting" |
| Blocked agent | the project's last run `blocked`, `QueueRun.reason` "the launch refused" | `reason` = "the launch refused"; bubble shows it | — |
| Other states | idle/typing/… | `reason: null`; no bubble | — |
| Reason-only change | same state, new reason | one `office.agent` delta | — |
| Run ends | live run leaves the set as `complete` with `ended.detail.pr` | the `office.run` delta carries `last_run {run_id, state:"complete", pr, ended_at}`; the snapshot's `last_run[project]` matches | no PR → `pr: null` |
| No ended run | project never ended a run | snapshot has no entry for that project; HUD shows "no run yet" | — |
| HUD live | live run, state null, engine id null | project, run id, "pending", "—", progress d/f/t, phase, "Ns ago" | — |
| Switcher | stored project absent from registry | falls back to the first registry project | storage throws → in-memory only |
| `/agents` fails | non-200 / network error | the HUD names the error, the floor stays empty; no throw | — |

</intent-contract>

## Code Map

Supervisor (the ruling's addition):
- `apps/supervisor/src/office.ts` — `OfficeAgent` :297, `OfficeView` :298. `analyseRun` :376-427 computes `awaiting` (:394, the latest RULING_KINDS event is `awaiting-ruling`, whose `detail.reason` is written at closeout.ts:389), `escalated` (:395, journal `story-escalated`/`run-paused`) and `pausedReason` (:396, state.json `paused_reason`). Queue `paused` events carry `detail.engine.paused_reason` (office.test.ts:215). For blocked, the run is `state==="blocked"` and the reason is `QueueRun.reason` (queue.ts:449). `projectCore.forProject` :450 is where to return a `reason`; `projectOffice` :465-481 builds the rows; `refresh()` :574-622 holds grace (:580-586), the agent change check (:595) and the delta emitters (office.agent :596, office.run :608-615; the leaving-run branch at :612 reads `this.queue.get(p.run_id)`). `selectRun` :283.
- `apps/supervisor/src/planstatus.ts:98` `runPr(events)` — reuse for `pr`. `queue.ts:63-70` `isTerminal`/`TERMINAL_STATES`. `QueueEvent.at` (queue.ts:507) on the last `ended`/`orphaned` event gives `ended_at`; fall back to `run.updated`.
- `apps/supervisor/test/office.test.ts` — the `world()` fixture :33-75; row 4 :211; blocked :260; the stream :506/:540; the routes :634.
- `apps/supervisor/README.md` :56-57, :103-119 — the office shape docs.
- `plugins/tk-studio/contracts/driver-contract.md` — header :5-6 (bold the new version, append the clause), web surfaces :90-151 ("The stream" paragraph). KEEP the heading `### Supervisor surfaces the web consumes (0.1.24)` and the `office.run` sentence; add a 0.1.25 note.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` :101-105, :325-328, :373-430 — move the header pin to 0.1.25 and add `test_0_1_25_…`.

Web:
- `apps/studio-web/src/live/store.ts` — types :11-57; `applyAgent` :102-123 (patch :105-109); `applyRun` :146-169 (removes a non-live run, so capture `last_run` here); `applySnapshot` :185-197 (destructures only at/agents/runs/problems); `LiveState` :83. Add `lastEventAt` (injectable `now`), keeping `getState()`'s reference stable.
- `apps/studio-web/src/renderer/scene.ts` — `Sheet` :12 `{floor, character}`; `loadSheet` :43; `drawFloor` :54; `placeCharacter` :68; `floorSize` :77; `layoutScene` :83 (rebuilds on resize; that is fine).
- `apps/studio-web/scripts/make-placeholder.ts` — `PALETTE` :13, `FLOOR` :27, `CHARACTER` :46 pixel rows, `WIDTH`/`HEIGHT` :65-67 (32x16), a hand CRC and zlib; byte-reproducible.
- `apps/studio-web/src/App.tsx` — the store :11, the stream effect :29-32, the Pixi effect :34-100, the HUD :104-125.
- vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. Scripts: `test`, `verify`, `sprites`. bun is at `~/.bun/bin/bun`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/office.ts` -- add `reason: string | null` to `OfficeAgent`, set only when the shown state is `waiting-for-human` or `blocked`. For waiting, take the first non-empty of: the awaiting-ruling `detail.reason`, state.json `paused_reason`, the latest `paused` event's `detail.engine.paused_reason`, and the latest journal escalation's reason. For blocked, take `QueueRun.reason`. Under grace, the reason follows the shown state (a held state keeps the previous reason; other states get null). Emit `office.agent` on a reason change and add `reason` to its payload. Add `OfficeLastRun {run_id, state, pr: string|null, ended_at}`: `OfficeView.last_run: Record<project, OfficeLastRun>` holds each project's newest terminal run, and the `office.run` delta for a run leaving the live set carries `last_run` when that run is terminal -- the ruling's projection.
- `apps/supervisor/test/office.test.ts` -- tests for the reason (awaiting-ruling, paused_reason, blocked, a non-waiting null, a reason-only delta) and for `last_run` (snapshot, delta with PR, no PR, no ended run) -- pin the projection.
- `apps/supervisor/README.md` -- document both fields.
- `plugins/tk-studio/contracts/driver-contract.md` -- header **0.1.25** (Story 30.4, additive: `reason`, `last_run`), noting that 30.5 adds `/board` to this same entry; a 0.1.25 sub-note in the web surfaces section -- AD-19.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- re-pin the header, add the 0.1.25 test.
- `apps/studio-web/src/live/store.ts` (+ `store.test.ts`) -- mirror `reason` and `last_run`: the snapshot replaces `last_run`; an `office.run` delta carrying `last_run` sets it for its project. Add `lastEventAt`, set on an applied snapshot or delta and unchanged on an ignored one.
- `apps/studio-web/scripts/make-placeholder.ts` + `public/sprites/placeholder.png` -- a desk tile and eight distinct two-frame state sets; regenerate with `bun run sprites`; the output stays byte-reproducible.
- `apps/studio-web/src/renderer/scene.ts` (+ new `scene.test.ts`) -- `Sheet` gains `desk` and `frames: Record<OfficeState, Texture[]>`, cut by `loadSheet`; add `placeDesks(world, sheet, agents)` (a desk plus an AnimatedSprite per agent, in row order) and `setPose(sprite, frames)` (in place). Tests use a bare `Container`/`new Texture()`.
- `apps/studio-web/src/office/model.ts` (+ `model.test.ts`) -- `framesFor(sheet, role, state)` (the role's set if the sheet has one, else the shared state set); the bubble rule; `hudModel(state, project, now)` (live: project, run id, state or "pending", engine id or "—", done/failed/total, the current story and its phase, seconds since `lastEventAt`; else `last_run` state and PR or "no run yet"); `projectsFrom(rows)`; and `rememberedProject`/`rememberProject` with injectable storage.
- `apps/studio-web/src/office/OfficeScreen.tsx` -- fetch `/agents` (the project list) and `/agents?project=<id>` (the desks); the switcher; the bubbles positioned over the sprites; the HUD; the canvas through scene.ts; a 1 s tick for "time since".
- `apps/studio-web/src/App.tsx` -- mount `OfficeScreen` with the store; keep the stream mount and the debug lines.
- `apps/studio-web/README.md` -- a section "The Office screen (Story 30.4)".

**Acceptance Criteria:**
- Given the supervisor tests, when `bun test` runs in apps/supervisor, then the reason and last_run tests pass along with all existing tests.
- Given AC1–AC3, when `bun run verify` runs in the /tmp copy, then vitest covers the eight distinct frame sets, `setPose` swapping in place on the same sprite object, the bubble rule, the HUD fields from a fixture store (including the null seams and no live run), and the switcher with fake storage.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass
- note: the diff (133 KB) was handed to both layers as the file /tmp/30-4-review.diff rather than inlined; both layers ran (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5: (high 0, medium 0, low 5) — /agents read not retried (plumbing, no criterion); empty registry blank screen (nothing to show, no criterion); desk rows overflow a short viewport (phone UI is EP-34); HUD /agents error path untested in the .tsx (fetchAgents' error answers are tested); duplicate of the last_run ordering finding merged
- addressed_findings:
  - `[medium]` `[patch]` the leaving-run office.run carried its own last_run, which could be older than the snapshot's: it now carries last_run only when it equals next.last_run[project]
  - `[medium]` `[patch]` last_run changes with no leaving run went unsent: one office.run {from: null, last_run} per uncovered project; the store sets it with no row; contract 0.1.25 note updated
  - `[low]` `[patch]` a stale paused event's engine reason after a resume: a recency guard
  - `[low]` `[patch]` the PR href scheme was unchecked: safeHref (^https?://), plain text otherwise
  - `[low]` `[patch]` the no-flicker sync rule lived untested in the .tsx: extracted to scene.ts deskSetKey/syncDesks, tested for the same sprite objects on a state-only change
  - `[low]` `[patch]` the old project's rows stayed until the new fetch resolved: rows cleared on switch

### 2026-10-19 — Review pass (follow-up, pass 3)
- note: fresh follow-up review of the committed story (baseline 88e1c074f9255a93db0f5996c19e9a0ac846d520 to HEAD); the 142 KB diff (excluding `_bmad-output/` and the png) was handed to both layers as /tmp/rev304/diff.patch; both layers ran (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` the HUD's time since the last event reset on every watchdog reconnect snapshot (a fresh EventSource gets a snapshot every ~15 s on a quiet office): `lastEventAt` is now set by a snapshot only on the first one or when its content (agents, runs, problems, last_run) changes; store tests added. Triaged patch, not bad_spec: the Tasks wording "set on an applied snapshot" is narrowed locally, recorded as a score-1 DRIFT and accepted by consult
  - `[medium]` `[patch]` a terminal `last_run` whose PR arrives later (a `closed_out` event, `runPr`) sent no delta, so stream clients kept `pr: null`: office.ts emits the from-null `office.run` on any `last_run` field change (`sameLastRun`); office.test.ts test added; the web store already replaces `last_run` by project (test added)
  - `[low]` `[patch]` OfficeScreen's one `error` state let a later successful `/agents?project=` read wipe a canvas/sheet failure: the canvas failure has its own `canvasError`
  - `[low]` `[patch]` the 0.1.25 note did not say a from-null terminal `office.run` carrying `last_run` is not a live-set entry, and the header clause omitted that emission: both clarified inside the 0.1.25 entry (no bump; the 0.1.24 sentence unchanged)

### 2026-10-19 — Review pass (follow-up, pass 4)
- note: fresh follow-up review of the committed story (baseline 88e1c074f9255a93db0f5996c19e9a0ac846d520 to HEAD e774a2f90913b5da97ee093cabb30e0da3ae4b3f); the 149 KB diff (excluding `_bmad-output/`, the png as a binary stub) was handed to both layers as /tmp/review-30-4-p4/diff.patch; both layers ran (band L); edge-case-hunter returned no findings
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 1: (high 0, medium 1, low 0) — engine run id "—" for a run that becomes live or launches after the snapshot: category (a), AC2 names the engine run id; the `office.run` delta shape is contract-pinned (same class as the existing phase deferral)
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` the desk in front of the character hid every frame-to-frame pixel of the `reading` pose (character row 10, under the monitor), so reading did not visibly loop (AC1): the book moved to character row 9, which the desk leaves clear; png regenerated byte-reproducibly; scene.test.ts decodes the committed png and asserts each state's two frames differ at a pixel the desk leaves visible, and that all eight sets are distinct (it fails on the old png)
  - `[medium]` `[patch]` the waiting/blocked bubbles of the first desk row sat under App's fixed debug panel (z 2 above the bubbles' z 1) (AC1): bubbles use `BUBBLE_Z` (3), and the OfficeScreen root went from `position: fixed` to `absolute` so it is no longer its own stacking context (consult: accept, score 1)
  - `[low]` `[patch]` the `GET /office` route header comment in apps/supervisor/src/api.ts omitted the 0.1.25 `reason` and `last_run`: comment-only edit outside Files (consult: apply, score 1)

## Design Notes

Settled shape (planner, 2026-10-19; the ruling names the fields and this note settles the keying):
- The snapshot carries `last_run` as a project-keyed object, because the snapshot spans projects. Each `office.run` delta carries the single object for its run's project.
- `ended_at` is an ISO string.
- The frame lookup per plan 30-4: the placeholder supplies shared per-state sets, and 30.7 adds per-role sets and the `idle` fallback without changing callers.
- Sequencing: 30.4 now takes the 0.1.25 bump that SPEC assigned to 30.5, and 30.5 and 30.6 extend that entry. Record this as a DRIFT.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `rm -rf /tmp/v304 && mkdir -p /tmp/v304 && git ls-files -co --exclude-standard apps/studio-web apps/supervisor | tar -cT - | tar -xC /tmp/v304`, then in `/tmp/v304/apps/studio-web`: `bun run sprites && cmp` against the committed png, then `bun run verify`; in `/tmp/v304/apps/supervisor`: `bun install --frozen-lockfile && bun test && bun run typecheck` -- expected: green
- `grep -rn "Assets.load(" apps/studio-web/src | grep -v test` -- expected: one hit (scene.ts); `grep -rn "new EventSource(" apps/studio-web/src | grep -v test` -- expected: one hit (stream.ts)
- `uv run python tools/verify_host.py` -- the host leg (binding); expected ok, or record it as unverifiable-here.

## Deviation Summary

### pass 1 (2026-10-19, implementer)

- planned: supervisor Files office.ts, office.test.ts, README.md / actual: also `apps/supervisor/src/page.ts` (`last_run: {}` on its fallback `OfficeView` when the projection throws) / why: `OfficeView.last_run` is required; tsc failed without it / may affect: none
- planned: new reason/last_run tests / actual: existing assertions and fixtures in office.test.ts and store.test.ts updated too (`reason: null`, `last_run: {}`, `lastEventAt: null`) / why: new required fields change those shapes / may affect: none
- planned: `placeDesks(world, sheet, agents)` / actual: `placeDesks(world, sheet, agents, opts?)` (`cols`, `autoUpdate`, `tile`) plus a pure `cutSheet(source)` used by `loadSheet` / why: `AnimatedSprite.play()` on the shared ticker throws in node; cutting testable without a load / may affect: 30-7
- planned: canvas effect in App or OfficeScreen / actual: moved into OfficeScreen, which reports zoom/ratio/fps via `onStats`; the canvas error line moved into the Office HUD / why: OfficeScreen owns canvas and desks / may affect: 30-6
- planned (SPEC Assumptions): 30.5 takes the 0.1.25 bump / actual: 30.4 takes it per the operator ruling (2026-10-19, session 11); header notes 30.5 adds `/board` to the same entry / why: operator ruling option (a) / may affect: 30-5-the-board-screen, 30-6-the-status-screen-and-the-home

Implementer score: 1. Session score: 2 (the 0.1.25 sequencing is a seam 30-5/30-6 were planned against).

DRIFT: apps/supervisor/src/page.ts gains `last_run: {}` in its fallback view — OfficeView.last_run is required and tsc fails without it — affects: none
DRIFT: placeDesks takes opts (cols, autoUpdate, tile) and scene.ts adds cutSheet — AnimatedSprite on the shared ticker throws in node; cutting must be testable — affects: 30-7-our-own-assets
DRIFT: the Pixi canvas effect moved from App.tsx into OfficeScreen.tsx (stats via onStats) — OfficeScreen owns the canvas and the desks — affects: 30-6-the-status-screen-and-the-home
DRIFT: contract 0.1.25 bump taken by 30.4 instead of 30.5 — operator ruling (session 11) option (a) — affects: 30-5-the-board-screen, 30-6-the-status-screen-and-the-home

### pass 2 (2026-10-19, review patches)

- planned: item 3 guard = latest RULING_KINDS event is the `paused` / actual: guard over close-out, close-out-failed, engine-resume, resumed, paused (excludes awaiting-ruling) / why: an awaiting-ruling does not end a pause, so a standing pause keeps its engine reason when the ruling has none / may affect: none
- planned: one new contract sentence for the unseen-run `last_run` delta / actual: also qualified the existing leaving-run sentence with "when that run is its project's `last_run`" / why: after patch 1 the old wording contradicted the code; pinned sentence and 0.1.24 heading untouched / may affect: none
- planned: new-run per-story `office.progress` (finding 6) / actual: not changed / why: contract-pinned, `driver-contract.md:151` "A run new to the live set sends an epic-only `office.progress` beside its `office.run`." / may affect: none (deferred)

DRIFT: 0.1.25 note gains the unseen-run `office.run {from: null, last_run}` and qualifies the leaving-run sentence — patches for review findings 1–2 — affects: 30-5-the-board-screen, 30-6-the-status-screen-and-the-home

### pass 3 (2026-10-19, follow-up review patches)

- planned (Tasks): `lastEventAt` set on an applied snapshot or delta / actual: a snapshot sets it only when it is the first or changes the view's content / why: watchdog reconnect snapshots reset AC2's time since the last event / may affect: none
- planned (0.1.25 note): from-null `office.run` when a project's `last_run` changes run / actual: on any `last_run` field change, and stated not to be a live-set entry / why: a PR arriving after the run ended was never sent / may affect: 30-5, 30-6

Implementer score: 1. Consult score: 2 (B widens an existing kind's emission inside the 0.1.25 note). Story `deviation_score` stays 2.

DRIFT: lastEventAt is set by a snapshot only when it changes the view (first snapshot, or changed content) — a watchdog reconnect snapshot every 15 s reset AC2's time-since-last-event — affects: none
DRIFT: 0.1.25 note: a from-null office.run fires on any last_run field change (e.g. a PR arriving after the run ended) and is not a live-set entry — fixes review pass 3 — affects: 30-5-the-board-screen, 30-6-the-status-screen-and-the-home

### pass 4 (2026-10-19, follow-up review patches)

- planned: patch only the three findings' files / actual: also `apps/supervisor/src/api.ts` (comment only), outside Files / why: a review finding on a stale doc of a surface this story shipped; consult ruled apply / may affect: none
- planned: raise the bubbles' zIndex only / actual: also the OfficeScreen root from `position: fixed` to `absolute` (still `inset: 0`) / why: a fixed root is its own stacking context, so no child could stack above App's debug panel / may affect: none

Implementer score: 1. Consult scores: 1 and 1. Story `deviation_score` stays 2.

DRIFT: apps/supervisor/src/api.ts route header comment names `reason` and `last_run` (0.1.25) — a doc-only patch for a review finding, outside Files — affects: none
DRIFT: OfficeScreen root went from position fixed to absolute (z-index auto) so the bubbles (z 3) can stack above App's fixed debug panel (z 2); it still fills the viewport through html/body/#root at 100% — review pass 4 AC1 bubble patch — affects: none

## Consult Log

- 2026-10-19T20:14:11Z — trigger: deviation-gt-0 + file-outside-files — question: accept the five pass-1 deviations (page.ts outside Files, fixture updates, placeDesks opts/cutSheet, canvas moved to OfficeScreen, 0.1.25 bump taken by 30.4)? — ruling: accept-deviation score 2 — do: accept all five (#1–#4 local, #5 seam → story score 2), keep the DRIFT lines; carry forward to 30-5/30-6 that they extend the existing 0.1.25 entry (`/board`, `/status`) without a second bump, correcting SPEC.md:111; proceed to review/verify with conformance and test_driver_contract green at 0.1.25 — rule candidate: when an operator ruling moves a contract bump earlier, the planner rewrites the SPEC Assumption and later plans to "extend the existing entry, no new bump" in the ruling commit, and the implementer records it as a score-2 DRIFT without a consult
- 2026-10-19T20:30:14Z — trigger: deviation-gt-0 (pass 2) — question: accept pass-2 deviations (A recency guard, B contract note for the unseen-run last_run delta) and defer finding 6 (contract-pinned epic-only progress)? — ruling: accept-deviation score 2 — do: accept A (1) and B (2, seam); keep the DRIFT line; leave C unpatched and file it as a category-(a) deferral naming driver-contract.md:151; carry B forward to 30-5/30-6 (office.run from:null may carry a never-live terminal run; count live runs with state !== null && LIVE_RUN_STATES.has(state)) — rule candidate: a review finding against a pinned consumer rule in the driver contract is a category-(a) deferral with no consult; a patch extending an operator-ruled additive note is a score-2 DRIFT with no consult

- 2026-10-19T20:44:53Z — trigger: deviation-gt-0 (follow-up pass 3) — question: accept A (lastEventAt set by a snapshot only when it changes the view, score 1) and B (supervisor emits the from-null office.run on any last_run field change, 0.1.25 note says so and that it is not a live-set entry)? — ruling: accept-deviation score 2 — do: accept A at score 1 with its DRIFT line (affects: none); accept B as its own score-2 DRIFT line (affects 30-5, 30-6), carrying forward that a consumer may receive a second from-null office.run for a run_id it already holds as last_run and must replace, not append; leave deviation_score at 2, version 0.1.25, the 0.1.24 sentence unchanged, and verify with conformance and test_driver_contract green — rule candidate: a review patch that widens an existing kind's emission condition inside an operator-ruled additive contract note, adding no field, kind or id, is a new score-2 DRIFT line naming its consuming stories, with no consult; a client change that drops an identical-content reconnect snapshot from a since-last-event clock is score 1, with no consult


- 2026-10-19T20:52:55Z — trigger: file-outside-files (follow-up pass 4) — question: apply the low-severity review patch to the `GET /office` header comment in apps/supervisor/src/api.ts (outside Files) or reject it? — ruling: apply — do: edit only the api.ts:29-30 comment to name `last_run` on the snapshot and `reason` on agent rows, no code change; add a score-1 DRIFT line (affects: none), leave deviation_score, 0.1.25 and the contract as they are; log the finding as patch and verify as before — rule candidate: a review `patch` that only corrects a code comment or docstring outside the plan's Files list, so it matches a surface the story already shipped, is applied with a score-1 DRIFT line (affects: none) and needs no consult
- 2026-10-19T20:57:25Z — trigger: deviation-gt-0 (follow-up pass 4) — question: accept the OfficeScreen root's change from position fixed to absolute (z-index auto), made so the bubbles (z 3) can stack above App's fixed debug panel (z 2), or reject it in favour of changing App.tsx's panel? — ruling: accept-deviation score 1 — do: keep position absolute on the root and zIndex BUBBLE_Z (3) on the bubbles, change nothing in App.tsx; record the DRIFT line (affects: none); keep the score at 1, the story's deviation_score stays 2 — rule candidate: in studio-web, a screen root that hosts DOM overlays meant to rise above App-level panels uses position absolute (z-index auto), never fixed; switching between the two to fix overlay stacking is a score-1 deviation with no consult

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was follow-up review pass 4 over story 30.4 as committed, from baseline `88e1c074f9255a93db0f5996c19e9a0ac846d520` to HEAD `e774a2f90913b5da97ee093cabb30e0da3ae4b3f`. The story itself is unchanged; passes 1–3 above record it. This pass applied three review patches:
- the `reading` pose now visibly loops at its desk;
- the waiting and blocked bubbles are no longer hidden under the debug panel;
- the `GET /office` route comment names the 0.1.25 fields.

It also deferred one finding: the engine run id stays "—" for a run that launches after the snapshot.

**Files changed this pass (6).**
- `apps/studio-web/scripts/make-placeholder.ts`: the reading book and its page change moved from character row 10, which the desk covers, to row 9. A comment states which pixels the desk hides.
- `apps/studio-web/public/sprites/placeholder.png`: regenerated, byte-reproducible.
- `apps/studio-web/src/renderer/scene.test.ts`: decodes the committed png and asserts two things: each state's two frames differ at a pixel the desk leaves visible, and all eight sets are distinct.
- `apps/studio-web/src/office/OfficeScreen.tsx`: bubbles use `BUBBLE_Z` (3), and the root went from `position: fixed` to `absolute`.
- `apps/supervisor/src/api.ts`: only the `GET /office` header comment changed. It now names `reason` and `last_run`.
- This spec.

**Review.** Both layers ran (band L). The Blind Hunter raised 4 findings and the Edge Case Hunter raised none.
- 3 patches applied (2 medium, 1 low).
- 1 deferred (category (a): AC2's engine run id, against the pinned `office.run` delta shape).
- 0 rejected.
- Two consults were held: file-outside-files ruled `apply`, and deviation-gt-0 ruled `accept-deviation score 1`.
- The existing deferred item (the new-run phase "—") is unchanged.

**Follow-up review.** Patched: high 0, medium 2, low 1. The score is 3×2 + 1 = 7, which is 5 or more, so `followup_review_recommended: true`.

**Verification** (re-run by this session after the patches).
- Lib suite (`plugins/tk-studio/lib`): 1415 tests OK (2 skipped). Conformance: top-level `ok: true`.
- Web, in a /tmp copy of the tracked and untracked files: `bun run sprites` gives byte-identical output (`cmp` OK). `bun run verify` builds and passes vitest 86/86 (5 files).
- Supervisor, in the /tmp copy: `bun install --frozen-lockfile` OK and `bun run typecheck` clean. `bun test` gives 897 pass, 8 fail. The 8 are the same set recorded in pass 3, caused by the /tmp location: one unnamed test, queue database placement, MCP `--force-starter`, and five `release: sbx stop` tests. The implementer's run of `office.test.ts` passed 53/53.
- `Assets.load(` has one hit (scene.ts:64). `new EventSource(` has one hit (stream.ts:148).

**unverifiable-here.**
- Host leg: `uv run python tools/verify_host.py`, which is binding. In-worktree `bun install` hits EPERM because the sandbox refuses symlinks. Run it on the host and expect `verify_host: ok (lib suite, conformance, studio-web)`.
- The attended look of the reading loop at the desk, and of the bubbles over the first desk row next to the debug panel.

**Residual risks.**
- Two deferrals stand: the new-run phase "—" and the new-run engine id "—". Both need an additive office delta field, which is a contract or operator decision.
- A bubble over the first desk row can still clip off the top of the viewport at a large zoom. It is no longer hidden under a panel.
- No component test covers OfficeScreen's bubble stacking.

DRIFT: lastEventAt is set by a snapshot only when it changes the view (first snapshot, or changed content) — a watchdog reconnect snapshot every 15 s reset AC2's time-since-last-event — affects: none
DRIFT: 0.1.25 note: a from-null office.run fires on any last_run field change (e.g. a PR arriving after the run ended) and is not a live-set entry — fixes review pass 3 — affects: 30-5-the-board-screen, 30-6-the-status-screen-and-the-home
DRIFT: apps/supervisor/src/api.ts route header comment names `reason` and `last_run` (0.1.25) — a doc-only patch for a review finding, outside Files — affects: none
DRIFT: OfficeScreen root went from position fixed to absolute (z-index auto) so the bubbles (z 3) can stack above App's fixed debug panel (z 2); it still fills the viewport through html/body/#root at 100% — review pass 4 AC1 bubble patch — affects: none

## Reconcile

### 2026-10-19 — adjust-stories

- Score: 2
- Reasoning: Three deviations touch later work: the 0.1.25 bump that SPEC assigned to 30.5, now taken by 30.4 with the from-null `office.run` note; the `cutSheet`/`placeDesks(opts)` seam and the png-decoding scene test; and the Pixi canvas living in OfficeScreen.tsx. No later acceptance criterion changes. 30.5 AC1 ("named in the contract's §1 web surfaces at 0.1.25") and 30.6 AC3 ("`GET /board` among the web surfaces (0.1.25, additive)") still hold as appends to the existing entry, as in the 26-1 → 26-3/26-5 precedent. The contract changes are the operator's ruling (session 11, option (a)), so no invariant is contradicted. The other DRIFT lines say `affects: none` and are local.
- Affected: 30-5-the-board-screen — SPEC Assumptions "30.5 takes the one bump to 0.1.25 naming `GET /board`"
- Affected: 30-6-the-status-screen-and-the-home — SPEC Assumptions "30.6 extends that same 0.1.25 entry with `GET /status`" (the entry now belongs to 30.4); also "the Office screen opens by default; the last screen is remembered per browser" now has to mount OfficeScreen, which owns the canvas
- Affected: 30-7-our-own-assets — "the renderer's frame sets come from the atlas by name" now replaces `cutSheet`, and `scene.test.ts` decodes the placeholder png that 30.7 deletes
- Invariant: none (the operator ruling of 2026-10-19 session 11 covers the 0.1.25 extension)


Gate: Part A adjust-stories; Part B story accepted, planned 30-5-the-board-screen
