---
title: 'Story 39.4: The Kanban and the Story'
type: 'feature'
created: '2026-11-10'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '9b8d29276046d83aa3b69c1eaa32696c400b848a'
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-39/plans/39-4.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The owner cannot see where a story stands or what it cost without Jira or the repository: the web has a row board (`GET /board`) and no page for one story, and nothing serves a story's Stage Log (addendum §3.2 F-D).

**Approach:** Add `GET /stories/{id}?project=` (one story composed from the plan store, its specs' Stage Log tables with `stage-posts.json`, the queue and `board.ts`'s parts, cached on file stamps) and `POST /stories/{id}/status` (the one owner-writable transition `draft → ready`, run through `plansync.py status` on the host, recorded as a `plan-status` service event with `actor: "owner"`, D9); turn `/app/board/<project>`'s default into a kanban beside today's row view with one allowed drag; add the story page at `/app/story/<id>`. Contract 0.1.35 gains this story's paragraph (additive).

**Acceptance criteria (verbatim, epics.md §Story 39.4):**

- **AC1.** **Given** the plan store (`_bmad-output/planning-artifacts/plan/ST-*.md`, canonical statuses `draft, ready, in-progress, blocked, review, done, dropped`), the Stage Log tables in the story specs and `_bmad-output/tracking/stage-posts.json` (`plansync.py stage`, `stage-post`) **When** Story 39.4 lands **Then** `GET /stories/{id}?project=` (cookie or bearer) answers one story: its frontmatter (id, title, status, parent, band, `external.jira.key`), its plan text, its Stage Log rows (stage, start, stop, model, tokens, cost) read from the spec on the host, its runs (from the queue, with state, PR and cost), its findings and PR from `board.ts`'s composition; a missing story is a named 404; the composition is cached on file mtimes as `GET /board` is; the contract names the route (0.1.35, additive); `board.test.ts` or a new `stories.test.ts` covers the composition and the 404.
- **AC2.** **Given** the Board screen (`apps/studio-web/src/board/*`) **When** `/app/board/<project>` is opened **Then** it offers the kanban view (default) beside today's row view: one column per canonical status, a card per story with the epic badge, id and title, band, Jira key, PR number, cost and the current stage (from `office.progress`), "Needs you" marked; a card opens `/app/story/<id>`; a card dragged from `draft` to `ready` sends `POST /stories/{id}/status {status: "ready"}` and shows the hint "Requests plansync status ready; the loop owns every other column"; any other drag is refused in the page with the reason.
- **AC3.** **Given** `POST /stories/{id}/status` (cookie + CSRF, or bearer) **When** the body asks `ready` for a `draft` story **Then** the supervisor runs `plansync.py status` on the host for that id (the verb the loop's plan-status pass uses, `apps/supervisor/src/planstatus.ts`), records a `plan-status` service event with the actor `owner`, and answers the new frontmatter; any other transition is refused by name (`StoryStatusNotOwnerWritable`) with the column that owns it; a story whose plan lease is held (`plan-lease` events) is refused with the holder named; `api.test.ts` covers the accepted transition, both refusals and the lease case.
- **AC4.** **Given** the story page (`apps/studio-web/src/story/*`, new) **When** `/app/story/<id>` is opened **Then** it shows the plan text, the Stage Log table with a total line, the runs with links to `/app/run/<id>`, the PR and findings, the Jira key as a link, and the "Needs you" strip with the inbox item when one exists; pending reads say "Loading the story…"; `src/story/model.test.ts` pins the model.

## Boundaries & Constraints

**Always:**
- The settled shapes 1–12 of `plans/39-4.md` (§Settled shape) are the field-level contract for every route, answer, event, card, drag and page; they are planner rulings recorded in SPEC.md CAP-12..CAP-15. Implement them as written.
- Replan (39-1 gate, 2026-11-09): keep 39.1's Board flow — `BoardScreen` takes `project` and `onProject(p, replace)` from `/app/board/<project>`, and `addressProject` (`screen.ts:301`) remembers a served address project and replaces an unserved one. Add only the `?view=`/`?epic=` toggles and the kanban default. A toggle preserves the address project; a view change navigates with `replace`.
- Flip the `PLACEHOLDER.story` pin in `apps/studio-web/src/screen.test.ts` (`:134-141`): `story` leaves `PLACEHOLDER` (`screen.ts:31-32`) and `/app/story/<id>` mounts `StoryScreen`; `run`, `checkin`, `settings` stay placeholders. App.tsx gives `story` its own branch before the shared placeholder branch (`App.tsx:93`).
- Every in-app link goes through 39.1's router (`router.navigate`), never a full page load. Queries (`?project=`, `?view=`, `?epic=`) ride on the path.
- The supervisor never edits a plan file (D9): it runs the verb and re-reads. The refusals (transition, lease) call nothing and record nothing.
- Windows host (AGENTS.md): every `readFileSync` names `"utf-8"`; `specs` in answers are root-relative POSIX; the one subprocess is `callStatus`'s argv-only `uv run`; every `bun test` names `--timeout`; the sha1 row key is over UTF-8 bytes.
- Stage Log and band readers live in `board.ts` (cycle avoidance); `stories.ts` is imported only by `api.ts`.
- Contract (AC1, AD-19): rulings row, header clause, two §1 rows and the `**0.1.35 (Story 39.4, additive).**` paragraph before `## 8. Conformance`, pinned by `test_0_1_35_story_39_4_the_kanban_and_the_story`; re-bound 39.3's test at 39.4's clause and paragraph (planned, local).

**Block If:**
- `test/cycles.test.ts` reports a new SCC (consult `deviation-gt-0`; never edit the allowlist).
- The Files list of `plans/39-4.md` must grow beyond the plan (consult `file-outside-files`).
- An existing whole-object `toEqual` pin on a board story breaks under the four additive fields: widen to `toMatchObject`, record local (score 1) — not a halt.

**Never:**
- Editing plan text in the web; any owner transition other than `draft → ready`; a per-card `GET /stories` (one `GET /board` serves the cards); a timer refetch; a drag library or new dependency; rendering plan text as HTML; machine paths or credentials in answers or events; touching the loop's run-scoped `plan-status` events; re-implementing the router.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Story read | `GET /stories/ST-177?project=p`, entity + specs + buffer + posts | 200, shape 1 answer, rows sorted by `started`, buffered dupes dropped, `posted` per shape 2 | — |
| Bad / missing | id not `ST-\d{3,}` / no project / unregistered / no entity | — | 400 `BadStory` / 400 `ProjectRequired` / 404 `UnknownProject` / 404 `UnknownStory {project, story}` |
| Owner ready | `POST …/status {status:"ready"}`, draft, no lease | verb called once, `plan-status` service event `actor:"owner"`, 200 with re-read story, `sync` | — |
| Not owner-writable | review→ready, draft→done | no call, no event | 409 `StoryStatusNotOwnerWritable {from,to,column,owner}` |
| Lease held | live `draft:<key>` lease | no call, no event | 409 `StoryLeaseHeld {run_id, phase, holder{pid,host}, since}` |
| Verb refusal / transient | re-read not ready / runner throws | event `ok:false` | 409 `StoryStatusRefused` / 500 `StoryStatusFailed` |
| Cookie POST no CSRF | — | — | 403 |
| Drag | draft→ready / same column / other | post / none / refused with `Refused: <from> → <to>. <owner>. Only draft → ready is yours.` | refused drops never post |

</intent-contract>

## Code Map

The plan's `## Code Map`, `## Settled shape` and `## Refresh — 39-3 gate` (`_bmad-output/specs/spec-epic-39/plans/39-4.md`) are the investigation, re-checked at HEAD `9b8d2927`. Anchors confirmed this session:
- `apps/studio-web/src/screen.ts:14` `Route` story `{name:"story"; id}`; `:31-32` `PLACEHOLDER.story`; `:301` `addressProject`; `:179-205` `createRouter`/`navigate(path,{replace})`.
- `apps/studio-web/src/App.tsx:52` `go(route, replace)`; `:80` BoardScreen mount; `:93-94` the shared placeholder branch.
- `apps/studio-web/src/board/BoardScreen.tsx:19` props `{store, project, onProject}`; `:50-53` `addressProject` use.
- `apps/studio-web/src/screen.test.ts:134-141` the placeholder pin to flip.
- `plugins/tk-studio/lib/tests/test_driver_contract.py:~4199-4214` 39.3's test: clause sliced to header end (`endswith("— additive) |")`) and note to `## 8. Conformance` — re-bound both at 39.4.
- Supervisor anchors (`board.ts`, `api.ts` cookieRoute ~:1458, `queue.ts` claim/releasePlanPhase, `planstatus.ts` `callStatus`/`Phase`, `inbox.ts runCost`, `office.ts readInbox`, `stagelog.py` columns): as listed in the plan; re-find by symbol.
- Toolchain: `bun` at `~/.bun/bin/bun` (not on PATH); no `node_modules` installed in either app yet.

## Tasks & Acceptance

**Execution:** the 21 files of `plans/39-4.md` §Files, with the actions listed there:
- `apps/supervisor/src/stories.ts` (new), `board.ts`, `api.ts`, `queue.ts`, `planstatus.ts` -- the two routes, composition, lease read, `"ready"` phase -- AC1, AC3.
- `apps/supervisor/test/stories.test.ts` (new), `test/api.test.ts` -- composition/404/cache/board fields/lease; the POST describe (accepted, both refusals, lease, CSRF 403, refusal, transient) -- AC1, AC3.
- `apps/supervisor/README.md` -- routes rows, cookie lists, `## The story (Story 39.4)`.
- `apps/studio-web/src/board/model.ts`, `board/KanbanView.tsx` (new), `board/BoardScreen.tsx`, `board/model.test.ts` -- kanban, toggles, drag, post -- AC2.
- `apps/studio-web/src/story/model.ts`, `story/StoryScreen.tsx`, `story/model.test.ts` (all new) -- AC4.
- `apps/studio-web/src/screen.ts`, `screen.test.ts`, `App.tsx` -- story route mounts `StoryScreen`; flip `PLACEHOLDER.story` pin.
- `apps/studio-web/README.md` -- `## The kanban and the story (Story 39.4)` before `## Commands`.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.35 paragraph and its pin; 39.3 re-bound.

**Acceptance Criteria:** AC1–AC4 above, each proven by the named tests and the gate below.

## Spec Change Log

## Review Triage Log

### 2026-11-10 — Review pass
- layers: blind-hunter, edge-case-hunter (band L; both run)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 3, low 5)
- defer: 0
- reject: 1 (medium 1) — `statusAnswerText` prints `Ready: <id> (was <previous_status>)` on any 200 regardless of `sync`: that is Settled shape 10's 200 text verbatim; showing `sync`/`reason` would extend the settled card behaviour.
- addressed_findings:
  - `[medium]` `[patch]` no test drove `sync: "partial"` / `sync: "blocked"` (shape 4) — two api.test.ts cases added (answer + service event); code needed no change.
  - `[medium]` `[patch]` StoryScreen wiped a loaded story on a failed refetch — the last story is kept, the error shows above it.
  - `[medium]` `[patch]` an off-enum card (sits in Draft) dropped back on Draft was refused — `dropRule` compares the card's column (`columnOf`), same column is `none` (shape 10).
  - `[low]` `[patch]` story page with no `?project=` and no served project loaded forever — `No project: open the story from the board`; `?project=` trimmed.
  - `[low]` `[patch]` `GET /stories` built `specIndex` twice per request — built once and passed to Stage Log and view (shape 3).
  - `[low]` `[patch]` `?epic=` naming an absent epic showed an empty kanban — `shownEpic` falls back to `defaultEpic`.
  - `[low]` `[patch]` a PR URL without `/pull/<n>` rendered `no PR` — renders `PR` through `safeHref`; `no PR` only when there is no PR (now the same on card and story page).
  - `[low]` `[patch]` supervisor README `GET /board` row lacked the 0.1.35 story fields — appended.

### 2026-11-10 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L; both run). The diff (195 KB, contract as a word diff) was handed over as a file path, `/tmp/rev394/diff.patch`, because it was too large to inline.
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 0
- reject: 1 (low 1): switching project resets `?view=rows` to the kanban. AC2 makes the kanban the default and names no view memory across projects; the plan's toggle rule covers only the toggles.
- addressed_findings:
  - `[medium]` `[patch]` The kanban drag never started in Firefox or iPadOS Safari because `dragstart` set no `dataTransfer` data, so AC2's draft → ready drag was dead there. `KanbanView.tsx` `onDragStart` now calls `setData("text/plain", id)` and sets `effectAllowed = "move"`.
  - `[low]` `[patch]` `jiraSite` re-parsed `.tk-studio/config.yaml` on every story read and POST (AC1: cached on file stamps). `stories.ts` now reads it through `cachedFile` with a stamp cache. A `stories.test.ts` case covers an edited, unparseable or removed config.
  - `[low]` `[patch]` A refused post (409) left the kanban stale. `KanbanView.tsx` refetches after any post that got an HTTP status; it does not refetch on a network failure.
  - `[low]` `[patch]` The story page kept the previous story's error after navigating, hiding "Loading the story…" (AC4). `StoryScreen.tsx` clears the error on an `[project, id]` change.
  - `[low]` `[patch]` A non-canonical status dropped on Ready named its raw status as the refusal column. `ownerTransition` (stories.ts) and `dropRule` (model.ts) now use the card's column (`draft`). Pins added in `stories.test.ts` and `model.test.ts`; the web pin cannot tell old from new text, since the reason text is unchanged.

### 2026-11-10 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L; both run). The diff since `9b8d29276046d83aa3b69c1eaa32696c400b848a` (190 KB; `driver-contract.md` compacted to the changed spans of its long lines, the supervisor README at zero context, the orchestrator's `stages/` buffer left out) was handed over as a file path, `/tmp/39-4-review-diff.patch`.
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 0
- reject: 10 (low 10):
  - the 200 strip ignores `sync`/`reason`: already rejected in the first pass (Settled shape 10's 200 text verbatim).
  - `KanbanView`'s drag wiring has no DOM test: vitest runs in node with no DOM. The decision (`dropRule`) and the request (now `requestReady`, below) are pinned. Already a recorded residual risk.
  - the fixture edits break on a CRLF checkout: `.gitattributes` pins `*.md text eol=lf`, and `git check-attr` confirms it for the board fixture.
  - the verb's result could overwrite the event's fixed keys: `callStatus` returns a closed shape (`ok, previous_status, status, conflict, error, blocked, reason`) with none of those keys, the same spread `planstatus.ts`'s records use.
  - buffers named `<N>-<M>.jsonl` are not read, and the row-key sid comes from the file stem: every writer passes the full `stories.yaml` id (`stagepass.ts`, `worktree.ts`, `task-planning.md`), and no short-key buffer exists. Reading one would add duplicate rows against the tables.
  - the buffer cells are not normalized like `_stage_cell`: rows go through `stage_row` before they are buffered, so the cells are already normalized and the re-normalization is idempotent.
  - the 409 `StoryStatusRefused` reason is unredacted: the API's `redact` removes the supervisor token, which plansync's output cannot contain, and the reason is clipped by `callStatus` as the loop's records are.
  - a null-project live run matches a card of another project: this is deliberate. A run whose project is not yet known counts, as in the refetch rule (`board/model.ts:201-209`), and the state is transient.
  - `updated` is read from a body without frontmatter: canonical plan entities always carry frontmatter, and `updated` is not an AC field.
- addressed_findings:
  - `[low]` `[patch]` (blind-hunter and edge-case-hunter, deduplicated) For a non-canonical `from` dropped on `ready`, the code answers `column: "draft"`, but the contract (0.1.35) and the plan's Settled shape 4 say `column` is `from`. The previous pass's change had moved the code away from both. `ownerTransition` (stories.ts) and `dropRule` (model.ts) now name `from` again. The same-column `none` check through `columnOf` (shape 10) stays. The `stories.test.ts` pin now expects `column: "approved"` with the draft writer as owner. The web pin's text is unchanged, because the reason never names the column; only its comment was updated.
  - `[low]` `[patch]` When `GET /inbox` failed, the kanban still posted with no CSRF token, and the strip showed a bare `CsrfRefused` that was sure to come. The inbox read and the post move into `requestReady` (model.ts). An inbox failure now names that read's error and makes no POST, and `model.test.ts` pins both paths. The reader is injected as `requestReady(project, id, readInbox, fetchFn)`, because `inbox/model.ts` already imports `board/model` (the consult accepted this, score 1).
  - `[low]` `[patch]` The `stories.test.ts` check that no machine path appears in the answer passed trivially on the Windows host, because `JSON.stringify` escapes backslashes. It now also checks for the JSON-escaped form of the root.

## Design Notes

Planned deviations (planner rulings, recorded as DRIFT at the end): the `PLACEHOLDER.story` pin flip in `screen.test.ts` (named by the replan); 39.3's contract test re-bounded at 39.4's clause (plan Refresh, local); the card's stage reads the live store story's `phase` because `office.progress.stage` is 39.5's (plan correction); `GET /board`'s story gains `band`, `jira_key`, `cost_usd`, `needs_you` additively (shape 8).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd apps/supervisor && bun test --timeout 30000` and `bunx tsc --noEmit -p .` -- expected: green (unverifiable-here if bun cannot install).
- `cd apps/studio-web && bunx tsc --noEmit`, `bunx vite build`, `bunx vitest run` -- expected: green (`bun run verify` as its steps if `bun install` EPERMs).

## Deviation Summary

### pass 1 (2026-11-10, implementer)

- planned: the four new board story fields always present (shape 8) / actual: `boardFor` always sets them; the supervisor `BoardStory` type marks them optional / why: required typing broke a stub board in `test/inbox.test.ts` (outside Files); the answer is unchanged / may affect: none
- planned: `404 UnknownStory` body `{ok:false, error, project, story}` (shape 1) / actual: also carries `detail: "no story <id> in project <p>"` / why: the story page renders `<error>: <detail>` (shape 11's example) / may affect: none
- planned: no machine paths in events (Never) / actual: the owner `plan-status` service event carries `directory: <root>` as shape 5 lists, as the loop's events do / why: shape 5 is the field-level contract / may affect: none
- planned: `screen.test.ts` pin "`/app/story/<id>` mounts `StoryScreen`" / actual: pins the parse to `story`, `PLACEHOLDER` without `story`, and (by reading `App.tsx` source) the `story` branch renders `<StoryScreen` before the placeholder branch / why: vitest runs in `environment: "node"`, nothing mounts / may affect: none
- planned: the `board.ts` exports of plan §Files / actual: also exports `specIndex`, `needsYouRunIds`, `openInboxItem`; `BoardScreen` gains `search` and `onNavigate` props fed by `App.tsx` from the route's query / why: one specs readdir per board, one Needs-you rule, toggles navigate without touching the router / may affect: none
- planned (Design Notes): `PLACEHOLDER.story` pin flipped in `screen.test.ts`; 39.3's contract test re-bounded at 39.4's clause and paragraph; card stage from the live story's `phase`; `GET /board` story gains four fields additively.
- DEVIATION SCORE: 1

DRIFT: supervisor BoardStory's four new fields typed optional (always set by boardFor) — required typing broke a stub in test/inbox.test.ts outside Files — affects: none
DRIFT: 404 UnknownStory carries a `detail` line — the story page renders `<error>: <detail>` — affects: none
DRIFT: the owner plan-status service event carries `directory` per shape 5 — shape 5 is the field-level contract, matching the loop's events — affects: none
DRIFT: the StoryScreen mount is pinned by parse + PLACEHOLDER + App.tsx source read — vitest node environment cannot mount — affects: none
DRIFT: extra exports specIndex/needsYouRunIds/openInboxItem in board.ts; BoardScreen gains search/onNavigate props — one readdir per board, one Needs-you rule, toggles through the router — affects: none
DRIFT: screen.test.ts PLACEHOLDER.story pin flipped (story leaves PLACEHOLDER; /app/story/<id> mounts StoryScreen) — named by the replan — affects: none
DRIFT: test_0_1_35_story_39_3_the_studio_chat re-bounded at 39.4's clause and paragraph — the 0.1.35 entry grows in story order — affects: none

Consult ruling (pass 1): item 3 (`directory` on the owner plan-status event) follows Settled shape 5; the spec's general Never line is over-broad there. Not a departure.

### pass 2 (2026-11-10, review patches)

- planned: patch 7 changes only an http(s) PR URL without `/pull/<n>` / actual: a non-http(s) PR (fixture `javascript:alert(1)`) now renders `PR` unlinked instead of `no PR`; the existing pin updated / why: `no PR` means no PR at all, as the story page already does; `safeHref` still refuses the link / may affect: none
- planned: change `dropRule` and its use in `KanbanView.tsx` / actual: `dropRule` maps through a new exported `columnOf`; `KanbanView.tsx` untouched / why: KanbanView already passes the raw status / may affect: none
- DEVIATION SCORE: 1

DRIFT: a present-but-unsafe or numberless PR renders `PR` (unlinked unless safeHref accepts it) instead of `no PR` on the kanban card — `no PR` means no PR, matching the story page — affects: none
DRIFT: new exported `columnOf` in board/model.ts carries shape 9's off-enum-in-Draft rule into dropRule — same-column drop is none — affects: none

### pass 3 (2026-11-10, follow-up review 2 patches)

- planned: `requestReady(project, id, fetchFn)` in `board/model.ts`, importing `fetchInbox` / actual: `requestReady(project, id, readInbox, fetchFn = fetch)`. `KanbanView.tsx` passes `fetchInbox`; `board/model.ts` has only `import type { InboxResult }` / why: `inbox/model.ts:6` already imports `refetchKey` from `board/model` at runtime, so importing back would form a cycle / may affect: none
- planned: restore Settled shape 4's refusal `column` / actual: as planned. This brings the code back in line with the plan and the contract. It is not a deviation.
- DEVIATION SCORE: 1

DRIFT: requestReady takes the inbox reader as a parameter (type-only import of InboxResult) — a runtime import would cycle with inbox/model.ts, which already imports board/model — affects: none

## Consult Log

- 2026-11-10T04:51:42Z — trigger: deviation-gt-0 — question: accept the implementer's five pass-1 deviations (optional BoardStory typing, UnknownStory detail, directory on the owner event, StoryScreen mount pin by source read, extra board.ts exports and BoardScreen props), and at what score? — ruling: accept-deviation score 1 — do: accept all five at score 1 and continue; keep the detail string, optional typing and directory; change no code or contract; record item 3 as shape 5 followed, not a departure — rule candidate: When a Settled shape names a field explicitly, it overrides a spec's general Never or Boundaries line; additive detail strings on error answers and TS optionality that leaves the wire shape unchanged are score-1 local and need no consult.
- 2026-11-10T05:13:11Z — trigger: deviation-gt-0 — question: accept the review-patch pass's two deviations (a non-http(s)/numberless PR renders `PR` instead of `no PR`, pin updated; exported `columnOf` with KanbanView untouched), and at what score? — ruling: accept-deviation score 1 — do: keep both with the updated model.test.ts pins; record that `no PR` = no PR at all now holds on the card and the story page — rule candidate: When a plan lists a display as only `<value> | <empty word>`, a present but malformed value shows a generic label with its link gated by safeHref, never the empty word.
- 2026-11-10T05:53:27Z — trigger: deviation-gt-0 — question: accept the follow-up-2 patch's `requestReady(project, id, readInbox, fetchFn)` signature (the reader is injected because `inbox/model.ts` already imports `board/model`) in place of the planned runtime import of `fetchInbox`? — ruling: accept-deviation score 1 — do: keep `requestReady(project, id, readInbox, fetchFn = fetch)` as written, with KanbanView passing `fetchInbox` and a type-only import; do not restructure the modules; record it as score 1 with the cycle as the reason — rule candidate: before telling an implementer to add a runtime import A→B, check whether B already imports A; if it does, inject the dependency as a parameter with a type-only import, as planned and not as a deviation. (observe.py record: ok)

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-09T17:24:14Z | 2026-11-09T17:48:19Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-10T02:52:31Z | 2026-11-10T02:52:57Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-10T04:22:48Z | 2026-11-10T05:13:59Z | 8f561fd1-9295-48fd-af71-1ad47b458770 | claude-opus-5-5 | medium | 26472775 | 178695 | 13.6563 | completed |
| review | 1 | 2026-11-10T05:14:00Z | 2026-11-10T05:36:55Z | 32b80ace-ef5b-4689-8721-49f11a69ad62 | claude-opus-5-5 | medium | 8046374 | 54424 | 5.4860 | completed |
| review | 2 | 2026-11-10T05:36:55Z | 2026-11-10T05:55:24Z | 57efbeeb-9963-41b9-824f-23283696b87a | claude-opus-5-5 | medium | 8123437 | 70812 | 5.5980 | completed |
| gate | 1 | 2026-11-10T05:55:24Z | 2026-11-10T05:58:03Z | 5e7b8f27-0f23-4618-acff-b42f430603d1 | claude-opus-5-5 | medium | 1794207 | 10864 | 1.3433 | completed |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-39-20261110T042044Z-ec3446` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review pass over Story 39.4, from the baseline `9b8d29276046d83aa3b69c1eaa32696c400b848a` through 39ddd3b0 and this pass's patches. The story is unchanged: `GET /stories/{id}`, `POST /stories/{id}/status` (owner `draft → ready` only), the kanban at `/app/board/<project>`, the story page at `/app/story/<id>`, and contract 0.1.35. This pass did three things:
- brought the refusal `column` back in line with the contract and the plan's Settled shape 4;
- stopped the kanban from posting when the CSRF read fails;
- made the machine-path test meaningful on the Windows host.

**Files (this pass).**
- `apps/supervisor/src/stories.ts`: `ownerTransition`'s refusal column is `to`, or the raw `from` when `to` is `ready` (shape 4, contract 0.1.35).
- `apps/studio-web/src/board/model.ts`: `dropRule`'s refusal column is the same as above, and the same-column `none` check through `columnOf` is kept. There is a new `requestReady(project, id, readInbox, fetchFn)`: when the inbox read fails it makes no POST and names the read's error.
- `apps/studio-web/src/board/KanbanView.tsx`: the drop goes through `requestReady(project, card.id, fetchInbox)`.
- `apps/studio-web/src/board/model.test.ts`: `requestReady` is pinned on both paths (inbox 500 → one fetch, no POST; inbox 200 → the POST carries `x-csrf-token`).
- `apps/supervisor/test/stories.test.ts`: the `ownerTransition("approved","ready")` pin expects `column: "approved"`, and the machine-path check also covers the JSON-escaped root.

**Review.** Two layers ran (blind-hunter and edge-case-hunter); 13 distinct findings remained after one duplicate was removed. 3 patches applied (low 3), 0 deferred, 10 rejected (reasons in the Review Triage Log). Follow-up review: patched high 0, medium 0, low 3; score 3×0 + 3 = 3 < 5, so `followup_review_recommended: false`.

**Verification.**
- `plugins/tk-studio/lib`:
  - `uv run python -m unittest discover tests`: 3166 OK, 5 skipped (implementer).
  - `uv run python ../contracts/conformance/runner.py run`: `ok: true` (implementer; re-run by this session, `ok: true`).
- `apps/supervisor`, with `~/.bun/bin` on PATH:
  - `bun test --timeout 30000`: 2348 tests, 2260 pass, 0 fail, 88 skip (implementer).
  - `tsc --noEmit -p .`: clean (implementer).
  - This session re-ran `bun test --timeout 30000 test/stories.test.ts test/api.test.ts`: 155 pass, 0 fail.
- `apps/studio-web` (tools run directly through `bun node_modules/...`, because `bun install` EPERMs on this mount):
  - `tsc --noEmit`: clean (implementer).
  - `vitest run`: 251/251 (implementer). This session re-ran `vitest run src/board src/story`: 26/26.
  - `vite build`: ok (implementer).
- Unverifiable here: an operator check after the merge and a serve restart. Drag a draft card to Ready in a real browser, on desktop and on an iPad, and see `Ready: ST-NNN (was draft)`. With the inbox read failing, the strip should name that failure and no POST should go out.

**Residual risks.**
- No real browser has proven the drag yet: vitest runs in node, so there is no DOM render test.
- `requestReady` is pinned, but the `KanbanView` wiring to it is not.
- `stories.ts` runs in `serve`: stop the supervisor before building and restart it after the merge.

DRIFT: requestReady takes the inbox reader as a parameter (type-only import of InboxResult) — a runtime import would cycle with inbox/model.ts, which already imports board/model — affects: none

## Reconcile

- 2026-11-10 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 39-5-the-runs-timeline-and-the-progress-in-view (plan refreshed in place: 39.4 landed shapes, route branch, contract re-bound; plan stage start/stop ok)
