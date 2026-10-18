---
title: 'The Office Projection: Semantic States, Progress and Its Stream'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_revision: '13df15984b5a4bb32409ba0669f93ef998b461a2'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-29/plans/29-3.md'
  - '{project-root}/_bmad-output/specs/spec-epic-29/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-epic-29/stories/29-2-the-agent-registry-spec.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** EP-30's office must render a live picture of each agent and each story without reading raw queue events or the engine's journal; the supervisor serves no semantic projection today (design spec §7.3, §6.3).

**Approach:** Story 29.3 (`_bmad-output/planning-artifacts/epics.md` § "Story 29.3: The Office Projection: Semantic States, Progress and Its Stream"), transcribed verbatim:

> **Given** the queue's events of a run and the engine's journal in the run's served root (`.bmad-loop/runs/<engine run id>/` at the bmad-loop pin of `bmad.lock`: the journal and run files the engine writes; the planner's Code Map names the exact files and kinds, read from the host side of the worktrees mount, never through the engine)
> **When** the supervisor projects them
> **Then** each agent of the registry has one of `offline`, `idle`, `thinking`, `reading`, `typing`, `running`, `waiting-for-human`, `blocked`, with the overlays `done` and `failed` per story, by one mapping table in `apps/supervisor/src/office.ts` (queued or lock-wait is `idle`; the launch and planner legs `thinking`; a dev session's implementer `typing` and its reviewers `reading`; the verify and host-verify legs `running`; `paused`, `awaiting-ruling` and an `escalate` `waiting-for-human`; a `blocked` run `blocked`; no run `offline`); promotion is instant, demotion goes through a grace timer (20 s, injectable), and `waiting-for-human` never expires on its own

> **Given** a run's stories (the spec folder's manifest at the run's base, the denominator fixed when the launch validated it)
> **When** the journal's terminal kinds land (a story landed, failed, deferred)
> **Then** progress per story and per epic is `done / total` with the current story named, and the quote band of §7.1 is not computed here (EP-32's)

> **Given** a consumer
> **When** it reads `GET /office` (a snapshot: the agents with their states, the live runs with story and epic progress, the time) or opens `GET /office/events` with `Accept: text/event-stream`
> **Then** the stream sends the snapshot first, then one event per state or progress change (`office.agent`, `office.progress`, `office.run`), honours `Last-Event-ID` (a reconnect replays from that seq, the snapshot again when it is too old), sends a heartbeat comment every 10 s, and closes cleanly on the client's close; the raw `GET /events` stream is unchanged; `bun test` pins the mapping table against recorded event and journal fixtures, the grace timer with an injected clock, the snapshot-then-deltas order, the replay and the heartbeat; the read-only status page shows each live run's agent states as text

## Boundaries & Constraints

**Always:**
- The planner's rulings in plan `29-3.md` are binding: the engine files and kinds (§ Code Map "The engine files"), the 11-row `OFFICE_MAP` (first match wins; unnamed roles `idle` while live, `offline` otherwise), the run-per-project selection, the denominator rule (first `stories-validated.count` entries of `<servedRoot>/<spec_folder>/stories.yaml`; later entries `extra: true`; no manifest → journal `story-start` keys), the per-story/per-epic shapes, the grace rank order, and § Settled shape (first frame `event:snapshot`; ids `<boot>-<seq>`; `overlay: "done"|"failed"|null`).
- `OFFICE_STATES` and `OFFICE_MAP` are exported once from `office.ts`; the table is the only place the mapping lives.
- Every registry agent (`readAgents(queue)`) appears exactly once in the projection.
- Reads files only: never through the engine, never spawns git, never writes the queue, `service_events` or the store. `GET /office`, `GET /office/events` and the status page write nothing.
- A missing run dir/file is "no engine signal", never an error; `problems[]` names only an unreadable file in an existing dir. An unparseable/partial last journal line is skipped silently.
- `graceMs` (20 000), `heartbeatMs` (10 000), `pollMs`, `bufferSize` (1000) and the clock are injectable.
- `live_state` is stamped at registry rebuild from the raw projection; a throwing projector stamps `offline` plus a problem and never fails the rebuild.
- Recorded fixtures carry no `prompt` field and no `policy_snapshot`, no credential.

**Block If:**
- An AC appears to need a change to the engine, `pipeline.py`, the driver contract, a queue event kind, a journal kind, or `GET /events` (consult; never do it).
- A recorded fixture would carry a credential or the story prompt and cannot be stripped (hand-make it instead and say so; block only if neither works).
- A design document contradicts a planner ruling (consult; DRIFT `affects: 29-4`).
- The Files list must grow beyond the plan's (consult `file-outside-files`).

**Never:**
- Edit `events()`/`sse()` in `api.ts` (`:291-346`) or factor them; the raw stream stays byte-identical.
- Compute the quote band or cost (EP-32), build web pages or sprites (EP-30), touch `plugins/`, `.bmad-loop/`, the engine, or `queue.ts` verbs/triggers.
- Persist office events to the queue.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No run | project with registry rows, no runs | all seven roles `offline` | none |
| Queued / lock-wait | run `queued` (± `lock-wait` event) | all `idle` | none |
| Launch | run `running`, `engine_run_id` null | `orchestrator` `thinking` | missing run dir = no signal |
| Dev / review / gate live | open journal session `role: dev` / `review` / gate `task_id` | `session`+`implementer` `typing` / `session`+`reviewer` `reading` / `planner`+`session` `thinking` | partial last line skipped |
| Engine verify | no open session, phase `dev-verify`/`review-verify`/`committing` | `session` `running` | none |
| Host verify | engine ended, no `host-verify` after latest `launched` | `orchestrator` `running` | none |
| Waiting | queue `paused`, `awaiting-ruling`, or escalation fixture | `orchestrator`+`session` `waiting-for-human`, never expires | none |
| Blocked | latest run `blocked`, no newer | `orchestrator`+`session` `blocked`, rest `offline` | none |
| Demotion | raw state drops at t0 | applied at t0+20 s, not at 19.9 s; bounce-back cancels | none |
| Progress | `inflight` fixture | epic 1/4, current story 29-2 | no manifest → journal keys |
| Replay | `Last-Event-ID` valid / too old / other boot / malformed | later deltas only / `event:snapshot` again | never errors |
| Wrong method | `POST /office` | 405 `Allow: GET` | JSON error |
| No auth | `GET /office` without bearer/cookie | 401 JSON | none |

</intent-contract>

## Code Map

The plan `_bmad-output/specs/spec-epic-29/plans/29-3.md` § Code Map is the full investigation (engine kinds with `<pkg>` line anchors, queue event kinds with `src/queue.ts` anchors, the mapping table, overlays/progress, grace, the `office.ts`/`api.ts`/`page.ts`/`registry.ts`/README changes, the fixture recipe). Verified anchors at baseline:

- `apps/supervisor/src/closeout.ts:255` -- `runDirOf` (unexported one-liner); export it or inline it in `office.ts`.
- `apps/supervisor/src/api.ts:291` `events()`, `:308` `sse()` -- read-only pattern for the new `officeSse`; `:506` cookie `readRoute`; `:546` bearer `/agents` route (add `/office`, `/office/events` beside); `:12-30` header route list; `:88-122` `ApiDeps`.
- `apps/supervisor/src/registry.ts:35` `OFFLINE`, `:71` `rowsFor` (gains optional live states), `:152` `RebuildDeps` (gains `live?`), `:174` `rebuildAgents`, `:225` `readAgents`.
- `apps/supervisor/src/page.ts:64-80` `PageData` (optional `office?`), `:164` `gatherPage`, `:389` `renderPage`, `:478` Agents section.
- `apps/supervisor/test/registry.test.ts` -- the only test file referencing `rowsFor(`/`rebuildAgents(`/`live_state` (asserts at `:74`, `:377`, `:424`).
- `apps/supervisor/test/api.test.ts:66` `fixture()` -- real `Queue` on a temp file for the queue side.
- `.bmad-loop/runs/20261018-010738-a250/{journal.jsonl,state.json}` (repo root of this worktree) -- the recorded source for `test/fixtures/office/inflight/`; read only.
- 29-2 DRIFT carried in: `rebuildQuietly` skips under `bun test` without injected deps; `queue.agents()` returns `{rebuilt_at, rows}`; the live leg skips a `routing.current.json` older than `run.created`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/office.ts` (new) -- `OFFICE_STATES`, `OFFICE_MAP`, cached `readJournal`/`readEngineState`, `projectOffice(queue, deps)`, `class OfficeHub` (grace, seq/boot ids, ring buffer, `refresh`/`snapshot`/`since`, poll only while subscribed) -- AC1, AC2, AC3.
- `apps/supervisor/src/closeout.ts` -- export `runDirOf` only (or leave untouched and inline) -- reuse.
- `apps/supervisor/src/api.ts` -- `GET /office`, `GET /office/events` (JSON snapshot without SSE accept; `officeSse` with snapshot-first or replay, heartbeat timer, abort cleanup), `ApiDeps` `office?`/`heartbeatMs?`/`graceMs?`, routes in cookie, bearer and header lists, `allow("GET")` otherwise -- AC3.
- `apps/supervisor/src/page.ts` -- `<section id="office"><h2>Office</h2>` per live run: run id, project, epic done/total, current story, `role: state` lines escaped with `t()` -- AC3.
- `apps/supervisor/src/registry.ts` -- `rowsFor` live states, `RebuildDeps.live` defaulting to raw `projectOffice`, throwing projector → `offline` + problem -- AC1 (29-2's `live_state`).
- `apps/supervisor/test/fixtures/office/**` (new) -- `inflight/` (recorded, stripped), `paused-escalation/`, `deferred/`, `complete/`, each `journal.jsonl` + `state.json`, plus a `stories.yaml` -- AC3 fixtures.
- `apps/supervisor/test/office.test.ts` (new) -- the plan's § Verify story-specific cases (mapping per row, grace, progress, stream, routes, page, registry) -- AC1–AC3.
- `apps/supervisor/test/registry.test.ts` -- adjust the `live_state` asserts for runless fixtures or add a live-state case.
- `apps/supervisor/README.md` -- HTTP API rows for `/office`, `/office/events`; "office projection (Story 29.3)" bullet (files/kinds, table, grace, denominator, ids/replay, consult/advisor `idle`, `live_state` at rebuild); status page row names the Office section.

**Acceptance Criteria:**
- Given each `OFFICE_MAP` row's fixture, when projected, then every registry agent has exactly the state the row names and `consult`/`advisor` stay `idle` while live.
- Given an injected clock, when the raw state promotes, demotes, bounces or waits, then promotion is instant, demotion lands at 20 s, a bounce cancels, and `waiting-for-human` survives an hour of ticks.
- Given the fixtures, when progress is computed, then `inflight` is 1/4 current 29-2, deferred and escalated count apart with overlays, a remediation entry is `extra` outside `total`, and no manifest falls back to journal keys.
- Given an SSE client, when it connects, then the first frame is `event:snapshot`, deltas follow in order (`office.agent`, `office.progress`, `office.run`), a valid `Last-Event-ID` replays exactly the later deltas, a stale/foreign id gets the snapshot, `: heartbeat` appears, and abort clears both timers.
- Given the existing `api.test.ts` SSE cases, when `bun test` runs, then they pass untouched.
- Given any GET of `/office`, `/office/events` or `/`, when served, then queue bytes and `MAX(seq)` are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-18 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` office `problems[]` carried absolute machine paths onto `/office` and the page (AD-15) — problems now run-relative, and the page passes every office problem through `machinePathsOut`; test with an unreadable journal
  - `[medium]` `[patch]` `awaiting-ruling` cleared only by `engine-resume`/`resumed`, so a close-out left `waiting-for-human` stuck — aligned with the page's ruling-end set (`close-out`, `close-out-failed`, `engine-resume`, `resumed`, `paused`); test
  - `[medium]` `[patch]` a newer queued run of another job masked the working run of the same project — `selectRun` prefers the newest non-queued live run; README rule updated; tests
  - `[low]` `[patch]` engine-file caches never shrank — pruned after each `projectOffice`, capped at 256; test
  - `[low]` `[patch]` the no-write test skipped the SSE branch — the stream is now opened, read and closed under the bytes/`MAX(seq)`/`service_events` assertion
  - `[low]` `[patch]` demotion with no subscriber started at the late GET — it starts from the last refresh when at least `graceMs` has passed since; test
  - `[low]` `[patch]` a pending demotion carried an old run's state to a new `current_run` — a `current_run` change applies the raw state at once; test

### 2026-10-18 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` `selectRun` let a newer running run of another job hide an older `paused` run (awaiting a ruling), so `waiting-for-human` vanished from the project's agents (AC1 "never expires on its own"). Now the newest `paused` live run wins first; README updated; test added
  - `[low]` `[patch]` the no-manifest fallback counted started keys beyond `stories-validated.count` (remediation) in done/total (could show 5/4). Keys after the first `count` are now `extra`; test added
  - `[low]` `[patch]` an engine-ended run with no queue `launched` (adopted `external`) held `orchestrator: running` forever in row 10. Host-verify is now pending only after a `launched`; row-10 text and README updated; test added
  - `[low]` `[patch]` the denominator used the LAST `stories-validated`, but the engine journals one per process (`stories_engine.py:103`), so a resume could grow `total` (AC2 "fixed when the launch validated it"). It now uses the first; test added
- rejected (one line each):
  - an escalation keeps `waiting-for-human` through a close-out: this is plan row 4 as ruled (journal `story-escalated` / `run-paused` unresolved). The engine is genuinely paused, and the plan pins that `story-escalated` is always followed by `run-paused`, so "escalates and continues" cannot occur at the pin
  - deltas cannot remove an agent, and `problems[]` is not streamed: the agent removal was accepted in consult 1, and the AC's stream kinds are `office.agent`/`office.progress`/`office.run` only
  - stream test gaps (`office.run` on leaving the live set; a too-old `Last-Event-ID` over HTTP): the behaviour is asserted at the hub level (`since()`), so this is plumbing, not an AC gap
  - `external` runs never read engine files: plan :99 rules that an external run reads the journal only "when `engine_run_id` is set"

### 2026-10-18 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` after a close-out relaunch, the fresh engine journal says nothing about stories that landed in earlier iterations (the old run dir is archived, and the engine's scheduler skips specs already `done` without journalling them), so epic `done / total` went backwards (AC2). `progress()` now counts an unsettled, non-current manifest story as `done` when its single story spec at the run's root has `status: done` (`specsDone`, the engine's own rule). The journal still wins and the denominator is unchanged; README updated; test added
  - `[low]` `[patch]` a close-out relaunch or engine resume keeps the old `engine_run_id` until the new engine's `launched` lands, so the launch leg showed orchestrator `idle` (row 11), or `running` (row 10) after an old `engine-gone` (AC1 "the launch ... legs `thinking`"). `launching` also holds when no `launched` has followed the latest `close-out`/`engine-resume` (`launchedSinceMove`); the row-5 text and README updated; test added. One existing test now expects `thinking` after a close-out, where it expected the archived engine's `typing`
  - `[low]` `[patch]` the status page said "no registry agents for this run" for every live run of a project other than the one `selectRun` picked, which hid where the agents were (AC3). The card now names the run holding the project's agents; the plain note stays only when the project has no agents; test added
  - `[low]` `[patch]` the `OFFICE_STATES` doc comment said "lowest grace rank first", which contradicts `OFFICE_RANK` (`blocked` < `waiting-for-human`). The comment is corrected; the array order is the story's and is unchanged
- rejected (one line each):
  - engine-end/host-verify stale after a resume: every relaunch or resume writes a fresh `launched` (`markLaunched`, `queue.ts:1508`) before its engine runs, and both checks key on the latest `launched`. The window before it is the row-5 patch above
  - total counts remediation entries before `stories-validated` lands: the window is the engine's first pick, right after `run-start`, and at launch the manifest holds only the launch's entries
  - no test for `office.run` when a run appears or leaves the live set: the AC's `bun test` list names the snapshot-then-deltas order, replay and heartbeat, not each `office.run` transition. This is plumbing (the same ruling as the follow-up pass)
  - a dropped agent stays as a ghost for stream consumers: consult 1 accepted that deltas never remove an agent (the same rejection as the follow-up pass)

## Design Notes

Planner rulings recorded in the plan and not appended to SPEC.md (gate rules forbid it): the role-per-leg table, the denominator rule, the frame/id shapes. SPEC Open Question 2 is answered by the pin: `story-deferred` exists; `story-skipped` counts as deferred; `story-escalated` is "failed". Detection limits recorded, not fixed: host-verify inferred (no start event), engine verify only through `state.json`, consult/advisor have no signal.

## Verification

**Commands:**
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test` -- expected: no failures beyond the 29-2 baseline (6 known: closeout `fakeStudioRoot`, five `sbx stop`); `office.test.ts` green.
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun node_modules/typescript/bin/tsc --noEmit` -- expected: exit 0.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `git diff --stat -- plugins/ .bmad-loop/` -- expected: empty.

## Deviation Summary

- Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-10-18, implementer)

- planned: `test/registry.test.ts` adjusted or given a live-state case / actual: untouched; runless `offline` asserts hold; live-state and throwing-projector cases live in `office.test.ts` / why: plan's Verify puts registry cases in `office.test.ts` / may affect: none
- planned: `RebuildDeps.live` defaults to raw `projectOffice` states / actual: defaults to new exported `officeStates(queue, runs?)` on the same projection core, fed the runs the rebuild already read / why: "the runs are read once per rebuild" test; agents from the old table are stale mid-rebuild / may affect: 29-4
- planned: inflight fixture copied with `prompt`/`policy_snapshot` stripped / actual: journal cut at line 26 (29-2 gate open); `state.json` tasks trimmed to 7 fields, 29-2 `review-verify` with `commit_sha` null, 29-3 dropped, `project` placeholder / why: reproduce the plan's state; keep machine paths/token counts out / may affect: none
- planned: one event per state or progress change / actual: `office.agent` also fires on `current_run`/`current_story` change; a new run sends an epic-only `office.progress` with its `office.run`; an agent leaving the registry is dropped without an event / why: delta-only clients get those fields / may affect: 29-4
- planned: a session-start with no end is the live session / actual: only sessions after the latest `run-start`/`run-resume`, none once the engine ended / why: a crash mid-session would show `typing` forever / may affect: none
- planned: `OFFICE_MAP` as the 11-row table / actual: rows carry a `when` predicate and `signal` text; `OFFICE_RANK`, `mapRoles`, `selectRun`, `engineRunDir`, `LIVE_RUN_STATES` also exported / why: the table is the only place the mapping lives / may affect: 29-4

DEVIATION SCORE (implementer): 1

- DRIFT: registry test cases in `office.test.ts`, `registry.test.ts` untouched — existing asserts hold — affects: none
- DRIFT: `RebuildDeps.live` defaults to `officeStates(queue, runs?)` — runs read once per rebuild — affects: 29-4
- DRIFT: inflight fixture trimmed/cut at line 26 — live journal moved on; strip machine data — affects: none
- DRIFT: extra `office.agent` on current_run/story change; epic-only `office.progress` with a new `office.run` — delta-only clients — affects: 29-4
- DRIFT: open sessions scoped to after latest run-start/run-resume and engine not ended — crash shows typing forever — affects: none
- DRIFT: `OFFICE_MAP` rows carry `when`/`signal`; extra helper exports — table is the single mapping place — affects: 29-4

### consult 1 ruling applied (2026-10-18T03:18:54Z)

- Score raised 1 → 2 (consult: accept-deviation score 2). Emission rules 29-4 must document: `office.agent` can fire with `state === from` when only `current_run`/`current_story` changed; a new run sends an epic-only `office.progress` (no `story`) next to its `office.run`; an agent that leaves the registry gets no event, and only the next snapshot drops it. `OFFICE_MAP`'s `when`/`signal` columns and the extra helper exports stay out of 29-4's contract: only `OFFICE_STATES`, `OFFICE_MAP`'s role-to-state pairs and the three kinds are the documented surface.


### pass 2 (2026-10-18, implementer, review patches)

- planned: plan § Code Map "the project's most recently created live run" / actual: `selectRun` prefers the newest non-queued live run, falling back to the newest queued run; blocked fallback unchanged / why: review finding 3 — `runs_one_live` is per `(job_id, checkout)`, so a queued run masked the working one / may affect: 29-4
- planned: plan row 4 "an `awaiting-ruling` event after the latest `engine-resume`/`resumed`" / actual: awaiting only when the latest of `awaiting-ruling`, `close-out`, `close-out-failed`, `engine-resume`, `resumed`, `paused` is `awaiting-ruling` (the page's set) / why: review finding 2 / may affect: none
- planned: finding 6, start demotion from the last refresh / actual: from the last refresh only when at least `graceMs` has passed since it; otherwise from now (a gap just under 20 s can hold a stale state up to ~40 s) / why: the bounce-cancel test / may affect: none
- planned: — / actual: with `graceMs: 0` a demotion lands on the first refresh that sees it / why: follows from the start rule / may affect: none
- planned: finding 4, prune or bound / actual: both; only `projectOffice` prunes, `officeStates` (rebuild) does not; a test-only `officeCachedPaths()` export / why: a rebuild prune would drop other live runs' journals / may affect: none
- environment: the implementer deleted ~55k `/tmp/tk-sup-*` test dirs older than 120 minutes (inodes at 100% made 501 tests fail); not a repo file; newer dirs left alone.

DEVIATION SCORE (implementer, pass 2): 1 → 2 (consult 2: the run-selection rule is a seam 29-4 documents)

- DRIFT: `selectRun` prefers the newest non-queued live run per project — a queued run of another job masked the working one (review) — affects: 29-4
- DRIFT: awaiting-ruling ends on the page's set (`close-out`, `close-out-failed`, `engine-resume`, `resumed`, `paused`) — a close-out left waiting-for-human stuck (review) — affects: none
- DRIFT: demotion counts from the last refresh only after a ≥ `graceMs` gap; caches pruned by `projectOffice` and capped at 256 — review patches — affects: none

### consult 2 ruling applied (2026-10-18T03:36:08Z)

- Pass 2 scored 2; story `deviation_score` stays 2. 29-4 must document the run-selection rule in the office contract: per project, the newest non-queued live run, else the newest queued live run, else the latest run when `blocked`. The test-only `officeCachedPaths()` export stays out of 29-4's contract. The `/tmp/tk-sup-*` deletion is an environment note only.

### pass 3 (2026-10-18, implementer, follow-up review patches)

- planned: run selection per consult 2 (newest non-queued live run, else newest queued, else latest when `blocked`) / actual: the newest `paused` live run first, then the newest other non-queued live run, then the newest queued live run, else the latest run when `blocked` / why: follow-up finding: a newer running run of another job hid an awaiting run's `waiting-for-human` (AC1) / may affect: 29-4
- planned: plan row 10 "engine ended, no `host-verify` after the latest `launched`" / actual: row 10 also requires a `launched` event (`hostVerified = launchedAt < 0 || host-verify after launched`); `OFFICE_MAP` row-10 text and README updated / why: an adopted `external` run is never host-verified by the supervisor, yet it showed `running` forever / may affect: 29-4
- planned: denominator from `stories-validated` / actual: the FIRST `stories-validated` entry for `count` and `spec_folder`; the no-manifest fallback marks started keys beyond `count` as `extra` / why: the engine journals one per process; AC2 "fixed when the launch validated it" / may affect: none

DEVIATION SCORE (implementer, pass 3): 2 (consult 3: accept-deviation score 2)

- DRIFT: run selection prefers the newest `paused` live run (replaces consult 2's rule) — a newer running run of another job hid an awaiting run's waiting-for-human (AC1) — affects: 29-4
- DRIFT: row 10 needs a queue `launched` before host-verify is pending — adopted external runs showed orchestrator `running` forever — affects: 29-4
- DRIFT: denominator from the first `stories-validated`; the no-manifest fallback marks keys beyond `count` as `extra` — the engine journals one per process; done exceeded total — affects: none

### consult 3 ruling applied (2026-10-18T03:46:32Z)

- All four patches kept; pass 3 scored 2; story `deviation_score` stays 2. 29-4 must document (a) the run-selection order: per project, the newest `paused` live run, else the newest non-queued live run, else the newest queued live run, else the latest run when `blocked` (this replaces consult 2's rule); (b) row 10's condition: a `launched` event exists and no `host-verify` follows the latest one, so adopted `external` runs never enter row 10. The first-`stories-validated` denominator and the no-manifest `extra` marking are local (score 1), affects: none.

### pass 4 (2026-10-18, implementer, follow-up review 2 patches)

- planned: plan row 5 "run running, no launched event yet (engine_run_id null)", with close-out in row 11 (idle) / actual: row 5 also holds when no `launched` has followed the latest `close-out`/`engine-resume` (`launchedSinceMove`); the `OFFICE_MAP` row-5 text and README updated / why: a relaunch or resume keeps the old `engine_run_id` until the new `launched`, so its launch leg showed `idle` (AC1) / may affect: 29-4
- planned: progress `done` from the journal's terminal kinds only (plan :104) / actual: an unsettled, non-current manifest story is also `done` when its single story spec at the run's root (`<root>/<specFolder>/stories/<id>-*.md`, not a sentinel) has `status: done`; the journal wins, the denominator is unchanged, and README updated / why: a close-out relaunch starts a fresh journal that omits stories landed earlier, so done/total went backwards (AC2) / may affect: 29-4
- page note naming the run that holds a project's agents, and the `OFFICE_STATES` comment fix: local, affects none

DEVIATION SCORE (implementer, pass 4): 1 (consult 4: accept-deviation score 2)

- DRIFT: row 5 now reads "run running, no launched event yet (engine_run_id null), or none since the latest close-out/engine-resume"; it replaces "run running, no launched event yet (engine_run_id null)". Row 11 still covers "between legs" but no longer the close-out window — a relaunch's launch leg showed idle (AC1) — affects: 29-4
- DRIFT: progress `done` now also comes from story specs: an unsettled, non-current manifest story is `done` when its single matching story spec at the run's root has `status: done`. This replaces "`done` comes from the journal's `story-done` only". The journal wins and the denominator is unchanged — a close-out relaunch's fresh journal dropped earlier landings (AC2) — affects: 29-4

### consult 4 ruling applied (2026-10-18T04:01:17Z)

- Both patches kept; pass 4 scored 2; story `deviation_score` stays 2. 29-4 documents the row-5 predicate and the progress-source rule as restated in the DRIFT lines above. `specsDone()` and the reuse of `launchedSinceMove` stay out of 29-4's contract.

## Consult Log

- 2026-10-18T03:18:54Z — trigger: deviation-gt-0 — question: accept pass 1 at score 1, score 2 (extra office.* emissions change a seam 29-4 documents), or reject (B)? — ruling: accept-deviation score 2 — do: keep (A),(B),(C) as built, remove no emission; raise deviation_score to 2 and list the emission rules 29-4 must document; keep OFFICE_MAP's when/signal and the extra exports out of 29-4's contract — rule candidate: When a deviation changes when an already-planned event kind fires, without changing its name, payload or the state vocabulary, score it 2 and name the documenting story; a consult is needed only if a kind, field or state is added or renamed.
- 2026-10-18T03:36:08Z — trigger: deviation-gt-0 — question: accept review-patch pass 2 (selectRun prefers newest non-queued live run; row-4 ruling-end set = page's; grace/cache refinements; /tmp test-dir cleanup) at score 1, 2, reject, or escalate? — ruling: accept-deviation score 2 — do: keep (1),(2),(3) as built; set pass-2 score to 2 and name 29-4 as documenting the run-selection rule; keep `officeCachedPaths()` out of 29-4's contract; log (4) as an environment note only — rule candidate: When a deviation changes which entity a projection picks (run, story, session) without adding or renaming a state, field or event kind, score it 2 and name the story that documents it; consult only if the vocabulary changes.
- 2026-10-18T03:46:32Z — trigger: deviation-gt-0 — question: accept follow-up pass 3 (selectRun prefers newest paused live run; row 10 needs a launched; first stories-validated; no-manifest extra) at score 2, 1, reject (1), or escalate? — ruling: accept-deviation score 2 — do: keep all four patches, pass score 2 (story stays 2); DRIFT naming 29-4 to document the new run-selection order and row-10 condition; log the denominator and no-manifest extra as local, affects none — rule candidate: When a projection's selection or row predicate is changed to keep an AC invariant (e.g. "waiting-for-human never expires") that an earlier consult ruling broke, accept it at score 2 and restate the replaced rule in full for the documenting story; consult only if the state, field or event vocabulary changes.
- 2026-10-18T04:01:17Z — trigger: deviation-gt-0 — question: accept follow-up 2 pass 4 (row 5 also holds with no launched since the latest close-out/engine-resume; progress counts a story done by its story spec when the relaunch's journal is silent) at score 1, 2, reject, or escalate? — ruling: accept-deviation score 2 — do: keep A and B as built; pass-4 score 2 with a DRIFT naming 29-4 that restates both replaced rules in full; keep `specsDone()` and the reuse of `launchedSinceMove` out of 29-4's contract — rule candidate: When a projection adds a second read-only source or widens a row predicate so an AC still holds across a relaunch or resume, without changing the state, field or event vocabulary, accept it at score 2 and name the documenting story; consult only if the vocabulary or the denominator changes.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This is the second follow-up review of the office projection, over the full story diff since `13df15984b5a4bb32409ba0669f93ef998b461a2`. It found four defects, all patched:
- Progress no longer goes backwards after a close-out relaunch. A story whose spec at the run's root is `done` counts as done when the fresh journal says nothing about it.
- A relaunch or resume shows its launch leg as orchestrator `thinking` until the new engine's `launched` lands.
- The status page names the run that holds a project's agents, instead of saying the run has none.
- The `OFFICE_STATES` comment no longer contradicts `OFFICE_RANK`.

**Files changed (this pass):**
- `apps/supervisor/src/office.ts`: `launching` widened through `launchedSinceMove`; new `specsDone()` with a cached and pruned `specStatuses`; the `progress()` override; the row-5 text; the `OFFICE_STATES` comment
- `apps/supervisor/src/page.ts`: an Office card with no agents names the run holding the project's agents
- `apps/supervisor/test/office.test.ts`: three new tests, each confirmed to fail on the pre-patch source. One close-out expectation changed from `typing` to `thinking`, as row 5 now rules
- `apps/supervisor/README.md`: row 5 and the progress rule

**Review:** blind-hunter and edge-case-hunter (L band, both layers) raised 9 findings. After deduplication (the two page findings were one) that left 8: 4 patched (medium 1, low 3), 0 deferred, 4 rejected (one line each in the Review Triage Log). Follow-up review recommended: true (patched high 0, medium 1, low 3; score 3×1 + 3 = 6 ≥ 5).

**Verification (after patches):**
- The implementer's run:
  - `bun test`: 855 pass and 6 fail out of 933 tests. The 6 failures are the known baseline: closeout `fakeStudioRoot` and five `sbx stop`.
  - lib suite: 1365 tests OK (skipped=1).
  - conformance: `ok: true`.
- Re-checked by this session:
  - `bun test test/office.test.ts`: 43 pass, 0 fail.
  - `tsc --noEmit`: exit 0.
  - conformance: `ok: true`.
  - `git diff --stat -- plugins/ .bmad-loop/`: empty.

**Residual risks:**
- After a close-out relaunch, the new engine's first `stories-validated` count is the manifest length at relaunch. If remediation entries were appended since the launch, it can be larger than the launch's count.
- A story spec reads `done` before its `story-done` is journalled, so the projection shows `done` when the spec is written. The engine treats the story the same way.
- Earlier risks are unchanged:
  - a paused run hides the same project's running run's agents;
  - host-verify is inferred;
  - engine verify is visible only through `state.json`;
  - consult and advisor stay `idle`;
  - office ids live in memory.

- DRIFT: row 5 now reads "run running, no launched event yet (engine_run_id null), or none since the latest close-out/engine-resume"; it replaces "run running, no launched event yet (engine_run_id null)". Row 11 still covers "between legs" but no longer the close-out window — a relaunch's launch leg showed idle (AC1) — affects: 29-4
- DRIFT: progress `done` now also comes from story specs: an unsettled, non-current manifest story is `done` when its single matching story spec at the run's root has `status: done`. This replaces "`done` comes from the journal's `story-done` only". The journal wins and the denominator is unchanged — a close-out relaunch's fresh journal dropped earlier landings (AC2) — affects: 29-4

## Reconcile

### 2026-10-18 — adjust-stories

- Score: 2
- Reasoning: Every deviation leaves the vocabulary unchanged: the eight states, the three `office.*` kinds, `GET /office` and `GET /office/events`. No AD or contract surface is touched (`git diff 13df159..HEAD -- plugins/ .bmad-loop/` is empty), and no later story's acceptance criterion changes. The one later consumer is 29-4. It documents the projection in the driver contract and makes the README's API table match the code, so it must document the behaviour as landed. Consults 1–4 named those rules. A note in its `invoke_dev_with` absorbs them. No epic after 29 exists in `epics.md` yet.
- Affected: 29-4-the-contract-names-the-web-as-a-consumer-and-the-runbook — "documents … the projection (`GET /office`, `GET /office/events`, the three `office.*` event kinds and the eight states)". It still holds, but the documented emission, run-selection, row-5/row-10 and progress-source rules must be the landed ones.
- Invariant: none

- Gate: Part A adjust-stories; Part B story accepted, planned 29-4-the-contract-names-the-web-as-a-consumer-and-the-runbook
