---
title: The engagement loop as built — from a request to the closeout (Epic 32)
description: Story 32.8's record. User flow F2 step by step as Epic 32 built it — the routes, the supervisor's passes, the engage verbs, the files and events each step leaves, the named refusals — plus the checklist for the attended first engagement and the notes EP-33 starts from.
rank: 63
---

# The engagement loop as built (Epic 32)

An engagement is one request from the owner, carried from a sentence to
delivered pull requests with a price agreed up front (user flow F2, B5). Only
typed inputs and supervisor-observed events move its state; the planner
(`tk-studio-engage`, a `claude -p` session) writes text and proposals but never
moves anything. This page describes what exists after Story 32.8.

## The record and the table

- The record is `_bmad-output/engagements/ENG-NNN/engagement.yaml` in the
  served project root (JSON text, untracked). Fields: `id, project, state,
  request, questions[], assumptions[], scope_page, quote, autonomy,
  approved_at, closeout, created, updated, spend {planning_usd, runs_usd},
  inputs[]`, and `follows` when the engagement changes a delivered one.
- `apps/supervisor/src/engagement.ts` `TRANSITIONS` is the one state table
  (contract §7.1, "The engagement state table"). `applyInput` applies the
  owner's verbs (`answer`, `go`, `revise`, `question`, `approve`, `cancel`);
  `applyEvent` applies the supervisor's event rows (`questions`, `launched`,
  `run-paused`, `run-resumed`, `cap`, `run-ended`). Every applied row appends
  one `inputs[]` line and one `engagement` service event.
- Writers never share a lock on the record: each one re-reads it and merges
  only its own fields (`writeFresh`/`applyRow` in the supervisor,
  `_merge_record` in `engage.py`).

## F2, step by step

| F2 step | What moves it | Pass or verb | Files | Events |
| --- | --- | --- | --- | --- |
| 1. The request | `POST /engagements {project, request, follows?}` | `api.ts` `postEngagement` | the record in `intake`, the plan counter's `next.engagement` | `engagement` |
| 1. The chat | `POST /chat/{id}` | one `engagement-chat` run, `engage.py reply` | `chat.jsonl` | `chat-queued` |
| 2. Questions | the planner's `engage.py questions` | the questions pass (`questions.ts`): `questions` row, the Jira block, answers read back, the issue closed | `questions.json` | `engagement-issue`, `engagement-answers` |
| 3. The scope | the planner's `engage.py scope`, or a `revise` body (the scope pass) | `scope.ts` | `scope.md`, the page `ENG-NNN: Scope of Work` | `engagement-scope` |
| 4. The quote | the planner's `engage.py quote`; the owner's `go` (`scoping → quoted`) | `engage.py quote` | the record's `quote`, `budget-bands.yaml` | — |
| 5. Approval | the owner's `approve {autonomy, base_ref?}` | the approve pass (`approve.ts`): append, sync, job, commit, PR, queued on merge | `epics.md`, plan entities, `run-epic-N.json` on `engagement/ENG-NNN` | `engagement-approve`, `engagement-run-queued` |
| 6. The run | the queue | the engagement-run pass: `launched`, autonomy stops, the cap, resubmits; the run-spend pass | the record's `spend.runs_usd` | `engagement-run-stop`, `engagement-cap`, `engagement-continue` |
| 7–9. Delivery | the last run ending | the closeout pass (`delivery.ts`), `engage.py closeout` | `closeout.md`, the page `ENG-NNN: Closeout`, the record's `closeout` | `engagement-closeout`, `engagement-issue {action: closed}` |

Every supervisor pass runs at the `finally` sites (`recover` every tick,
`drain`, `run`) and never throws; under `bun test` none runs unless its deps
are injected. The input route runs the questions, scope, approve and run
passes for one engagement right after an applied `answer`, `go`, `revise` or
`approve`; a run end is seen only at `finally`.

## Mid-run inputs

- **`question`** — a self-loop in every open state, logged `{verb: question,
  payload {text}, source}`. No pass runs and no turn is minted. The planner's
  next `reply` answers the newest owner `question` line newer than its own
  last chat line.
- **`revise`** — back to `scoping` with the quote voided (from `quoted`,
  `approved`, `in-progress`, `paused`, `partial`). With a linked run live, the
  run pass's step 4 stops each engine gracefully with reason `revise` (a
  still-queued run is cancelled), once per engine. The engine finishes its
  current story. Nothing is resubmitted; a re-approval starts a new cycle. No
  closeout runs for a `scoping` record.
- **`go`** — from `awaiting-answers` it assumes each open question's default
  (`assume-defaults`); from `partial` it raises the cap (`go {cap}`,
  `raise-cap`) and the run pass resubmits the stopped run.

## Delivery: the closeout pass

1. **The last run.** A record in `in-progress` or `partial`. Its newest linked
   run over every approve cycle must be terminal (`complete`, `partial`,
   `blocked`, `cancelled`). No `after_run` resubmit may name it. In
   `in-progress` it must have no ok stop (a `steady` or `ask` stop owes the
   resubmit or the pause, any other stop the resubmit). A `steady` stop on a
   run with no PR, or with a PR `gh pr view --json state` names `CLOSED`
   (closed unmerged: the run pass resubmits only once the PR is `MERGED`),
   awaits no merge and holds nothing back; `OPEN`, `MERGED` or gh failing
   still holds it back. The run pass resubmits and pauses only in
   `in-progress`, so in `partial` a stop does not hold the closeout back. In
   `partial` no `cap` block may be owed. An `engagement-closeout` event naming
   that `run_id` means it is done; the pass re-reads the events right before
   each notice, so a second process's pass never tells twice.
2. **The composition.** The supervisor writes `{run_id, outcome_hint, runs,
   stories, epics, side_exits, spend, quote}` to a temp file:
   - the runs' costs come from the ledger's `job-run` lines by `studio_run_id`
     (a missing or non-positive cost is `null`, rendered `—`);
   - the stories come from `landedStory` and every `close-out` event, each
     with its spec `status` and its PR state (`gh pr view --json state`). The
     spec is read with `findSpec(servedRoot(run) ?? root, key)` (a nested
     served root, Story 28.5: `<worktree>/<prefix>`), else from the pushed run
     branch in git objects (`git show
     origin/supervisor/run-<id>:./<spec>`, then the local branch; the path found
     by `git ls-tree` with `findSpec`'s naming), because the run's worktree is
     archived (removed) at close-out before this pass runs (DW-46). The read
     is read-only: the served root is still never fetched, pulled, checked
     out or reset;
   - the epics are the approve pass's declared jobs against the queued ones;
   - the side exits are the `inputs[]` lines into `paused`, `partial`,
     `failed` or `cancelled`.
3. **The report.** `engage.py closeout` judges each `### <title>` of the
   scope's `## Deliverables`. A deliverable's stories are the proposed stories
   naming its title, else every proposed story. The i-th proposed epic is the
   i-th declared `run-epic-N`, and its story `m` is the landed key `N-m-…`.
   `done` means each story landed (`spec_status: done`) and its PR is
   `MERGED`. Otherwise the first reason applies: `no acceptance signal`,
   `epic not run`, `story <key> not landed`, `PR <url> not merged`. It writes
   `closeout.md` with the sections Outcome, Deliverables, Pull requests, Cost
   per story, Spend, Quote against actual and Side exits. Quote against
   actual compares `runs_usd` alone with the bands and the cap (both priced
   from story runs, and the supervisor's cap meters `runs_usd`); planning
   and the total are printed beside it. It publishes
   `ENG-NNN: Closeout` beside the scope page (`page: null` when the project
   has no Confluence binding) and merges `closeout` into the record.
4. **The state.** `run-ended {outcome, run_id, closeout}`. The outcome is
   `delivered` when every deliverable is done, `failed` for a `blocked` last
   run, else `partial`. `partial → partial` is a row, so a later `go {cap}`
   and a new last run give a new closeout that replaces the file and the
   page.
5. **The issue and the notice.** `track.py close --engagement` moves the
   issue to `Done`, closing an open cap or ask block with it (Jira-bound
   projects only). The pass emits `engagement-issue {engagement, project,
   issue, action: "closed", step: "closeout"}`; a track refusal by name emits
   `engagement-issue {engagement, project, action: "refused", step: "close",
   reason}` and counts as closed. Then one notifier line goes out:
   `engagement ENG-NNN <outcome>: <page url | closeout.md path>`, and
   `engagement-closeout {engagement, project, run_id, outcome, page, ok,
   notify}` is recorded.

### Refusals

- **`engage.py closeout`:** `NoScope`, `EngagementRecordUnreadable`,
  `CloseoutInputInvalid`, `NotInProgress`, `EngagementClosed`, plus the shared
  `BadEngagement` and `UnknownEngagement`. A 429, a 5xx or an OS refusal is
  `partial` with `retry: true`.
- **The pass:** a lib refusal by name sends one `closeout-refused` notice
  (state `closeout-refused`, reason `engagement ENG-NNN closeout refused:
  <reason>`) and records `engagement-closeout` with `outcome: null`,
  `page: null`, `ok: false` and `reason`, the state unmoved. That event names
  the `run_id`, so the refusal counts as done for that run and is not
  retried. A transient failure (`retry: true`, no status block, the process
  failing) records nothing and is retried at the next pass. A transient
  issue close retries only the close and the notice, and only while the
  record still sits in the outcome's state: once it has moved on (a `go
  {cap}` from `partial`, a `revise`), the engagement is live again and
  nothing is closed, told or recorded.
- **`POST /engagements {…, follows}`:** a malformed id is `400 SchemaError`.
  An unknown id in the same served project is `404 UnknownEngagement
  {engagement}`. A followed record that is not JSON or not a record is `500
  EngagementRecordInvalid {project, engagement, detail}`. A record not yet
  `delivered` is `409 FollowsNotDelivered {engagement, state}`. Nothing is
  minted on any of them.

## Change requests

After `delivered` a change is a new engagement: `POST /engagements {project,
request, follows: "ENG-NNN"}`. It starts in `intake` with its own questions,
scope and quote; the delivered record is never touched.

## The attended first engagement: checklist

1. Create the engagement from the web, then answer or `go` past the
   questions. Check that the Jira issue opens and closes.
2. Read the scope page. Edit it once in Confluence and confirm that the
   sync-back replaces `scope.md` and voids the quote.
3. Quote it. Check the band against the history, then `go`.
4. Approve with `steady` and check that the plan PR opens. Merge it, then
   confirm the first run is queued and `launched` moves the record to
   `in-progress`.
5. Watch one story land, the graceful stop, the merge and the resubmit. Send a
   `question` mid-run and check that the next reply answers it.
6. Optionally, reach the cap on purpose to check the cap block and the notice,
   then send `go {cap}`.
7. When the last run ends, check `closeout.md` and its page. Read each
   deliverable's verdict against its acceptance signal **by hand**: the
   mechanical verdict only says the stories landed and their PRs merged. Check
   the cost table against the meter, the issue at `Done` and the one notifier
   line.
8. Record what diverged in this page and in the deferred-work ledger.

Every Atlassian, `gh` and notifier call in the tests is a fake. The live
behaviour is `unverifiable-here` until this checklist runs.

## Notes for EP-33

- **Only the first epic is queued (32.6).** In a multi-epic scope, the later
  epics' deliverables read "not done — epic not run" until EP-33 queues them.
- **The served root is not pulled after a merge (DW-46).** A landed spec is
  read in the run's kept worktree. For an archived worktree the spec is read
  from `origin/supervisor/run-<id>`, then the local run branch. Only when
  neither ref holds it does it read as `spec_status: null`, which shows as
  "not landed".
- **No report for a `cancelled` engagement.** `cancel` is terminal; a report
  for it is EP-33's call.
- **The signal is checked mechanically only.** Judging an acceptance signal's
  text against the code needs the human read above (or a later reviewer
  leg).
- **A refused closeout is not retried.** After the event with `ok: false`,
  rerun `engage.py closeout` by hand once the cause is fixed.
