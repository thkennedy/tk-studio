---
title: 'The Agent Registry'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_revision: 'e17b43b1365954e25afd800249b8049748e73c24'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-29/plans/29-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-29/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Consumers of the studio (the web, a driver, the operator) have no single registry of the agents the supervisor can run per project, so surfaces cannot name the same agents by the same ids (design spec §7.2).

**Approach:** Story 29.2 (`_bmad-output/planning-artifacts/epics.md` § "Story 29.2: The Agent Registry"), transcribed verbatim:

> **Given** the registry's served projects (the host registry's roots) and the routing legs of each (`pipeline.py resolve --directory <root>` with the shipped defaults when no story is live; the run's `routing.current.json` while one is)
> **When** `recover` runs (every tick) and whenever a run is claimed or ends
> **Then** the supervisor rebuilds an `agents` table in the queue file: one row per `(project, role)` for the roles `orchestrator`, `session`, `implementer`, `reviewer`, `consult`, `advisor`, `planner` (the legs of contract §5 mapped once, in one table in `apps/supervisor/src/registry.ts`), with `agent_id` `<project-id>/<role>`, `model`, `effort` and `advisor` from the resolved route, `persona` from a bindings file (`apps/supervisor/personas.json`, shipped: a display name per role; the sprites are EP-30's), `live_state` (Story 29.3; `offline` until then), `current_run` and `current_story` when the role has a live leg, and `jira_account` empty (EP-31's); the table is derived only: the plugin and onboarding are not changed, the registry is never edited by hand, and a project the host registry drops disappears on the next rebuild

> **Given** a consumer
> **When** it reads `GET /agents` (bearer or session cookie) or `GET /agents?project=<id>`
> **Then** the answer lists the rows above with the time of the rebuild; an unknown project answers an empty list; the read-only status page gains an "Agents" section listing them per project; `bun test` pins the mapping from a resolved route, the rebuild on tick, claim and end, and the two routes; `apps/supervisor/README.md` documents the table and the routes

## Boundaries & Constraints

**Always:**
- The role → leg mapping is the planner's ruling (plan § Code Map), exported once as `ROLE_LEGS`/`ROLES` from `registry.ts`: orchestrator←`supervise`, session←`session`, implementer←`implementer`, reviewer←`reviewers`, consult←`consult`, planner←`planner`; `advisor` row: `model` = the `session` leg's `advisor` value verbatim, `effort`/`advisor` `null`. `seam`/`review`/`triage` map to no role. A missing field is `null`, never invented.
- `personas.json` shape is the plan's § Settled shape: `{"<role>": {"display_name": "<string>"}}` for all seven roles; row `persona` = that string or `null`. No sprites.
- `live_state` is `"offline"` on every row; `jira_account` is `""`.
- Rebuild replaces the whole table in one transaction with one `rebuilt_at`; a failed host-registry read leaves the table unchanged (`rebuilt: false`); a refusing resolve keeps the project's seven rows with `null` model/effort/advisor and names the problem.
- Rebuild never throws into a tick, claim or end (`rebuildQuietly`), and never writes `service_events`.
- Production paths (tick → `recoverQueue`, `cli.ts recover`, `runJob` claim and end, `drainQueue`, `cancelRun`) rebuild by default; tests inject deps or disable through `RunOptions`.
- GET paths (`/agents`, the status page) only read the table; they never rebuild.
- House rules: stdlib-only studio scripts, atomic writes, no credential in any answer, event or log.

**Block If:**
- An AC appears to need a change to `pipeline.py`, `registry.py`, onboarding or the driver contract (consult first; the plugin is unchanged).
- A GET path can only be served by rebuilding.
- A design document contradicts the role → leg ruling (consult; DRIFT `affects: 29-3, 29-4`).

**Never:**
- Derive any live state (29.3), compute office projection, or touch the contract (29.4).
- Add sprites, `jira_account` values, or a leg to `pipeline.py`.
- Change `writeStarterLocks`/`writeStarterLock`, the `runs` triggers, or `plugins/tk-studio/agents/*.md`.
- Cache routes across rebuilds.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resolved route, no live run | registry with project `p`; resolve returns distinct legs | 7 rows `p/<role>`, values per ROLE_LEGS, `current_run`/`current_story` null | none |
| Live run | `running` run of `p` whose served root holds `routing.current.json` (`story: "29-1"`) | rows carry that file's legs, `current_run` = run id, `current_story` = `"29-1"` | unreadable file → resolve, named in `problems[]` |
| Project dropped | registry drops `q` | `q`'s 7 rows gone after the next rebuild | none |
| Registry read fails | registry throws / `ok:false` / no studio root | table unchanged, `{rebuilt:false, problem}` | logged by `rebuildQuietly`, never thrown |
| Resolve refuses | resolve `ok:false` for `p` | 7 rows kept with `null` model/effort/advisor | `RouteResolveFailed` in `problems[]` |
| Personas | missing file/role; malformed JSON | `persona: null`; malformed adds `PersonasInvalid`, rows still written | never fails the rebuild |
| `GET /agents[?project=]` | bearer or session cookie | 200 `{ok:true, rebuilt_at, agents}`; filter by project; unknown → `[]` | no auth → 401 JSON; `POST` → 405 `Allow: GET` |

</intent-contract>

## Code Map

The full investigation is `plans/29-2.md` § Code Map (listed in `context`); its anchors were spot-checked on 2026-10-18 and hold. Key points:

- `plugins/tk-studio/lib/pipeline.py:84` -- `LEGS` (session, implementer, reviewers, consult, seam, review, triage, supervise, planner). READ-ONLY.
- `apps/supervisor/src/registry.ts` (new) -- `ROLES`, `ROLE_LEGS`, `rowsFor`, `resolveRoute` (copy `registryShow` pattern `server.ts:65`; parse with `lastJsonObject` `server.ts:627`; `pluginRoot` from `env.ts:38`), `liveRun` (via `servedRoot`, `queue.ts:745`), `loadPersonas`, `rebuildAgents`, `readAgents`. Project roots from `registryShow().projects` entry root (`entryRoot` `server.ts:76`).
- `apps/supervisor/src/queue.ts` -- `SCHEMA` (~`:598-630`, `service_events` at `:622` is the precedent) gains `agents` table (columns per plan); `replaceAgents(rows, rebuiltAt)` and `agents(project?)` beside `serviceEvents` (`:1963`).
- `apps/supervisor/src/cli.ts` -- `RunOptions` (`:261`) gains the `agents` seam; rebuild points: `recoverQueue` finally after `writeStarterLocks` (`:616`), `runJob` after `queue.claim` (`:1057`) and in its `finally`, `drainQueue` (`:709`) after its loop, `cancelRun` (`:837`) after the end; all through `rebuildQuietly`.
- `apps/supervisor/src/api.ts` -- `GET /agents` route; add `/agents` to cookie `readRoute` (`:498`); header route list.
- `apps/supervisor/src/page.ts` -- `PageData`, `gatherPage`, `renderPage`: `<section id="agents"><h2>Agents</h2>` text per project, escaped with `t()`; read only (`test/page.test.ts` no-write guard).
- `apps/supervisor/personas.json` (new), `apps/supervisor/README.md` (`## HTTP API` route row; `## Queue, lock and restart rules` table paragraph).
- Tests calling `recoverQueue(`/`runJob(`/`drainQueue(`/`cancelRun(`: `api.test.ts` (25), `worktree.test.ts` (16), `sandbox.test.ts` (8), `command-line.test.ts` (5), `hygiene.test.ts` (3). Any that must change only to inject the seam is a DRIFT listed file by file (29-1 consult rule).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/queue.ts` -- add `agents` table to `SCHEMA`, `replaceAgents`, `agents(project?)` -- storage in the queue file.
- `apps/supervisor/src/registry.ts` -- new module per Code Map -- the one mapping table and the rebuild.
- `apps/supervisor/personas.json` -- seven roles, `display_name` each -- shipped bindings.
- `apps/supervisor/src/cli.ts` -- `rebuildQuietly` + `RunOptions` seam + the rebuild points -- rebuild on tick, claim, end.
- `apps/supervisor/src/api.ts` -- `GET /agents` + cookie read route + header -- the consumer route.
- `apps/supervisor/src/page.ts` -- Agents section -- the no-JS fallback.
- `apps/supervisor/test/registry.test.ts` -- the plan's § Verify story-specific cases (mapping, personas, live run, rebuild points, dropped project and failed registry, routes, GET writes nothing, page section) -- pins AC1/AC2.
- `apps/supervisor/README.md` -- route row; `agents` table, role → leg table, persona file -- docs.

**Acceptance Criteria:**
- Given the injected registry and resolve, when `rowsFor`/`rebuildAgents` run, then seven rows per project match `ROLE_LEGS` and the I/O matrix.
- Given `recoverQueue`, a `runJob` claim, and a run end with injected deps, when each runs, then `rebuilt_at` advances.
- Given rows in the table, when `GET /agents` is read with bearer or cookie (with and without `?project=`), then the answer matches the matrix and the table is unchanged.
- Given the status page, when rendered, then `<section id="agents">` lists each project's roles as text and no resolver is called.
- Given the plugin, when the change lands, then nothing under `plugins/` changed, and the lib suite and conformance stay green.

## Spec Change Log

## Review Triage Log

### 2026-10-18 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 2 (claim rebuild shows no live leg: at claim no leg is live yet, no `routing.current.json` exists, consistent with the Design Notes' live-leg rule; runJob/recover rebuild-point coverage: ruled score 1 by consult)
- addressed_findings:
  - `[medium]` `[patch]` `rebuilt_at` read back null after a zero-project rebuild — one-row `agents_meta` written in the `replaceAgents` transaction; `agents()` reads it
  - `[medium]` `[patch]` the HTTP cancel awaited the end-rebuild — `cancelRun` `detachRebuild?` seam passed by `api.ts`; the answer no longer waits
  - `[low]` `[patch]` overlapping rebuilds could write a stale snapshot — clock read before the registry; `replaceAgents` refuses when the stored time is newer (`RebuildSuperseded`)
  - `[low]` `[patch]` `liveRun` read every run once per project — runs read once per rebuild

### 2026-10-18 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 10 (liveRun prefers an older live run with a file over a newer one without: matches the Design Notes' live-leg rule; claim rebuild too early to show the live leg: AC requires a rebuild on claim, rejected the same way in pass 1; `advisor` row reports `model: "off"`: the plan's ruling takes the session leg's advisor value verbatim (`opus`, `fable` or `off`); a cancel that ends nothing still rebuilds: harmless detached work; `?project=` with an empty value answers `[]`: an unknown project answers an empty list per AC2; claim/end/recover rebuild points pinned through the seam and `rebuilt_at: null` on the endpoint untested: consult-accepted in pass 1 / plumbing; external live run counts as no live leg: Design Notes say so explicitly and README agrees; a resume take-over has no immediate rebuild: the recover `finally` rebuild (cli.ts:641) follows `driveResumes`; a live file missing a leg gives `null`: spec says a missing field is `null`, never invented, and `pipeline.py` writes every leg)
- addressed_findings:
  - `[medium]` `[patch]` a wall-clock step back (or a carried-over future `agents_meta.rebuilt_at`) froze the table, every rebuild refused as `RebuildSuperseded` — `replaceAgents(rows, rebuiltAt, current?)` refuses only when `stored > rebuiltAt && stored <= current` (now, read in the transaction); README clause; test with a 2099 stored stamp
  - `[low]` `[patch]` a fresh worktree's `routing.current.json` copied from the checkout (`worktree.ts:207` `COPIED_RUNTIME`) made the new run report the previous story as `current_story` — `liveRun` treats a file whose `written_at` precedes `run.created` (compared to the whole second, per consult: `pipeline.py` writes it to the second) as no file and parses the file once; README clause; two tests (copy skipped; same-second genuine file accepted)

## Design Notes

Live-leg rule (plan): the project's most recently created run in `running`, `paused` or `external` whose `servedRoot(run)` holds `.bmad-loop/routing.current.json` supplies the route for every row of the project, with `current_run = run.run_id`, `current_story = file.story`. No served root (removed worktree, external run) counts as no live leg.

## Verification

**Commands:**
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test` -- expected: no failures beyond the 29-1 baseline (6: closeout `fakeStudioRoot`, five `sbx stop`); `registry.test.ts` green.
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun node_modules/typescript/bin/tsc --noEmit` -- expected: exit 0.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `git diff --stat -- plugins/` -- expected: empty.

## Deviation Summary

### pass 1 (2026-10-18, implementer)

- planned: production paths rebuild by default; tests inject or disable through `RunOptions` / actual: with no deps injected and running under `bun test` (`underBunTest()` marker), `rebuildQuietly` skips; no existing test file edited / why: ~57 existing calls would otherwise spawn `registry.py show`/`pipeline.py resolve` against the operator's registry (hole-31 precedent) / may affect: 29-3
- planned: `PageData` gains `agents` / actual: optional field; renderer shows a note when absent / why: `auth.test.ts`, `closeout.test.ts` build `PageData` literals / may affect: none
- planned: rebuild on recover, claim, end pinned through existing fixtures / actual: end pinned via `cancelRun` with injected deps; recover and drain pinned in a block skipped without `TK_STUDIO_ROOT`; claim pinned only via the `rebuildQuietly` seam / why: `runJob` fixture is private to `command-line.test.ts`; plan allows the seam fallback / may affect: none
- planned: the `RunOptions` seam / actual: `cancelRun`'s own deps object also gains `agents?` / why: `cancelRun` does not take `RunOptions` / may affect: none
- planned: `agents(project?)` returns rows / actual: returns `{rebuilt_at, rows}`, `rebuilt_at` = latest across the table (null after a zero-project rebuild) / why: filtered or unknown-project reads still carry the rebuild time / may affect: none

Note (consult): the tick (recover) and claim rebuilds are pinned through the `rebuildQuietly` seam; the direct `recoverQueue`/`drainQueue` test runs only when `TK_STUDIO_ROOT` is set and `uv` is present (`recoverQueue` calls `requireStudio()` first, cli.ts:626).

DEVIATION SCORE: 1 (accepted by consult)

- DRIFT: `rebuildQuietly` skips under `bun test` when no deps are injected — keeps ~57 existing calls off the real registry — affects: 29-3
- DRIFT: `PageData.agents` optional — existing test literals — affects: none
- DRIFT: claim rebuild pinned via the `rebuildQuietly` seam, recover/drain in a `TK_STUDIO_ROOT`-gated block — `runJob` fixture private to command-line.test.ts — affects: none
- DRIFT: `cancelRun` deps gain `agents?` — it takes no `RunOptions` — affects: none
- DRIFT: `queue.agents()` returns `{rebuilt_at, rows}` — rebuild time on filtered reads — affects: none


### pass 2 (2026-10-18, review patches)

- planned: an `agents` table only / actual: a one-row `agents_meta` table holds `rebuilt_at`; `replaceAgents` returns a boolean and refuses a stale snapshot (`RebuildSuperseded` → `rebuilt:false`) / why: review patches 1 and 3 / may affect: 29-3
- planned: the cancel's end-rebuild awaited / actual: `cancelRun` deps gain `detachRebuild?`, which `api.ts` passes; `ApiDeps` gains `agents?`/`onAgentsRebuild?` test seams / why: review patch 2 (Story 22.3: the cancel answer never waits on unrelated work) / may affect: none
- Correction to pass 1: `queue.agents()` no longer reads `rebuilt_at: null` after a zero-project rebuild; only a queue that has never been rebuilt reads null.

DEVIATION SCORE: 1 (accepted by consult)

- DRIFT: `agents_meta` one-row table plus a stale-snapshot refusal (`replaceAgents` returns a boolean, `RebuildSuperseded` → `rebuilt:false`); `rebuilt_at` read from `agents_meta` — affects: 29-3
- DRIFT: `cancelRun` deps gain `detachRebuild?`; the HTTP cancel does not await the rebuild; `ApiDeps` gains `agents?` and `onAgentsRebuild?` test seams — affects: none

### pass 3 (2026-10-18, follow-up review patches)

- planned: `replaceAgents(rows, rebuiltAt)` refuses any snapshot older than the stored stamp / actual: optional `current` clock; a stored stamp later than now (a clock that moved back) never blocks / why: follow-up review patch (medium) / may affect: none
- planned: `liveRun` returns `{run, file}`; a served root holding the file is the live leg / actual: returns `{run, file, route, error?}` (file parsed once); a file whose `written_at` precedes `run.created` at whole-second precision is no file / why: follow-up review patch (low), AC1's "the run's `routing.current.json`"; consult-ruled / may affect: 29-3
- planned: the second-precision test builds its run through the fixture / actual: the test sets the run's `created` directly in the queue's SQLite file (`bun:sqlite`) to force a non-zero millisecond part / why: the queue stamps `created` itself, and only this makes the test fail reliably without the fix / may affect: none

DEVIATION SCORE: 1 (accepted by consult)

- DRIFT: live leg skips a `routing.current.json` whose `written_at` precedes `run.created` (a checkout copy), compared to the second — affects: 29-3 (`current_run`/`current_story` stay `null` until the engine rewrites the file)
- DRIFT: `replaceAgents` gains an optional `current` clock; a future stored `rebuilt_at` never blocks a rebuild — affects: none

## Consult Log

- 2026-10-18T02:18:26Z — trigger: deviation-gt-0 — question: accept the five pass-1 deviations at score 1, notably the `underBunTest()` default-skip in `rebuildQuietly` and the tick/claim rebuilds pinned through the seam rather than a default-run test? — ruling: accept-deviation score 1 — do: accept all five at score 1 and go on to review; note in pass 1 that tick and claim are pinned through `rebuildQuietly` and the direct recover/drain test needs TK_STUDIO_ROOT and uv; change no existing test file and keep the default-skip — rule candidate: A rebuild point behind `requireStudio()` may be pinned through its injectable seam (with a `describe.skipIf(!TK_STUDIO_ROOT)` direct test), and a side-effecting default may switch off via `underBunTest()` as long as an explicit injection still wins; both are score 1 and need no consult.
- 2026-10-18T02:29:09Z — trigger: deviation-gt-0 — question: accept the review-patch pass at score 1 (`agents_meta` table and stale-snapshot refusal; `detachRebuild` cancel seam and `ApiDeps` test seams), or is either a seam 29-3/29-4 rely on (score 2)? — ruling: accept-deviation score 1 — do: accept both at score 1, change no code; one DRIFT line each (agents_meta → affects 29-3; detachRebuild → affects none); correct the stale pass-1 DRIFT about a null `rebuilt_at` after a zero-project rebuild — rule candidate: A review-pass patch that adds internal storage (an extra table or meta row) or a test-only or non-blocking deps seam is score 1 with no consult, provided the HTTP response shape, the exported mapping tables and the driver-contract surface are unchanged and the README lists the new table. (The ruling said to put the DRIFT lines in "the plan". This session writes only the spec, so they went into the spec's Deviation Summary, pass 2.)
- 2026-10-18T02:40:16Z — trigger: deviation-gt-0 — question: accept the follow-up review patches at score 1 (`replaceAgents` optional `current` clock so a future stored stamp never blocks; `liveRun` widened to `{run, file, route, error?}` and skipping a `routing.current.json` whose `written_at` precedes `run.created`), or score 2 / reject? — ruling: accept-deviation score 1 — do: accept both at score 1 without changing the HTTP shape, ROLE_LEGS/ROLES or replaceAgents' boolean contract; before committing, compare at whole-second precision (pipeline.py writes `written_at` with timespec=seconds) so a same-second genuine file is not a copy, and add one test; add a pass-3 DRIFT line (live leg skips a checkout-copied file — affects 29-3; the clock guard affects none) — rule candidate: A review patch that narrows when a non-seam internal helper counts an input as live, to match the AC's wording over a looser Design Notes paraphrase, is score 1 with a DRIFT line naming the story that consumes the visible field; any timestamp comparison must truncate both sides to the coarser writer's precision.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (all effort medium, advisor off); knowledge spine absent

**Summary:** Follow-up review of the agent registry (Story 29.2, committed at a584f8e). The story's behaviour is unchanged: an `agents` table in the queue file, seven rows per served project from the resolved route through `ROLE_LEGS`, rebuilt on recover, claim and end, served read-only by `GET /agents[?project=]` and the status page's Agents section. This pass hardened two edges. (1) A wall-clock step back no longer freezes the table: the stale-snapshot guard ignores a stored `rebuilt_at` in the future. (2) A fresh worktree's `routing.current.json` copied from the checkout no longer passes for the new run's live leg. A file whose `written_at` precedes `run.created`, compared to the whole second, counts as no file.

**Files changed (this pass):**
- `apps/supervisor/src/queue.ts`: `replaceAgents` gains an optional `current` clock; a future stored stamp never blocks.
- `apps/supervisor/src/registry.ts`: `liveRun` parses the file once, returns `{run, file, route, error?}`, and skips a checkout copy (second-precision `written_at` vs `created`); `rebuildAgents` uses the parsed route.
- `apps/supervisor/test/registry.test.ts`: three tests (future stored stamp; copied file skipped; same-second genuine file accepted); the live-run fixture's `written_at` is now after the run's creation.
- `apps/supervisor/README.md`: one clause per patch in the agent-registry paragraph.

**Review:**
- Blind Hunter and Edge Case Hunter (band L, both layers ran).
- 2 patches applied (high 0, medium 1, low 1), 0 deferred, 10 rejected.
- Follow-up review recommended: false. Patched high 0, medium 1, low 1; score 3×1+1 = 4 < 5.

**Verification** (run by this session after the patches):
- `bun test` (apps/supervisor): 812 pass, 6 fail, 72 skip (890 tests). The 6 failures are the baseline (the closeout `fakeStudioRoot` case and the five `sbx stop` cases); none are new.
- `tsc --noEmit`: exit 0.
- Lib suite: OK (1365 tests, 1 skipped).
- Conformance: `ok: true`.
- `git diff --stat -- plugins/`: empty.

**Residual risks:**
- Between materialise and the engine's first rewrite of `routing.current.json`, a new run shows the resolved route with `current_run`/`current_story` `null` (DRIFT, affects 29-3).
- A file with a missing or unparseable `written_at` is still accepted as the run's own.
- Carried from pass 1: in a default `bun test` run, the tick and claim rebuilds are pinned only through the `rebuildQuietly` seam (consult-accepted); production rebuilds spawn `uv` per project on every tick, claim and end.

**Deviations** (deviation_score 1; every one consult-accepted):
- DRIFT: `rebuildQuietly` skips under `bun test` when no deps are injected — keeps ~57 existing calls off the real registry — affects: 29-3
- DRIFT: `PageData.agents` optional — existing test literals — affects: none
- DRIFT: claim rebuild pinned via the `rebuildQuietly` seam, recover/drain in a `TK_STUDIO_ROOT`-gated block — `runJob` fixture private to command-line.test.ts; `recoverQueue` calls `requireStudio()` first — affects: none
- DRIFT: `cancelRun` deps gain `agents?` and `detachRebuild?` — it takes no `RunOptions`; the cancel answer must not wait on the rebuild — affects: none
- DRIFT: `queue.agents()` returns `{rebuilt_at, rows}` with `rebuilt_at` from a one-row `agents_meta`; `replaceAgents` refuses a stale snapshot (`RebuildSuperseded`) — review patches — affects: 29-3
- DRIFT: `ApiDeps` gains `agents?` and `onAgentsRebuild?` test seams — to pin the non-blocking cancel — affects: none
- DRIFT: live leg skips a `routing.current.json` whose `written_at` precedes `run.created` (a checkout copy), compared to the second — AC1's "the run's file"; follow-up review patch — affects: 29-3
- DRIFT: `replaceAgents` gains an optional `current` clock; a future stored `rebuilt_at` never blocks a rebuild — a clock step back froze the table — affects: none

## Reconcile

- 2026-10-18 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 29-3-the-office-projection-semantic-states-progress-and-its
