---
title: "The Owner's Decisions Have a Source and a Sink"
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_revision: 'f568fc1e464f54a93d4f92bf11764e3abeaf1676'
deviation_score: 1
review_loop_iteration: 0
followup_review_recommended: true
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-4.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized, multiple-goals]
deferred: []
---

> **Serve process.** This story changes code that runs inside `serve` (`sweep.ts`, `worktree.ts`, `cli.ts`, `resolution.ts`, `planseams.ts`, `closeout.ts`). The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

<intent-contract>

## Intent

**Problem:** A sweep's triage names each owner decision as a bare question (`launch.py triage_summary`, `sweep.ts parseTriage` keep only `{id, question}`); the engine skips it unattended, the PR lists it, and nothing posts it where the owner answers or ingests the answer (hole 112, DW-171: nineteen issues hand-posted on 2026-11-05; TKSTUDIO-220..224 still open). Separately, an issue left in `Blocked - Awaiting User` after block → cancel → re-drive never leaves it (EP-36 B1, the retrospective's B3, AI-4).

**Approach:** Transcribed verbatim from `epics.md` §Story 38.4 (authoritative), shaped by `plans/38-4.md` §Settled shape 1–14 (SPEC design notes CAP-10/11/12):
- AC1 — **Given** the triage's `decisions [{id, question}]` (`launch.py:1789-1800`), the `sweep-triage` event (`sweep.ts`) and `track.py block` (`--source run|engagement`, the engagement form's questions block) **When** a sweep's triage names decisions **Then** each carries `options[] {letter, text}` and `default` (the sweep skill's triage emits them; a drive pins the shape), `track.py block --source sweep` posts one Task per related group from the run's `triage.json` (the `tk-studio-decision` label, the owner assigned, `Blocked - Awaiting User`, the mention comment, the `<id>: <letter>` / `all: <letter>` answer form: the 2026-11-05 hand posting's shape recorded in `_bmad-output/tracking/decisions-jira.json`), the sweep's close-out calls it when the project is bound and the PR body lists the issue keys in place of the bare questions, and a dry run names what it would post; the lib suite pins the grouping and the issue body with a fake.
- AC2 — **Given** an answered decision issue at `Block Resolved` and the inbox tick (`syncback.py`, `inbox.py`) **When** the tick reads it **Then** the ingest parses the owner's comment lines (`<id>: <letter>`, `all: <letter>`; a missing line takes `default` only when the comment says `default`), writes `decision: <letter> — <text> (TKSTUDIO-N, <date>)` onto each ledger entry through the ledger verb, answers `bmad-loop decisions` in the sandbox when an open sweep record exists (else records the answer for the next triage to read), replies on the issue naming what was ingested and what is still open, and moves it to Done or re-blocks with the missing ids named; the five hand-posted issues still open (TKSTUDIO-220 to 224) are ingested by the verb when they return; the studio web's inbox lists the decision items with their state (DW-178's check-in UI is not built here); the lib suite pins the parse, the reply and the re-block with a fake.
- AC3 — **Given** an issue in `Blocked - Awaiting User` whose canonical is `in-progress` or `review` with no block standing (`jirabackend.py:993-997`; EP-36 B1's sequence: block, cancel, re-drive without `track unblock`) **When** the plan-status pass promotes **Then** the promote leaves `Blocked - Awaiting User` when no block stands (the block's record on the plan entry resolved, or the issue's last block comment answered), or every cancel and re-drive path calls `track unblock` first (one of the two, named in the contract), a same-category test pins the exit; the contract names the decision shapes and the edge (0.1.34, additive); DW-171 closes by this PR and the runbook's hole-112 row reads fixed.

The plan settles every either/or: the shape is lettered studio-side from the stock skill's own `options`/`recommendation` (shape 1); the engine is answered over stdin at the sweep close-out (shape 8); the block edge is option (a) (shape 11).

## Boundaries & Constraints

**Always:**
- Implement each Settled shape of `plans/38-4.md` exactly as written (decision shape, grouping, issue form, `--source sweep` argv/result/refusals/dry run, record, grammar and `default` rule, `decision:` line and `ledger-decide`, engine answer, ingest/reply/re-block, inbox `decision` item and web rows, edge (a), contract 0.1.34 Story 38.4 paragraph, `jiraBound` moved to `planseams.ts` with a re-export).
- Stdlib-only Python via `uv run`; atomic writes; every headless surface ends in the AD-11 status block; every text open names `encoding="utf-8"`; a `text=True` subprocess names `encoding="utf-8"`; every `bun test` names `--timeout 30000`; VM paths are `toVmPath(...)` + a POSIX tail, never `join`.
- `sweep.ts` never value-imports `closeout.ts` (`test/cycles.test.ts` stays green unchanged); `sweepdecisions.py` imports `track` lazily inside `ingest`.
- Count a new `track.py block` call in `sweep.test.ts` by its verb, never by total `uv` calls; fixture roots without `planning.jira` make no call.
- Contract: `0.1.34 (Story 38.4, additive): …` header clause after 38.3's, `, Story 38.4` in the Stories row, a `**0.1.34 (Story 38.4, additive).**` paragraph after 38.3's (:2771) and before `## 8. Conformance` (:2816); `test_0_1_34_story_38_4_…` after the 38.3 test (`test_driver_contract.py:3552`) with the prefix regex `Story 38\.1, Story 38\.2, Story 38\.3, Story 38\.4(, Story 38\.\d+)* \(Epic 38\)`.
- DW-171 closes in the in-loop form `resolved <date> by Story 38.4 (…)`; the runbook hole-112 row (`kb/agent-pc-setup-runbook.md:1686`) reads fixed; README run-sweep paragraph (:239) updated.

**Block If:**
- A returning hand-posted issue's record entry holds no `DW-\d+` ids, or its live description carries no lettered option lines — never invent option text; the settled fallback is the reply `not ingested: options unreadable` and a re-block (plan Risks). Its live ingest is `unverifiable-here`.
- A test or the drive shows `bmad-loop decisions` committing anywhere other than the sweep worktree's run branch, or the close-out misreads its commit (consult `deviation-gt-0`).
- The ledger harvest or `dwledger` tests refuse two `decision:` lines on one entry (consult).
- The Files list must grow beyond the plan's Files, or the clock threatens (halt consult; split candidates in plan Risks).

**Never:**
- Fork/edit the stock `bmad-loop-sweep` skill or the installed bmad-loop engine (AD-4); run the engine verb at the owner root or from the tick.
- Take option (b) (`track unblock` on cancel/re-drive paths); change `planstatus.ts`.
- Build DW-178's check-in UI or any new screen; answer TKSTUDIO-220..224.
- Commit `_bmad-output/tracking/` contents; push, tag, PR, or release.
- Fix the known `guards.test.ts` DW-173 baseline (2 cases red when `TK_ATLASSIAN_*` set) — carry it.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lettering | skill decision with 3 options, recommendation = 2nd key | `options [{letter A..C, text, key, effect}]`, `default: "B"` | no options → `options: []`, `default: null` |
| Grouping | 3 decisions, two with equal normalised question+options | 2 issues; the related pair in one, ordered by lowest DW | >30 ids chunked |
| Post dry run | `--source sweep --dry-run` | one `dry run: would create "<summary>" …` note per group, no call, nothing written, `partial` | mixing `--story`/`--engagement`/`--reason`/`--resolves`/`--kind` → refused by name, exit 2 |
| Post re-run | id already open on a record issue / answered | `skipped[]` names it | `--ask DW-n` re-asks with `Earlier answer:` line |
| Unreadable triage | `--triage` absent / not an object | `TriageUnreadable` refusal | exit 2 |
| Answer full | `DW-1: B`, `all: A` on a 2-id issue | DW-1=B, DW-2=A; `decision:` lines; reply `Still open: none`; move to Done | ledger line idempotent (`unchanged`) |
| Answer partial | one id unanswered, no `default` line | reply names it; `_block_issue` re-block naming missing ids | `default` line with `default: null` → `DW-n: no default` |
| Bad answer | `DW-1: E` / `DW-1: A with a change` | id open, `no option E` / `qualified answer, not ingested` | — |
| Temp failure | Jira 5xx during ingest | cycle not recorded; next tick retries | `partial`, `retry: true` |
| Engine answer | close-out, record has matched answers for leading pending ids | `printf keys | bmad-loop decisions`; re-read `--json`; `sweep-decisions-answered` note | key failing `^[A-Za-z0-9_-]{1,16}$` skipped; failure never blocks close-out |
| Block edge | Blocked issue, canonical in-progress/review, snapshot was `blocked` or owner comment newer than last `Blocked:` | category move, else `Block Resolved` then category, else `exit_stuck` note | standing block (canonical blocked, no evidence) keeps winning |

</intent-contract>

## Code Map

`plans/38-4.md` §Code Map and its "Refreshed at the 38-3 gate" block are the investigation; anchors re-checked at `f568fc1e` (unchanged since the plan's refresh). Key anchors:

- `plugins/tk-studio/lib/launch.py:1786` `triage_summary` (decisions at :1799-1800; `triage_reason`, `sweep-triage` payload unchanged).
- `apps/supervisor/src/sweep.ts` — `Triage` :163, `parseTriage` :179, `recordTriage` :221, `mergeTriages` :357, `sweepSummary` :374, `SweepSummary` :310, `sweepSection` :424 (`### Human decisions` :439, "Skipped unattended" :442), `sweepRecord` :475, `summaryFromRecord` :494, `sweepCloseOutSummary` :645 (preferred seat for `answerDecisions` then `postDecisions`, after `withStageRows`).
- `apps/supervisor/src/worktree.ts:1485/:1656`, `cli.ts:1256` — the three close-out sites (untouched when `sweepCloseOutSummary` carries the calls). `prBody` `worktree.ts:446`.
- `apps/supervisor/src/closeout.ts:664` `jiraBound` → move to `planseams.ts`, re-export at old home. Host track precedent: `closeout.ts:728-760`, `approve.ts:973-985`.
- `apps/supervisor/src/sandbox.ts:105-134` — sbx exec argv builders, `vmLaunchStatus` POSIX-tail precedent.
- `plugins/tk-studio/lib/track.py` — `SOURCES` :222, `--source` check :402, `_block_issue` :336-388, engagement precedent :502-852, `main` :1695-1866.
- `plugins/tk-studio/lib/plansync.py` — `_atomic_write` :238, `LEDGER_REL` :3501, `ledger_resolve` :3544, `_deferred_next` :3610, ledger-resolve parser :3725 / dispatch :3749 / main :3796. `dwledger.py` `parse_ledger`, `LedgerDuplicateId`, `LedgerMissingId` :37.
- `plugins/tk-studio/lib/syncback.py` — `SEARCH_FIELDS` :62, `log_comments` :251-288, `tick` :574-777 (`inbox.derive` gate :748-751).
- `plugins/tk-studio/lib/inbox.py` — `_item` :124-150 (engagement precedent :134-145), `derive` :153-191, `BLOCK_COMMENT_RE` :68.
- `apps/supervisor/src/resolution.ts:232` — add `i.decision === undefined` filter.
- `apps/studio-web/src/inbox/model.ts` (`InboxItem` :11-19, `InboxRow` :79-88, `inboxRows` :116-126), `InboxScreen.tsx`.
- `plugins/tk-studio/lib/jirabackend.py` — `promote` :878-1030 (move :988-1001, `exit_stuck` :1003-1010), `_transition_to_category` :763, `transition_to_name` :1371, statuses :1183-1188.
- Engine (read-only): `bmad_loop/cli.py cmd_decisions` :1747-1792, `sweep.py DecisionPrompter` :324-368, `decisions.py` :97-166. Skill (read-only): `.claude/skills/bmad-loop-sweep/automation-mode.md:27-66`.
- Contract `driver-contract.md` 38.3 paragraph :2771, `## 8. Conformance` :2816; drive `e2e_run_sweep.py` `FILTER` :48, `TRIAGE` :63.
- Records: DW-171 `deferred-work.md:1439`; runbook :1686; README :239.

## Tasks & Acceptance

**Execution:** (the plan's Files list is the boundary; per-file detail is in plan §Files and §Settled shape)
- `plugins/tk-studio/lib/sweepdecisions.py` (new) -- lettering, grouping, summary/description/comments, record I/O, parse, `post(...)`, `ingest(...)` -- shapes 1–6, 9.
- `plugins/tk-studio/lib/launch.py` -- `triage_summary` uses the lettering -- shape 1.
- `plugins/tk-studio/lib/track.py` -- `SOURCES` gains `sweep`; `--triage` (repeatable), `--run-id`, `--ask`; refusals; dispatch to `sweepdecisions.post`; docstring -- shape 4.
- `plugins/tk-studio/lib/plansync.py` -- `ledger_decide` + `ledger-decide` subcommand; docstring -- shape 7.
- `plugins/tk-studio/lib/syncback.py` -- `labels` in `SEARCH_FIELDS`; `sweepdecisions.ingest` after `inbox.derive` under its gate; counts -- shapes 9, 10.
- `plugins/tk-studio/lib/inbox.py` -- `decision: {ids}` item field; docstring -- shape 10.
- `plugins/tk-studio/lib/jirabackend.py` -- promote edge (a) -- shape 11.
- `apps/supervisor/src/sweep.ts` -- `Triage`/`parseTriage` shape; `answerDecisions`, `postDecisions` in `sweepCloseOutSummary`; `decision_issues` on summary and record; `sweepSection` lists keys; header -- shapes 1, 8, 14.
- `apps/supervisor/src/planseams.ts`, `closeout.ts` -- move `jiraBound`, re-export -- shape 14.
- `apps/supervisor/src/worktree.ts`, `cli.ts` -- only if per-site calls are needed (untouched otherwise, no deviation).
- `apps/supervisor/src/resolution.ts` -- exclude decision items; header -- shape 10.
- `apps/studio-web/src/inbox/model.ts`, `InboxScreen.tsx` -- decision rows in `open`+`resolved`, `state`, `kind`, `Decision` tag -- shape 10.
- `plugins/tk-studio/contracts/conformance/e2e_run_sweep.py` -- fixture with two options, shape assertion (letters, default), `FILTER` gains `|Story 38.4` -- shape 1.
- `plugins/tk-studio/contracts/driver-contract.md` -- clause, row, paragraph -- shape 12.
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- run-sweep paragraph; hole-112 row fixed; DW-171 closed `by Story 38.4`.
- Tests: `tests/test_sweepdecisions.py` (new; grouping, body, parse matrix, reply, re-block, record, legacy entry, dry run, using `FakeTrack`/`FakeSyncBack`), `test_launch.py`, `test_track.py`, `test_plansync.py`, `test_syncback.py`, `test_inbox.py`, `test_jirabackend.py` (Blocked → In Progress for `in-progress` and `review` under (i), (ii), the `Block Resolved` fallback, a standing block kept), `test_driver_contract.py`; `apps/supervisor/test/sweep.test.ts`, `resolution.test.ts`; `apps/studio-web/src/inbox/model.test.ts` -- cover the I/O matrix.

**Acceptance Criteria:**
- Given a skill triage with options and a recommendation, when `triage_summary`/`parseTriage` project it, then each decision carries lettered `options` and `default` and `e2e_run_sweep` asserts the shape.
- Given a bound fixture project and a triage, when the sweep close-out runs, then `track.py block --source sweep` is called once, the PR body's `### Human decisions` lists issue keys, and an unbound root makes no call and keeps the bare questions.
- Given an answered decision issue in a `FakeSyncBack` tick, when the tick runs, then the ledger gets the `decision:` lines via `ledger_decide`, the reply comment is posted, and the issue moves to Done or is re-blocked naming missing ids.
- Given a decision item in the inbox, when `resolution.ts` scans resolved items, then it queues no `validate-resolution` run, and the web inbox shows the row with its state and a `Decision` tag.
- Given B1's sequence in `test_jirabackend`, when `promote` runs, then the issue leaves `Blocked - Awaiting User`; a standing block stays.
- Given the contract, when `test_driver_contract` and conformance run, then the 38.4 clause/row/paragraph are pinned and `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 12: (high 0, medium 9, low 3)
- defer: 0
- reject: 4: (medium 1, low 3) — (ii) "any owner comment answers the block" is the AC's own wording and plan shape 11(ii); the engine walk stopping at the first unanswered pending id is the engine verb's stdin semantics (an empty line takes the recommendation; shape 8); two studio `decision:` lines after an `--ask` re-ask are by design (the later dated line stands; plan Block If accepts two lines); the engine commit after the host leg touches only the ledger and `.bmad-loop/decisions.json`, and CAP-4's no-changes skip excludes sweeps
- addressed_findings:
  - `[medium]` `[patch]` answerDecisions: legacy (hand-posted) answers with empty key/effect never matched and were re-asked → fallback match by label / lettered text; an id with no readable triage options is neither fed nor asked
  - `[medium]` `[patch]` post: an issue created but not blocked was skipped as "already asked" on retry → record `blocked: false` until `_block_issue` succeeds; a re-run finishes the block
  - `[medium]` `[patch]` ingest: a half-done item's answers leaked into the shared record → answers merged per item only after its reply
  - `[medium]` `[patch]` ingest: failed Done move / re-block left the item stuck or (after a first fix) replied every tick → per consult ruling 2, a non-temporary failure records the cycle with a note; only `track.transient` leaves it unrecorded; an item with no `reason_comment` id is skipped before any write
  - `[medium]` `[patch]` ledger_decide: same answer on another UTC date wrote a second line → same letter + text + KEY is `unchanged` on any date
  - `[medium]` `[patch]` InboxScreen had no header row (the new State cell misaligned) → header row from exported `INBOX_COLUMNS`
  - `[medium]` `[patch]` load_record/write_record dropped a hand-posted file's other top-level data → unrecognised keys kept verbatim, a list top level kept under `legacy`
  - `[medium]` `[patch]` promote: a stuck block edge with a field change overwrote snapshot `canonical_status`, erasing evidence (i) → kept `blocked` while stuck
  - `[medium]` `[patch]` ingest: a non-temporary JiraError inside the item (refused reply, 4xx on transitions) left no cycle → cycle recorded with what was written, note `not retried`
  - `[low]` `[patch]` a missing `reason_comment` keyed a cycle on None → skipped before any write
  - `[low]` `[patch]` dry-run / create-refused text used `!r` quoting against the contract's `"<summary>"` → explicit double quotes
  - `[low]` `[patch]` README: the ingest's `decision:` lines sit uncommitted in the owner checkout → said, committed like a `ledger-resolve` edit

### 2026-11-08 — Review pass (follow-up, iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run); the 240 KB diff (baseline f568fc1e464f54a93d4f92bf11764e3abeaf1676 → working tree, `_bmad-output/specs` excluded, the 65 KB contract-version row elided to its changed fragment) handed to each layer as a file path, not inline
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 2: (medium 1, low 1) — `retry: true` from `post` re-tried by nothing: a temporarily failed close-out post leaves the PR's bare questions (honest), and the ids stay undecided in the ledger so the next sweep's triage names and posts them; no criterion names a same-sweep retry. The record's read-modify-write race between the sync-back tick and the close-out's `track.py block --source sweep`: a short window between two host passes, no criterion names it; the ledger (the source of truth) is written separately by `ledger-decide`, whose re-run is `unchanged`
- addressed_findings:
  - `[medium]` `[patch]` load_record misread the real 2026-11-05 record (keyed by group name — `DW-32`, `R1`, `HUD`, `ENG-A` — the issue in each entry's `issue`): DW-keyed groups became fake issue keys, the rest were never indexed, TKSTUDIO-206..224 never matched → `_legacy_issues` indexes by `issue`, the group name kept in `group`; a legacy entry with `status: Done` is not asked; test on the real layout
  - `[medium]` `[patch]` a repeated `--ask` (retried/late close-out, next sweep) created another Task per call → an id already re-asked on an open issue other than its answer's is skipped `already re-asked on KEY` (a cut-short block finished); `postDecisions` reads the new skip line
  - `[low]` `[patch]` a temporary failure of the Done move / re-block after the reply re-posted the reply next tick → the cycle recorded with `move_pending: true`; the next tick retries only the move, then clears it
  - `[low]` `[patch]` the PR footer said every decision was asked in Jira after a partial post → issue lines keep the Jira footer, bare questions keep the unattended `bmad-loop decisions` line
  - `[low]` `[patch]` `navCount`'s doc comment sat above `INBOX_COLUMNS` → moved back

### 2026-11-08 — Review pass (follow-up 2, iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run); the 382 KB diff (baseline f568fc1e464f54a93d4f92bf11764e3abeaf1676 → working tree, `_bmad-output` excluded) handed to each layer as a file path, not inline
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 3: (medium 1, low 2) — an `OSError` from the ledger or record atomic write escapes `ingest` and aborts the tick: the tick's other writers (`inbox.derive`, which runs first and writes the same tracking folder) propagate write failures the same way, and no criterion names a local-write failure. The record's read-modify-write race between the sync-back tick and the close-out post: rejected last pass for the same reason (atomic writes; the ledger is written separately and its re-run is `unchanged`). A transient reply failure after the ledger lines are written, then the owner edits the letter before the retry, leaves two `decision:` lines with different letters on one entry: needs a transient failure and an owner edit within one tick; the record's answer and the reply carry the latest letter
- addressed_findings:
  - `[medium]` `[patch]` a repeated `--ask DW-n` still posted a new Task per call when the issue holding DW-n's recorded answer read as open (a studio entry re-blocked for other ids, or a legacy entry not Done): `asked_on` kept that issue, so `prior == answer.issue` and the id was posted again → `post` collects every open issue per id (`open_on`) and treats one other than the answer's issue as the re-ask; tests for the studio-open and legacy-not-Done variants (two calls, one Task, `already re-asked on PROJ-102`)
  - `[low]` `[patch]` a temporary failure after the reply fell through to `failed = True` and also noted "not retried" → the non-transient handling is an `else` branch; the existing move-retry test asserts no "not retried" note
  - `[low]` `[patch]` edge (a)'s no-route note said the issue "stays in 'Blocked - Awaiting User'" after the by-name move to `Block Resolved` succeeded and only the category move failed → that case notes the move to `Block Resolved` and the missing category route; the still-blocked wording (pinned by two tests) unchanged; new jirabackend test
  - `[low]` `[patch]` `"sweep"` added to the shared `SOURCES` made `track.py unblock --source sweep` accepted (refused before this story) → `unblock` refuses `--source sweep` before any Atlassian call; new track test

## Design Notes

The Settled shapes in `plans/38-4.md` are the design; they are not restated here to avoid drift. Two notes for the implementer: (1) `apps/supervisor` and `apps/studio-web` may lack `node_modules` in this worktree — run `bun install --frozen-lockfile` there (PATH=`$HOME/.bun/bin:$PATH`) before the suites; (2) `bunx tsc` may not resolve bun types in a worktree — use `bun node_modules/typescript/bin/tsc --noEmit -p .` (38.3's form).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK (gate 1)
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` (gate 2)
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger tests.test_sweepdecisions tests.test_track tests.test_plansync tests.test_syncback tests.test_inbox tests.test_jirabackend tests.test_launch tests.test_driver_contract` -- expected: OK
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000` -- expected: 0 fail (DW-173 baseline only when `TK_ATLASSIAN_*` set)
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun node_modules/typescript/bin/tsc --noEmit -p .` -- expected: clean
- `cd apps/studio-web && PATH="$HOME/.bun/bin:$PATH" bun x vitest run src/inbox/model.test.ts` -- expected: pass
- `uv run python plugins/tk-studio/contracts/conformance/e2e_run_sweep.py` -- expected: ok

**Unverifiable here (operator):** the Windows host leg (`uv run tools/verify_host.py` on the box); the live ingest of TKSTUDIO-220..224 when one returns; the serve restart after the merge.

## Deviation Summary

### pass 1 (2026-11-08, implementer)

- planned: the Files list only (`hostleg.test.ts` not named) / actual: one fixture line in `apps/supervisor/test/hostleg.test.ts` gains `context: "", options: [], default: null` / why: the new `TriageDecision` type made its `{id, question}` literal fail the typecheck / may affect: none
- planned: record shape `{version, issues, answers}`, legacy entries byte-for-byte / actual: an optional top-level `legacy_cycles: [{issue, block_comment, at, ingested, missing}]`; record options also store each option's `label` / why: a legacy entry cannot hold its own ingest cycles if it must stay unchanged; the engine answer matches by label / may affect: none
- planned: the first `--triage` path is the `sweep-triage` note's `path` / actual: `postDecisions` uses the engine run dir's `triage.json` / `triage-<N>.json` while present, falling back to the note's path / why: the engine run id for the description is read from the engine run-dir path / may affect: none
- planned: `ledger-decide` refusals as listed / actual: also refuses an entry with no `status:` line; in ingest a refused id stays open as `ledger refused` with a note / why: the line goes after `status:`; an id the ledger cannot take must not read as ingested / may affect: none
- Reading noted (not a deviation): "past 6 ids reads `DW-12, …, DW-17 +N`" read as first id, `…`, sixth id, `+<ids after the sixth>`.
- Environment: `bun install` cannot symlink on this mount (EPERM); node_modules installed under /tmp and copied in; suites run via `bun node_modules/typescript/bin/tsc` and `node node_modules/vitest/vitest.mjs`.

DEVIATION SCORE: 1

DRIFT: hostleg.test.ts fixture line widened to the new TriageDecision shape — the typecheck refused the old literal — affects: none
DRIFT: decisions-jira.json gains optional `legacy_cycles` and option `label` — legacy entries stay byte-for-byte and the engine answer matches by label — affects: none
DRIFT: postDecisions reads the engine run dir's triage files first, note path as fallback — the engine run id comes from that path — affects: none
DRIFT: ledger-decide also refuses an entry with no `status:` line; ingest keeps such an id open (`ledger refused`) — the line's place is after `status:` — affects: none

### pass 2 (2026-11-08, review patches; consult ruling 2 accepted at score 1, (d) rejected and rebuilt to the ruling)

- planned: shape 8 match by (effect, label) else (key, label), a miss to `--ask` / actual: a third rule matches an answer with empty key and effect by its label against the option's label or lettered text; an id with no readable triage options is neither matched nor asked / why: review finding (legacy answers could never match; an unreadable triage is no evidence of a mismatch) / may affect: none
- planned: shape 5 record / actual: issue entries gain `blocked: bool`; unrecognised top-level keys kept verbatim, a list top level or a clashing key under `legacy` / why: review findings (finish an interrupted block; "a legacy entry is kept as it is") / may affect: none
- planned: shape 7 "the same line already on the entry gives unchanged" / actual: same letter + text + KEY on any date gives `unchanged`, `line` returns the existing line / why: review finding (a retry across midnight duplicated the line) / may affect: none
- planned: shape 9 only a temporary failure leaves the cycle unrecorded / actual: as planned after consult ruling 2 — any non-transient failure records the cycle (ingested = ids written, missing = the rest; note `… the cycle is recorded; not retried`); an item with no `reason_comment` id is skipped before any write; when the failure precedes knowing the item's ids, `missing` falls back to the record entry's ids / why: review findings + ruling / may affect: none
- planned: shape 10 InboxScreen shows the state and a Decision tag / actual: a header row (there was none) from an exported `INBOX_COLUMNS` / why: review finding (the added State cell misaligned the columns) / may affect: none

DEVIATION SCORE: 1 (consult ruling 2; the implementer's reported "5" is off the 0–3 scale and void)

DRIFT: answerDecisions gains a legacy match by label/lettered text and never asks an id whose triage options are unreadable — hand-posted answers could never match shape 8 — affects: none
DRIFT: decisions-jira.json issue entries gain `blocked`; unrecognised top-level data kept (`legacy`) — finish an interrupted block; keep the hand-posted file as it is — affects: none
DRIFT: ledger-decide `unchanged` ignores the date for the same letter, text and KEY — a retried ingest across midnight duplicated the line — affects: none
DRIFT: InboxScreen gains a header row from `INBOX_COLUMNS` — the new State cell had no header to sit under — affects: none

### follow-up review pass (2026-11-08, implementer)

- planned: `post`'s skip lines as shipped / actual: a new skip `DW-n: already re-asked on KEY`, read by `sweep.ts postDecisions`; `track.py` docstring names it / why: the repeated `--ask` finding; the PR body would lose the re-asked issue otherwise / may affect: none
- planned: legacy entries indexed by top-level issue-like key / actual: indexed by their `issue` field, the group name kept in a new `group` field; cycles gain optional `move_pending` / why: the real record's layout and the reply-twice finding / may affect: none
- consult (08:00Z) also logs as local: the contract clause "a legacy entry whose `status` is `Done` is not asked", the partial-post wording in `decisionLines`, the doc-comment move in `inbox/model.ts`

DEVIATION SCORE (this pass): 1 (consult 08:00Z, accept-deviation score 1)

DRIFT: post gains the `DW-n: already re-asked on KEY` skip, read by sweep.ts postDecisions — a repeated --ask created duplicate Tasks; the PR body must still name the re-asked issue — affects: none
DRIFT: decisions-jira.json gains `group` on indexed legacy entries and optional `move_pending` on an ingest cycle (0.1.34 paragraph updated, unbumped) — the real hand-posted record is keyed by group; a retried move must not re-post the reply — affects: none

### follow-up review pass 2 (2026-11-08, implementer)

- the four patches above stay inside the story's Files (`sweepdecisions.py`, `jirabackend.py`, `track.py` and their tests); no contract text changed (`driver-contract.md` already lists `unblock` as `[--source run]`; the pinned still-blocked note is unchanged)

DEVIATION SCORE (this pass): 0

## Consult Log

- 2026-11-08T06:57Z — trigger: deviation-gt-0 + file-outside-files — question: accept the implementer's four pass-1 deviations (hostleg.test.ts fixture, record legacy_cycles/label, run-dir-first triage read, no-status refusal) and does the contract need legacy_cycles? — ruling: accept-deviation score 1 — do: keep all four; add "an entry with no `status:` line" to the 38.4 paragraph's ledger-decide refusal list (driver-contract.md:2856), pin it in test_0_1_34_story_38_4_…, note `ledger refused` beside the ingest's left-open reasons; leave legacy_cycles wording (already named at :2846) — rule candidate: a fixture edit forced only by a type the story introduces is a logged score-1 deviation needing no consult; any new refusal a verb raises goes into the contract paragraph's refusal list in the same story
- 2026-11-08T07:24Z — trigger: deviation-gt-0 (review pass 1 patches; implementer score 5, off-scale) — question: accept the five review-patch deviations (a) legacy answer match + unreadable triage not asked, (b) record blocked flag + legacy keys, (c) any-date unchanged, (d) no cycle on a non-temporary Done/re-block failure or missing reason_comment, (e) inbox header row? — ruling: accept-deviation score 1 (reject (d)) — do: keep (a)(b)(c)(e); on a non-temporary Done/re-block failure record the cycle with the failure in notes; an item with no reason_comment id is skipped before add_comment and ledger_decide with a note; only track.transient leaves a cycle unrecorded; add a two-tick no-Done-route test showing one reply and one cycle — rule candidate: any once-per-poll Jira write records its dedupe key on a non-temporary failure; only transient failures leave it unrecorded, and an item with no dedupe key is skipped before it writes
- 2026-11-08T08:00Z — trigger: deviation-gt-0 (follow-up review pass patches; implementer score 1) — question: accept (a) the `DW-n: already re-asked on KEY` skip in `post` (read by `sweep.ts postDecisions`, track.py docstring) and (b) record fields `group` on indexed legacy entries and optional `move_pending` on an ingest cycle, the 0.1.34 paragraph updated unbumped? — ruling: accept-deviation score 1 — do: keep (a) and (b) as patched, the 0.1.34 Story 38.4 paragraph unbumped with its new phrases and pins; log also the local changes not named in the report: the contract's "a legacy entry whose `status` is `Done` is not asked" clause, the partial-post wording in `decisionLines`, the doc-comment move in `inbox/model.ts`; before commit run the sweepdecisions, driver-contract and sweep.test suites (every `bun test` names `--timeout`) — rule candidate: optional record fields or new skip/refusal messages added inside the story's own unreleased contract-version paragraph, with an in-diff consumer update, a phrase pin, and no reference from any later story's plan or stories.yaml entry, are score-1 local by default and need no consult — observe record: ok

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261108T062400Z-df37cd` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**This run:** the second follow-up review pass over the committed story (c906b4b5, 4e97be32; spec `done` → `review_loop_iteration` 0 → step-04). The story's change (AC1 source, AC2 sink, AC3 promote edge (a), contract 0.1.34) is as committed; this pass patched four review findings in it.

**Summary of this pass's change:**
- `post`: a repeated `--ask` is idempotent even while the issue holding the id's recorded answer still reads as open (re-blocked studio entry, or legacy entry not Done).
- `ingest`: a temporary failure after the reply records `move_pending` only; no contradictory "not retried" note.
- `promote` edge (a): the no-route note names `Block Resolved` when the by-name move reached it.
- `track.py unblock --source sweep` is refused (as before the story).

**Files changed (this pass):**
- `plugins/tk-studio/lib/sweepdecisions.py` — `post`'s `open_on` re-ask lookup; `ingest`'s non-transient `else` branch.
- `plugins/tk-studio/lib/jirabackend.py` — edge (a)'s no-route note names the actual status.
- `plugins/tk-studio/lib/track.py` — `unblock` refuses `--source sweep`.
- `plugins/tk-studio/lib/tests/test_sweepdecisions.py` — two repeated-ask tests; the move-retry test asserts no "not retried" note.
- `plugins/tk-studio/lib/tests/test_jirabackend.py` — `test_block_resolved_reached_but_no_category_route_names_block_resolved`.
- `plugins/tk-studio/lib/tests/test_track.py` — `test_source_sweep_has_no_unblock_and_makes_no_call`.

**Review:** 4 patches applied (high 0, medium 1, low 3), 0 deferred, 3 rejected (Review Triage Log).

**Follow-up review recommended: true.** Patched: high 0, medium 1, low 3. Score 3×1 + 1×3 = 6, at least 5.

**Consults:** none this pass (deviation score 0, no trigger).

**Verification (run by this session after the patches):**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): Ran 3005 tests, OK (skipped=4).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- The spec's targeted module list (`test_release_roster … test_driver_contract`): Ran 779 tests, OK.
- The supervisor (`bun test --timeout 30000`, `tsc`), web (vitest, `tsc`) and `e2e_run_sweep.py` checks were not re-run: this pass changed no TypeScript and no file those checks read beyond the Python verb's internals, which the lib suite covers. The previous pass recorded them green.
- The implementer reports each new or extended test fails against HEAD's files and passes with the patch.

**Unverifiable here (operator):**
- The Windows host leg: `uv run tools/verify_host.py` on the box.
- The live ingest of a hand-posted issue when one returns to `Block Resolved`.
- The serve restart after the merge (`sweep.ts` runs inside `serve`).

**Residual risks:** the three rejected findings (an `OSError` on a tracking write aborts the tick as the tick's other writers do; the record's unlocked read-modify-write between the tick and the close-out; a duplicate `decision:` line if the owner edits a letter between a transient reply failure and its retry), each with its reason in the Review Triage Log.

## Reconcile

- 2026-11-08 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 38-5-the-pause-path-finished (plan refreshed in place; stage start/stop ok)

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-08T04:56:13Z | 2026-11-08T04:58:45Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-08T06:25:38Z | 2026-11-08T07:39:55Z | 375366a5-a153-449b-a1e9-e57be4901cd9 | claude-opus-5-5 | medium | 47398423 | 269633 | 21.1871 | completed |
| review | 1 | 2026-11-08T07:39:56Z | 2026-11-08T08:07:22Z | bf76f03b-e0eb-470b-9531-b9f5a333da04 | claude-opus-5-5 | medium | 10115819 | 98162 | 6.9647 | completed |
| review | 2 | 2026-11-08T08:07:22Z | 2026-11-08T08:22:26Z | 28f30a8b-2dcb-4522-a141-26f0a3c09638 | claude-opus-5-5 | medium | 9845349 | 62033 | 5.5903 | completed |
| gate | 1 | 2026-11-08T08:22:26Z | 2026-11-08T08:25:54Z | a3a1908e-cd27-4615-becb-466d6d3b5414 | claude-opus-5-5 | medium | 2558588 | 16828 | 1.6176 | completed |

