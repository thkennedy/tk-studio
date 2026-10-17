---
title: 'The API Answers on the Tailnet Only'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '3c21babc8b7083a764ba31f64a4ee199fd0677c5'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-22/operator-decisions.md'
warnings: [oversized]
deferred:
  - summary: >-
      A driver can still claim a run between cancelRun's re-read and the Queue.end transaction, so a cancel can end a just-claimed run without keeping its lock for the live driver.
    evidence: |-
      Review pass 1 patch 2 narrowed the window but did not close it: the owner-liveness probe cannot run inside the end transaction (implementer report, consult ruling 2). The criterion it touches: cancel ends the run `cancelled` through Queue.end and the recorded-worker rule, never a bare lock release (deferral class a).
    location: >-
      src/cli.ts cancelRun; src/queue.ts writeEnd
    severity: medium
  - summary: >-
      A driver that records its studio run after cancelRun's re-read but before Queue.end leaves that studio run unended.
    evidence: |-
      Follow-up review pass: patch 1 made cancel end the studio run from a fresh re-read, and the driver's recordMinted end a studio run minted after the cancel. A setStudioRun that lands between that re-read and the Queue.end transaction still succeeds, so neither side ends it (implementer report, consult ruling 3). It is a sibling of the claim/end race above. The criterion it touches: cancel ends the studio run through jobrun cancel (deferral class a).
    location: >-
      src/cli.ts cancelRun / recordMinted
    severity: medium
---

<intent-contract>

## Intent

**Problem:** As the operator away from the box, I want the supervisor's HTTP API on the tailnet address behind a bearer token, so that I can submit, watch, and cancel runs from the phone, iPad, or main PC. Today the supervisor is operable only from its CLI on the agent PC.

**Approach:** Add an HTTP API (`Bun.serve`) started by a new CLI verb `serve`. It binds only `TK_SUPERVISOR_BIND` (inside `100.64.0.0/10`) on `TK_SUPERVISOR_PORT` (default `8787`), and gates every route on `Authorization: Bearer <TK_SUPERVISOR_TOKEN>`. `POST /jobs` goes through the CLI's own submit path. The read routes answer from the queue. Cancel ends the queue run `cancelled` through `Queue.end`.

**Acceptance criteria (verbatim, epics.md Story 22.1):**
1. **Given** the supervisor starts, **When** it binds, **Then** it binds only the Tailscale address named in its environment and refuses to start on `0.0.0.0`, on an address outside `100.64.0.0/10`, or without a bearer token in its environment.
2. **Given** a request without the correct token, **When** it arrives, **Then** it gets 401 and the token never appears in any log.
3. **Given** `POST /jobs` naming a registered project and a declared job, with optional `base_ref`, `tier`, `model`, and `effort`, **When** it is valid, **Then** it is queued through Story 21.3's validation and the response carries the run id; an invalid body gets 400 with the schema error.
4. **Given** `GET /jobs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /status`, and `GET /events?since=`, **When** each is called, **Then** each answers from the queue; cancel ends the run `cancelled`, stopping a launched engine gracefully (`tk-studio-launch` verb `stop`, `graceful`); `/events` serves both SSE and plain polling.
5. **Given** the API test suite, **When** it runs, **Then** auth refusal, malformed JSON, unknown project, unknown job, and a double cancel are pinned and green.

**Dispatch rulings (stories.yaml replans, binding):**
- API run ids are queue run ids. Answers also carry `studio_run_id`.
- `POST /jobs` calls the same submit path (`submitJob` resolution, then `enqueue`). Each named refusal (`HostBypassRefused`, `TierRefused`, `SbxSandboxMissing`, `SupervisorConfigInvalid`, `VmPathUnderivable`) maps to 400 with its name, and no run is queued. Keep the registry root from `validate()` on any drive.
- `/events` and `/runs/{id}` pass event kinds and details through as stored, never a fixed list.
- A `POST /jobs` on a checkout whose lock an ended run still keeps waits in `queued` and names that holder.
- Cancel ends the queue run `cancelled` through `Queue.end` with its event. It ends the studio run through `jobrun cancel`, or launch `stop --graceful` when an engine was launched. It follows the recorded-worker rule (`Queue.recordedWorker`; on sbx, the in-VM deadline, so the lock is kept with `holdLock`), never a bare lock release.

## Boundaries & Constraints

**Always:**
- Refuse to start, with a named error and without binding, in each of these cases:
  - `TK_SUPERVISOR_BIND` is unset, `0.0.0.0`, not an IPv4 literal, or outside `100.64.0.0/10`.
  - `TK_SUPERVISOR_TOKEN` is unset or empty.
  - `TK_SUPERVISOR_PORT` is set but is not a port number.
- Compare tokens in constant time. The 401 body never echoes the header or the token. No log line, error or event carries the token or the `Authorization` header.
- Every route, including an unknown path, is behind auth.
- Environment variables follow operator-decisions.md §1 and §2 (AD-15: no machine path or address in tracked files).

**Block If:** the story needs a behaviour that neither the criteria, the rulings above, nor operator-decisions.md settle, and the choice changes what the operator observes.

**Never:**
- No second submission path: never re-implement validation beside `submitJob`.
- The API itself never drives or claims a run. Drain and the pacer stay as they are.
- No listening on `0.0.0.0`, localhost, or any non-tailnet address, and no `--dangerously-skip-permissions`.
- No status page (22.2), `start.ps1`, notifier or snapshot (22.3).
- Never create a branch from `base_ref`: that belongs to a later story (ST-074).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior |
|---|---|---|
| Bad bind | BIND `0.0.0.0`, `192.168.1.5`, `100.128.0.1`, or unset | `serve` exits non-zero, names the error, never binds |
| No token | TOKEN unset or empty | `serve` exits non-zero, named error |
| Auth refusal | missing or wrong `Authorization` on any route | 401 `{ok:false,error:"Unauthorized"}`, token absent from all captured output |
| Malformed JSON | `POST /jobs` body `{not json` | 400, error names the JSON parse failure, nothing queued |
| Schema error | missing `project`/`job`, unknown field, wrong type (`tier: 5`) | 400 with the schema error naming the field, nothing queued |
| Unknown project | `project` not in the registry | 400 naming the refusal, nothing queued |
| Unknown job | `job` not declared for the project | 400 naming the refusal, nothing queued |
| Named refusal | a submit that throws e.g. `TierRefused: …` | 400 `{error:"TierRefused", detail:…}`, nothing queued |
| Valid submit | `{project, job, base_ref?, tier?, model?, effort?}` | 200 `{ok, run_id, studio_run_id, state:"queued", …}`; `base_ref` is stored on the queue run |
| Lock kept by an ended run | a valid submit on that checkout | 200, `state:"queued"`, with `holder` naming the run that keeps the lock |
| Unknown run | `GET /runs/x`, `POST /runs/x/cancel` | 404 |
| Cancel a queued run | `POST /runs/{id}/cancel` | 200, run `cancelled` through `Queue.end`, `ended` event |
| Cancel a running run | the run has a studio run and/or an engine run | launch `stop --graceful` (engine) and/or `jobrun cancel`; then `recordedWorker(run, true)`; `Queue.end(…,"cancelled")`, with `holdLock` when the worker may still run |
| Double cancel | cancel a run already terminal | 409 `{error:"RunTerminal", state}`; the run and its events are unchanged |
| Events poll | `GET /events?since=<seq>` | JSON of events with `seq > since`, kinds and details as stored |
| Events SSE | same, with `Accept: text/event-stream` | `text/event-stream`: one `id:<seq>` plus `data:<event json>` per event, then new events as they land |

</intent-contract>

## Code Map

- `src/cli.ts:496` `submitJob(jobId, directory, opts)` -- the submit path. It takes a directory, not a project id. Every error comes out as `StartError` (:144, `refusal` :153); recover the refusal name from the message prefix, as `main` :1413 does. `validate` :716 (private) holds the registry-root check (`samePath` :196). `RunOptions` :205 has no `base_ref` yet.
- `src/cli.ts:323` `studioRunEnder(verbRunner)` -- the verb choice (core → `cancel`, skill → `finish`); reuse it for the studio end of a cancel. `main` :1373 and `USAGE` :1365 get the new `serve` verb.
- `src/server.ts:65` `registryShow(projectId)`, `:74` `entryRoot` -- resolve a project id to its root. `:352` `runJobVerb`, `:340` `runUv`. Refusal classes are at :365/:380/:388. `VmPathUnderivable` is a plain `Error` prefix at :414, and `SupervisorConfigInvalid` is in `src/config.ts:24`. This file is the MCP stdio server; keep the HTTP API out of it.
- `src/queue.ts:632` `Queue` -- `get` :659, `runs` :663, `events(runId?)` :667 (no `since` yet), `lock(root)` :701, `recordedWorker` :739, `enqueue` :773, `end(runId, state, reason, {holdLock,…})` :1119 (throws `RunTerminal` :83). The column migration pattern is at :647, and the jobs table at :545 has no list method. `QueueRun` :420, `QueueEvent` :455, `Holder` :489. The `launch.py status` call pattern is at :231.
- `src/env.ts` -- env getters (`supervisorConfigPath` :47); add BIND/PORT/TOKEN here.
- `test/queue.test.ts:18-40` -- `fakeProbes` and the `fixture()` temp-queue pattern. `test/command-line.test.ts:105` `fakeVerbs` is the verb-runner stub pattern.
- `README.md` -- `## Operator commands` :6, `## Environment` table :118-129.
- tk-studio `lib/launch.py stop --directory <root> --run-id <id> --graceful` (driver contract §tk-studio-launch), invoked through `runUv`.

## Tasks & Acceptance

**Execution:**
- `src/env.ts` -- add `apiBind`, `apiPort` (default 8787) and `apiToken` getters with named errors -- one env surface (AD-15).
- `src/api.ts` (new):
  - `checkBind(addr)`, the `100.64.0.0/10` check.
  - `createApi(deps)`, which returns a `fetch(Request) => Promise<Response>` handler. `deps` holds the queue, token, `submit`, `cancel`, and the clock/poll interval for SSE.
  - `serve(env)`, which validates bind, port and token, then calls `Bun.serve({hostname: bind, port})`.
  - Routes and body schema per the matrix.
  - Rationale: an injectable handler lets tests run without the tailnet.
- `src/cli.ts`:
  - Export a `submitProject(projectId, jobId, opts)` that resolves the root through `registryShow`, then calls `submitJob`.
  - Thread `base_ref` through `RunOptions`/`submitJob` to `enqueue`.
  - Export `cancelRun(queue, runId, {verbRunner, launchStop})` implementing the cancel ruling.
  - Add the `serve` verb.
  - Rationale: one submit path, and cancel reusable by the API.
- `src/queue.ts`:
  - A nullable `base_ref` column, through the migration at :647 and `enqueue`.
  - `events` gains an optional `since` seq filter.
  - A `jobs()` list read.
  - Rationale: every answer comes from the queue.
- `test/api.test.ts` (new) -- the whole matrix, including the five pinned cases, the token absent from captured `console.*` output, and the SSE framing -- AC 5.
- `README.md` -- `serve` in Operator commands, an `## HTTP API` section, and three Environment rows -- operator surface.

**Acceptance Criteria:**
- Given the verify gate, when `bun test` runs, then `test/api.test.ts` and every existing suite are green, and `bunx tsc --noEmit` is clean.
- Given the tailnet, a phone and the real bind (`unverifiable-here`), when the operator runs `curl -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" http://$TK_SUPERVISOR_BIND:8787/status` from another device, then it answers. Record this command in the Auto Run Result.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 2, low 5)
- defer: 1 (medium 1)
- reject: 3 (low 3)
- addressed_findings:
  - `[medium]` `[patch]` cancel raced by the driver's own end answered 409 "unchanged" after doing side effects; now `CancelRaced` 409 carries `effects`, README reworded
  - `[medium]` `[patch]` cancel of a running run under a live driver with no recorded worker released the lock bare; the lock is now kept (`driverLive`) and freed by the driver's `endDriven` or recovery (see Deviation Summary pass 2)
  - `[low]` `[patch]` SSE reconnect replayed the log; a valid `Last-Event-ID` now wins over `since` on SSE
  - `[low]` `[patch]` the auth scheme was case-sensitive; `bearer` in any case is accepted, the compare stays constant-time
  - `[low]` `[patch]` a malformed percent-escape in a run id gave 500; now 404 `RunNotFound`
  - `[low]` `[patch]` a failed engine stop was invisible in the cancel answer; the 200 answer carries `effects` (engine_stop, studio, worker, lock)
  - `[low]` `[patch]` README omitted the `POST /jobs` 500 answers; documented
- deferred: the claim/end race left in cancel (class a, the cancel criterion), recorded in frontmatter `deferred`
- rejected: surrounding whitespace in `TK_SUPERVISOR_TOKEN` is trimmed (the operator controls the token; no criterion affected); `redact` mangles text with a one-character token (cosmetic, no criterion); `base_ref` not applied when a submit adopts a running run (the same adoption rule 21-4 set for tier/model/effort through the shared submit path)

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 1 (medium 1)
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` a cancel during the minting verb left the studio run open; cancel now ends the studio run named by a fresh re-read, and the driver's new `recordMinted` ends a studio run minted after the cancel (`CANCELLED_REASON`) before rethrowing `RunTerminal`
  - `[medium]` `[patch]` `buildWorkerEnv` handed `TK_SUPERVISOR_TOKEN` to every host worker; it is now stripped beside `ANTHROPIC_API_KEY` (src/server.ts, consult ruling 3: outside the Tasks files, score 1)
  - `[medium]` `[patch]` a launch engine started between cancel's engine probe and the worker kill escaped; cancel re-probes after the kill, stops a late engine gracefully and hands it the lock
  - `[low]` `[patch]` the real `launchStopGraceful` was never run; a fake `uv` on PATH now pins its argv and its `ok`/refused/no-JSON answers
  - `[low]` `[patch]` `GET /events?since=` with an empty value answered 400; an empty or blank `since` is the documented default 0
- deferred: the record-after-re-read window left in cancel (class a, the cancel criterion; consult ruling 4), recorded in frontmatter `deferred`

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 4, low 2)
- defer: 0
- reject: 5 (low 5)
- addressed_findings:
  - `[medium]` `[patch]` a worker the driver recorded after cancel read the run was never killed; cancel re-reads the run after `Queue.end` and applies the recorded-worker rule to a newly recorded worker (a `worker-kill` event, copied into the answer's `effects.worker`)
  - `[medium]` `[patch]` a worker spawned after the cancel had its record refused (`RunTerminal`), so `releaseDriverLock` could free the lock under it; the recorder now kills its own unrecorded child (`Queue.killUnrecorded`, pid plus start time), and `releaseDriverLock` keeps the lock when that kill says the worker may still run
  - `[medium]` `[patch]` `mirror`'s `setStudioRun` on a cancelled run threw `RunTerminal` and skipped `endDriven`, leaving the driver-kept lock held and the studio run open; that studio run is now ended (`CANCELLED_REASON`) and `endDriven` still runs
  - `[medium]` `[patch]` cancelling a running run whose dead driver had started its minting verb left the minted studio run open, because `recover` skips terminal runs; cancel now looks it up with `studioRunFinder`, records it and ends it (`effects.lookup`)
  - `[low]` `[patch]` a JSON `GET /events` fell back to `Last-Event-ID`; only the SSE stream reads it now
  - `[low]` `[patch]` 405 answers had no `Allow` header; every 405 now carries it
- rejected:
  - A launched engine is not handed the lock when the worker may still run: the claim path's launch probe (`src/queue.ts` `claimProbes`, `launch`) checks the engine before a freed launch holder's lock is reused. No criterion is broken.
  - `/events` has no page limit: this is a single-operator tailnet API over a local queue, and no criterion names a bound.
  - `idleTimeout: 0`: every connection is tailnet-only and behind auth, and no criterion is affected.
  - The `POST /jobs` 500 branch is untested: it is plumbing named in a DRIFT line, not in a criterion.
  - `base_ref` is untested on a later `recordRunOptions` or an adopting resubmit: this is plumbing, and the adoption rule was already ruled on in review pass 1.

## Design Notes

- **`base_ref`:** the story makes it an optional submission field without saying more. It is validated as a non-empty string, stored on the queue run like `tier` (operator-decisions §3 treats submission flags the same way), and returned by `/runs/{id}`. No branch is cut (ST-074).
- **`GET /status`:** answers `{ok, counts: {<state>: n}, live: [non-terminal runs], locks: [held checkout locks with holder]}`, all from the queue.
- **Double cancel is 409, not an idempotent 200.** `Queue.end` already refuses a terminal run with `RunTerminal`, so the API surfaces that refusal.
- **Holder on submit:** after `enqueue`, read `queue.lock(root)`. If another run holds the lock, return it as `holder` with `state:"queued"`.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no lockfile change
- `bun test` -- expected: all green, including `test/api.test.ts`
- `bunx tsc --noEmit` -- expected: no errors

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: queue changes = `base_ref` column, `events(since)`, `jobs()` / actual: also `Queue.locks()` and exported `LockRow` / why: `GET /status` lists held locks with holder from the queue; no list read existed / may affect: 22-2
- planned: `base_ref` stored like `tier` / actual: added to `RUN_OPTION_KEYS`, so a set `base_ref` appears in the `enqueued` event detail and an adopting resubmit writes a `run-options` event / why: that is how `tier` is stored / may affect: none
- planned: studio run ends "through `jobrun cancel`" / actual: reused `studioRunEnder` (core → `cancel`; skill → `finish --state partial`, reason `cancelled: operator request`) / why: Code Map names it; the supervisor never `finish`es a core run / may affect: none
- planned: matrix names 400 refusals only / actual: an unnamed refusal (unknown project/job) → 400 `error:"SubmitRefused"` with the text in `detail`; a non-refusal submit failure (transport, missing `TK_STUDIO_ROOT`, unusable queue) → 500 with its name prefix, else `SubmitFailed` / why: spec did not settle these names / may affect: 22-2
- planned: unknown project/job pinned against the real submit path / actual: pinned with a stand-in submit throwing the same errors, and through the real path in a block that skips without `TK_STUDIO_ROOT` or `uv` (it ran here) / why: the real path needs the studio and `uv` / may affect: none

DRIFT: `Queue.locks()` and exported `LockRow` added (a seam 22-2 must reuse, not re-derive) — `GET /status` must list held locks from the queue — affects: 22-2-a-read-only-status-page
DRIFT: `base_ref` joins `RUN_OPTION_KEYS` (shows in `enqueued`/`run-options` event detail) — stored the way `tier` is — affects: none
DRIFT: cancel's studio end reuses `studioRunEnder` (skill runs get `finish partial`, not `cancel`) — the supervisor never finishes a core run and skill runs have no `cancel` — affects: none
DRIFT: unnamed submit refusals answer 400 `SubmitRefused`; non-refusal failures answer 500 — the spec named only the five refusals — affects: 22-2-a-read-only-status-page
DRIFT: unknown project/job pinned with a stand-in submit plus an env-gated real-path block — the real path needs the studio and `uv` — affects: none

### pass 2 (2026-09-28, implementer, review patches)

- planned: patch 2 a minimal cancel-side change that keeps the lock / actual: also `Queue.end` `driverLive` option (`writeEnd`), `claimProbes` (an ended no-worker holder is live while its lock owner lives), `releaseKeptLocks(self)` (skips such a lock while its owner lives), `endDriven` → new `releaseDriverLock` with a `lock-released` event, public `Queue.ownerAlive` / why: without them claim and recover free the kept lock at once, and a long-lived driver never frees it / may affect: 22-2-a-read-only-status-page
- planned: patch 1 answers 409 / actual: new `CancelRaced` (subclass of `RunTerminal`) carries `effects` / why: the 409 must report side effects already done / may affect: none

DRIFT: a run ended by cancel with no worker recorded keeps its lock for its live driver (driverLive); claim/recover treat it as live while the lock owner lives, endDriven frees it with lock-released; public Queue.ownerAlive added — never a bare lock release (Dispatch ruling) — affects: 22-2-a-read-only-status-page

### pass 3 (2026-09-28, implementer, follow-up review patches)

- planned: `buildWorkerEnv` untouched (src/server.ts outside the Tasks files) / actual: `delete env.TK_SUPERVISOR_TOKEN` beside `ANTHROPIC_API_KEY`, with a test in `test/command-line.test.ts` / why: the token this story adds must never reach a worker transcript (Boundaries; NFR5) / may affect: none
- planned: the post-mint recording inline in `drive()` / actual: moved into the exported `recordMinted(queue, queueRunId, started, verbRunner)` / why: `drive`/`runJob` is only testable end to end against a real studio; behaviour unchanged / may affect: none
- planned: a second engine probe when the first found none / actual: also when the verb started during the cancel's awaits (re-read `current` has `verb_started` and a launch definition) / why: the same escape exists there / may affect: none
- planned: end a minted studio run when the queue run went terminal / actual: only when it is `cancelled` / why: every other terminal state is the driver's own end, which already ends its studio run / may affect: none

DRIFT: `TK_SUPERVISOR_TOKEN` stripped in `src/server.ts` `buildWorkerEnv` (a file outside the Tasks list) — the story's new secret otherwise reaches every host worker — affects: none
DRIFT: exported `recordMinted` in src/cli.ts (post-mint recording moved out of `drive`) — the only way to pin the driver-side cancel end without a real studio — affects: none

### pass 4 (2026-09-28, implementer, second follow-up review patches)

These scores come from consult ruling 5.

- **D1, score 2.**
  - planned: cancel kills only the worker recorded when it reads the run.
  - actual: a new queue event kind, `worker-kill` (from/to = the terminal state, detail `{why, worker}`), written by the new public `Queue.noteWorkerKill`. The new public `Queue.killUnrecorded` kills a spawned worker whose record was refused. `releaseDriverLock` is now async and keeps the lock while that kill says the worker may still run. The API copies a `worker-kill` that follows `ended` into `effects.worker`.
  - why: a worker recorded or spawned during a cancel must be killed, and no lock may be freed under it.
  - may affect: 22-2, which shows ended runs that keep a lock.
- **D2, score 1.**
  - planned: cancel ends the studio run named on the queue run.
  - actual: when the dead driver started its minting verb and no studio run was recorded, cancel looks one up with `studioRunFinder`, records it (`setStudioRun`) and ends it. The result appears in the cancel answer as `effects.lookup` (`{ok:true, adopted}` or `{ok:false, detail}`). `mirror` gained a defaulted `verbRunner` parameter so it can end a studio run minted after a cancel.
  - why: `recover` skips terminal runs, so without this nothing ends that studio run.
  - may affect: none (22-2 never reads cancel `effects`).
- **D3, score 1.**
  - planned: the JSON poll ignores `Last-Event-ID`.
  - actual: that is done. In addition, on the SSE stream a bad `Last-Event-ID` now falls back to `since`, or to 0 when `since` is absent, and a bad `since` still answers 400 (`src/api.ts:207-209`).
  - why: an EventSource reconnect must not fail on a bad header.
  - may affect: none.
- **D5, score 1.** The README cancel row now names the lookup, the `worker-kill` event and `lookup` in the effects. README.md is in the Tasks list.

DRIFT: new queue event kind `worker-kill` (`Queue.noteWorkerKill`, `Queue.killUnrecorded`; async `releaseDriverLock` keeps the lock while an unrecorded worker may still run) — a worker recorded or spawned during a cancel must be killed and no lock freed under it — affects: 22-2-a-read-only-status-page
DRIFT: cancel looks up and ends a studio run minted by a dead driver (`effects.lookup`); `mirror` takes a defaulted `verbRunner` — `recover` skips terminal runs, so nothing else ends it — affects: none
DRIFT: SSE ignores an invalid `Last-Event-ID` (falls back to `since`/0) instead of answering 400 — an EventSource reconnect must not fail on a bad header — affects: none

## Consult Log

- 2026-09-28T22:53:08Z — trigger: deviation-gt-0 — question: accept the implementer's five deviations (Queue.locks seam, base_ref in RUN_OPTION_KEYS, studioRunEnder for cancel, SubmitRefused/500 names, stand-in plus env-gated real-path tests)? — ruling: accept-deviation score 2 — do: keep all five; score 2 for Queue.locks()/LockRow (seam 22-2 reuses); deviation 3 correct as built, skill runs keep finish partial — rule candidate: a new public Queue read method or exported queue row type scores 2 and is named as a seam; studio runs end only through studioRunEnder, no consult needed
- 2026-09-28T23:02:17Z — trigger: deviation-gt-0 — question: accept patch 2's widened lock-semantics change (driverLive, claimProbes, releaseKeptLocks(self), endDriven releaseDriverLock, public Queue.ownerAlive) at score 1, 2, or revert? — ruling: accept-deviation score 2 — do: keep patch 2 as built; score 2 with the DRIFT line naming 22-2; defer the leftover re-read/end race (recorded in the spec's frontmatter `deferred`, the loop's deferral channel: this session writes only the spec) — rule candidate: any change to how claim, recover, endDriven or releaseKeptLocks decide a lock is live or freed scores 2 and names 22-2; a race left after a review patch is deferred, not fixed in the same pass
- 2026-09-28T23:08:48Z — trigger: file-outside-files — question: follow-up review patch strips TK_SUPERVISOR_TOKEN in src/server.ts buildWorkerEnv (outside the spec Tasks files): patch, defer, or reject? — ruling: accept-deviation score 1 — do: delete env.TK_SUPERVISOR_TOKEN beside ANTHROPIC_API_KEY in buildWorkerEnv and note it in its doc comment; add a unit test that the token and ANTHROPIC_API_KEY are dropped and TK_STUDIO_HOME kept; record in the Deviation Summary as file outside Tasks list, score 1, local — rule candidate: a story that adds a new secret env var also strips it in buildWorkerEnv (src/server.ts) with a test, pre-approved at score 1
- 2026-09-28T23:15:55Z — trigger: deviation-gt-0 — question: accept the patch pass deviations (D1 exported recordMinted for testability, D2 wider second launch-engine probe, D3 recordMinted ends the minted studio run only on cancelled) and how to handle the leftover record-after-re-read window? — ruling: accept-deviation score 1 — do: keep D1-D3 at score 1; defer the leftover window in frontmatter deferred beside DW-12 (location src/cli.ts cancelRun / recordMinted, medium, class a), not patched this pass; re-run the gate and continue — rule candidate: a review patch that moves code into an exported helper purely for testability, behaviour unchanged, scores 1 unless a written later story names it; a race a patch narrows but does not close is deferred without a consult

- 2026-09-28T23:30:36Z — trigger: deviation-gt-0 — question: second follow-up review patches: accept D1 (`worker-kill` event, `noteWorkerKill`/`killUnrecorded`, async `releaseDriverLock`), D2 (`effects.lookup` for a dead driver's minted studio run), D3 (SSE bad `Last-Event-ID` falls back), D4 (defaulted `verbRunner`, new Queue methods), D5 (README cancel row), and at what scores? — ruling: accept-deviation score 2 — do: keep all five as built; D1 score 2 with a DRIFT naming 22-2-a-read-only-status-page, D2 score 1 (affects none), D3/D4/D5 score 1; fold D4 into the D1/D2 DRIFT lines; note in the Deviation Summary that a bad `Last-Event-ID` on SSE falls back to `since`/0 and a bad `since` still answers 400 — rule candidate: New queue event kinds and new keys in the cancel answer's `effects` score 1 (kinds pass through as stored and 22-2 reads neither); they rise to 2 only when they change whether a lock is kept or freed

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was the second follow-up review pass over the built story. Recap of the story itself:
- `tk-supervisor serve` starts an HTTP API bound only to `TK_SUPERVISOR_BIND` (IPv4 inside `100.64.0.0/10`) on `TK_SUPERVISOR_PORT` (default 8787), with every route behind the bearer token.
- `POST /jobs` goes through the CLI submit path.
- The read routes answer from the queue, and `/events` serves JSON polling and SSE.
- Cancel ends the queue run `cancelled` through `Queue.end`, stops a launched engine gracefully, ends the studio run, and follows the recorded-worker rule.

This pass closed four cancel races and two small HTTP gaps:
- A worker the driver records after cancel reads the run is now killed.
- A worker whose record is refused because the run was cancelled is killed by its own driver, and no lock is freed while it may still run.
- `mirror` on a cancelled run now ends the unrecorded studio run and still frees the lock the driver kept.
- A dead driver's minted studio run is looked up and ended on cancel.
- JSON `/events` ignores `Last-Event-ID`.
- 405 answers carry an `Allow` header.

**Files changed (this pass):**
- `src/cli.ts`:
  - `cancelRun` looks up a dead driver's studio run and kills a worker recorded after the cancel read.
  - `queueRecorder().worker` kills a spawned worker whose record was refused.
  - `mirror` ends a cancelled run's unrecorded studio run and still reaches `endDriven`.
- `src/queue.ts`: adds `noteWorkerKill` (the `worker-kill` event) and `killUnrecorded`. `releaseDriverLock` is now async and keeps the lock while an unrecorded worker may still run.
- `src/api.ts`: `effects.worker` comes from a `worker-kill` event. The JSON `/events` ignores `Last-Event-ID`. 405 answers send an `Allow` header.
- `test/api.test.ts`: tests for each of the six patches, including a Linux kill of a real detached `sleep`.
- `README.md`: the cancel row names the lookup, the `worker-kill` event, and `lookup` in the effects.

**Review:** blind-hunter and edge-case-hunter both ran. There is no story plan file, and the spec is flagged oversized.
- 6 patches applied (medium 4, low 2), 0 deferred, 5 rejected. The reasons are in the Review Triage Log.
- Follow-up review recommended: true. Patched high 0, medium 4, low 2; score 3×4+2 = 14, which is 5 or more.
- One consult (`deviation-gt-0`) accepted every deviation. D1 is score 2 and affects 22-2; the rest are score 1.
- I left the deferred-work ledger untouched. The orchestrator owns its entries, DW-12 and DW-13 included.

**Verification** (run by this session after the patches):
- `bun install --frozen-lockfile`: no changes.
- `bun test`: 470 pass, 0 fail across 10 files.
- `bunx tsc --noEmit`: exit 0.

**unverifiable-here** (needs the tailnet and another device). The operator runs this on the agent PC, with `serve` started from the console:
`curl -H "Authorization: Bearer $TK_SUPERVISOR_TOKEN" http://$TK_SUPERVISOR_BIND:8787/status`
It should answer. The same request without the header should get 401.

**Residual risks:**
- The two cancel races already deferred remain open:
  - DW-12: a driver claims the run between cancel's re-read and the end transaction.
  - DW-13: a driver's `setStudioRun` lands in that same window.
- On sbx, a worker whose record is refused is killed through its host `sbx exec` process, not inside the VM. The lock does not wait for the in-VM deadline, because no worker is recorded.
- If that kill fails, the kept lock is freed by `claim` once the driver dies, because there is no recorded worker to check.
- `launchStopGraceful`'s test and the real-process kill test are skipped on win32.

DRIFT: new queue event kind `worker-kill` (`Queue.noteWorkerKill`, `Queue.killUnrecorded`; async `releaseDriverLock` keeps the lock while an unrecorded worker may still run) — a worker recorded or spawned during a cancel must be killed and no lock freed under it — affects: 22-2-a-read-only-status-page
DRIFT: cancel looks up and ends a studio run minted by a dead driver (`effects.lookup`); `mirror` takes a defaulted `verbRunner` — `recover` skips terminal runs, so nothing else ends it — affects: none
DRIFT: SSE ignores an invalid `Last-Event-ID` (falls back to `since`/0) instead of answering 400 — an EventSource reconnect must not fail on a bad header — affects: none

## Reconcile

### 2026-09-28 — adjust-stories

- Score: 2
- Reasoning: Four DRIFT lines name 22-2. Three reach its planned view of kept locks: the `Queue.locks()`/`LockRow` seam; a cancelled run that keeps its lock for its live driver (`driverLive`), with no deadline; and the new `worker-kill` and `lock-released` event kinds. The fourth, the `SubmitRefused`/500 answer names, touches nothing a read-only page reads, because a refused submit queues nothing. The other DRIFT lines are internal to 22-1 (`base_ref` in `RUN_OPTION_KEYS`, `studioRunEnder`, `recordMinted`, the token stripped from worker env, SSE `Last-Event-ID`). The skill-run `finish partial` end matches driver-contract `cancel` ("a running run terminates `partial` with reason `cancelled`"). No acceptance criterion of 22-2 or 22-3 changes.
- Affected: 22-2-a-read-only-status-page — "show `held` runs and ended runs that keep a lock, each with the lock holder and the deadline" (a lock kept for a live driver after a cancel has no deadline; kept locks come from `Queue.locks()`)
- Invariant: none


Gate: Part A adjust-stories; Part B story accepted, planned 22-2-a-read-only-status-page
