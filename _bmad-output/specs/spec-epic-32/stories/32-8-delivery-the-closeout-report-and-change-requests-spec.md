---
title: 'Delivery, the Closeout Report and Change Requests'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '27db57dd7e392d353572c53c51cc71b25edebfe9'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-32/plans/32-8.md'
  - '{project-root}/plugins/tk-studio/contracts/driver-contract.md'
warnings: [oversized]
deferred:
  - summary: >-
      A named engage.py closeout refusal records engagement-closeout ok:false and is never retried, so the record stays in-progress/partial with the issue open; a manual engage.py closeout rerun writes the report but never applies run-ended, closes the issue or notifies.
    evidence: |-
      Blind Hunter; delivery.ts closeoutStep records the run_id on refusal (counts as done, accepted by consult 1 as deviation 4); the lib never moves state. Deferral class (a): AC1's state/issue/notifier outcome is not reached after a refusal.
    location: >-
      apps/supervisor/src/delivery.ts:274
    severity: medium
  - summary: >-
      After a closeout leaves an engagement partial for a run that ended unstopped, an owner go {cap} moves it to in-progress with no run queued and no new closeout, so it stays in-progress indefinitely.
    evidence: |-
      Edge Case Hunter; step 7 resubmits only cap-stopped runs and the closeout pass treats the engagement-closeout event for that run_id as done. Deferral class (a): the go-past-a-cap input named by AC2 leaves no run and no report.
    location: >-
      apps/supervisor/src/delivery.ts (lastRunEnded / closeoutStep); apps/supervisor/src/approve.ts runStep step 7
    severity: medium
deviation_score: 2
reconcile_verdict: no-impact
---

<intent-contract>

## Intent

**Problem:** After 32.6 an approved engagement runs, but nothing says when it is finished: a run that ends on its own leaves the record `in-progress`, with no report and the Jira issue open; `revise` does not stop a live run, and `POST /engagements` refuses `follows` (400 SchemaError).

**Approach:** A supervisor closeout pass at the `finally` sites detects the engagement's last run ending, composes a JSON input and runs `engage.py closeout` on the host (render, write, publish `ENG-NNN: Closeout`, merge `closeout`), then applies `run-ended` via `applyEvent`, closes the Jira issue and sends one notifier line. `revise` mid-run stops live runs gracefully; `follows` is accepted additively within contract 0.1.27.

### Story 32.8 (authoritative, epics.md — transcribed, not extended)

As the owner, I want delivery to say done, not done and why, with the cost per story, So that the engagement closes on evidence and a change after delivery is a new engagement with its own quote (F2 steps 7 to 9; B5 items 7 to 9).

- **AC1:** **Given** `in-progress` and the engagement's last run ending (`complete`, `partial`, `failed`, `cancelled`) **When** the supervisor's engagement pass runs (at the `finally` sites, as the resolution pass does) **Then** it writes `_bmad-output/engagements/<id>/closeout.md`: each deliverable's acceptance signal checked against the landed stories' specs and PRs (done / not done / why), the PRs, a per-story cost table from the meter's records and the runs' `job-run` events, the planning spend, the quote against the actual, and every side exit with its reason; publishes it as `Engagements/ENG-NNN/Closeout` beside the scope; sets `closeout` and the state `delivered` (every deliverable done) or leaves `partial` / `failed` with the report; moves the engagement's Jira issue to `Done`; the notifier sends one line with the link
- **AC2:** **Given** a live engagement **When** `question` (the owner asks; the planner's next turn answers; no state change), `revise` (back to `scoping` with the quote voided; a run in flight finishes its story through a graceful stop) or `go` (past a cap or past open questions) arrives **Then** it applies as 32.1's table says; after `delivered` a change is a new engagement (`POST /engagements {project, request, follows: ENG-NNN}`) with its own quote; `bun test` covers the closeout's composition and the three mid-run inputs with fakes; the lib suite covers the report's rendering and `engage.py closeout`; the contract's §2 names `tk-studio-engage` and its verbs (`reply`, `questions`, `scope`, `quote`, `closeout`; 0.1.27 additive) and §7.1 the state table; `kb/engagement-loop.md` describes the loop as built, for the attended first engagement and for EP-33

## Boundaries & Constraints

**Always:**
- Files boundary = the plan's 16 files (Tasks below). Any other file is a deviation; growing the list is a HALT (oversize gate).
- `TRANSITIONS` rows unchanged; the contract's `### The engagement state table (0.1.27, Story 32.1)` stays equal to it.
- Run-end rows go through the exported `applyEvent` (source `supervisor`) in a fresh read (`writeFresh`/`applyRow` style); lib writes `closeout` alone via `_merge_record` (fresh read, merge-only). No new shared lock.
- Lib: stdlib-only, atomic writes, every exit ends with the JSON status block (AD-11), no credentials in files/events, no driver/supervisor imports (AD-2).
- Contract: one `0.1.27 (Story 32.8) adds to this same entry …` clause after 32.7's; no `**0.1.28**`; append "Story 32.8" to the "Story / rulings" row in 32.7's shape ("…, Story 32.7, Story 32.8 (Epic 32)"); add `closeout` to the §2 `tk-studio-engage` row; keep every 32.1–32.7 pinned string; add one 32.8 pin before `test_section_8_names_the_cli_drives`.
- Owner text is unchecked: deliverables parse with `parse_scope`/`SIGNAL_RE`, falling back to a case-insensitive `Acceptance signal` substring search; no signal → "not done — no acceptance signal", never a crash.
- Close any open cap/ask block as part of moving the issue to Done (`track.py close --engagement`, gated by `jiraBound`).
- Every Atlassian, `gh`, uv and notifier call is a fake in tests.

**Block If:**
- A `TRANSITIONS` row must change (e.g. `run-ended` from `paused`) — §7.1 change needing `bmad-correct-course`.
- The closeout needs a chat-line field, a new route, or a contract version beyond 0.1.27.
- The Files list must grow beyond the plan's 16 files.

**Never:** never pull the served root (DW-46); never closeout a `cancelled` (terminal) or `scoping` record; never resubmit after a `revise` stop; never touch the previous record on `follows`; never change `questions.ts closeStep`; never add to `afterEngagementInput`; never push, tag, release or bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delivered | `in-progress`, last linked run `complete`, every deliverable's stories `spec_status: done` + PR `MERGED` | closeout.md + page; `run-ended {outcome: delivered}`; issue Done; one notifier line; `engagement-closeout` event | — |
| Partial | last run `complete`/`partial`/`cancelled`, a deliverable not done | `run-ended {outcome: partial}`; report names why | — |
| Failed | last run queue state `blocked` | `run-ended {outcome: failed}` | — |
| Not last run | newest linked run live, or resubmit owed (`after_run`, steady stop awaiting merge), ask pause or cap block owed | no closeout | — |
| Already closed | `engagement-closeout` event names that `run_id` | no-op | — |
| Repeat after `go {cap}` from `partial` | new last run ends | new closeout replaces file + page; `partial → <outcome>` row | — |
| Unqueued epic | an epic's `run-epic-N` never queued | its deliverables "not done — epic not run" | — |
| No signal | deliverable lacks any acceptance signal | "not done — no acceptance signal" | never a crash |
| No Confluence binding | project unbound | file written, `page: null` + note | not a refusal |
| Lib refusals | missing scope / unreadable record / bad input | `NoScope` / `EngagementRecordUnreadable` / `CloseoutInputInvalid` | transient failure `retry: true`; pass never throws |
| revise mid-run | `in-progress`/`partial` → `scoping` with a live linked run | graceful stop reason `revise` (queued run cancelled), once per engine, no resubmit | — |
| question | any open state | self-loop logged `{verb: question, payload {text}, source}`, no pass | — |
| go | `awaiting-answers` → assume-defaults; `partial` → raise-cap | per table | — |
| follows ok | `{project, request, follows: "ENG-001"}`, ENG-001 `delivered` in same project | new record `intake` with `follows: "ENG-001"` | — |
| follows bad | malformed / unknown / not delivered | 400 SchemaError / 404 `UnknownEngagement {engagement}` / 409 `FollowsNotDelivered {engagement, state}` | previous record untouched |

</intent-contract>

## Code Map

The plan's Code Map (`plans/32-8.md` § Code Map) is the investigation; anchors verified 2026-10-26. Key points:

- `apps/supervisor/src/engagement.ts` -- `TRANSITIONS` :200 (read-only), `applyEvent` :321, `checkCreateBody` :92, `newEngagement` :76, `ENGAGEMENT_ID_RE` :49, `Engagement.closeout` :68. Change only `follows`.
- `apps/supervisor/src/approve.ts` -- `writeFresh` :193, `applyRow` :205, `linksOf` :909 (omit `since` for every cycle), `stopRun` :920, `cancelQueued` :935, `landedStory` :952, `trackBlock` :962 (uvRunner/studioScript pattern), `defaultNotify` :1000, `runStep` :1026 (step 4 :1102-1114 stop/cancel for `partial`/`cancelled`; step 7 :1132-1155 resubmit hand-off), `engagementRunPass` :1157, `engagementRunSpendPass` :1180 (`spend.runs_usd`); header :46-68.
- `apps/supervisor/src/board.ts:194` -- `jobRunCosts` (`studio_run_id → {cost}`). `hygiene.ts:150` `EndNotice`. `closeout.ts:394` `jiraBound(root)`. `queue.ts:63` terminal states `complete|partial|blocked|cancelled`.
- `apps/supervisor/src/cli.ts` -- `approveDeps` :805, `approveQuietly` :818 (add the closeout pass after `engagementRunPass`); skipped under `bun test` unless deps injected.
- `apps/supervisor/src/api.ts` -- `postEngagement` (~:497-517), `locateEngagement`/`servedRootOf`; input route (~:539-578) unchanged.
- `plugins/tk-studio/lib/engage.py` -- `SIGNAL_RE` :690, `parse_scope` :738, `_with_scope_lock` :867, `_merge_record` :918, `_publish_scope` :948-1028 (folder find-or-create, footer-hash AND version skip, `mdstorage.convert`, `page_footer`), `main` subparsers; `quote` reads meter records from `ledger.store_root()/"measurements"` via `quote.py history` deduped by `story_key`.
- `plugins/tk-studio/lib/track.py` -- `close --engagement` (`close_engagement` :822): Block Resolved → Done from any blocked kind; move in place `skipped`; `NoIssue` refusal.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 0.1.27 entry (32.7 clause last), Story/rulings row, §2 `tk-studio-engage` row, state table :238 (unchanged).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 32.7 pin :1389-1424; insert 32.8 pin before :1425.
- Tests: `apps/supervisor/test/{approve,engagement,api}.test.ts`; `plugins/tk-studio/lib/tests/test_engage.py` (fake Confluence transport as scope tests).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/engage.py` -- add `closeout` verb (`--directory`, `--engagement`, `--input-file`, `--dry-run`): parse deliverables, judge verdicts, render closeout.md, atomic write, publish `ENG-NNN: Closeout`, merge `closeout` -- Settled shapes 2, 3, 5.
- `plugins/tk-studio/lib/tests/test_engage.py` -- rendering, verdict ordering, signal fallback, no-signal, unbound Confluence, publish skip, refusals, record merge.
- `apps/supervisor/src/approve.ts` -- step 4 also stops/cancels live linked runs (all cycles) when state is `scoping` with reason `revise`, once per engine, no resubmit; export reused helpers; update header.
- `apps/supervisor/src/delivery.ts` (new) -- the closeout pass: last-run detection, composition, uv call (timeout 300), `applyEvent(run-ended)`, `track.py close --engagement`, one notifier line `engagement ENG-NNN <outcome>: <page url | closeout.md path>`, `engagement-closeout` event; never throws; serialised per served root.
- `apps/supervisor/src/cli.ts` -- run the closeout pass after `engagementRunPass` in `approveQuietly` with production deps.
- `apps/supervisor/src/engagement.ts` + `apps/supervisor/src/api.ts` -- `follows` (Settled shape 7).
- `apps/supervisor/test/delivery.test.ts` (new), `approve.test.ts`, `engagement.test.ts`, `api.test.ts` -- composition and pass with fakes; revise stop; `go` past cap and past questions; `question` self-loop; `follows` bodies and refusals.
- `apps/supervisor/README.md` -- document the closeout pass, revise stop, follows.
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` -- `closeout` (supervisor-run, never the planner); reply step answers the newest unanswered owner `question` line.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- Settled shape 9.
- `kb/engagement-loop.md` (new) -- the loop as built, F2 step by step: passes, files, events, refusals, the attended first-engagement checklist, EP-33 notes.

**Acceptance Criteria:**
- Given an `in-progress` engagement whose last linked run ended, when `approveQuietly`'s closeout pass runs with fakes, then closeout.md is written with every AC1 section, the page published, `closeout` set, the state moved per Settled shape 4, the issue closed and exactly one notifier line sent (delivery.test.ts + test_engage.py).
- Given `question`, `revise`, `go` on a live engagement, when applied, then the 32.1 table result holds and `revise` mid-run gracefully stops the run (approve.test.ts/engagement.test.ts).
- Given a `delivered` ENG-NNN, when `POST /engagements {project, request, follows}` arrives, then a new `intake` record with `follows` is created; bad follows refuse as named (api.test.ts).
- Given the contract, when grepped, then `0.1.27 (Story 32.8)` hits, `**0.1.28**` count is 0, §2 names all five verbs, and the 32.8 pin passes.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 1, medium 3, low 1)
- defer: 2 (medium 2)
- reject: 1 (low 1)
- addressed_findings:
  - `[high]` `[patch]` spec_status read from the removed worktree made `delivered` unreachable in production — specStatus now falls back to `git show origin/<run branch>:<spec>` then the local branch (read-only, no fetch), per consult 2; tests added
  - `[medium]` `[patch]` Quote against actual compared planning+runs with run-priced bands/cap — now compares runs_usd, adds a cap-hit line, prints planning and total separately
  - `[medium]` `[patch]` lastRunEnded blocked closeout on an ok steady/ask stop in `partial` — gated on `in-progress`; test added
  - `[medium]` `[patch]` contract §1 POST /engagements row self-contradicted (refused-until text, misplaced 400) and omitted 500 EngagementRecordInvalid; the 32.8 clause said "no table row changes" — row, clause, README and the 32.8 pin corrected
  - `[low]` `[patch]` unmetered run cost rendered $0.00 — non-positive cost maps to null (—)
- deferred (class a, both): named lib refusal never retried (stuck record); go {cap} after an unstopped-end partial closeout leaves in-progress with no run
- rejected: cancel/revise racing the closeout between the lib merge and applyRow — sub-second fresh-read window, the residual already accepted for the spend pass (32-5 DRIFT); applyEvent still refuses the terminal row

### 2026-10-26 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 2, low 4)
- defer: 0
- reject: 4 (medium 2, low 2)
- addressed_findings:
  - `[medium]` `[patch]` nested served project (run.prefix): specStatus searched the worktree top and the ref fallback ran `git show <ref>:<cwd-relative path>`, so `delivered` was unreachable — now `findSpec(servedRoot(run) ?? root)` and `git show <ref>:./<path>`; nested-root test added (consult 3: the Settled shape's own reading)
  - `[medium]` `[patch]` in-progress, an ok steady stop on a run with no PR held back the closeout forever (step 7 never resubmits without a PR), so a stopped run ending `blocked` never reached `failed` — the hold-back now ignores a steady stop with no PR; ask/cap stops still hold; tests added
  - `[low]` `[patch]` engage.py closeout: an OSError reading `--input-file` was the permanent `CloseoutInputInvalid` refusal, against the verb's own "OS refusal → partial, retry: true" — now partial/retry; bad JSON still refuses; test added
  - `[low]` `[patch]` kb/engagement-loop.md EP-33 note said an archived worktree reads `spec_status: null` — corrected to the pushed-branch fallback
  - `[low]` `[patch]` kb/engagement-loop.md `follows` refusals omitted `500 EngagementRecordInvalid` — added
  - `[low]` `[patch]` the contract-named `follows` 500 EngagementRecordInvalid had no test — api.test.ts case added (nothing minted)
- rejected: named lib refusal never retried (already deferred, DW-52); a run ending `complete` with open PRs closes out `partial` once (AC1 judges at the last run's end, by design); an earlier closeout's `run-ended → partial` listed among side exits (a real exit in the engagement's history); lib merge racing a revise/cancel (the sub-second fresh-read window already rejected in pass 1)

### 2026-10-26 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 0
- reject: 4 (medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` in-progress, an ok steady stop whose PR was CLOSED unmerged held the closeout back forever (step 7 resubmits only on MERGED), so AC1's closeout, run-ended, issue close and notice were never reached. closeoutStep now asks `gh pr view` for a steady-stopped last run's PR and closes out only on CLOSED; OPEN, MERGED and a gh failure still hold back. `lastRunEnded` takes a sync `prClosed` flag. This is Settled shape 1's own reading, the same as consult 3's no-PR ruling, so no new consult. Tests added. (Blind Hunter + Edge Case Hunter, deduplicated.)
  - `[low]` `[patch]` run-ended already applied with a transient issue close, then `go {cap}` / `revise` moved the record on: the next pass still closed the issue to Done and sent the closeout notice for a live engagement. The already-applied branch now returns unless the record is still in that outcome's state. Test added.
  - `[low]` `[patch]` one notifier line across processes: the closeout event was checked only at the pass start, before the up-to-300 s lib run and the issue close. It is now re-read right before the refusal notice and the success notice, per the approve module's cross-process rule. Test added.
  - `[low]` `[patch]` README and kb/engagement-loop.md still gave the pre-fix spec lookup `findSpec(run.worktree ?? root, key)` and "in-progress no ok stop at all". Corrected to `servedRoot(run)`, `git show <ref>:./<path>`, and the no-PR / CLOSED-PR rule, with the P2 and P3 behaviour.
  - `[low]` `[patch]` the api.ts `POST /engagements` route header omitted the `follows` 500 EngagementRecordInvalid that the code, the README and the contract return. Added.
- rejected:
  - storyPr crediting an earlier pause's PR: the documented pass-1 DRIFT falls back to the run's PR, which is the same PR.
  - the closeout closing an open cap block in `partial`: by design, per the plan's Code Map (DW-47's closeout half).
  - a named `track.py close` refusal counting as closed: the accepted pass-1 DRIFT, recorded as `engagement-issue refused`, the same class as DW-52.
  - the final run's own cost tripping the cap before the closeout: 32.6 step 2's table behaviour (in-progress at or past the cap → partial). `partial → delivered` is a legal row, so this change does not cause it.

## Design Notes

Settled shapes from `plans/32-8.md` (binding; full text there):

1. **Last run (CAP-15).** Record in `in-progress` or `partial`; candidate = newest linked run over every approve cycle (`linksOf` without `since`); must be terminal with no `after_run` resubmit naming it, no `ok` steady stop awaiting its PR merge, no ask pause or cap block owed. Once per last run: an `engagement-closeout` service event naming its `run_id` means done.
2. **Composition.** Supervisor writes JSON `{run_id, outcome_hint, runs: [{run_id, job, state, studio_run_id, cost_usd, pr}], stories: [{key, run_id, spec_status, pr, pr_state}], epics: [{job, queued}], side_exits: [{at, to, verb, reason}], spend {planning_usd, runs_usd}, quote}` and runs `engage.py closeout --directory <served root> --engagement <id> --input-file <path>` via `uvRunner` (timeout 300). `stories` = `landedStory` + `close-out` events per linked run; `spec_status` from `findSpec(run.worktree ?? root, key)` frontmatter; `pr_state` from `gh pr view --json state` (null on failure); `epics` = jobs declared by the approve pass (`engagement-approve` step `job` detail) vs queued; `side_exits` = `inputs[]` lines whose `to` ∈ {paused, partial, failed, cancelled} with `detail.reason`, payload `reason` or the verb. Chat run_ids are queue ids mapped via `studio_run_id`; per-story costs span all cycles.
3. **Verdict.** Deliverables = `scope.md` `## Deliverables` `### <title>` with signal. A deliverable's stories = proposed stories naming its title (case-insensitive), else all engagement stories. `done` iff each landed (`spec_status: done`) and PR `MERGED`; else `not done — <why>` in order: `no acceptance signal`, `epic not run`, `story <key> not landed`, `PR <url> not merged`.
4. **Outcome.** All done → `delivered`; else last run `blocked` → `failed`; else → `partial`. Applied via `applyEvent` with `detail {outcome, run_id, closeout: <path>}` in a fresh read.
5. **Report/page/record.** Sections `Outcome`, `Deliverables`, `Pull requests`, `Cost per story` (`story | run | tokens | usd`, `—` unmetered), `Spend`, `Quote against actual` (band50/85/95 usd, cap, actual, band hit), `Side exits`. Page `ENG-NNN: Closeout` in the `ENG-NNN` folder under `Engagements`, `mdstorage.convert` + `page_footer`, skip on footer-hash AND version match. Record `closeout {path, page {id, url, version} | null, outcome, done, not_done, run_id, at}`. Result `{status, engagement, outcome, page, written[]}`.
6. **revise mid-run (CAP-16).** Step 4 covers `scoping` with any live linked run of any cycle: `launchStopGraceful` reason `revise`, queued → `cancelQueued` reason `revise`, once per engine; no resubmit; no closeout/run-ended for `scoping`.
7. **follows.** Optional `follows` matching `ENGAGEMENT_ID_RE` else 400 SchemaError; same served project else 404 `UnknownEngagement {engagement}`; must be `delivered` else 409 `FollowsNotDelivered {engagement, state}`; new record carries `follows` only when given.
8. **question.** Self-loop logged, no pass; the engage reply step answers the newest owner `question` line newer than the planner's last chat line. No turn minted, no chat-line field.
9. **Contract.** As in Always.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green (only the 3 released-roster guards may be red, unverifiable-here).
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd apps/supervisor && bun test test/delivery.test.ts test/approve.test.ts test/engagement.test.ts test/api.test.ts && bun test` -- expected: 0 fail (`TK_STUDIO_ROOT` set, `TK_ATLASSIAN_*` unset).
- `cd apps/supervisor && bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean.
- `grep -n "0.1.27 (Story 32.8)" plugins/tk-studio/contracts/driver-contract.md` hits; `grep -c "\*\*0.1.28\*\*" plugins/tk-studio/contracts/driver-contract.md` is 0.
- `git status --porcelain` -- expected: only the Files above plus this spec.

## Deviation Summary

- Note: `/tmp` volume is nearly out of inodes (≈250–1077 free); a gate failure from temp-file creation is environmental.

### pass 1 (2026-10-26, implementer)

- planned: keep every 32.1–32.7 pinned string, append "Story 32.8" to the rulings row in 32.7's shape / actual: 32.7 pin's `"Story 32.6, Story 32.7 (Epic 32)"` shortened to `"Story 32.6, Story 32.7"`; 32.8 pin asserts the full new row / why: appending ", Story 32.8 (Epic 32)" necessarily breaks the old substring / may affect: none
- planned: lib refusals `NoScope`, `EngagementRecordUnreadable`, `CloseoutInputInvalid`; result `{status, engagement, outcome, page, written[]}` / actual: also refuses `NotInProgress` and `EngagementClosed`; result also carries `closeout`, `done`, `not_done` plus standard `mode`/`notes`/`dry_run` / why: enforce "never close out cancelled/scoping" in the lib too / may affect: none
- planned: no Confluence binding → `page: null` + note / actual: missing agent-seat env and a `PublishRefused` write treated the same way / why: keep the refusal set to the named ones; the report still lands / may affect: none
- planned: `engagement-closeout {engagement, project, run_id, outcome, page, ok, notify}` / actual: a lib refusal adds `reason` (`ok: false`), sends one `closeout-refused` notice and counts as done for that run; issue close emits `engagement-issue {action: closed, step: closeout}` or refused with `step: close` / why: refusals visible, reuse issue-event vocabulary / may affect: none
- planned: `epics` = jobs declared vs queued / actual: from the newest ok `job` step only; lib maps i-th proposed epic → i-th declared `run-epic-N`, story m → landed key prefix `N-m-`; a story's `pr` is its pause-event PR, else the run's PR / why: input shape carries no proposed→minted epic mapping / may affect: none
- planned: test the closeout pass through `approveQuietly` with fakes / actual: tests call `closeoutPass` directly; `cli.ts` wiring covered by `tsc` only / why: `approveQuietly` is private; `recover` needs a live studio / may affect: none
- Env: TMPDIR redirected to /home/agent/.claude/projects/tk-tmp-32-8 (removed); `js-yaml`/`argparse` copied into apps/supervisor/node_modules from /c/GitHub/tk-studio for `bun test` (removed); `tsc` run via a temp tsconfig pointing at the host checkout's node_modules.

DRIFT: 32.7 contract pin's rulings-row substring shortened to "Story 32.6, Story 32.7" — appending Story 32.8 breaks "(Epic 32)" after 32.7 — affects: none
DRIFT: engage.py closeout adds refusals NotInProgress, EngagementClosed and result fields closeout/done/not_done — enforce no closeout of cancelled/scoping in the lib — affects: none
DRIFT: missing Confluence seat env or PublishRefused degrade to page: null + note — keep the named refusal set; the report still lands — affects: none
DRIFT: engagement-closeout gains reason on refusal, a closeout-refused notice, and engagement-issue closed/refused events with step — refusals visible, existing vocabulary — affects: none
DRIFT: epic mapping by declaration order (i-th proposed epic → i-th run-epic-N, story m → N-m- key prefix) from the newest job step — the input carries no proposed→minted mapping — affects: none
DRIFT: closeout pass tested via closeoutPass directly, cli wiring by tsc only — approveQuietly is private — affects: none

Consult re-scored the pass-1 set at 2: the extra refusals, result fields and declaration-order epic mapping are published in the 0.1.27 (Story 32.8) clause and EP-33 relies on them.

### pass 2 (2026-10-26, review patches)

- planned: Quote against actual shows bands, cap, the actual total and its band / actual: compares `runs_usd` (line `- actual (runs_usd)`), adds `- cap hit: under the cap | at or over the cap`, prints planning_usd and total in the section too / why: bands and cap are priced on story runs and the cap meters runs_usd / may affect: none
- planned: delivery.test.ts proves delivered from a pushed-branch spec / actual: lib faked with a Settled-shape-3 verdict; real-lib null spec_status → not landed tested in test_engage.py / why: delivery tests fake uv throughout / may affect: none
- planned: specStatus reads `findSpec(run.worktree ?? root, key)` / actual: falls back to `git show origin/<run branch>:<spec>` then the local branch, path via `git ls-tree` (consult 2) / why: the worktree is removed at every non-paused close-out, so delivered was unreachable / may affect: none

DRIFT: Quote against actual compares runs_usd with bands and cap, adds a cap-hit line — bands and cap are priced on story runs, the cap meters runs_usd — affects: none
DRIFT: spec_status falls back to the run's pushed branch via git show/ls-tree (no fetch) — the worktree is removed before the closeout pass — affects: none
DRIFT: contract §1 POST /engagements row reworded and lists 500 EngagementRecordInvalid; the 32.8 clause reads "no new route, no version bump and no state-table row change" — the row contradicted the clause — affects: none

### pass 4 (2026-10-26, follow-up review patches)

- No story deviation: P1–P3 follow Settled shapes 1 and 5's own reading, and P4 is docs only.
- Env: `/tmp` was at 734–820 free inodes, so TMPDIR was redirected to `/home/agent/.claude/projects/tk-tmp-32-8-review/tmp`.
  - The `node_modules` symlink was refused on the virtiofs mount. The implementer ran bun and tsc through out-of-repo tsconfig overrides pointing at `/c/GitHub/tk-studio/apps/supervisor/node_modules`. Under those overrides one `command-line.test.ts` case was red on HEAD too: the child resolved an auto-installed `js-yaml`.
  - This session re-ran the full `bun test` with `js-yaml` and `argparse` copied into `apps/supervisor/node_modules` (gitignored, removed afterwards): 0 fail.

## Consult Log

- 2026-10-26T15:09Z — trigger: deviation-gt-0 — question: accept the six pass-1 deviations (incl. shortening the 32.7 pin to resolve the pin conflict) and is the stale §1 POST /engagements row in scope? — ruling: accept-deviation score 2 — do: keep all six deviations; leave the 32.7 pin at "Story 32.6, Story 32.7", the 32.8 pin asserts the full row / append an inline 0.1.27 (Story 32.8) `follows?` note to the §1 POST /engagements row (driver-contract.md:114); add the closeout-refused notice and engagement-issue {action, step} events to kb/engagement-loop.md and the README closeout paragraph / re-run lib suite, conformance and bun test; record score 2 — rule candidate: When a story appends to a contract row an earlier story pinned by substring, the planner writes "shorten the prior pin to its stem; the new pin asserts the full row" into Settled shapes, and lists every §1 row whose text says "until Story X" as a required edit for story X.
- 2026-10-26T15:17Z — trigger: high-severity-finding — question: spec_status is read from a removed worktree so `delivered` is unreachable in production; read from pushed-branch git objects, keep as limitation, or judge by PR MERGED alone? — ruling: accept-deviation score 1 — do: option (a): specStatus tries findSpec(run.worktree ?? root) then `git -C <root> show origin/<run branch>:<spec>` then local `<run branch>` (path via git ls-tree, findSpec naming), else null; never fetch/pull/checkout/reset the served root / add a delivery.test.ts case (worktree removed, spec done only on the pushed branch, PR MERGED → delivered; missing ref → not landed) / note in kb/engagement-loop.md that spec status is read from the pushed branch (DW-46) — rule candidate: Any supervisor pass that reads a story artifact after close-out reads it from the run's pushed branch ref (git show origin/<branch>:<path>, read-only, no fetch) whenever run.worktree may have been removed.
- 2026-10-26T15:30Z — trigger: deviation-gt-0 — question: accept the review-patch pass deviations (Quote against actual compares runs_usd with a cap-hit line; delivered case tested with the faked lib)? — ruling: accept-deviation score 1 — do: keep the renderer as patched; keep the faked-lib MERGED case, real-lib null spec_status covered in test_engage.py — rule candidate: When a report compares spend with a quote or cap, compare the meter the quote and cap were priced on (runs_usd), and show other spend on separate lines.
- 2026-10-26T15:45Z — trigger: deviation-gt-0 — question: follow-up pass patches — lastRunEnded ignores an ok steady stop when the run has no PR; specStatus reads findSpec(servedRoot(run) ?? root) and git show <ref>:./<path> — accept as score 1, not a deviation, or revert? — ruling: apply — do: keep both patches as written in delivery.ts with no DRIFT lines and deviation score 0 (each is the Settled shape's own reading, option b) / keep the two new delivery.test.ts cases (nested served root; steady stop with no PR → failed) — rule candidate: In Settled shapes, a run's project directory is written servedRoot(run), never run.worktree (the git top only), and every "hold back while awaiting X" condition names what happens when X can never occur.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review pass on the committed 32.8 implementation, from baseline `27db57dd7e392d353572c53c51cc71b25edebfe9`. Both layers ran (band L) and five patches were applied:
- In `in-progress`, a steady-stopped last run whose PR was closed unmerged now closes out instead of holding the engagement forever.
- A retried issue close no longer closes the issue or notifies once the record has moved on (`go {cap}`, `revise`).
- The closeout event is re-read right before each notice, so concurrent passes send one line.
- The docs (README, kb) and the api.ts header match the code.

**Files changed**
- `apps/supervisor/src/delivery.ts`:
  - `lastRunEnded` takes a `prClosed` flag.
  - A new helper `steadyPr` finds a steady-stopped run's PR; `closeoutStep` asks `gh` for its state and closes out only on CLOSED.
  - The already-applied branch is gated on the record still holding the outcome state.
  - The `told()` re-check runs before each notice.
  - The header and comments are updated.
- `apps/supervisor/test/delivery.test.ts`: a new describe block with 4 tests. They cover a CLOSED PR closing out; OPEN, MERGED and gh failing holding back (and a cap stop making no gh call); a record moved on after run-ended; and another process's closeout event recorded mid-pass, on both the success and refusal paths.
- `apps/supervisor/src/api.ts`: the `POST /engagements` header lists the `follows` 500 EngagementRecordInvalid.
- `apps/supervisor/README.md`: the closeout pass's last-run rule (no PR / CLOSED PR), the `servedRoot(run)` spec lookup, and the moved-on and re-read behaviour.
- `kb/engagement-loop.md`: the same corrections in "The last run", the composition and the Refusals.

**Review**
- Patches applied: 5 (medium 1, low 4).
- Deferred: 0.
- Rejected: 4. Two were accepted pass-1 DRIFTs, one was by design per the plan, and one was 32.6's cap row.
- Follow-up review recommended: true. Patched counts are high 0, medium 1, low 4, for a score of 3×1+1×4 = 7.

**Verification** (re-run by this session after the patches):
- `uv run python -m unittest discover tests`: 1993 tests OK (2 skipped).
- `runner.py run`: `ok: true`.
- `bun test`, the four story files: 264 pass, 0 fail. Whole suite: 1386 pass, 5 skip, 0 fail.
- `tsc --noEmit` (through the out-of-repo tsconfig pointing at the host checkout's node_modules): exit 0.
- `grep "0.1.27 (Story 32.8)"`: 2 hits; the `**0.1.28**` count is 0.
- `git status`: only the five files above plus this spec.

Environment notes:
- `/tmp` is nearly out of inodes (734 free), so TMPDIR was redirected.
- `js-yaml` and `argparse` were copied into the gitignored `apps/supervisor/node_modules` for the full bun run, then removed; a symlink is refused on this mount.
- bun is at `~/.bun/bin`.

**Residual risks**
- A closeout gated on a steady stop's PR now makes one `gh pr view` call per pass while that PR stays OPEN, the same cadence as step 7.
- DW-52 and DW-53 remain open.
- Live Atlassian, `gh` and notifier calls are fakes in every test. They are unverifiable here until the attended first engagement.

## Reconcile

### 2026-10-26 — no-impact

- Score: 2
- Reasoning: 32.8 is the last entry in Epic 32's `stories.yaml` and epics.md plans no later epic, so no later story was planned against anything it changed. Every DRIFT is additive inside the story's own 0.1.27 (Story 32.8) clause (extra lib refusals and result fields, the closeout events, declaration-order epic mapping, the §1 POST /engagements row reworded with its 500), accepted by consults 1–4. `TRANSITIONS` and the §7.1 state table are untouched, there is no `**0.1.28**` and no new route. The shortened 32.7 pin is a test-stem change the 32.8 pin supersedes. EP-33's reliance on the published surface is documented in `kb/engagement-loop.md` ("Notes for EP-33").
- Affected: none
- Invariant: none
- Gate: Part A no-impact; Part B epic complete: no next story (32-8 accepted; replan queue had no open entry for an unstarted Epic 32 story)
