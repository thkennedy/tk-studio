---
title: 'The Live Stream in the Browser'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '9f9458d88c6974b72132dd5b0454a6f8ba5876d3'
deviation_score: 2
review_loop_iteration: 0
followup_review_recommended: false
# Operator ruling 2026-10-19 (session 11): the story stands; 30-4 extends the office projection additively
# (agent reason, last ended run with its PR; contract 0.1.25) and the ruling is recorded in its replan note.
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-3.md'
  - '{project-root}/_bmad-output/specs/spec-epic-30/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The studio web (30.1 spike, served under `/app/` by 30.2) shows nothing the supervisor knows. Story 30.3 (CAP-7…9): as the operator watching the office, I want the web to hold one event stream per tab that survives sleeps and backgrounding, so that what the office shows is what the supervisor knows, on desktop and on the iPad (§6.3).

**Approach:** A pure client store (`src/live/store.ts`) folds the supervisor's `GET /office/events` stream (snapshot, then `office.agent` / `office.progress` / `office.run` deltas, ids `<boot>-<seq>`); a stream module (`src/live/stream.ts`) owns the one `EventSource`, the 15 s / `visibilitychange` watchdog and a capped backoff; `App.tsx` mounts it once and the HUD shows the stream status. Web-only.

### Acceptance criteria (verbatim, epics.md "### Story 30.3")

- **AC1:** **Given** a signed-in tab **When** the web mounts **Then** it opens one `EventSource` on `GET /office/events` (Story 29.3's stream), applies the `event:snapshot` first and every `office.agent`, `office.progress` and `office.run` delta after it into one client store, and reconnects with `Last-Event-ID` after a drop so no delta is lost or applied twice (the store ignores an id at or below the last applied)
- **AC2:** **Given** no event for 15 seconds, or the tab returning from the background (`visibilitychange` to visible) **When** the watchdog fires **Then** the stream is closed and reopened with the last id, the HUD shows "reconnecting" until the snapshot arrives, and the store's state is never cleared in between (iPad Safari backgrounds streams the way iOS does)
- **AC3:** **Given** the store **When** it is tested **Then** vitest covers the snapshot, each delta kind, a duplicate delivery, a gap filled by a resume, and the watchdog's reopen, with a fake `EventSource`

## Boundaries & Constraints

**Always:** The stream URL is the absolute `/office/events` (30.2 injects `<base href="/app/">`; a relative URL hits the SPA fallback). Exactly one `new EventSource(` in non-test source, in `stream.ts`; one open source at a time (old closed before new opens). A snapshot replaces `view` atomically and rebases `lastId`; the view is never set to null/empty on reconnect. A delta applies only when its boot equals `lastId`'s boot and its seq is greater. DOM dependencies (`EventSource`, visibility source, timers) are injectable; defaults `globalThis.EventSource` and `document`. Types mirrored, not imported, from `apps/supervisor`. Files are exactly the plan's six (below).

**Block If:** Honouring "the last id" on the watchdog's reopen is judged to need a supervisor or contract change (a `?last_event_id=` query, a named heartbeat event). The Files list must grow past six (oversize, band L).

**Never:** Touch `apps/supervisor`, `plugins/tk-studio/contracts`, `SPEC.md`, the renderer (`src/renderer/*`). Add a query parameter to the stream URL. Add a web dependency (if one became unavoidable, `bun.lock` must be regenerated and committed — treat as a deviation). Push, tag, or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Snapshot | `snapshot` id `b-5`, `{at,agents,runs,problems,id}` | view = data (without `id`), lastId `b-5`, status `live` | — |
| Agent delta | `office.agent` `b-6`, known agent | agent row updated (state, current_run, current_story) | — |
| New agent | `office.agent` with `from:null`, unknown id `proj/dev` | row added, project `proj`, role `dev` derived from `agent_id` | — |
| Progress before run | `office.progress` for unseen `run_id` | run row created (`state` unknown until `office.run`, `engine_run_id: null`), epic set; `story` merged by `key` when present | — |
| Run leaves | `office.run` with `state` null or not in `queued|running|paused|external` | run dropped from `runs` | — |
| Duplicate | delta id `b-6` when lastId is `b-6` or later | ignored | — |
| Stale boot | delta `a-9` when lastId is `b-2` | ignored | — |
| New boot snapshot | snapshot `c-1` after `b-40` | view replaced, lastId `c-1` | — |
| Unknown kind / malformed id | anything else | ignored | no throw |
| Drop + resume | browser reconnect (readyState CONNECTING) replays `b-6..b-9` overlapping `b-6` | status `reconnecting` then deltas apply; overlap ignored; no gap | browser retries itself |
| Watchdog | 15 s no event, or `visibilitychange` → visible | status `reconnecting`, old source closed, one new source; view intact until snapshot sets `live` | — |
| Given up | `error` with readyState CLOSED (401/503) | `reconnecting`; reopen after 1 s doubling, cap 30 s; reset by a snapshot | — |

</intent-contract>

## Code Map

- `apps/supervisor/src/api.ts:378-415` (READ-ONLY) -- `officeSse`: frames `id:<boot>-<seq>\nevent:<kind>\ndata:<json>`; first frame `event:snapshot` with data `{at, agents, runs, problems, id}`; a valid `Last-Event-ID` header replays buffered deltas after it with NO snapshot; `: heartbeat` is an SSE comment every 10 s (never fires a listener). 401 JSON with no session → `EventSource` ends CLOSED, browser does not retry.
- `apps/supervisor/src/office.ts:632` (READ-ONLY) -- `since(id)`: null (fresh snapshot) for malformed / other-boot / ahead / older-than-1000-ring ids. A restart is a new boot.
- `apps/supervisor/src/office.ts:20,266,292-298,499` (READ-ONLY) -- types to mirror: `OFFICE_STATES` (8), `LIVE_RUN_STATES`, `OfficeStory {key,title?,status,phase,overlay,extra?}`, `OfficeEpic`, `OfficeRun {run_id,project,state,engine_run_id,epic,stories}`, `OfficeAgent {agent_id,project,role,state,current_run,current_story}`, `OfficeView {at,agents,runs,problems}`.
- `apps/supervisor/src/office.ts:585-615` (READ-ONLY) -- delta payloads and order inside one poll (agents, then progress, then runs): `office.agent {agent_id,state,from,at,current_run,current_story}`, `office.progress {run_id,epic,story?}`, `office.run {run_id,project,state,from}`; a leaving run gets `office.run` with its queue state or null. Deltas never carry `engine_run_id`/`title`: keep snapshot values, `null` for runs born after it. A departed agent gets no event (next snapshot drops it).
- `apps/studio-web/src/App.tsx:20-87` -- the one `useEffect` mount; HUD at `:89-107` (zoom, ratio, fps lines kept). `src/main.tsx` wraps in `StrictMode` (double mount in dev).
- `apps/studio-web/vite.config.ts` -- `base: "/app/"` + injected `<base href="/app/">`; vitest `environment: "node"`, `include: ["src/**/*.test.ts"]` (no DOM: inject deps, or use `vi.useFakeTimers()`).
- `apps/studio-web/package.json` -- `verify` = `bun install --frozen-lockfile && bun run build && bun run test`; no new dependency expected.

## Tasks & Acceptance

**Execution:**
- `apps/studio-web/src/live/store.ts` -- new: mirrored types, `LiveId`, `parseId("<boot>-<seq>")` (null on malformed; boot may itself contain `-`, so split on the LAST `-`), `createOfficeStore()` with `getState()`, `subscribe(fn)` (returns unsubscribe; `getState` returns a stable reference between changes for `useSyncExternalStore`), `applySnapshot(id, data)`, `applyDelta(id, kind, data)`, `setStatus(s)`; state `{view, lastId, status: "connecting"|"live"|"reconnecting"}` -- the store's rules per the Matrix.
- `apps/studio-web/src/live/stream.ts` -- new: `WATCHDOG_MS = 15_000` exported; `openOfficeStream(store, deps?)` → `{close()}`; one `EventSource("/office/events")`, `addEventListener` on `snapshot`, `office.agent`, `office.progress`, `office.run` and `error`; each listener parses `ev.data` (bad JSON ignored) and uses `ev.lastEventId`; watchdog re-armed on every event; `visibilitychange` visible fires it; CLOSED-error backoff 1 s ×2 cap 30 s reset by snapshot; `close()` clears every timer and listener and closes the source.
- `apps/studio-web/src/live/store.test.ts` -- new: snapshot; each delta kind incl. new agent derivation, progress before run, run leaving; duplicate and stale-boot ignore; snapshot rebase on new boot; unknown kind; `parseId`.
- `apps/studio-web/src/live/stream.test.ts` -- new: fake `EventSource` class recording instances/URL/`close()` and dispatching named events with `lastEventId`; covers URL `/office/events`, a gap filled by a resume (drop → CONNECTING error → replay with overlapping duplicate), the 15 s watchdog reopen, the `visibilitychange` reopen, "reconnecting" until the snapshot with the view intact, one open source at a time, CLOSED-error backoff, `close()`.
- `apps/studio-web/src/App.tsx` -- modify: module-level or ref-held store; open the stream in a `useEffect` closed in its cleanup (StrictMode leaves one open source); `useSyncExternalStore`; HUD gains one line: `stream live` / `connecting` / `reconnecting` plus agent and live-run counts.
- `apps/studio-web/README.md` -- modify: section "The live stream (Story 30.3)": the absolute URL, the store's rules, the watchdog and backoff, the heartbeat-is-a-comment consequence.

**Acceptance Criteria:**
- Given the built web, when `grep -rn "new EventSource(" apps/studio-web/src --include=*.ts --include=*.tsx | grep -v test` runs, then exactly one hit, in `stream.ts`, with the absolute `/office/events`.
- Given AC1–AC3, when `bun run verify` runs in a /tmp copy of the committed `apps/studio-web` files, then build passes and vitest covers each Matrix row.
- Given the change, when `git diff main --stat -- apps/supervisor plugins/tk-studio/contracts` runs, then it is empty.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 10 (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` Edge Case Hunter: after a drop on a quiet office the browser's own Last-Event-ID resume replays nothing and sends no snapshot, so the HUD sat on "reconnecting" up to 15 s on a healthy stream. Fixed: `open` on a source that was open before and has delivered an event sets `live`; a fresh source's first `open` never does (AC2 kept). Two new vitest cases.
- rejected (one line each):
  - watchdog re-armed by rejected deltas (stale boot after restart): the supervisor answers an other-boot Last-Event-ID with a snapshot (`office.ts:632` `since` → null), so the scenario does not arise.
  - store accepts any higher seq, no gap detection: AC1's rule is "ignores an id at or below the last applied"; the supervisor replays exactly or sends a snapshot (ring overflow → null).
  - HUD flips to reconnecting every 15 s on a quiet office: plan 30-3's accepted v0 residual (heartbeat is an SSE comment); named under residual risks.
  - every visibilitychange-to-visible reopens: AC2 taken literally.
  - snapshot id from `ev.lastEventId` not `data.id`: the snapshot frame carries an `id:` line (`api.ts:408`).
  - agent state / epic / story shapes not validated: plumbing, not a criterion.
  - late `office.progress` leaving a ghost run: the supervisor emits progress only for runs in the live set, followed by `office.run` (`office.ts:600-612`).
  - backoff reset on a rejected same-id snapshot: plumbing, no criterion affected.
  - `OFFICE_EVENTS_URL` unused by `open()`: deliberate literal for the one-source grep; tests assert the URL.
  - `error` with readyState OPEN: not a state EventSource reports on error.
- skipped-layer: none (band L, both layers ran)

## Design Notes

**Ruling (plan 30-3, pre-recorded, score 1):** "reopened with the last id" — a fresh `EventSource` cannot set `Last-Event-ID`; only the browser's own reconnect on the same object resends it (AC1's drop-and-resume). The watchdog's reopen is a new object, so the supervisor answers with a snapshot, which AC2 names ("until the snapshot arrives"). The store keeps `lastId` across the reopen and rebases on the snapshot, so no delta applies twice. Recorded as `DRIFT … affects: none`; no query parameter, no supervisor change.

**Heartbeat:** `: heartbeat` is a comment, so on a quiet office the watchdog reopens every 15 s (one snapshot, a brief "reconnecting"). AC2 taken literally; acceptable for v0; residual risk.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `git ls-files -co --exclude-standard apps/studio-web | tar -cT - | tar -xC /tmp/v303 && cd /tmp/v303/apps/studio-web && bun run verify` -- expected: install, build, vitest green (in-worktree gate unverifiable-here: sandbox refuses symlinks).
- `grep -rn "new EventSource(" apps/studio-web/src --include=*.ts --include=*.tsx | grep -v test` -- expected: one hit, `stream.ts`.
- `git diff main --stat -- apps/supervisor plugins/tk-studio/contracts` -- expected: empty.
- Host (binding, operator): `uv run python tools/verify_host.py` -- expected: `verify_host: ok (lib suite, conformance, studio-web)`.

**Manual checks (unverifiable-here):**
- iPad: open `/app` signed in, background Safari > 1 min, return: HUD "reconnecting" then "stream live", agents/runs not blanked. A real supervisor: a run's state change appears without reload.

## Deviation Summary

### pass 1 (2026-10-19, implementer)

- planned: mirrored `OfficeRun.state: string` / actual: `state: string | null`, null marking a row created by `office.progress` before its `office.run` / why: the matrix's "state unknown until `office.run`" needs a typed representation / may affect: 30-4
- planned: status returns to `live` on a snapshot (the resume row does not name when "reconnecting" ends) / actual: an applied delta also sets `live` / why: a `Last-Event-ID` resume replays deltas with no snapshot, so the HUD would otherwise stay "reconnecting" until the next watchdog; a watchdog reopen still shows "reconnecting" until its snapshot / may affect: none
- planned: no rule for an `office.run` naming an unseen run / actual: creates a row (`engine_run_id: null`, empty epic, no stories) / why: keeps the live-run count right if the progress was missed / may affect: 30-4
- planned: literal `/office/events` / actual: same literal behind an exported `OFFICE_EVENTS_URL` constant, plus exported backoff constants / why: readability and testability; the grep still finds one hit / may affect: none
- planned (plan 30-3 ruling): watchdog "reopened with the last id" / actual: a fresh `EventSource` gets a snapshot; `lastId` kept and rebased / why: a new `EventSource` cannot set `Last-Event-ID`; AC2 names the snapshot outcome / may affect: none

DEVIATION SCORE: 1 (implementer); 2 after consult (entries #1 and #3 are seams 30-4 consumes)

DRIFT: OfficeRun.state mirrored as `string | null` — a progress-created row has no state until its office.run — affects: 30-4 (seam: Office screen must render state null and runs with an empty epic and no stories)
DRIFT: an applied delta sets status `live` — a Last-Event-ID resume sends no snapshot — affects: none
DRIFT: office.run for an unseen run creates a row — keeps the live-run count right — affects: 30-4 (seam: Office screen must render state null and runs with an empty epic and no stories)
DRIFT: exported OFFICE_EVENTS_URL and backoff constants — readability and tests — affects: none
DRIFT: watchdog reopen gets a snapshot, not a Last-Event-ID replay — a fresh EventSource cannot set the header (plan 30-3 ruling) — affects: none

### pass 2 (2026-10-19, review patch)

- planned: on a browser reconnect `open`, set `live` when the source was open before and the store has a lastId / actual: also requires the same source to have delivered an event (`sourceHeard`) / why: a source that dropped before any event has no Last-Event-ID, so the supervisor sends a snapshot and AC2's "reconnecting until the snapshot" must hold / may affect: none
- planned: the fake EventSource dispatches `open` / actual: a `connect()` that `emit()` calls when still connecting; the gap-fill test calls `es.connect()` first / why: a real browser fires `open` before any frame / may affect: none

DEVIATION SCORE: 1 (pass 2); story score stays 2

DRIFT: browser-resume `open` sets live only after the same source delivered an event — a never-heard source gets a snapshot — affects: none

## Consult Log

- 2026-10-19T19:40Z — trigger: deviation-gt-0 — question: accept the implementer's five deviations (state null, delta sets live, unseen office.run row, exported constants, watchdog snapshot ruling) and their score? — ruling: accept-deviation score 2 — do: accept all five (#1=2, #2=1, #3=2, #4=1, #5=1), story score 2; DRIFT #1/#3 name the 30-4 seam; no code change, do not hold "reconnecting" until a snapshot on a browser-native resume — rule candidate: any deviation that widens a mirrored type or the client store's row shape a later story consumes scores at least 2 and its DRIFT line names that story and the new nullable fields
- 2026-10-19T19:46Z — trigger: deviation-gt-0 — question: accept the review patch's sourceHeard guard and the fake EventSource connect() fixture? — ruling: accept-deviation score 1 — do: keep the sourceOpened && sourceHeard guard and the flag reset in open(); keep connect() and the explicit es.connect() calls; proceed, no spec or contract change — rule candidate: when a patch gates a status change on "the browser resumed", count it as a resume only if the same source delivered an event (score 1, no consult)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** The studio web now holds one `EventSource` per tab on the absolute `/office/events` (30.2's `<base href="/app/">` makes relative URLs wrong) and folds it into one client store. A snapshot replaces the view atomically and rebases `lastId`. A delta applies only on the same boot with a higher seq, so duplicates and stale boots are ignored. A 15 s watchdog, re-armed on every event and fired on `visibilitychange` to visible, closes the source and opens one new one with the view intact ("reconnecting" until the snapshot). When the browser gives up (CLOSED, e.g. 401/503), the stream reopens with a 1 s → 30 s backoff that a snapshot resets. On the browser's own reconnect, the browser resends `Last-Event-ID` and the supervisor replays the missed deltas. The HUD gains a stream line (status, agents, live runs). Web-only.

**Files changed (6, exactly the plan's Files).**
- `apps/studio-web/src/live/store.ts`: new. Holds the mirrored office types, `parseId` (splits on the last `-`), and `createOfficeStore` (`getState`/`subscribe`/`applySnapshot`/`applyDelta`/`setStatus`).
- `apps/studio-web/src/live/stream.ts`: new. `openOfficeStream(store, deps?)` owns the one source, its listeners, the watchdog, the backoff and the browser-resume `open`.
- `apps/studio-web/src/live/store.test.ts`: new. Tests the snapshot, each delta kind, duplicate and stale-boot deltas, the rebase on a new boot, and unknown kinds and ids.
- `apps/studio-web/src/live/stream.test.ts`: new, with a fake `EventSource`. Tests the URL, a gap filled by a resume, the 15 s and visibility reopens, "reconnecting" until the snapshot, one source at a time, the backoff, `close()`, and the quiet resume.
- `apps/studio-web/src/App.tsx`: mounts the stream in one `useEffect` (StrictMode-safe), reads the store with `useSyncExternalStore`, and adds the HUD stream line.
- `apps/studio-web/README.md`: new section "The live stream (Story 30.3)".

**Review.** Both layers ran (band L). 1 low patch applied, 0 deferred, 10 rejected (see the Review Triage Log). Two consults on deviation-gt-0: both accepted, giving a story score of 2.

**Follow-up review.** Patched: high 0, medium 0, low 1. Score 3×0 + 1 = 1, below 5, so `followup_review_recommended: false`.

**Verification.**
- Lib suite (`plugins/tk-studio/lib`): 1414 tests OK (2 skipped). Conformance: `ok: true`.
- Web, in a /tmp copy of exactly the files git commits (`git ls-files -co --exclude-standard apps/studio-web | tar …`): `bun run verify` installed from the frozen lockfile, built, and passed vitest 52/52 (3 files). No new dependency, so `bun.lock` is unchanged.
- `grep -rn "new EventSource(" apps/studio-web/src … | grep -v test`: one hit, `stream.ts`, `/office/events`.
- `git diff main --stat -- apps/supervisor plugins/tk-studio/contracts`: empty.
- Every I/O-matrix row has a covering test, and all of them ran and passed.

**unverifiable-here.**
- In-worktree studio-web gate: the sandbox refuses symlinks (`bun install` EPERM). Host command: `uv run python tools/verify_host.py`, expecting `verify_host: ok (lib suite, conformance, studio-web)`. This host leg is binding.
- The iPad attended check: open `/app` signed in, background Safari for over a minute, then return. Expected: the HUD shows "reconnecting", then "stream live", and agents and runs are not blanked in between.
- Against a real supervisor: a run's state change appears without a reload.

**Residual risks.**
- `: heartbeat` is an SSE comment and fires no listener. On a quiet office the watchdog therefore reopens every 15 s, costing one snapshot and a brief "reconnecting" each time. A named heartbeat event is a supervisor and contract change, a candidate for the 0.1.25 bump (30.5/30.6).
- Every return to visible reopens the stream, even after a short hide.
- 30-4 must render a run with `state: null` (created by progress before its `office.run`) and a run with an empty epic and no stories.

DRIFT: OfficeRun.state mirrored as `string | null` — a progress-created row has no state until its office.run — affects: 30-4
DRIFT: office.run for an unseen live run creates a row (engine_run_id null, empty epic, no stories) — keeps the live-run count right — affects: 30-4
DRIFT: an applied delta, or the browser's own reconnect `open` on a source that has delivered an event, sets status `live` — a Last-Event-ID resume sends no snapshot — affects: none
DRIFT: exported OFFICE_EVENTS_URL and backoff constants — readability and tests — affects: none
DRIFT: watchdog reopen gets a snapshot, not a Last-Event-ID replay — a fresh EventSource cannot set the header (plan 30-3 ruling) — affects: none

## Reconcile

### 2026-10-19 — escalate

- Score: 2
- Reasoning: DRIFT #1 and #3 (`OfficeRun.state: string | null`; an `office.run` for an unseen run creates a row with `engine_run_id: null`, an empty epic and no stories) are seams that 30-4 and 30-6 read. Notes in their `invoke_dev_with` can absorb them (queued below). The other three DRIFT lines touch nothing later. Escalated because 30-4's criteria need data that this story's store, and the 0.1.24 projection it mirrors, do not carry. `OfficeAgent` has no reason field, and the stream holds no ended run and no PR. Meeting those criteria means either a new supervisor or contract field, or the web reading `GET /runs/{id}` / `GET /jobs`. The first contradicts the epic narrative ("extended here only by the board's read"); the second contradicts SPEC Constraints ("The web consumes only the supervisor's own surfaces named in contract §1 (0.1.24…)"). Otherwise 30-4's acceptance criteria must change, and that is the operator's `bmad-correct-course`.
- Affected: 30-4-the-office-screen — "`waiting-for-human` and `blocked` add a React DOM bubble over the character naming what it waits for (the projection's reason)"
- Affected: 30-4-the-office-screen — "with no live run it shows the last ended run's end state and PR link"
- Affected: 30-4-the-office-screen / 30-6-the-status-screen-and-the-home — the store's run rows may hold `state: null`, `engine_run_id: null`, an empty epic and no stories (seam only; queued)
- Invariant: SPEC.md Constraints bullet 2 (web consumes only contract §1 0.1.24 surfaces plus `/board`, `/status`); epic 30 narrative (§1 extended only by the board's read); no AD contradicted by 30-3 itself


Gate: Part A escalate; Part B story accepted, planned 30-4-the-office-screen (Block If: projection carries no agent reason, ended run or PR — operator ruling in the replan queue)
