---
title: 'The Board Screen'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: 'a3156af126cf14e40ef414a6cc5852f0c5e1c718'
deviation_score: 1
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-5.md'
warnings: [oversized]
deferred:
  - summary: >-
      An open, focused Board tab with no run deltas keeps yesterday's Done items past local midnight.
    evidence: |-
      Category (a), AC2 "Done (ended today)". The Board refetches on project-scoped office.run/office.progress deltas, window focus and visibility, never on a timer (spec Never). A tab that stays focused and visible across midnight with no run activity is not refetched until the next delta or focus change. Raised by both review layers.
    location: >-
      apps/studio-web/src/board/BoardScreen.tsx
    severity: low
---

<intent-contract>

## Intent

**Problem:** The operator cannot read the plan, the runs and the money of a project on one screen (§6.3, Canonical ST-112). As the operator, I want a board of epics as projects with their stories as phases, the findings draining and the spend against the band, with a Needs-you / Working / Done column.

**Approach:** The supervisor gains `GET /board?project=<id>` (a supervisor surface, AD-2) composed from the served project's plan directory, the queue, the deferred-work ledger and the metered `job-run` spend. The web gains a Board screen built only from that answer. Contract §1 names `/board` by appending to 30.4's existing 0.1.25 entry, with no second bump.

**Acceptance criteria (verbatim, epics.md Story 30.5):**
- AC1: **Given** the plan directory of a served project (`_bmad-output/planning-artifacts/plan/`, the index and the entities) and the queue's runs and PRs **When** a consumer reads `GET /board?project=<id>` (a new supervisor surface, AD-2, named in the contract's §1 web surfaces at 0.1.25) **Then** the answer lists the epics with their stories and canonical statuses, each story's latest run (state, PR, host-verify outcome) when one exists, the open deferred-work entries that name the story (the findings), and per epic the metered spend from the ledger's `job-run` events against the epic's band when `.tk-studio/budget-bands.yaml` names one; the answer is cached per plan-directory mtime and rebuilt on change; a project with no plan directory answers an empty board with the reason
- AC2: **Given** the board **When** the Board screen renders **Then** epics are rows of phased bars whose segments are their stories coloured by status, the findings count drains as entries close, the spend bar sits against the band, and three columns triage every live run: Needs-you (paused, awaiting a ruling, a red host leg), Working (running), Done (ended today); each item links to the run's PR and names the ruling it waits for when there is one
- AC3: **Given** the screen **When** it is tested **Then** `bun test` covers the board surface from a fixture plan directory and queue (statuses, findings, spend, the cache), and vitest covers the rows, the columns and the links from a fixture answer

## Boundaries & Constraints

**Always:**
- The answer shape is the plan's settled shape (Design Notes), shared with 30.6. Missing `project` → 400 `ProjectRequired`; unregistered → 404 `UnknownProject`; non-GET → 405; signed-in cookie reads `/board` (add it to `readRoute`).
- Live runs are counted as `state !== null && LIVE_RUN_STATES.has(state)`. Done (ended today, supervisor host's local day, injected `now`) comes from the `/board` answer, never the store's `last_run`.
- Contract: append `GET /board` to the `0.1.25 (Story 30.4)` header clause and to the §1 web-surfaces table and 0.1.25 note; no second bump, no rewording of the 30.4 text; pin the new text in `test_driver_contract.py` by its own phrases, leaving the 30.4 pins as they are.
- Web reuses `src/office/model.ts` (`FetchLike`, `fetchAgents`' never-throw shape, `rememberedProject`/`PROJECT_KEY`, `safeHref`, `NONE`); logic lives in `src/board/model.ts` (vitest only runs `*.test.ts`). The web reads no surface but `/board` (and the existing ones it already reads).
- The band shape is `epics: {EP-NNN: {usd_estimate: <number>}}` in `.tk-studio/budget-bands.yaml`; absent, malformed or non-positive → `band_usd: null`. Document it in the supervisor README; add no entry to the tracked yaml.
- Supervisor-side house rules: atomic writes (none expected), no plugin imports from the supervisor or vice versa (AD-2).

**Block If:**
- The Files list (plan 30-5) must grow past its thirteen entries plus the fixture folder.
- The 30.4 contract text must be reworded, or a second version bump appears necessary.
- A run's epic cannot be determined without guessing (never guess; such spend counts toward no epic).

**Never:**
- No new web surface beyond `/board`; the web never reads `GET /runs/{id}` or `GET /jobs`.
- No refetch timer on the Board screen (refetch on store `office.run`/`office.progress` changes).
- No second `Assets.load(` or `new EventSource(` in `apps/studio-web/src`.
- No edits to `.tk-studio/budget-bands.yaml`, `epics.md`, plan files, `stories.yaml`. No push, tag, PR, release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy board | fixture plan (EP + ST entities), queue runs with `plan-status`/`host-verify` events, deferred-work, ledger, band | epics with stories, statuses, latest run per story, open findings, spend vs band | none |
| No plan dir | registered project, no `plan/` | `epics: []`, `plan.reason` names the missing path; `triage` still filled | 200 |
| Closed finding | DW entry `status: closed` | not counted; count drains | none |
| Duplicate job-run | two `job-run` events same `payload.run_id` | last wins, spend counted once | none |
| No band | yaml lacks `epics:` or value ≤ 0 / malformed | `band_usd: null` | none |
| Non run-epic job | `job_id` not `run-epic-N` | spend counts toward no epic | none |
| Cache | second read unchanged | same plan part (cache hit); touched entity → rebuild | none |
| Triage | paused / awaiting-ruling / red host leg / running / ended today / ended yesterday | Needs-you / Needs-you / Needs-you / Working / Done / absent; terminal red today → Needs-you | none |
| Bad request | no `project` / unknown / POST | 400 `ProjectRequired` / 404 `UnknownProject` / 405 | `{ok:false,error}` |
| Web fetch fails | network error or non-JSON | `fetchBoard` answers `{ok:false,error}`, never throws | screen shows the error |
| Non-http PR | `pr: "javascript:..."` | no link (`safeHref` null) | none |

</intent-contract>

## Code Map

Plan `plans/30-5.md` Code Map is the investigation; anchors verified at baseline. Key points:
- `apps/supervisor/src/api.ts` -- header route list :13-50; `ApiDeps` :102-145 (`queue`, `now`, `env`, `registry?` default `registryShow()`, `ledger?: {user, machine}`, `office`) → add `board?`; `route()` :639-684, add `/board` beside `/agents` :652 and `/office` :659 with `allow("GET")`, `fail()` :172; **`readRoute` :608-609 gains `/board`**.
- `apps/supervisor/src/planstatus.ts` -- `PLAN_REL` :64, `planEntity` :212-225, `storyNumber` :166, `runPr(events)` :98, `plan-status` event detail `{phase, pr, story_key, id, ok}` :252-256.
- `apps/supervisor/src/closeout.ts` -- `frontmatter(text)` :80 (js-yaml, `{}` on failure), `pausedStory(events)` :72.
- `apps/supervisor/src/office.ts` -- `LIVE_RUN_STATES` :267, `lastRunOf` :460, ruling/wait-reason precedence ~:404-433 (`analyseRun`/`projectCore` unexported; export the narrowest helper rather than copy), file cache pattern :106-130.
- `apps/supervisor/src/hostverify.ts` -- detail :16, `isRed` :209; `host-verify` event from worktree.ts:738.
- `apps/supervisor/src/queue.ts` -- `isTerminal` :63-70, `QueueRun` :447-500, `QueueEvent` :506; test helpers `note` :2092, `markPaused` :1748, `end` :1825.
- `apps/supervisor/src/page.ts` / `env.ts` -- ledger path `<studioHome(env)>/measurements/<user>-<machine>.jsonl`; `ledgerUser` :103, `safeName` :92.
- Deferred-work rule (port of `bmad_loop/deferredwork.py`): `^### (DW-\d+): (.+?)\s*$`, `^status:[ \t]*(.*)$`, open when the first word is `open`; entry ends at the next heading of any level; story via `storyNumber(source_spec)` → ST by plan `source`.
- Test templates: `test/office.test.ts:783-812` (bearer `routed()`, cookie via `signSession`), `test/registry.test.ts:369-407` (anonymous/POST/cookie).
- `plugins/tk-studio/contracts/driver-contract.md` -- header :5 (30.4 clause already says "Story 30.5 adds `GET /board` to this same 0.1.25 entry"), §1 table :103-109, 0.1.25 note :132-149.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 30.4 pins :458-499.
- `apps/studio-web/src/office/model.ts` -- `FetchLike` :81, `fetchAgents` :85-96, `PROJECT_KEY`/`rememberedProject`/`rememberProject` :100-133, `NONE` :138, `safeHref` :182.
- `apps/studio-web/src/App.tsx` -- module-level `officeStore`, `openOfficeStream`, `<OfficeScreen>`; base `/app/`; `live/store.ts` `subscribe` :111.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/board.ts` -- new: plan reader (EP/ST entities), findings parser, spend reader (whole file, cached on `(size, mtimeMs)`, dedupe by `payload.run_id`, epic from `run-epic-N`), band reader, per-story latest run, triage, plan cache, `boardFor(project, deps)` -- AC1, the settled shape.
- `apps/supervisor/src/office.ts` -- only if needed: export the narrowest ruling/pause-reason helper -- one rule, not two.
- `apps/supervisor/src/api.ts` -- route, `readRoute`, header comment, `ApiDeps.board?` -- AC1 surface.
- `apps/supervisor/test/fixtures/board/` + `apps/supervisor/test/board.test.ts` -- fixture root (plan with EP/ST + `index.md`, deferred-work.md, budget-bands.yaml; ledger in tmp `TK_STUDIO_HOME`); every matrix row on the server side plus route 200/400/404/405 and cookie -- AC3 bun leg.
- `apps/supervisor/README.md` -- `/board` answer, triage rule, cache, band yaml shape.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- append-only contract text and `test_0_1_25_names_the_board` -- AC1 "named in §1 at 0.1.25".
- `apps/studio-web/src/board/model.ts` + `model.test.ts` -- `boardUrl`, `fetchBoard` (never throws), rows (segments per story coloured by status), findings and spend bars (null band → spend alone), columns, `safeHref` links, ruling text; tests from a fixture answer -- AC2/AC3 vitest leg.
- `apps/studio-web/src/board/BoardScreen.tsx` -- fetch on project change, refetch on store `office.run`/`office.progress` changes, render -- AC2.
- `apps/studio-web/src/App.tsx` -- minimal Office/Board switch mounting one screen at a time -- AC2 reachability.
- `apps/studio-web/README.md` -- "The Board screen (Story 30.5)" section.

**Acceptance Criteria:**
- Given the fixture project and queue, when `bun test test/board.test.ts` runs, then statuses, latest runs, open-only findings, deduped spend vs band, cache hit and rebuild on a touched entity, the no-plan answer, the triage columns and the route codes are asserted and pass.
- Given a fixture answer, when vitest runs `src/board/model.test.ts`, then rows, segments, columns, PR links (non-http dropped), ruling text, a null band and a failed fetch are asserted and pass.
- Given the contract, when the lib suite runs, then the new board phrases are pinned and the 30.4 pins still pass, and conformance answers `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-10-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 1 (high 0, medium 0, low 1)
- reject: 2 (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Board refetched only on run deltas, so closed findings, plan edits and new spend never reached an open screen: refetch on window focus and on becoming visible (no polling), README updated
  - `[medium]` `[patch]` board `ruling` used a shorter rule than the office (missed state.json `paused_reason` and journal escalation): office's rule factored into `waitReasonOf`, exported as `runWaitReason`, used for live runs; test added
  - `[medium]` `[patch]` spend filter compared the ledger's raw `project` against `safeName(project)` (ledger.py:212 writes the raw key): compare raw; test with `"my proj"`
  - `[low]` `[patch]` `GET /board?project=__proto__` answered 200: `Object.hasOwn` lookup; `__proto__`/`constructor` → 404 test
  - `[low]` `[patch]` no assertion of a story run's `host_verify` "red"/"skipped": test added
  - `[low]` `[patch]` `refetchKey` reacted to every project's deltas: scoped to the selected project (null-project runs still count, per consult); tests added
- rejected: the contract header naming the board in both the 30.4 clause and the new 30.5 clause (the invocation required appending without rewording the 30.4 text); per-request `queue.events()` cost over a project's run history (plumbing, no criterion named)

### 2026-10-19 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 5 (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` a close-out relaunch's live progress marks earlier stories `done` from their landed specs (`specsDone`), so they took the relaunch as their latest run (running, PR null, host_verify null). Fix: live-progress `done` keys are weak and attribute a story only when no run names it strongly (plan-status, ruling, pause, live current/failed/deferred). Test added (board.test.ts:222). README updated.
  - `[low]` `[patch]` plan entity names were sorted as text (`EP-1000` before `EP-999`) although `ENTITY_RE` accepts `\d{3,}`. Fix: sort by numeric id, then by name. Test added (board.test.ts:106).
  - `[low]` `[patch]` `fetchBoard` let a body with no `plan`, an epic with no `stories` or a story with no `findings` through, and the screen then threw and unmounted the App. Fix: `isBoardShape` checks the dereferenced parts and returns `{ok:false, error}` otherwise. Cases added (model.test.ts:122-134). README updated.
  - `[low]` `[patch]` the `/agents` project list was fetched only on mount, so a transient failure left the Board empty until remount. Fix: it is retried on each focus/visibility wake while no project is chosen, with no timer. No component test harness exists, so no test.
- rejected: a `blocked` run "in no column" (wrong: `blocked` is terminal, queue.ts:63, so it lands in Done when ended today, per Design Notes); a failing registry "unhandled" (wrong: the router's catch answers JSON 500 InternalError, api.ts:645; the per-read registry subprocess is plumbing cost); the debug HUD staying frozen over the Board (no criterion names it); the contract header naming the board in both clauses (already rejected: the 30.4 text must stay untouched); no test that the board writes nothing (board.ts has no write call; plumbing)
- skipped-layer: none (band L, both layers ran)

### 2026-10-19 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` triage took a run's latest `host-verify` at any position, so a run that ended `partial` on a red host leg and was then resumed or relaunched (a later `launched`, no new verify) sat in Needs-you while `running`, never in Working (AC2). Both layers raised it, deduplicated. Fix: `redSinceLaunch` in board.ts counts a red leg only when the `host-verify` follows the latest `launched` (worktree.ts `recordedVerify`'s rule). It applies to both triage branches; the story's `run.host_verify` is unchanged. Test added (board.test.ts, red-then-launched → working; launched-then-red → needs_you). README triage bullet updated.
  - `[low]` `[patch]` the contract's 30.5 note said "Done holds the runs ended on the supervisor host's local day" and omitted that a terminal run ended that day with a red host leg is in Needs-you. Fix: the sentence names the exception (the 30.4 text is untouched; the existing pin is kept); a new pin in test_driver_contract.py.
  - `[low]` `[patch]` AC1's "rebuilt on change" was tested only for a touched or edited entity. Fix: a board.test.ts case adds an entity file after a cached read (rebuilt, new story present) and removes it (rebuilt, story gone). No source bug found.
- rejected: registry subprocess per `/board` read and per-request run-history cost (already rejected twice: plumbing cost, no criterion names it); a failing registry "unhandled" (already rejected: the router's catch answers JSON 500 InternalError, api.ts:645); `blocked` runs in no column (already rejected: `blocked` is terminal, queue.ts:63); no test that the board writes nothing (already rejected: board.ts has no write call); a terminal Needs-you item not saying why it is there (AC2 asks only for the PR link and the ruling "when there is one"; a red host leg is not a ruling)
- skipped-layer: none (band L, both layers ran)

## Design Notes

Settled answer (plan 30-5, shared with 30.6):
`{ok: true, project, built_at, plan: {reason?}, epics: [{id, title, status, band_usd: number|null, spend_usd: number, findings: number, stories: [{id, key: "N.M", title, status, findings: [{id: "DW-NN", title, severity}], run: {run_id, state, pr: string|null, host_verify: "green"|"red"|"skipped"|null, ended_at: string|null} | null}]}], triage: {needs_you: [item], working: [item], done: [item]}}`; item = `{run_id, state, story_key: string|null, pr: string|null, ruling: string|null}`.

Triage: every live run of the project in exactly one column. Needs-you = `paused`, or latest ruling event `awaiting-ruling`, or latest `host-verify` red; `ruling` = awaiting reason, else pause reason. Working = other live runs. Done = terminal runs whose `ended_at` is on the host's local day; a terminal run ended today with a red host leg goes to Needs-you.

Cache: plan part keyed on the plan dir's `mtimeMs` plus each entity's `(mtimeMs, size)` (a superset of "per plan-directory mtime", since in-place edits don't move a dir mtime); findings on deferred-work `(size, mtimeMs)`; spend on the ledger's; runs and triage composed per request. The board reads the served project's own plan directory; a transcribed plan (`planOwner`) is the "no plan directory" answer.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `rm -rf /tmp/v305 && mkdir -p /tmp/v305 && git ls-files -co --exclude-standard apps/studio-web apps/supervisor | tar -cT - | tar -xC /tmp/v305`, then `cd /tmp/v305/apps/supervisor && bun install --frozen-lockfile && bun test test/board.test.ts && bun test && bun run typecheck` -- expected: board green; full suite only the 8 known location-caused failures
- `cd /tmp/v305/apps/studio-web && bun run verify` -- expected: build + vitest green
- `grep -rn "Assets.load(" apps/studio-web/src | grep -v test` and `grep -rn "new EventSource(" apps/studio-web/src | grep -v test` -- expected: one hit each
- `uv run python tools/verify_host.py` -- binding host leg; unverifiable-here (sandbox EPERM on symlinks)

**Manual checks (if no CLI):**
- unverifiable-here: the attended look of bars, columns and links on desktop/iPad, and a live board against the box's real plan, queue and ledger.

## Deviation Summary

### pass 1 (2026-10-19, implementer)
- planned: per-epic spend from the ledger's `job-run` events, epic from `run-epic-N` / actual: also only counts events whose envelope `project` equals the served project's safe-named id; other or absent `project` counts toward no epic / why: the ledger is per machine and holds every project; "never guess" / may affect: 30-6-the-status-screen-and-home
- planned: reuse `FetchLike` from `src/office/model.ts` / actual: not exported there; `board/model.ts` derives it as `NonNullable<Parameters<typeof fetchAgents>[1]>` / why: `office/model.ts` is not in Files; same type / may affect: none
- planned: export "the narrowest helper" from `office.ts` / actual: two exported helpers `awaitingRuling` and `standingPauseReason`, both used by office code / why: the board's ruling is "awaiting reason, else pause reason", two parts of the existing rule / may affect: none
- planned: ledger path as `page.ts` builds it (`ledgerUser`, `safeName`) / actual: the two private helpers copied into `board.ts` / why: not exported; `page.ts` not in Files / may affect: none
- planned: triage item `ruling` = awaiting reason, else pause reason / actual: filled only for live runs; terminal items carry `ruling: null` / why: an ended run waits for no ruling / may affect: 30-6-the-status-screen-and-home

DRIFT: spend counted only for ledger events whose `project` matches the served project — the per-machine ledger mixes projects and the epic must not be guessed — affects: none
DRIFT: `FetchLike` derived from `fetchAgents`' parameter instead of imported — not exported from office/model.ts, which is outside Files — affects: none
DRIFT: three office.ts exports (`awaitingRuling`, `standingPauseReason`, `runWaitReason` over the private `waitReasonOf`) instead of one; /board reads populate office.ts caches (bounded by CACHE_MAX, pruned at the next projection) — the board shares the office's full wait-reason rule rather than copying it — affects: none
DRIFT: `ledgerUser`/`safeName` copied into board.ts — private in page.ts, which is outside Files — affects: none
DRIFT: terminal triage items carry `ruling: null` — an ended run waits for no ruling — affects: none

### pass 2 (2026-10-19, review patches)
- planned: share the office's wait-reason rule through the narrowest helper / actual: rule factored into private `waitReasonOf`; new export `runWaitReason(run, events)` reads the run's journal and state.json via office.ts caches / why: `OfficeRun` carries no wait reason and adding it would change the wire shape / may affect: none
- planned: `refetchKey` limited to the selected project's runs / actual: also counts runs whose `project` is still null / why: such a run may belong to the selected project; only an extra refetch, never a missed one / may affect: none

DRIFT: `refetchKey` also counts runs with a not-yet-known project — avoids a missed refetch — affects: none

### pass 3 (2026-10-19, follow-up review patches)
- planned: `fetchBoard` answers `{ok:false, error}` for a malformed body / actual: a present but non-array triage column now fails the whole read instead of counting as empty / why: the patch asked for the check on all three columns / may affect: none (score 0, not a DRIFT)

### pass 4 (2026-10-19, follow-up review patches 2)
- planned: README triage bullet: change the live-run clause "its latest `host-verify` is red" / actual: also added "(by the same rule)" to the terminal sentence "a terminal run ended today with a red host leg goes in Needs-you instead" / why: `redSinceLaunch` is computed before the live/terminal split, so both branches use it / may affect: none (consult: accept-deviation score 1)

DRIFT: README's terminal-branch triage sentence also names the after-`launched` rule — the code applies it to both branches and the doc must match — affects: none

## Consult Log

- 2026-10-19T21:38Z — trigger: deviation-gt-0 — question: accept or reject the implementer's five score-1 deviations (project-filtered spend, derived FetchLike, two office helpers, copied ledgerUser/safeName, terminal ruling null) — ruling: accept-deviation score 1 — do: keep all five, record each as DRIFT with affects: none; add a board.test.ts case for a run-epic-N job-run from another/missing project adding nothing; add a case for a terminal run with a latest awaiting-ruling triaging with ruling: null — rule candidate: When a needed helper is private in a file outside Files, copy it or derive its type in the new file and log a DRIFT with "affects: none". That is a score-1 deviation and needs no consult.
- 2026-10-19T21:51Z — trigger: deviation-gt-0 — question: accept the patch pass's runWaitReason export (with office cache side effect) and refetchKey's null-project allowance — ruling: accept-deviation score 1 — do: keep both; rename the office-helpers DRIFT to name all three exports and the cache side effect, affects: none; add a model.test.ts case for a null-project run changing the key — rule candidate: When a new screen needs a rule that already lives privately in another module, export a thin wrapper over the private function, not a copy; record it as score-1 DRIFT with affects: none when the wire shape is unchanged.
- 2026-10-19T22:25Z — trigger: deviation-gt-0 — question: accept the README "(by the same rule)" addition to the terminal triage sentence, beyond the patch's named live clause — ruling: accept-deviation score 1 — do: Keep "(by the same rule)" in apps/supervisor/README.md:183 as written. / Record the deviation at score 1 (local doc accuracy, no seam) and continue the follow-up pass. — rule candidate: When a patch instruction changes a rule that the code shares across several branches, every README sentence describing those branches is in scope for the same patch and is not scored as a deviation. (observation recorded: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This is the second follow-up review pass on story 30.5: `GET /board?project=<id>` plus the web Board screen. Both review layers ran over the diff from baseline a3156af126cf14e40ef414a6cc5852f0c5e1c718 (band L). This pass fixed three things:
- The triage counts a red host leg only when its `host-verify` follows the run's latest `launched`. A resumed or relaunched run is no longer held in Needs-you by a stale red leg.
- The contract's 30.5 note names the red-host-leg exception to Done.
- A test pins the plan cache rebuilding when an entity is added or removed.

**Files changed.**
- `apps/supervisor/src/board.ts`: `redSinceLaunch` (worktree.ts `recordedVerify`'s rule), used by `triage` in both branches.
- `apps/supervisor/test/board.test.ts`: the red-then-relaunched and launched-then-red triage case; the add/remove-entity cache case (20 tests).
- `apps/supervisor/README.md`: the triage bullet states the after-`launched` rule.
- `plugins/tk-studio/contracts/driver-contract.md`: the 30.5 note names the red-host-leg exception to Done. The 30.4 text is untouched and there is no version bump.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: one new pin for that phrase.

**Review.** 3 patches (medium 1, low 2), 0 deferred, 6 rejected; see the Review Triage Log. One consult (deviation-gt-0) accepted the README terminal-sentence addition at score 1.

**Follow-up review.** Patched: high 0, medium 1, low 2. The score is 3×1 + 2 = 5, which is 5 or more, so `followup_review_recommended: true`.

**Verification** (re-run by this session after the patches).
- Lib suite: 1416 tests OK (2 skipped). Conformance: `ok: true`.
- Supervisor, in a /tmp copy of tracked and untracked files: `bun install --frozen-lockfile` OK; `bun test test/board.test.ts` 20 pass, 0 fail; `bun run typecheck` exit 0; full `bun test` 917 pass, 72 skip, 8 fail. The 8 are exactly the known location-caused set: one unnamed, queue database placement, MCP `--force-starter`, five `release: sbx stop`.
- Studio-web `bun run verify`: build OK, vitest 96/96 (6 files).
- `Assets.load(` and `new EventSource(` each have one non-test hit.
- The implementer confirmed the new triage test fails against the old `f.host === "red"` rule.

**unverifiable-here.**
- Host leg, which is binding: `uv run python tools/verify_host.py`. In-worktree `bun install` hits EPERM because the sandbox refuses symlinks. Expect `verify_host: ok (lib suite, conformance, studio-web)`.
- The attended look of the Board on a desktop and an iPad, and a live board against the box's real plan, queue and ledger.

**Residual risks.**
- A story's `run.host_verify` still shows the latest outcome, which may be a stale red from before a relaunch, while the triage files the run in Working.
- An open, focused tab still keeps yesterday's Done items past midnight (DW-32, filed by the orchestrator).
- Each `/board` read runs `registry.py show` and walks the project's run events.

DRIFT: README's terminal-branch triage sentence also names the after-`launched` rule — the code applies it to both branches and the doc must match — affects: none

## Reconcile

- 2026-10-19 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 30-6-the-status-screen-and-the-home (Block If: AC2's counts, ledger tail and version are on no web-read surface — operator ruling in the replan queue)
