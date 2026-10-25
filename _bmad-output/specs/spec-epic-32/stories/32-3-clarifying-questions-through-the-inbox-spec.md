---
title: 'Clarifying Questions, Through the Inbox'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '8a5fc6089e7aabbf5526b2eb1e8ad166e860ec24'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-3.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** A planner turn that finds gaps no default can cover has no way to ask the owner, and nothing puts such a question in the owner's inbox or the office. 32.1 laid the `intake → awaiting-answers → scoping` rows (event `questions`, verbs `answer`/`go`), but nothing applies them (F2 step 2; B5 item 2).

**Approach:** Add `engage.py questions`, which writes `questions.json` in the served root. A supervisor questions pass applies it once per queue run id through `applyEvent` (source `planner`). It then blocks one Jira issue per engagement (`track.py block --engagement`), reads the owner's Jira reply as answers, and closes the issue (`track.py close --engagement`) once the state leaves `awaiting-answers`. The inbox item carries `engagement`, and the office's planner row gets the "!" through `blocked_issue`. Everything is additive on contract 0.1.27.

User story: As the owner, I want at most three multiple-choice questions with defaults, in my inbox, so that scoping waits on me loudly and never silently, and an absent owner leaves stated assumptions, not a stall (F2 step 2; B5 item 2).

Acceptance criteria (verbatim from epics.md Story 32.3):

- **AC1. Given** an engagement in `intake` whose planner turn finds gaps a default cannot cover **When** the planner writes `engage.py questions` (at most three, each `{id, text, options[] with exactly one default, impact}`; a fourth is refused by name) **Then** `questions[]` fills, the state moves `intake → awaiting-answers` by a `question` input the supervisor applies on the planner's behalf from the written file (the one exception to "the owner sends every input", recorded with source `planner` and the run id), one Jira issue per engagement (`ENG-NNN: questions`, issue type Task, in the project's Jira project) is created or updated through the planning adapter and moved to `Blocked - Awaiting User` with the questions as a comment that @mentions the owner (31.5's `track.py block` path, extended with `--engagement`), the sync-back's inbox lists it (the item carries `engagement: ENG-NNN`), and the office shows the "!" bubble on the planner's desk
- **AC2. Given** the owner's reply on the issue (31.6's Issue screen, Jira itself) or the Chat screen's answer cards **When** the sync-back pulls the comment, or `POST /engagements/{id}/input {verb: answer, answers: {<id>: <option>}}` arrives **Then** the answers land in `questions[].answer` (a comment is parsed as `<id>: <option>` lines, a free-text answer is kept verbatim for the planner to judge), the issue moves to `Block Resolved` and on to `Done` (no validation leg for a question: the planner's next turn judges the answer), and the state moves `awaiting-answers → scoping` once every question has an answer; `go` with questions open converts each unanswered question into its default as a stated assumption in `assumptions[]` (named on the scope page) and moves on; nothing moves on a timer; the lib suite and `bun test` cover the cap, the issue and the inbox item, the two answer paths and the assumptions with fake Atlassian REST

## Boundaries & Constraints

**Always:**
- Use the plan's Settled shapes 1 to 4 (`plans/32-3.md` §Settled shape; SPEC Design notes, CAP-6 bullets) exactly as written: the `questions.json` shape and its validation rules; the issue found by exact summary `ENG-NNN: questions` (type `Task`, label `tk-studio-engagement`) and its comment body; the inbox item's `engagement` and the planner's `blocked_issue`; the comment-as-answers parse.
- The AC's "`question` input" is the 32.1 table's event row `intake + event questions → awaiting-answers` (effect `set-questions`, source `planner`). Apply it through the existing exported `applyEvent`, with the queue `run_id`. The owner's `question` verb stays a no-move. `TRANSITIONS` and `applyEvent` are used, not changed.
- Replan (from 32-2): the chat session runs in a worktree. `project_root` from the run payload is `engage.py --directory`, and the supervisor reads `questions.json` from the served root (`queue.runPayload(runId)?.project_root`). The `run_id` is the queue run id.
- A record write outside the serve path re-reads the record fresh right before its atomic write and merges only its own fields (`state`, `questions`, `assumptions`, `updated`, `inputs`), the `chatSpendPass` rule.
- The cap and the option rule are checked in `engage.py` and again in the supervisor pass. A fourth question is `TooManyQuestions`.
- The questions pass runs from injected deps and never throws. In bun tests, the `uvRunner` is injected (no live Jira). The lib tests use fake Atlassian REST.
- Nothing moves on a timer. The pass runs at run ends (the existing `finally` sites) and after an applied `answer`/`go` on the input route.
- Contract: extend 0.1.27 additively. The header clause is `0.1.27 (Story 32.3) adds to this same entry …`, and there is never a `**0.1.28**`. Keep every 32.1 and 32.2 pin in `test_driver_contract.py`, and add a 32.3 pin. In the state table, only the `awaiting-answers | answer` rows' source cell changes (adds `supervisor`). The bun equality test against `TRANSITIONS` must stay green.
- House rules: stdlib-only Python via `uv run`; atomic writes; the AD-11 status block (exit 2 on `blocked`); credentials never land in files or events; nothing in the plugin imports a driver or the supervisor.
- Stay within the plan's Files list (23 files, including this spec).

**Block If:**
- The Files list must grow beyond the plan's list: HALT naming the file (oversize gate, 2026-10-25).
- The state-table source-cell edit breaks the bun equality test or a 32.1 pin, and the fix needs `engagement.ts` or a file outside Files: HALT naming the test.
- Creating the `Task` issue needs a Jira project type or scheme change that 31.1's setup did not make, and no fake can stand in for it: HALT naming the setup gap. (In fakes, `IssueCreateRefused` is the named refusal and not a halt.)
- Applying `questions` would need a `TRANSITIONS` row or effect change (for example, re-asking from `awaiting-answers` or `scoping`): HALT.

**Never:**
- No change to `apps/studio-web/**`, `engagement.ts`, `chat.ts`, `queue.ts`, `board.ts`, `closeout.ts`, `jirabackend.py`, `plansync.py`, `miniyaml.py`, `released-roster.json`, `.bmad-loop/**` or `_bmad-output/planning-artifacts/**`.
- No new state-machine row, no timer, and no planner-minted turn after the answers (32.4 decides how scoping starts).
- No validation leg for an engagement item (the resolution pass skips it).
- No refactor of `jirabackend.promote`; the issue create stays in `track.py`.
- No push, tag, release motion or version-gate bump.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ask | `intake`; `engage.py questions --directory R --engagement ENG-001 --run-id Q --questions-file f` with 1–3 valid questions | `questions.json` written atomically; status `ok` | none |
| Fourth question | 4 questions | nothing written | `blocked` `TooManyQuestions`, exit 2 |
| Bad question | no default, two defaults, 1 or 7 options, duplicate id/label, bad id, empty text/impact | nothing written | `blocked` `QuestionInvalid` naming the index |
| Wrong state / closed / no run id | state ≠ `intake`; terminal; no `--run-id` | nothing written | `NotIntake` / `EngagementClosed` / `RunIdRequired` |
| Apply | ended `engagement-chat` run Q; `questions.json` with `run_id: Q`; record `intake` | `questions[]` set; state `awaiting-answers`; `inputs[]` line `{verb: questions, source: planner, run_id: Q}`; `engagement` event | once per run id: a second pass applies nothing |
| Apply refused | invalid file, or state ≠ `intake` | record unchanged | one `engagement-questions-skipped {engagement, project, run_id, reason}` event |
| Block | `awaiting-answers`, no issue | `track.py block --engagement` creates `ENG-NNN: questions` (Task), moves it to `Blocked - Awaiting User`, comments with the owner mention and each open question; `engagement-issue {action: blocked}` | `retry: true` emits nothing (the next pass retries); `IssueCreateRefused`, `EngagementNotFound`, `NoOpenQuestions` by name |
| Inbox | sync-back sees summary `ENG-001: questions` blocked | the `inbox.json` item carries `engagement: "ENG-001"`; `reason_comment` fills | none |
| Office "!" | an open inbox item with `engagement`, with or without a run | the project's `planner` agent has `blocked_issue {issue, state}` | a story block on a run still wins for the other agents |
| Jira answer | owner comment `scope: Small` + `db: something else` after the newest agent comment | `answer` applied with source `supervisor`: `Small` matched to its label, the free text kept verbatim; all answered → `scoping`; `engagement-answers {comment, ids}` | a comment id is applied once; no parsed line, or questions still open → re-block with the open ones |
| Card answer | `POST /engagements/{id}/input {verb: answer, answers}` | answers land; on all answered → `scoping`; `afterEngagementInput` runs the pass, which closes the issue | the pass's errors are swallowed; an unknown id stays 400 SchemaError |
| Go | `go` while questions are open | each unanswered question's default becomes an `assumptions[]` entry; → `scoping`; the issue closes | none |
| Close | state left `awaiting-answers` with a `blocked` issue event and no later `closed` | `track.py close --engagement`: `Block Resolved`, then `Done`; `engagement-issue {action: closed}` | a move already in place goes in `skipped[]`; an absent issue is `NoIssue`, `blocked` |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-32/plans/32-3.md` §Code Map) is the investigation, with line anchors. The orchestrator re-checked them at 8a5fc60 and they hold. The implementer reads the plan's Code Map and Settled shape in full. In summary:

- `apps/supervisor/src/engagement.ts` (read-only): `TRANSITIONS` :200-236 (event `questions` :203; `answer` :205-206; `go` :207), `defaultOf` :240, the `assume-defaults` effect :265, `set-questions` :272, `applyInput` :299-317, `applyEvent` :321-334 (first caller is this story), `InputSource` :43.
- `apps/supervisor/src/chat.ts` (read-only): `chatSpendPass` :242-298 is the model for an injected-deps, never-throws pass with a fresh-read merge. It takes the root from `queue.runPayload(runId)?.project_root` (:263).
- `apps/supervisor/src/cli.ts`: `chatSpendQuietly` at :651, :831 and :1191 (wrapper :725-728; `underBunTest()` skip as at :301). Add `questionsQuietly` beside it, and wire the production `afterEngagementInput` where `ApiDeps` is assembled.
- `apps/supervisor/src/api.ts`: `postInputRoute` :532-560. Add the `ApiDeps.afterEngagementInput?` call after an applied `answer`/`go` (fire-and-forget).
- `apps/supervisor/src/closeout.ts` (read-only): `trackArgs` and `uvRunner` :454-480 are the model for the `track.py` call (timeout 120).
- `apps/supervisor/src/resolution.ts:216`: skip items carrying `engagement`.
- `apps/supervisor/src/office.ts`: `blockedIssueFor` :357, the per-agent `blocked` :660-671, the diff :800-804; `registry.ts:19` `ROLES` names `planner`; `readInbox` :334.
- `apps/supervisor/src/inbox.ts:118` `readComments`.
- `plugins/tk-studio/lib/engage.py`: `reply` (:421-463) and argparse `main` (:468-524) are the verb model; reuse `_result`/`_finish` :102-113, `engagement_dir` :127, `read_record` :135, `atomic_write_text` :61.
- `plugins/tk-studio/lib/track.py`: `block` :222-267 (argparse :900-909), `SOURCES` :125, `RESOLVED_STATUS` :1011, `jirabackend.search_jql` (:1066) and the create pattern in `jirabackend.promote` :787-799.
- `plugins/tk-studio/lib/syncback.py:54` `SEARCH_FIELDS`; `plugins/tk-studio/lib/inbox.py` `BLOCK_COMMENT_RE` :62, `_item` :115-135, `derive` :138-175.
- Tests: `test_track.py:42` `FakeTrack` (add `POST /issue` and `/search/jql`; `test_jirabackend.py:99-104` is the model); `test_syncback.py:61` `FakeSyncBack`; `test_inbox.py` `StateTests` :54, `MergeTests` :187; `test_driver_contract.py` 32.1/32.2 pins :964, :1002; bun fixtures `test/inbox.test.ts:25`, `test/resolution.test.ts:23,38,71`.
- Contract `driver-contract.md`: header line 5, §1 :112 (the inbox item and `blocked_issue`), §2 track row :388 and engage row :389, the state table's `awaiting-answers | answer` rows.
- `conformance/runner.py:187` checks the "If the deterministic core is unrunnable…" sentence in the track skill. Keep it.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/engage.py` -- add verb `questions` (`--directory`, `--engagement`, `--run-id`, `--questions-file`, `--dry-run`); validate per Settled shape 1; write `questions.json` atomically; refusals `TooManyQuestions`, `QuestionInvalid` (index), `EngagementClosed`, `NotIntake`, `RunIdRequired` -- AC1's planner write and cap
- `plugins/tk-studio/lib/tests/test_engage.py` -- cover the happy write, the fourth question, each invalid shape, the state refusals and dry-run -- the cap
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` -- when to ask (gaps a default cannot cover; at most three; otherwise proceed on stated defaults); the exact argv with `--directory <project_root>` -- the planner's instruction
- `plugins/tk-studio/lib/track.py` -- `block --engagement ENG-NNN` (exclusive with `--story`; implies source `engagement`): find or create the issue, transition to Blocked, comment per Settled shape 2; result shape and refusals per the plan; new verb `close --engagement` (`Block Resolved`, then `Done`; `skipped[]`; `NoIssue`) -- AC1 issue, AC2 close
- `plugins/tk-studio/lib/tests/test_track.py` -- fake `POST /issue` and `/search/jql`; cover create, find-existing, re-block, close, the refusals -- fake Atlassian REST
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- document `--engagement` and `close`; keep the runner.py:187 sentence
- `plugins/tk-studio/lib/syncback.py` -- `SEARCH_FIELDS` gains `summary` -- the inbox needs the summary
- `plugins/tk-studio/lib/tests/test_syncback.py` -- the fake returns `summary`; assert it reaches the inbox
- `plugins/tk-studio/lib/inbox.py` -- `_item`/`derive`: summary `^ENG-\d{3,}: questions$` → `engagement` and `title`; the previous-item copy keeps `engagement` -- AC1 inbox item
- `plugins/tk-studio/lib/tests/test_inbox.py` -- the engagement item in `StateTests` and `MergeTests`; `reason_comment` fills from the engagement comment
- `apps/supervisor/src/questions.ts` (new) -- the pass: apply, block, Jira answers, close (plan Code Map steps 1–4), injected deps, never throws, fresh-read merge -- AC1/AC2 orchestration
- `apps/supervisor/src/cli.ts` -- `questionsQuietly` at the three `finally` sites (`opts.questions` injectable or `false`; `underBunTest()` skip); the production `afterEngagementInput`
- `apps/supervisor/src/api.ts` -- `ApiDeps.afterEngagementInput?`; call it after an applied `answer`/`go`, errors swallowed
- `apps/supervisor/src/resolution.ts` -- skip items with `engagement`
- `apps/supervisor/src/office.ts` -- the project's `planner` agent takes `blocked_issue` from the first open inbox item with `engagement`, with or without a run
- `apps/supervisor/test/questions.test.ts` (new) -- apply once per run id, skipped event, block/retry, Jira-answer parse (label match, verbatim free text, once per comment, re-block), close, `go` assumptions, never throws
- `apps/supervisor/test/resolution.test.ts`, `test/office.test.ts`, `test/api.test.ts` -- the skip, the planner "!", and `afterEngagementInput` after `answer`/`go` (not after a refused input)
- `apps/supervisor/README.md` -- the questions pass, its service events and the `afterEngagementInput` hook
- `plugins/tk-studio/contracts/driver-contract.md` -- the 0.1.27 (Story 32.3) header clause; §2 engage `questions`; §2 track `--engagement` and `close`; the inbox item `engagement?`; the planner-desk `blocked_issue` rule; the `answer` rows' source `supervisor`
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- a 32.3 pin; keep the 32.1 and 32.2 pins

**Acceptance Criteria:**
- Given an `intake` engagement and a finished `engagement-chat` run whose session wrote `engage.py questions`, when the questions pass runs, then `questions[]` fills, the state is `awaiting-answers` with an `inputs[]` line of source `planner` carrying the queue run id, `track.py block --engagement` ran, and the planner agent's `blocked_issue` shows the issue once the inbox holds the engagement item.
- Given `awaiting-answers`, when every question is answered (Jira comment or card) or `go` arrives, then the state is `scoping` (`go` adding each open default to `assumptions[]`) and `track.py close --engagement` moves the issue to `Block Resolved` and then `Done`.
- Given the verify gate, when it runs, then the lib suite is green except the 3 released-roster guards, conformance is `ok: true`, `bun test` and `tsc --noEmit` are clean.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- layers: blind-hunter 8 findings, edge-case-hunter 4 findings; 10 unique after dedupe (race, case-insensitive id); plus 1 consult follow-up (TS unknown-field pin)
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 0, medium 4, low 7)
- defer: 0
- reject: 0
- addressed_findings (sent to the implementer in one relaunch; outcome recorded under pass 2):
  - `[medium]` `[patch]` concurrent questions passes can create two `ENG-NNN: questions` issues or post a duplicate comment (no serialisation of find→create→event) — serialise per engagement
  - `[medium]` `[patch]` a refused Jira answer (`writeFresh` null) still emits `engagement-answers` with its ids, marks the comment consumed and never re-blocks
  - `[medium]` `[patch]` a re-block after an unparsed owner comment posts nothing (the `_block_issue` skip rule sees the same body) though Settled shape 4 says the comment names what is still open
  - `[medium]` `[patch]` a named `track.py block` refusal (e.g. `IssueCreateRefused`) records nothing and calls Jira again at every run end; the owner gets no signal
  - `[low]` `[patch]` Jira answers bypass the typed-payload size check the input route applies
  - `[low]` `[patch]` answer lines: id matched case-sensitively; a copied `(default)` suffix or `- ` bullet defeats the label match
  - `[low]` `[patch]` the `seen` comment-id set is not updated inside the loop, so an edited comment (two lines, one id) is handled twice in one pass
  - `[low]` `[patch]` an unparsable `questions.json` emits `engagement-questions-skipped` for every ended chat run of the engagement, not once
  - `[low]` `[patch]` `engage.py` id check uses `re.match` with `$`, accepting `"q1\n"` that the supervisor then refuses
  - `[low]` `[patch]` stale docs: contract engage row "32.3 to 32.8 add the verbs `questions`…", the `track.py` docstring caller sentence, the README 31.7 "no call site" paragraph
  - `[low]` `[patch]` consult follow-up: `questions.test.ts` does not pin an unknown question field as `QuestionInvalid`

### 2026-10-25 — Review pass (follow-up, review_loop_iteration 0)
- layers: blind-hunter 5 findings, edge-case-hunter 3 findings; 8 unique (no duplicates)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 4, low 2)
- defer: 0
- reject: 2 (low 2): cancel out of `awaiting-answers` does not fire the input-route hook (cancel is not in the story's criteria; the next pass at a run end closes the issue); a Jira search-index lag could duplicate the issue on a fast retry (block retries are paced by pass boundaries, far past index lag; the same-pass re-block needs an inbox item, which needs the issue indexed)
- addressed_findings (one implementer relaunch, then one for the consult's DO lines):
  - `[medium]` `[patch]` a re-block after an unparsed/refused owner comment that answered transient was never retried (`blockOwed` saw the older `blocked` as current, the comment already seen) — a block is now also owed since the newest `engagement-answers` with `ids: []` (`blockOwedSince`)
  - `[medium]` `[patch]` owner answers synced before a later agent comment were dropped (only comments after the newest agent comment were read) — every owner comment no `engagement-answers` names is read, in order, each id once
  - `[medium]` `[patch]` a named `track.py close` refusal was retried at every pass with no record — one `engagement-issue {…, action: refused, step: close, reason}`, no further close call; block logic ignores `step: close`
  - `[medium]` `[patch]` the issue was never closed when the block moved it but returned transient (no `blocked` event) — close is owed for any record with a `questions` line once it left `awaiting-answers`, until `closed` or a close `refused`
  - `[low]` `[patch]` a pasted question header (`<id>: <text>`) was read as the answer — `parseAnswers` ignores a line equal to the question's text
  - `[low]` `[patch]` the README and `rootChains` comment claimed cross-process serialisation — corrected to in-process only (`track.lock` across processes); the `engagement-answers` events are re-read right before each apply

### 2026-10-25 — Review pass (follow-up 2, review_loop_iteration 0)
- layers: blind-hunter 7 findings, edge-case-hunter 4 findings; 10 unique (search-index-lag duplicate/NoIssue reported by both)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 0, low 5)
- defer: 0
- reject: 5 (low 5): Jira search-index lag can duplicate the issue or make a card-answer close see `NoIssue` (same ruling as the previous pass: block retries and card answers are paced by pass boundaries and a human reading the questions, far past index lag; a human closing the issue in Jira clears the inbox item and the "!"); answers on a duplicate issue are not read (follows only from the rejected duplicate); an owner edit to an already-applied comment is not re-read (Settled shape 4: once per comment id); the 31.6 Issue screen's Done on an engagement issue re-blocks (Settled shape 4: a comment with no parsed line re-blocks; mapping Done to `go` is product behaviour the story does not name); a multi-line free-text answer keeps only its line (Settled shape 4 is per line)
- addressed_findings (one implementer relaunch):
  - `[low]` `[patch]` `track.py close` always tried `Block Resolved` first, which setup reaches only from `Blocked`, so a never-blocked issue (created, block transition failed transient) refused for good — it now skips `Block Resolved` when not blocked and no transition reaches it, named in `skipped[]`, and goes on to `Done`
  - `[low]` `[patch]` close's missing-transition refusal had no name though the contract says "a close refusal by name" — now `NoTransition: …`, named in the §2 track row, the track SKILL.md, the README and the `closeStep` comment
  - `[low]` `[patch]` `blockStep` stamped the `blocked` event after the up-to-120 s `track.py block` call, so a partial card answer written during the call owed no corrected re-block — the stamp is taken before the call (both `blocked` and `refused`)
  - `[low]` `[patch]` driver-contract.md:5 said a named block refusal is re-called only after a later `questions` or `answer` line; the code also re-calls after an owner comment that applies nothing — the clause names it (pinned)
  - `[low]` `[patch]` a question with id `impact` read a pasted block-comment `Impact: <impact>` line as its answer — `parseAnswers` skips it

## Design Notes

- The 3 released-roster guards (`test_release_roster` `test_repo_roster_rides_the_version_gate` and the two `test_drift_check` `SkillsDirPlaneTestCase` real-repo cases) have been red by design since 32.2, until the release motion. They are `unverifiable-here`. Nothing else may be red.
- The live Jira path (the owner seat on the box, a real `Task` type) is `unverifiable-here` until the attended first engagement. Fakes prove it here.
- The inbox lists the item on the next sync-back tick (a queued cron job). Its run end drives the pass's Jira-answer step. That is not a timer of this story's own.
- The record's read→rename window against the input route remains (32-2 consult). A shared record lock is not this story's.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green except the 3 released-roster guards
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test test/questions.test.ts test/resolution.test.ts test/office.test.ts test/api.test.ts test/engagement.test.ts test/chat.test.ts`, then `bun test` -- expected: 0 fail
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bunx tsc --noEmit` -- expected: clean
- `grep -n "0.1.27 (Story 32.3)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" plugins/tk-studio/contracts/driver-contract.md` -- expected: 0
- `git status --porcelain` -- expected: only the Files above

## Deviation Summary

### pass 1 (2026-10-25, implementer)

- planned: Settled shape 1 option labels "unique", fields `{id, text, options[{label, default?}], impact}` / actual: `engage.py` and the supervisor's `checkQuestions` treat labels as unique case-insensitively and refuse any field outside the shape as `QuestionInvalid` / why: Jira answers match labels case-insensitively, so case-only label differences are indistinguishable; refusing unknown fields mirrors the proposal check / may affect: none
- planned: wire the production `afterEngagementInput` where `ApiDeps` is assembled in `cli.ts` / actual: `cli.ts` exports `afterEngagementInput(queue, root, id)` and `createApi` (api.ts) defaults to it when `deps.afterEngagementInput` is unset, as `chatDeps()` is defaulted / why: `ApiDeps` is assembled in `api.ts` (`serve`/`createApi`), not `cli.ts` / may affect: none
- planned: no refusal named for a bad `--engagement` id in `track.py`; no `close` result shape / actual: a bad id is `EngagementNotFound`; `close` answers `{ok, dry_run, engagement, issue, moved[], skipped[], notes, written}` / why: the plan left both open / may affect: none

DEVIATION SCORE: 1

Orchestrator verify after pass 1: lib suite 1859 ran, OK (skipped 2; the 3 released-roster guards are green at this baseline); conformance `ok: true`; the six named bun files 318 pass 0 fail; full `bun test` (`TK_STUDIO_ROOT` set, `TK_ATLASSIAN_*` unset) 1282 pass, 5 skip, 0 fail across 28 files; `tsc --noEmit` clean. The implementer's 11 sbx/sandbox failures came from running without `TK_STUDIO_ROOT`; they do not reproduce here.

### pass 2 (2026-10-25, implementer, review patches)

- planned: Settled shape 4's answer regex (case-sensitive id), label compared trimmed and case-insensitively / actual: the id is matched case-insensitively and lowercased; a leading `- ` and a trailing ` (default)` are stripped for the label comparison only; free text stays verbatim / why: review patch 6 (an owner who capitalises the id or copies an option line is still read) / may affect: none
- planned: a `track.py block` refusal emits nothing and the next pass calls again; `engagement-issue` actions `blocked | closed` / actual: a named refusal emits `engagement-issue {engagement, project, action: "refused", reason}` once per reason since the last `questions`/`answer` line, with no further call until a later input owes a block (`retry: true` still emits nothing); `track.py` holds a per-engagement `track.lock` (held → `retry: true`; OS refusal → `EngagementLockUnwritable`); `close` refuses `EngagementNotFound` when the engagement directory is absent / why: review patches 4 and 1 (the refusal is visible, Jira is not called at every run end, two callers cannot create two issues) / may affect: 32-7

DEVIATION SCORE: 1

### consult doc fixes (2026-10-25, implementer)
- The 2nd consult's DO lines: `EngagementLockUnwritable` and `close`'s `EngagementNotFound` named in the §2 `tk-studio-track` row, the track SKILL.md and the README; the `track.lock` sentence in the row. Doc only. DEVIATIONS: none. The frontmatter `deviation_score` stays 1 (both passes accepted at score 1, no DRIFT).

Matrix test audit: every row has a running, passing test. Ask / fourth / bad question / wrong state are in `test_engage.py` `QuestionsTestCase`. Apply, apply refused, block, Jira answer, card answer, go and close (supervisor side) are in `test/questions.test.ts`. The issue create, find, re-block, close and refusals are in `test_track.py`. The inbox item is in `test_inbox.py` and `test_syncback.py`, the planner "!" in `test/office.test.ts`, and the hook after `answer`/`go` in `test/api.test.ts`.

### pass 3 (2026-10-25, implementer, follow-up review patches)

- planned: Jira answers are the owner comments after the newest agent comment / actual: every owner comment no `engagement-answers` event names yet, in comment order / why: follow-up finding 2 (a sync race dropped answers) / may affect: none
- planned: `engagement-issue` `refused` only from the block / actual: a named close refusal emits `engagement-issue {engagement, project, action: refused, step: close, reason}` once; driver-contract.md:5 (0.1.27 entry) says so / why: follow-up finding 3 / may affect: none (no later EP-32 story names the event, per the consult)
- planned: close only after a recorded `blocked` event / actual: close owed for any record with a `questions` line that left `awaiting-answers`, until `closed` or a close `refused` / why: follow-up finding 4, AC2 / may affect: none

Implementer self-score 2; the consult (deviation-gt-0, Consult Log) ruled accept-deviation score 1, no DRIFT, no version bump. Frontmatter `deviation_score` stays 1.

### pass 4 (2026-10-25, implementer, follow-up review 2 patches)

- planned: close moves the issue `Block Resolved`, then `Done` / actual: an issue not in `Blocked - Awaiting User` with no transition into `Block Resolved` skips it (`transition: <KEY> is not blocked (<status>); 'Block Resolved' skipped` in `skipped[]`) and goes on to `Done`; a blocked issue still needs `Block Resolved` / why: follow-up 2 finding 1 (setup adds only `Blocked → Block Resolved`) / may affect: none
- planned: close refusals by name / actual: the missing-transition refusal is `NoTransition: …`, named in the §2 track row, SKILL.md and README; the 0.1.27 (Story 32.3) clause also names the re-call after `engagement-answers` with `ids: []`; `test_driver_contract.py` pins both / why: follow-up 2 findings 2 and 4 / may affect: none

Implementer self-score 1; the consult (deviation-gt-0, Consult Log) ruled accept-deviation score 1, no DRIFT, no version bump. Frontmatter `deviation_score` stays 1.

## Consult Log

- 2026-10-25T07:39:21Z — trigger: deviation-gt-0 — question: accept the three pass-1 deviations (case-insensitive label uniqueness and a closed question shape; `afterEngagementInput` defaulted in `createApi`; `EngagementNotFound` for a bad id and the `close` result shape) at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: keep A, B and C as built, no DRIFT lines; make sure a test pins A at both validators (`engage.py questions` and `questions.ts` `checkQuestions` each refuse case-only label duplicates and an unknown field as `QuestionInvalid`) — rule candidate: when a story says labels or keys are "unique" and answers match them case-insensitively, uniqueness is checked case-insensitively, and a published JSON shape is closed unless it says otherwise; neither needs a consult
  - follow-up: `test_engage.py` pins both; `questions.test.ts` lacked the unknown-field pin, added with the review patches (patch 11).

- 2026-10-25T08:01:59Z — trigger: deviation-gt-0 (review-patch pass 2) — question: accept the case-insensitive answer parse with bullet/`(default)` stripping and the `refused` engagement-issue action plus `track.lock` / `EngagementLockUnwritable` / `close` `EngagementNotFound` at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: keep A and B as built, no DRIFT, no version bump; in driver-contract.md:388 add `EngagementLockUnwritable` to the `block --engagement` blocked list, add `EngagementNotFound` (engagement dir absent) and `EngagementLockUnwritable` beside `NoIssue` in the `close` cell, and say both verbs hold `_bmad-output/engagements/<id>/track.lock` with a held lock ending `partial` `retry: true`; add `EngagementLockUnwritable` to skills/tk-studio-track/SKILL.md:84 and README.md:146, then rerun the lib suite, bun test and conformance — rule candidate: a parser that accepts more input forms and normalizes them to the pinned stored form is score 1 with no DRIFT, and a supervisor service_events detail the contract never names needs only the README row

- 2026-10-25T08:16:36Z — trigger: deviation-gt-0 (follow-up review patch pass, implementer self-score 2) — question: accept (A) Jira answers read from every owner comment no `engagement-answers` names (not only after the newest agent comment), (B) a close refusal emitting `engagement-issue {…, action: refused, step: close, reason}`, (C) close owed for any engagement with a `questions` line that left `awaiting-answers`, not only after a recorded `blocked` — at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: keep A, B and C as built, no DRIFT, no version bump; in driver-contract.md:5 (the 0.1.27 entry) after "closes it with the new verb `track.py close …` (`Block Resolved`, then `Done`; no validation leg)" add "; a close refusal by name emits `engagement-issue {engagement, project, action: refused, step: close, reason}` once and no further close call (a block's `refused` carries no `step`)"; make sure questions.test.ts pins the c2/c3/c4 race, a close with no recorded `blocked` reaching `closed`, and a close `refused` with `step: "close"` stopping further close calls without counting as a block `refused` — rule candidate: a new field on a supervisor service event is score 1 when no later story in the epic names that event; if the event appears in driver-contract.md and the current story introduced it, update that contract line in the same patch and do not bump the version

- 2026-10-25T08:42:51Z — trigger: deviation-gt-0 (follow-up review 2 patch pass, implementer self-score 1) — question: accept (A) close skipping `Block Resolved` for a never-blocked issue, (B) the `NoTransition` refusal name, (C) the §2 track row and the 0.1.27 clause naming both and the `ids: []` re-call, at score 1, 2, or reject? — ruling: accept-deviation score 1 — do: keep A, B and C as built and commit them with this pass, no version bump; record that a never-blocked issue skips `Block Resolved` (named in `skipped[]`) and a missing transition refuses `NoTransition`, both inside the 0.1.27 (Story 32.3) entry; leave the blockStep stamp and the `Impact:` skip as they are (not deviations) — rule candidate: a close/resolve verb that walks a workflow by name may skip an intermediate status setup only reaches from a status the issue never held, naming the skip in `skipped[]` and refusing `NoTransition` only when a required step fails; score 1 within the story that introduced the contract entry
  - observation recorded (`observe.py record`, ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5 (effort medium, advisor off on every leg; `pipeline.py resolve`); knowledge spine absent

**Summary.** This was the second follow-up review pass over the already-built story, against baseline `8a5fc6089e7aabbf5526b2eb1e8ad166e860ec24` (HEAD before this pass: `d539f19218744bd25bd1c8fb13f347495843b23e`). It fixes five low-severity edges:
- A `track.py close` on an issue that was never blocked now reaches `Done`.
- Close's missing-transition refusal is named `NoTransition`.
- A partial card answer that lands during a block call now owes a corrected re-block.
- The contract's re-call rule for a block refusal now matches the code.
- A pasted `Impact:` line is no longer read as an answer.

**Files changed (this pass)**
- `plugins/tk-studio/lib/track.py`: `close_engagement` skips `Block Resolved` for an issue that is not blocked and has no transition into it (named in `skipped[]`). The missing-transition refusal is now `NoTransition: …`. The docstring says so.
- `plugins/tk-studio/lib/tests/test_track.py`: a never-blocked issue closes `complete` with the skip named; a blocked issue still needs `Block Resolved`; a missing transition to `Done` refuses as `NoTransition`.
- `apps/supervisor/src/questions.ts`: `blockStep` takes the event stamp before the `track.py block` call. `parseAnswers` skips a copied `Impact: <impact>` line. The `closeStep` comment names `NoTransition`.
- `apps/supervisor/test/questions.test.ts`: a partial answer written mid-block owes exactly one re-block; the `parseAnswers` `impact` cases.
- `plugins/tk-studio/contracts/driver-contract.md`: the §2 `tk-studio-track` row names `NoTransition` and the never-blocked skip. The 0.1.27 (Story 32.3) clause names the re-call after `engagement-answers` with `ids: []`. There is no version bump.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: pins for both contract phrases. Every 32.1 and 32.2 pin is kept.
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` and `apps/supervisor/README.md`: the close behaviour and `NoTransition`.
- `_bmad-output/specs/spec-epic-32/stories/32-3-clarifying-questions-through-the-inbox-spec.md`: this pass's triage, deviations, consult and result.

**Review.** Blind-hunter returned 7 findings and edge-case-hunter 4, which came to 10 unique findings.
- Patched: 5 (high 0, medium 0, low 5).
- Deferred: 0.
- Rejected: 5 (low).
- Consults: one, on deviation-gt-0. It ruled accept-deviation score 1, with no DRIFT. Its DO lines were followed.

The diff was about 288 KB, so the reviewers got it as a file path (`git diff <baseline> -- apps plugins`) rather than inline.

Follow-up review: recommended (true). The 5 low patches give a score of 3×0 + 1×5 = 5, which is at least 5.

**Verification** (run by this session after the patch)
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1865 tests ran, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test` over the six named files (`TK_STUDIO_ROOT` set, `TK_ATLASSIAN_*` unset): 338 pass, 0 fail.
- The implementer's full `bun test`: 1302 pass, 0 fail across 28 files.
- `bun node_modules/typescript/bin/tsc --noEmit`: clean.
- The contract has `0.1.27 (Story 32.3)`, and `**0.1.28**` occurs 0 times.
- `git status` names only the plan's Files.
- The implementer ran each new test against the pre-patch sources, and each one failed there.

**unverifiable-here**
- The live Jira path (the owner seat on the box, a real `Task` type, the real workflow's transitions out of `To Do`) has been tested with fakes only. It gets its first live run at the attended first engagement, after 32.8.

**Residual risks**
- Jira search-index lag: a block retry or a card-answer close fired seconds after a create could still miss the new issue (a duplicate, or a final `NoIssue`). This was rejected twice as far below pass pacing. The cure would be passing the known issue key to `track.py`.
- The never-blocked skip assumes the workflow reaches `Done` from the issue's status. If it does not, the refusal is a final `NoTransition`.
- Serialisation is still in-process only. There is no shared record lock (the 32-2 consult).

## Reconcile

- 2026-10-25 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 32-4-the-scope-of-work-on-confluence
