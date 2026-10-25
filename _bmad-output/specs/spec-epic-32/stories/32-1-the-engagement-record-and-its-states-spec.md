---
title: 'The Engagement Record and Its States'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '909a5ea1dbc5adadc784b31f95a0171f90a6d857'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-32/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Hiring the studio has no record of its own: there is no engagement, no state, and no typed way to move it. The owner cannot read or trust where a piece of hired work stands (§7.1; F2 steps 1 and 8).

**Approach:** Lay the engagement loop's foundation in the supervisor (AD-2). There is one `engagement.yaml` per engagement in the served project's `_bmad-output/engagements/<id>/`. `POST /engagements` creates it, two GET routes read it, and only the typed inputs of `POST /engagements/{id}/input` move it. Each move is a row of one exported transition table in `apps/supervisor/src/engagement.ts`. The record is also surfaced on the office snapshot and stream and on the board's Needs-you column, additive on contract 0.1.27.

User story: As the owner, I want an engagement created from a request and moved only by typed inputs, so that hiring the studio has one record whose state I can read and trust.

Acceptance criteria (verbatim from epics.md Story 32.1):

- **AC1. Given** a registered project and a request in plain language **When** `POST /engagements {project, request}` arrives (the bearer, or a session cookie with `X-CSRF-Token`, else 403 CsrfRefused) **Then** the supervisor writes `_bmad-output/engagements/<id>/engagement.yaml` in the served project's root (the id `ENG-NNN` from the plan counter's new `engagement` series; `shape_version: 1`; the §7.1 fields `id, project, state, request, questions[], assumptions[], scope_page, quote, autonomy, approved_at, closeout`, plus `created`, `updated`, `spend {planning_usd, runs_usd}` and `inputs[]`, the typed-input log) in state `intake`, appends a queue event `engagement {id, project, state, from: null}`, and answers 200 `{ok, engagement}`; `GET /engagements?project=<id>` lists the project's engagements newest first and `GET /engagements/{id}` reads one with its chat pointer (32.2); a cookie session reads both; an unregistered project is 404 UnknownProject; contract 0.1.27 (additive) names the routes.
- **AC2. Given** the states `intake → awaiting-answers → scoping → quoted → approved → in-progress → delivered` with the side exits `paused`, `failed`, `partial`, `cancelled` **When** `POST /engagements/{id}/input {verb, …}` arrives with one of `answer`, `go`, `revise`, `question`, `approve`, `cancel` (each with its typed payload, checked by schema) **Then** exactly the transitions of one exported table in `apps/supervisor/src/engagement.ts` apply (the table is written into the contract's §7.1 row and tested row by row); any other body is 400 SchemaError, a verb illegal in the current state is 409 IllegalInput `{state, verb}`, a terminal state 409 EngagementClosed; nothing else moves `state`: not a chat message, not the planner, not a timer (leaving planning is an explicit exit, F2 step 5); every applied input is appended to `inputs[]` with its time and its source (`bearer` | `cookie` | `planner` for 32.3's one exception) and emits an `engagement` event carrying `from`; `bun test` covers every row of the table and every refusal.
- **AC3. Given** the office and the board **When** an engagement exists **Then** `GET /office` and the stream's snapshot carry `engagements[] {id, project, state, title (the request's first line, 80 characters), needs_you}` (contract 0.1.27, additive) and the hub emits `office.engagement {id, state, from}` deltas on each change; `GET /board`'s Needs-you column lists the project's engagements in `awaiting-answers` and `quoted` as items `{engagement, state, title}`; the office projection's and the board's tests cover the rows.

## Boundaries & Constraints

**Always:**
- Use the planner's Settled shape 1 to 6 (plan §Settled shape; SPEC Design notes) exactly as written: the chat pointer, the `next.engagement` counter series, the typed payload per verb, the event rows with `applyEvent` and `source: supervisor`, `follows` refused, and the `engagement` service event.
- The transition table in the plan's Code Map is the one exported `TRANSITIONS`. Any other code path that sets `state` is forbidden.
- Mint the counter atomically **before** the record lands. Every other key and `counter_version` are preserved, and the written YAML stays readable by `plansync.py`'s reader.
- Record writes are atomic (tmp then rename). The event is emitted only after the record has landed.
- Write the record table into the contract as `### The engagement state table (0.1.27, Story 32.1)` after the §1 web-surfaces table. Bump the contract version cell to 0.1.27 and keep it additive.
- Stay within the plan's Files list (11 files). Show paths root-relative in `problems[]` (AD-15).

**Block If:**
- The Files list must grow, for example to a plugin lib file, a web file, `queue.ts`, `closeout.ts` or `resolution.ts`: HALT naming the file.
- `js-yaml`'s dump of the counter is not re-readable by `plansync.py`'s `miniyaml` (a flow mapping, a quoted int, a document marker): HALT with both outputs.
- A reviewer reads "the contract's §7.1 row" as a change to the design README's §7.1: HALT naming both readings.

**Never:**
- No planner, chat, questions, scope, quote side effects or closeout (32.2 to 32.8).
- No web change (32.7), and no edit to the committed `.tk-studio/plan-counter.yaml`.
- No `follows` field, and no planner `{questions[], run_id}` over HTTP.
- No push, tag or release motion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| create | bearer `POST /engagements {project, request}` | 200 `{ok, engagement}` in `intake`, file written, service event `from: null` | — |
| cookie create, no CSRF | cookie session, no `X-CSRF-Token` | nothing written | 403 CsrfRefused |
| unknown project | `project` not in registry | nothing written | 404 UnknownProject |
| bad body | extra field / empty request / non-JSON | nothing written | 400 SchemaError / MalformedJson |
| legal input | `go` in `intake` | 200 `{ok, engagement, from:"intake", to:"scoping"}`, `inputs[]` line, event with `from` | — |
| illegal input | `approve` in `intake` | state unchanged | 409 IllegalInput `{state, verb}` |
| terminal | any verb in `delivered`/`failed`/`cancelled` | state unchanged | 409 EngagementClosed |
| guarded go | `go` in `scoping`, `quote` null | state unchanged | 409 IllegalInput `detail: "no quote"` |
| bad id | `GET /engagements/foo` | — | 400 BadEngagement; a missing `ENG-NNN` is 404 UnknownEngagement |
| wrong method | `PUT /engagements` | — | 405 with `Allow` |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-32/plans/32-1.md` §Code Map) is the investigation, with line anchors. The implementer reads it in full. In summary:

- `apps/supervisor/src/engagement.ts` (new) -- the types, `checkInputBody`, `TRANSITIONS`, `applyInput` and `applyEvent` (pure), `titleOf`, `needsYou`, the IO (`readEngagement`, `writeEngagement`, `listEngagements` with a cache and `problems[]`), `mintEngagementId` and `chatPointer`. Style reference: `checkReplyBody` (`inbox.ts:209`). `REPLY_MAX_BYTES` is `inbox.ts:50`. The counter semantics are in `plansync.py:20-24,197-240`.
- `apps/supervisor/src/api.ts` -- the four routes beside `/inbox`; the `via: "bearer"|"cookie"` threaded the way `csrf` is; the cookie read and CSRF-POST allowances; the `knownRoots` registry wrapper feeding the office's `roots`; the header doc. Root resolution is `registryRoot` (`inbox.ts`).
- `apps/supervisor/src/office.ts` -- `OfficeView.engagements`, `OfficeHubOptions.roots`, the `office.engagement` diff in `refresh()`, and the `OfficeEventKind` addition.
- `apps/supervisor/src/board.ts` -- the triage `needs_you` union `TriageItem | EngagementTriageItem`, with engagement items appended after the run items.
- `apps/supervisor/src/queue.ts:1982-1988` -- `serviceEvent` / `serviceEvents`, read-only.
- `plugins/tk-studio/contracts/driver-contract.md` -- the version cell (line 5, currently 0.1.26), the §1 web-surfaces table (~line 90-113), and the new state-table subsection.
- `apps/supervisor/README.md` -- the HTTP API table, the board triage bullet and the office projection section.
- Tests: `test/engagement.test.ts` (new), `test/api.test.ts`, `test/office.test.ts` and `test/board.test.ts`, with fixtures per the plan.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/engagement.ts` -- create the module per the plan's Code Map and Settled shape -- it holds the record, the table and the IO (AC1, AC2).
- `apps/supervisor/src/api.ts` -- add the routes, the auth source threading and the cookie allowances -- AC1 and AC2 surfaces.
- `apps/supervisor/src/office.ts` -- add `engagements[]` and the `office.engagement` deltas -- AC3.
- `apps/supervisor/src/board.ts` -- add the Needs-you engagement items -- AC3.
- `apps/supervisor/test/engagement.test.ts` -- test every table cell, every refusal, `checkInputBody` per verb, `titleOf`, the mint (including Python-reader compatibility of the written counter), the IO and `chatPointer` -- AC2's row-by-row requirement.
- `apps/supervisor/test/api.test.ts`, `office.test.ts`, `board.test.ts` -- cover the route, office and board rows listed in the plan -- AC1 and AC3.
- `plugins/tk-studio/contracts/driver-contract.md` -- add the 0.1.27 entry, the §1 rows and the state table subsection -- AC1 and AC2 (contract names the routes and table).
- `apps/supervisor/README.md` -- document the routes, the board item and the office field.

**Acceptance Criteria:**
- Given the table, when `bun test test/engagement.test.ts` runs, then every `(state, verb)` cell and event row from the plan table has a passing assertion.
- Given the counter written by `mintEngagementId`, when `plansync.py`'s `load_counter` reads it, then `epic`, `story` and `task` are unchanged and it parses.
- Given the contract, when the verify gate runs, then the lib suite is green and conformance is `ok: true`.

## Spec Change Log

## Review Triage Log

skipped-layer: none — band L, both blind-hunter and edge-case-hunter ran

### 2026-10-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 3, low 2)
- defer: 0
- reject: 1 (low 1): a race between the supervisor and plansync.py on plan-counter.yaml. Both writes are atomic and both minters skip existing ids (`mintEngagementId`'s directory check; `plansync.py:223-240`), so a lost increment cannot duplicate an id.
- addressed_findings:
  - `[high]` `[patch]` A project-less `GET` or `POST /engagements/{id}[/input]` took the first registry project holding a repeated `ENG-NNN`. It now answers 409 AmbiguousEngagement `{engagement, projects[]}` when more than one served root holds the file; `?project=` settles it. Consult ruling applied; documented in the contract and README; three api tests.
  - `[medium]` `[patch]` The office read engagements from the newest run's root before the registry root the routes write to. Now registry root first, run root as fallback; test added.
  - `[medium]` `[patch]` No test tied the contract's state table to `TRANSITIONS`. engagement.test.ts now parses the contract subsection and checks equality in both directions.
  - `[medium]` `[patch]` Lost update: the record was read before an await and written after it. It is re-read synchronously before `applyInput`; a concurrent `Promise.all` test fails without the fix.
  - `[low]` `[patch]` A record whose `id` differs from its directory is now `EngagementRecordInvalid` and listed in `problems[]`.
  - `[low]` `[patch]` An open stream never picked up later-registered roots. The hub's `roots()` now starts a detached registry refresh after 60 s; the unauthorized-request rule holds (page.test.ts green).

### 2026-10-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 0
- reject: 3 (low 3)
  - A counter mapping with no `next` is 500 EngagementCounterInvalid. Not a defect: `plansync.py:209-213` rejects the same file, and the default named in Settled shape 2 applies to an absent `next.engagement`, not an absent `next`.
  - A transient `readdirSync` failure (EMFILE/EACCES) empties the list. This is FS-error plumbing that no criterion names.
  - Merged into the medium patch below as a duplicate: the edge-case hunter's concurrent-office-read finding.
- addressed_findings:
  - `[medium]` `[patch]` The office treated an empty `roots` map as the registry's roots before any registry read had succeeded. As a result, the status page, a concurrent second `GET /office`, or a failing `registry.py show` showed `no served root` problem lines and hid registry-root engagements. Fix: `roots` is `undefined` until a read succeeds (`rootsKnown`), and every office read awaits the first read's shared promise. Two office tests added.
  - `[low]` `[patch]` `parseRecord` let `questions: [null]` through, so `answer`/`go` threw an unnamed 500. It now requires a string `request`, a mapping in every `inputs[]`/`questions[]`/`assumptions[]` entry, and a non-empty question `id`. Per the consult, `set-questions` now stores only id-bearing mappings. Tests were added in engagement.test.ts (invalid reads, a list that skips and names the record, a write-then-read round trip) and in api.test.ts (500 EngagementRecordInvalid).
  - `[low]` `[patch]` `POST /engagements` on a registry root missing on disk recreated a phantom root. It is now 500 EngagementRootMissing with nothing created; api test added.
  - `[low]` `[patch]` The contract rows and the api.ts header doc left out refusals: EngagementRootMissing, EngagementCounterInvalid, BadEngagement, UnknownEngagement and EngagementRecordInvalid on input, AmbiguousEngagement, and CsrfRefused. They are now listed and consistent with the README; the version stays 0.1.27.
  - `[low]` `[patch]` The README cookie paragraph said that CSRF covers only `POST /runs/{id}/cancel` and that no other cookie POST is allowed. It now names the four CSRF-gated cookie POSTs `cookieRoute` allows, and keeps the never-`POST /jobs` rule.

### 2026-10-25 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 0
- reject: 4 (low 4)
  - The first `GET /office` / `GET /office/events` awaits one `registry.py show`, which can take up to its 120 s timeout. This was the previous pass's deliberate choice, so that the first snapshot already shows the engagements. It runs once per process, a shared promise covers concurrent reads, and `GET /board` and `/inbox` already await the same subprocess.
  - No engagement GET returns `X-CSRF-Token`. The token is session-scoped (`csrfToken(secret, cookie)`), so the one `GET /inbox` already publishes serves every CSRF-gated cookie POST. Getting it is the 32.7 web client's job.
  - A failing `registry.py show` answers `500 InternalError` on the engagement routes. That is the generic fault answer every route gives (api.ts top-level handler), not a refusal.
  - `office.engagement` sends `state: null` while a malformed record is still on disk. The delta mirrors the snapshot: `engagements[]` leaves out the unreadable record and `problems[]` names it. A repaired record reappears as `from: null`, consistent with "appeared".
- addressed_findings:
  - `[low]` `[patch]` The engagement `problems[]` line was `engagements/<id>/engagement.yaml`, which is not root-relative as the contract and AD-15 require, and the office lines were identical across projects. `listEngagements` now uses `shownPath(id)` (`_bmad-output/engagements/<id>/engagement.yaml: <reason>`), and the office prefixes `project <id>: ` (the `run <id>: ` convention). Tests and README updated.
  - `[low]` `[patch]` `raise-cap` checked `r.quote !== null`, so a record with no `quote` key went from `partial --go {cap}-->` to `quote: {cap}`. The guard is now `isObject(r.quote)`, and an engagement.test.ts case was added.

## Design Notes

- "The contract's §7.1 row": the contract has no §7.1. The planner's reading is a contract subsection holding the table, naming design README §7.1 as its source. This is a note, not a DRIFT.
- `source: "supervisor"` on event rows (Settled shape 4; SPEC Open Question 2): these rows have no caller in 32.1, so the HTTP-applied sources stay `bearer` | `cookie` as the AC names. `planner` is reserved for 32.3.
- `scoping --go--> quoted` only with a non-null quote (SPEC Open Question 1, the planner's reading).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && ~/.bun/bin/bun test` -- expected: green (the four touched files first)
- `cd apps/supervisor && ~/.bun/bin/bunx tsc --noEmit` -- expected: clean
- `grep -c "0.1.27" plugins/tk-studio/contracts/driver-contract.md` >= 3; `grep -n "engagement state table" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "/engagements" apps/supervisor/README.md` >= 4
- `git diff --stat -- .tk-studio/plan-counter.yaml` -- expected: empty; `git status --porcelain` lists only the Files

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: bump the contract version cell to **0.1.27** / actual: the header still reads **0.1.26**; the 0.1.27 entry, rows, note and state table are written / why: Block If 1. The bump needs `plugins/tk-studio/lib/tests/test_driver_contract.py` (it asserts `**0.1.26**` in the header and `**0.1.27**` not, lines 380-664), which is outside Files; the attempt failed 11 tests and was reverted / may affect: 32-2..32-8
- planned: the state-table subsection right after the §1 web-surfaces table / actual: at the end of the web-surfaces section, before `### Project root (0.1.22)` / why: lib tests bound that section at the next `### ` heading / may affect: none
- planned: `OfficeView.engagements` required / actual: optional in the type, always present on the wire / why: `page.ts` (outside Files) builds an `OfficeView` literal / may affect: 32-7
- planned: `office.engagement` diffed by `id` / actual: diffed by project plus id / why: each served root mints its own ENG-NNN series, so ids can collide across projects / may affect: 32-7
- planned: `knownRoots` seeded at construction / actual: the first office read awaits one registry read, refreshed at most once a minute, skipped under test with no injected registry / why: an existing page test forbids an unauthorized request from reading the registry / may affect: none
- planned: the `engagements: no served root` problem whenever agents name the project / actual: only when `roots` is supplied / why: existing office tests expect `problems: []` / may affect: none
- planned: `listEngagements(root): Engagement[]` / actual: `listEngagements(root, problems?)` / why: keeps the return type while reporting bad records / may affect: none
- planned: the answer shapes were unspecified / actual: `GET /engagements/{id}` answers `{ok, project, engagement, chat}`, the list answers `{ok, project, engagements, problems}`, and refusals carry `engagement` / why: names the target / may affect: 32-2, 32-7
- planned: tests only in the four named files / actual: existing helpers and assertions adjusted in `board.test.ts` and `office.test.ts` (both are named Files) / why: the Needs-you union and the snapshot keys / may affect: none
- implementer score: 3
- process note: the implementer found /tmp out of inodes and deleted about 114k stale `tk-sup-*` test directories older than 60 minutes. These were outside the repo and left by earlier supervisor test runs.

DRIFT: contract header not bumped to 0.1.27 — test_driver_contract.py pins 0.1.26 and is outside Files — affects: 32-2..32-8
DRIFT: state-table subsection placed at the end of the web-surfaces section — lib tests bound the section at the next ### — affects: none
DRIFT: OfficeView.engagements optional in the type — page.ts outside Files builds an OfficeView — affects: 32-7
DRIFT: office.engagement keyed by project+id — ENG ids are per served root — affects: 32-7
DRIFT: knownRoots lazy-seeded on the first office read — an existing test forbids unauthorized registry reads — affects: none
DRIFT: GET /engagements answer shapes named by the implementer — the plan left them open — affects: 32-2, 32-7

### pass 2 (2026-10-25, implementer, applying the consult ruling)

- supersedes pass 1, deviation 1, per the consult: the header is now **0.1.27**. `plugins/tk-studio/lib/tests/test_driver_contract.py` was added as file twelve (outside the plan's Files, accepted by the consult at score 1). The pass-1 header DRIFT line is void.
- planned: move six version pins and drop one assertNotIn / actual: moved all ten identical `**0.1.26**` pins and the semver `assertRegex` (about line 107), and dropped all five `assertNotIn("**0.1.27**")` / why: they assert the same version cell / may affect: none
- planned: the new 32.1 test checks four things / actual: it also pins Story 32.1 in the rulings row, both answer shapes, the "keyed by project plus id" wording, and the absence of `**0.1.26**` / why: it pins the seams written in fix 2 / may affect: 32-2..32-8 (they must keep these strings)
- the seams the consult scored 2 are now explicit in the contract's 0.1.27 rows and the README: the GET answer shapes, and `office.engagement` carrying `project`, keyed by project plus id.
- the four bun test files pass only with `~/.bun/bin` on PATH (two api tests exec `env bun`). This is the environment, not a code change.
- story score per consult: 2

DRIFT: test_driver_contract.py edited (file outside Files) — its version pins block the 0.1.27 bump AC1 requires; consult accepted it, score 1 — affects: none
DRIFT: GET /engagements answer shapes and office.engagement keyed by project+id carrying project — these seams were open in the plan and are now pinned in the 0.1.27 contract rows — affects: 32-2, 32-7

### pass 3 (2026-10-25, review patches)

- planned: the plan's Code Map (`plans/32-1.md:45`) says a project-less id lookup takes the first hit / actual: more than one served root holding the id is `409 AmbiguousEngagement {engagement, projects[]}`, recorded in the 0.1.27 contract rows and the README / why: per-root ENG series repeat ids, and first-hit misroutes inputs (AC2); the consult ruled score 2. The plan file is not edited (planner's artifact); this entry records the replacement rule / may affect: 32-2, 32-7 (send `?project=` whenever an id can repeat)
- planned: the office root is the newest run's root, else the registry roots / actual: the registry roots, else the newest run's root / why: one root for routes, board and office (AC3) / may affect: none
- story score unchanged: 2

DRIFT: project-less engagement lookup refuses ambiguity (409 AmbiguousEngagement) instead of taking the first hit — ENG ids repeat across served roots and first-hit misroutes inputs; consult ruled score 2 — affects: 32-2, 32-7
DRIFT: office engagement root order inverted (registry root first) — matches the root the routes and board use — affects: none

### pass 4 (2026-10-25, follow-up review)

- DRIFT: parseRecord requires a string request, mapping entries and a non-empty question id, and set-questions keeps only id-bearing questions. This was needed because a malformed record crashed the input route with an unnamed 500; the consult ruled option (B). Score 1. Affects: none (32.3's questions already carry `id`, per epics.md Story 32.3).
- DRIFT: the office hub's `roots` callback may return `undefined` ("registry not read yet"). This was needed because an unread registry produced false `no served root` lines. Score 1, local. Affects: none.

## Consult Log

- 2026-10-25T04:00:21Z — trigger: file-outside-files + deviation-gt-0 + halt (plan Block If 1) — question: bumping the contract header to 0.1.27 requires editing test_driver_contract.py, which is outside Files; halt, touch it, or leave 0.1.26 as DRIFT? Also rule on the other pass-1 deviations — ruling: accept-deviation score 2 — do: (1) add test_driver_contract.py as file twelve: move the version-head pins to 0.1.27, drop assertNotIn 0.1.27, add a 32.1 pin (0.1.27 present after the 0.1.26 clauses, 0.1.28 absent, routes and the engagement state table present), then bump driver-contract.md:5 and pass the lib suite and conformance; (2) drop the header DRIFT and rewrite it as a file outside Files at score 1; accept the other deviations at 1, except office.engagement keyed by project+id and the GET answer shapes at 2, which go into the contract's 0.1.27 rows and the README, with the delta carrying project additively; (3) story score 2, no halt — rule candidate: any story whose Files include driver-contract.md and that opens or extends a contract version also lists plugins/tk-studio/lib/tests/test_driver_contract.py in Files — observe record: "ok": true
- 2026-10-25T04:11:24Z — trigger: high-severity-finding — question: a project-less GET or POST on /engagements/{id} takes the first registry project holding ENG-NNN, and ids repeat across served roots; patch, bad_spec, defer or escalate? — ruling: apply — do: (1) in locateEngagement with no ?project=, a hit is a project whose record file exists; more than one hit is 409 AmbiguousEngagement {engagement, projects[]} before any read, one hit reads as today (malformed stays 500), none is 404, and ?project= behaves as today; (2) document the refusal in the contract's 0.1.27 rows and the README, and add bun tests (same id in two projects gives 409 for GET and POST with nothing written; malformed plus valid gives 409; ?project= settles it); (3) replace "first hit wins" with this rule as DRIFT score 2; a patch, not bad_spec — applied, except the plan-file edit: plans/32-1.md is the planner's artifact and outside Files, so the rule change is recorded in this spec's Deviation Summary instead — rule candidate: an id minted from a per-project counter and resolved by a route with no project refuses ambiguity with a 409 naming the candidate projects, never the first match — observe record: "ok": true

- 2026-10-25T04:30:48Z — trigger: deviation-gt-0 (follow-up review pass) — question: parseRecord now requires a mapping in every questions[]/assumptions[]/inputs[] entry, a non-empty question id and a string request, while set-questions (engagement.ts:271) stores questions with no id; the hub's roots callback is widened to allow undefined; accept, filter at the writer, reject, or score 2? — ruling: accept-deviation score 1 — do: (1) keep the three parseRecord checks and the widened roots type; (2) in set-questions keep only isObject(q) && nonEmpty(q.id), plus one engagement.test.ts case where a questions event stores only the id-bearing entries and the record reads back cleanly; (3) log both deviations at score 1 with option (B) — rule candidate: when a story adds a validation rule to a record reader, the same story applies it in every effect or writer that stores the field, and tests that what it writes reads back; a reader stricter than its writer is a patch, not a deviation — observe record: "ok": true

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg, read from `.bmad-loop/routing.current.json`); knowledge spine absent

**Summary.** This run was a second follow-up review of the done story, delivered by 12357bf and 5a7b4d7. It covered:
- the engagement record `_bmad-output/engagements/ENG-NNN/engagement.yaml`;
- the four `/engagements` routes;
- the one exported `TRANSITIONS` table;
- `engagements[]` and `office.engagement`;
- the board's Needs-you engagement items;
- contract 0.1.27.

Both layers reviewed the full diff since 909a5ea and two low findings were patched. The routes, the table, the contract text and the contract version are unchanged.

**Files changed in this pass**
- `apps/supervisor/src/engagement.ts`:
  - `listEngagements` problem lines now use `shownPath(id)`, which is root-relative;
  - `raise-cap` guards on `isObject(r.quote)`.
- `apps/supervisor/src/office.ts`: `engagementsOf` prefixes each engagement problem line with `project <id>: `; the doc comment is updated.
- `apps/supervisor/test/engagement.test.ts`: the problem-line assertions are updated, and a new case covers `partial` → `go {cap}` with no `quote` key.
- `apps/supervisor/test/office.test.ts`: the test now expects two distinct per-project problem lines.
- `apps/supervisor/README.md`: the `GET /engagements` row and the office projection section show the new line format.

**Review.** 6 raw findings from two layers (blind-hunter 4, edge-case-hunter 2): 2 patched (high 0, medium 0, low 2), 0 deferred, 4 rejected. No consult was triggered: the implementer reported deviation 0, there was no high-severity finding, and no file outside Files was touched.
Follow-up review: not recommended (false). Patched counts are high 0, medium 0 and low 2, for a score of 3×0 + 2 = 2, which is below 5.

**Verification**
- `bun test test/engagement.test.ts test/api.test.ts test/office.test.ts test/board.test.ts test/page.test.ts` (with `~/.bun/bin` on PATH): 314 pass, 7 skip, 0 fail.
  - The implementer's first run without `bun` on PATH failed 2 api child-process tests with `env: 'bun': No such file or directory`. This is environmental.
- `bunx tsc --noEmit`: clean.
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1821 OK, 2 skipped.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- On the contract, `grep -c 0.1.27` gives 9 and `engagement state table` has 3 hits. On the README, `grep -c /engagements` gives 8.
- `.tk-studio/plan-counter.yaml` is untouched. `git status` named only the five Files above plus this spec.

**Residual risks**
- 32.2 and 32.7 clients must send `?project=` when an id can repeat (409 AmbiguousEngagement).
- 32.3's planner questions must carry a non-empty `id`.
- 32.7's web client must take the CSRF token from `GET /inbox`, because no engagement GET returns it.
- A hung `registry.py show` stalls the first office read for up to 120 s.
- SPEC Open Questions 1 to 3 stay open to the operator.
- Supervisor tests leave stale `/tmp/tk-sup-*` directories.

DRIFT: test_driver_contract.py edited (file outside Files) — its version pins block the 0.1.27 bump AC1 requires; consult accepted it, score 1 — affects: none
DRIFT: state-table subsection placed at the end of the §1 web-surfaces section — lib tests bound the section at the next ### — affects: none
DRIFT: OfficeView.engagements optional in the type — page.ts outside Files builds an OfficeView — affects: 32-7
DRIFT: office.engagement keyed by project+id, carrying project — ENG ids are per served root — affects: 32-7
DRIFT: knownRoots lazy-seeded on the first authorized office read, refreshed detached after 60 s — an existing test forbids unauthorized registry reads — affects: none
DRIFT: GET /engagements answer shapes {ok, project, engagement, chat} and {ok, project, engagements, problems} — the plan left them open; now pinned in 0.1.27 — affects: 32-2, 32-7
DRIFT: project-less engagement lookup refuses ambiguity (409 AmbiguousEngagement) instead of taking the first hit — ENG ids repeat across served roots; consult ruled score 2 — affects: 32-2, 32-7
DRIFT: office engagement root order inverted (registry root first) — one root for routes, board and office — affects: none
DRIFT: parseRecord requires a string request, mapping entries and a non-empty question id, and set-questions stores only id-bearing questions — a malformed record crashed the input route with an unnamed 500; consult ruled option (B), score 1 — affects: none
DRIFT: the office hub's roots callback may return undefined until a registry read succeeds — an unread registry produced false "no served root" lines — affects: none

## Reconcile

### 2026-10-25 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is additive on contract 0.1.27 and was ruled by consult: the GET answer shapes, `office.engagement` carrying `project` and keyed by project plus id, 409 AmbiguousEngagement on a project-less id lookup, and the 32.1 lib pins in `test_driver_contract.py`. No AD, schema or ruling is contradicted, and no later acceptance criterion has to change. Three unstarted stories build on these seams and can absorb them through `invoke_dev_with` notes.
- Affected: 32-2-the-planner-leg-behind-the-chat-route — "`POST /chat/{engagement} {message}`" resolves an id that can repeat across served roots (ENG series are per root)
- Affected: 32-7-the-chat-screen — "the hub emits `office.engagement {id, state, from}` deltas" (the delta now also carries `project` and is keyed by project plus id); the list and read answer shapes are `{ok, project, engagements, problems}` and `{ok, project, engagement, chat}`
- Affected: 32-8-delivery-the-closeout-report-and-change-requests — "§7.1 the state table" and "`POST /engagements {project, request, follows: ENG-NNN}`" (the table is the contract subsection pinned by the 32.1 lib test; `follows` is 400 SchemaError until 32.8)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 32-2-the-planner-leg-behind-the-chat-route
