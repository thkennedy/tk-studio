---
title: 'Validation of a Resolution'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'b9be0cecc794aa6843e2ca72feb6df5ddf8132f4'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-7.md'
  - '{project-root}/_bmad-output/specs/spec-epic-31/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** When the owner's reply or Done moves an issue to `Block Resolved` (31.6), nothing checks that the reply resolves the block. The paused story never resumes, and a bad answer fails silently instead of coming back to the inbox (§6.9 items 4 and 5).

**Approach:** Add a `tk-studio-track validate` verb (check, pass, fail, the ruling write, `validation.jsonl`), a changelog read in `jirabackend`, `inbox.mark_validating`, and a shipped `validate-resolution` job. Add a supervisor resolution pass that queues the job from `resolved` inbox items and resumes the paused run on a pass. All of it follows `plans/31-7.md` Settled shapes 1–7, which are binding.

### Acceptance Criteria (verbatim, epics.md Story 31.7)

- AC1: **Given** an issue in `Block Resolved` **When** the sync-back sees it **Then** the supervisor queues a `validate-resolution` job for the project (host tier, the planner leg's model): the session reads the reason and the reply, and either tests the thing it had to be able to do (a command, a path, a sign-in) or judges whether the answer is enough; a pass moves the issue back to `To Do` or `In Progress` (the loop re-arms the story: the supervisor's paused run resumes with the ruling written into the spec, or the job's next tick re-runs it), a fail moves it to `Blocked - Awaiting User` with a follow-up comment that lands in the inbox again
- AC2: **Given** the engagement's questions and approvals and the loop's `escalate` rulings **When** they arise **Then** each is an issue with comments in the same project, so the owner has one inbox for everything; the supervisor's `awaiting-ruling` writes the block instead of a Telegram note alone, and a reply that carries a ruling is written into the spec by the validation session; the lib suite and `bun test` cover the queueing, the two outcomes and the ruling write with fakes

## Boundaries & Constraints

**Always:**
- The carried notes in the invocation (31-1, 31-2, 31-4, 31-5, 31-6) are binding:
  - Accept `Block Resolved` only when the changelog's most recent transition into it carries the recorded `owner_account_id`. An older owner transition never validates a later one, and an absent or empty accountId never matches. With no owner id recorded, refuse by name.
  - Detect statuses and transition by name, never by category. When no transition reaches the target, refuse by name.
  - Queue once per (issue, transition). A failed tick (`rate-limited`, `error`, or an incomplete read) queues nothing; that is why the pass reads `inbox.json` `resolved` items.
  - Re-arm a passed story from its `track-block` event, not from `awaiting-ruling`.
  - On a fail, re-block through the `track.py block` internals with the follow-up as the reason, which posts a new agent comment and opens a new cycle.
  - On a transient Jira failure, end `partial` + `ok: false` + `retry: true` and record nothing.
  - The owner reply is the set of `comments.jsonl` lines whose `author` and `update_author` are both `owner`, created after the newest agent comment. `Done.` is a valid answer.
- The validation session acts on the agent seat only (`client_for`). It never uses `owner_client`/`owner_gaps`, never calls `track.py reply`, and never reads the `TK_STUDIO_ATLASSIAN_OWNER_*` variables.
- House rules apply: stdlib-only Python via `uv run`; atomic writes; every headless surface ends on the §3 JSON status block; no credential in any file or event; the plugin imports no driver or supervisor.
- `driver-contract.md` and `conformance/manifest.json` are updated in this story (AD-19).

**Block If:**
- The session would need the owner seat, or any Jira write outside `jirabackend` (AD-4).
- Validation must run while the paused run's checkout lock is held, and the narrow `claim` exemption (Settled shape 5) is not enough.
- `bmad-loop resolve --no-interactive --resume` refuses unless a `resolution.json` marker exists.
- The Files list must grow beyond the plan's list, or a new skill folder (a released-roster entry) becomes necessary.

**Never:**
- No new skill folder and no released-roster or version bump.
- No engagement call site: EP-32 owns the engagement loop. Record it as a DRIFT line instead.
- No change to `syncback.py` or `jobrun.py`, and no behaviour change to the existing `closeout.ts` functions (exports only).
- Never change the paused spec's `status:`.
- Never push, tag, release, or write under `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| check, owner resolved | live `Block Resolved`; newest changelog transition into it has accountId == owner id | `complete`; `owner_resolved: true`; transition, reason and replies are filled; inbox item marked `validating` | — |
| check, agent or older owner transition | newest transition into `Block Resolved` is by the agent, or by an empty or absent accountId (an older one was the owner's) | `complete`; `owner_resolved: false` | session goes on to `--fail` |
| any verb, refusal | no binding / absent agent var / no owner id / live status ≠ `Block Resolved` / bad key | `blocked`, exit 2, named reason; the agent-var refusal carries "no Atlassian call made" | no Jira call before the env refusal |
| pass | `--to "In Progress"` with a reachable transition | issue transitioned by name; `validation.jsonl` gets `outcome: pass` | no transition reaches the target → `blocked`, named |
| pass with ruling | `--ruling-file` + `--spec` | `**Ruling (owner, KEY comment ID, DATE):** …` inserted before `</intent-contract>` (else `</frozen-after-approval>`); `status:` unchanged | absent spec or block → `blocked`, named |
| fail | `--follow-up-file` | `Blocked:` agent comment + transition to `Blocked - Awaiting User`; `outcome: fail` line with `follow_up_comment_id` | — |
| transient | 429/5xx/network during any verb | `partial`, `ok: false`, `retry: true`; no `validation.jsonl` line | caller retries |
| pass: queue | bound project, `inbox.json` item `state: resolved` | one `validate-resolution` run (host, planner model/effort) plus a `validate-queued` event per key; the same key is never queued again | unbound project or missing inbox → skipped |
| pass: re-arm | run ended; newest `validation.jsonl` line is `pass`; `paused_run` still `paused` | `resumePaused` called, `validate-resumed` recorded | refusal recorded, never thrown; `fail` resumes nothing |
| lock | claimant `job_id: validate-resolution`; holder paused | claims without waiting | still waits on a queued or running holder |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-31/plans/31-7.md`, "Code Map" and "Settled shape" 1–7) is the investigation. It is binding and its anchors were re-checked on 2026-10-25. Key anchors:

- `plugins/tk-studio/lib/jirabackend.py`:
  - status names: `RESOLVED_STATUS` L1011, `BLOCKED_STATUS` L1010
  - `_current_status` L653, `issue_comments` L1088 (the paging pattern), `transition_to_name` L1118, `add_comment` L1144, `client_for` L945
  - Add `issue_changelog` and `last_transition_into` beside `issue_comments`. Pin the REST shape in `FakeJira`: `GET /issue/{key}/changelog` → `{values:[{id, created, author:{accountId}, items:[{field:"status", toString}]}], startAt, maxResults, isLast}`.
- `plugins/tk-studio/lib/track.py`:
  - `_block_issue` L169-214, `block` L217-322, `reply` L353-451 (the refusal and result pattern), `main` L456-504
  - helpers `transient` L99, `newest_agent_body` L118, `resolve_story` L136
- `plugins/tk-studio/lib/inbox.py`: `reason_comment` L76, `_item` L115 (keeps `validating`), `derive` L138 (the atomic-write pattern)
- `plugins/tk-studio/lib/syncback.py`: `log_comments` L242 (the `comments.jsonl` line shape). Read-only.
- `plugins/tk-studio/jobs/` (`atlassian-sync-back.json` is the template); `job.py` `validate_definition` L223, `load_types` L293.
- `apps/supervisor/src/`:
  - `cli.ts`: the post-run chains at L688-693, L780-787 and L1130-1138, plus `recoverQueue` L642. `validate` L1434 resolves a definition through `jobrun.py resolve`.
  - `queue.ts`: `enqueue` L1059 (an idempotent mint), `claim` paused-holder branch L1196-1203, `note` L2092, `serviceEvent` L1972.
  - `closeout.ts`: `findSpec` L118, `jiraBound` L394, `trackBlock` L457 (`track-block` with `issues[]`), `resumePaused` L603. Export `servedRoot` and add a `track-block` lookup helper.
  - `registry.ts` L104 reads `routing.current.json`. `office.ts` `readInbox`/`INBOX_REL` L318-325.
- Tests:
  - lib: `test_track.py` (`FakeTrack` L41, `ReplyTestCase` L508), `test_jirabackend.py` (`FakeJira` L43), `test_inbox.py` L116, `test_job.py` L208/L218, `test_driver_contract.py` L608-612 and L780-877
  - supervisor: `apps/supervisor/test/` (`fakes.ts`, `closeout.test.ts`, `queue.test.ts` L433)
- Contract: `driver-contract.md` header L5 (add the 31.7 clause to 0.1.26), the §2 `tk-studio-track` row L299, §4 jobs L379-385. `conformance/manifest.json` `surfaces["tk-studio-track"]` L411-430.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py` -- add `issue_changelog(client, key)` (paged, read-only) and the pure `last_transition_into(histories, name)` -- Settled shape 2
- `plugins/tk-studio/lib/inbox.py` -- add `mark_validating(root, key)`, an atomic rewrite of one item's state -- the 31.7 `validating` state
- `plugins/tk-studio/lib/track.py` -- add the `validate` subparser and verb: `--check`, `--pass` (`--to`, optional `--ruling-file`/`--spec`), `--fail --follow-up-file`, `--dry-run`. Include the shared refusals, the ruling write, the atomic `validation.jsonl` append and the transient handling, and update the docstring -- Settled shapes 1, 3, 6
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- add the `validate` verb and the session procedure for `payload.verb: validate` -- Settled shape 7
- `plugins/tk-studio/jobs/validate-resolution.json` -- new shipped job, exactly per Settled shape 7
- `plugins/tk-studio/contracts/driver-contract.md` and `contracts/conformance/manifest.json` -- the 31.7 clause, `validate` in §2, `validate-resolution` in §4, and the `validate` no-env drive (`blocked`, marker `no Atlassian call made`) -- AD-19
- `plugins/tk-studio/lib/tests/test_track.py`, `test_jirabackend.py`, `test_inbox.py`, `test_job.py`, `test_driver_contract.py` -- cover every I/O-matrix row on the lib side with fake REST
- `apps/supervisor/src/closeout.ts` -- exports only (`servedRoot` and a `track-block` lookup helper)
- `apps/supervisor/src/queue.ts` -- in `claim`, a `validate-resolution` claimant does not wait on a paused holder -- Settled shape 5
- `apps/supervisor/src/resolution.ts` (new) -- `resolutionPass(queue, deps)`: queue from `resolved` items once per key (`validate-queued`), with the payload and the planner run options; re-arm on `pass` via `resumePaused` (`validate-resumed`); refusals recorded, never thrown -- Settled shape 4
- `apps/supervisor/src/cli.ts` -- run `resolutionPass` right after `closeOutPaused` in the three chains, guarded like its neighbours
- `apps/supervisor/README.md` -- document the pass, its events and the lock exemption
- `apps/supervisor/test/resolution.test.ts` (new) and `test/queue.test.ts` -- test queueing once per key, nothing for unbound projects or a missing inbox, planner routing, re-arm on pass, nothing on fail, a recorded refusal, and the lock exemption (paused holder only)

**Acceptance Criteria:**
- Given an `inbox.json` with a `resolved` item in a bound project, when the supervisor's post-run chain runs twice, then exactly one `validate-resolution` run is queued (host tier, planner model and effort, payload with `verb: "validate"`), and one `validate-queued` event is recorded.
- Given a passed validation whose issue's paused run still holds the checkout, when the run ends, then the resolution pass resumes that run and records `validate-resumed`, and the ruling (when given) is inside the paused spec's intent-contract block.
- Given a failed validation, when it completes, then the issue is in `Blocked - Awaiting User` with a new `Blocked:` agent comment carrying the follow-up, and no resume happens.
- Given AC2's engagement clause, when the story closes, then no engagement call site exists and a DRIFT line records EP-32 as its owner; `awaitRuling` → `trackBlock` (31.5) is unchanged and its tests stay green.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 3, low 3)
- defer: 0
- reject: 1: (low 1)
- addressed_findings:
  - `[high]` `[patch]` `validate --pass` ignored `owner_resolved`; it now refuses by name before any write when the newest transition into `Block Resolved` is not the owner's (tests cover an agent, empty, absent and other account; `--fail` still runs in each case) — consult 2/3
  - `[medium]` `[patch]` a transient follow-up failure after the re-block transition left the `--fail` retry refused; a retry now resumes the block (comment + fail line, no second transition)
  - `[medium]` `[patch]` a validation run ending with no outcome left the item `validating` and its key recorded forever; the pass now records `validate-expired` and re-queues (items `resolved` or `validating`)
  - `[medium]` `[patch]` the job's `stop.on_status: ["blocked"]` would halt every later validation after one refusal; now `stop: {until: 9999-12-31T23:59:59Z}` — consult 2
  - `[low]` `[patch]` an adopted queued `validate-resolution` run in the `run`/`submit` path lost its enqueued payload; `withStoredPayload` now applies in both branches
  - `[low]` `[patch]` the ruling's closing-tag match now accepts only a whole-line `</intent-contract>` (else `</frozen-after-approval>`)
  - `[low]` `[patch]` a `--pass` refused for an unreachable target left the ruling written; reachability is checked before the write
- rejected: dependents blocked by 31.5 stay blocked after a pass — AC1 names "the issue" only; each dependent is its own inbox item and validates on its own

### 2026-10-25 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 1, medium 2, low 2)
- defer: 0
- reject: 7 (medium 2, low 5)
- addressed_findings:
  - `[high]` `[patch]` the `validate-expired` re-queue had no cap, so a deterministic no-line refusal minted a host-tier planner session every pass — `recordedKeys` caps it at `MAX_EXPIRIES = 3` per key (consult 2026-10-25T02:12:07Z); documented in the resolution.ts header, README and the driver-contract bullet; bun test for 3 re-queues, none on the 4th, a new `reason_comment.id` queues again
  - `[medium]` `[patch]` a `--pass` retry whose move into `--to` landed before a transient error was refused (no longer `Block Resolved`), so no `pass` line and no resume — resume guard mirroring the `--fail` one (live status `--to`, its newest move newer than the newest `Block Resolved` move, that one the owner's); tests for the resume and both refusals
  - `[medium]` `[patch]` `rearm` walked every historic `validate-queued`, so an older cycle's event could resume the paused run on a newer cycle's `pass` line while that run was live — rearm reads only each issue's newest `validate-queued`; bun test
  - `[low]` `[patch]` a `--pass --ruling` refused after the ruling write (no transition match, or a non-transient `JiraError`) left the ruling in the spec, against the docstring — the spec is restored atomically; the transient path keeps it as before; two tests
  - `[low]` `[patch]` the `RunNotPaused` re-arm refusal had no test — bun test added
- rejected: the resolution pass swallows errors with no event — the header pins never-throws/retry-next-pass; an error event per tick would be noise, and no AC or contract names one
- rejected: the paused-holder lock exemption is not tied to the payload's `paused_run` — narrowing it lets a dependent issue's validation (`paused_run: null`) minted first wait on the paused holder and take the one-live-run-per-checkout slot, so the story's own validation never queues (deadlock)
- rejected: dependents stay blocked after a pass — already rejected in pass 1: AC1 names "the issue" only
- rejected: `test_mark_validating…` does not re-run `derive` — the keep rule is pinned by the pre-existing `test_inbox.py` StateTests case
- rejected: no test for one live validation per checkout — the queue's idempotent mint is pre-existing and tested in `queue.test.ts`; plumbing
- rejected: the `runJob` payload-overlay wiring is untested end to end — ruled at consult 2026-10-25T02:05:45Z (accepted, residual risk)
- rejected: a key switch from `blocked_since` to `reason_comment.id` could queue a cycle twice — the block comment is posted by `block` before the owner can resolve, so the log carries it before the item is `resolved`; a stray second run is bounded by the new cap

### 2026-10-25 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L, both run; diff `b9be0ce..` excluding this spec, 2,570 lines, handed over as a file path)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (medium 1, low 2)
- defer: 0
- reject: 2 (medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `rearm` treated every `validate-resumed` refusal as final, so a transient `ResumeFailed` (the spawn or the vmHome/sbx lookup failed; `resumePaused` puts the run back to `paused`) left a passed story paused forever while Jira showed `In Progress` (both layers). `finalResumes` now retries `ResumeFailed` on later passes, up to `MAX_RESUME_ATTEMPTS = 3` per `run_id|issue`, counted from the recorded events. `ok: true` and every other code stay final. Header, README and the driver-contract bullet are updated. Bun tests cover retry then success, the cap of 3, and `StoryLanded` attempted once (consult 2026-10-25T02:36:26Z).
  - `[low]` `[patch]` `queueResolved` called `enqueue` even when a live `validate-resolution` run was on the checkout. `enqueue` then overwrote that queued run's `model`/`effort` with another item's planner leg before answering `minted: false`. A pre-check now `break`s first; `!minted` stays as a backstop. Bun test: two paused runs with different legs.
  - `[low]` `[patch]` the header, README, driver-contract and a test comment said "the owner's next reply or a re-block is a new key". The key comes from the newest agent `Blocked:` comment, so only a re-block is a new key. The wording is fixed in all four places.
- rejected: an exempt `validate-resolution` run is not taken over by `recover` on a supervisor restart (the paused run holds the lock). The restart resume is named by no AC. A takeover would overwrite the paused run's lock row, and the orphaned run is re-queued through `validate-expired` (cap 3).
- rejected: a `--fail` retry after a posted follow-up whose confirming GET failed is refused with no fail line. This was accepted in pass 2 (Deviation Summary, consult 2026-10-25T02:05:45Z). The follow-up comment is in Jira, so the owner's answer opens a new key.

## Design Notes

- The 31-4 carry says "queue from `applied[]`". The plan's ruling (Code Map, "Refinement of the 31-4 note") reads `inbox.json` `resolved` items instead, because `applied[]` never reaches the supervisor (`jobrun._summarize_result` drops it), while `inbox.derive` runs only on a complete, non-error tick. The behaviour is the same: queue on the transition into `Block Resolved` by name, and nothing from a failed tick. Recorded as a DRIFT line, score 1.
- The queue key `(project, issue, reason_comment.id ?? blocked_since)` identifies one block cycle. A fail posts a new block comment, so the next resolution gets a new key.
- `bun` is at `~/.bun/bin/bun`. Run vitest and tsc through `bun node_modules/...`, one file at a time, on a private `TMPDIR` with `TK_STUDIO_ROOT` set.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green, except the 3 released-roster guard tests, which are red by design until the release motion (unverifiable-here)
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, including the `validate` drive
- `env -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_TOKEN -u TK_ATLASSIAN_CLOUD_ID -u JIRA_API_TOKEN uv run plugins/tk-studio/lib/track.py validate --directory . --issue ST-1 --check` -- expected: `blocked`, exit 2, a named reason, "no Atlassian call made"
- `cd apps/supervisor && ~/.bun/bin/bun node_modules/vitest/vitest.mjs run test/resolution.test.ts` (then `test/queue.test.ts`, then `test/closeout.test.ts`) and `~/.bun/bin/bun node_modules/typescript/bin/tsc --noEmit` -- expected: green
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ apps/ _bmad-output/specs/spec-epic-31/` -- expected: only pattern text
- `git status --porcelain` -- expected: only the plan's Files

**Manual checks (if no CLI):**
- Unverifiable here: a live loop on a set-up site. Operator: pause a run on a bound project, reply from the Inbox, and watch the `validate-resolution` run. On a pass, the issue goes to `In Progress`, the ruling is in the spec and the run resumes. On a fail, the item is back in the Inbox with the follow-up.

## Deviation Summary

- Planned DRIFT (Design Notes): the queue source is `inbox.json` `resolved` items rather than `applied[]`, per the plan's ruling (score 1).
- Planned DRIFT: AC2's engagement questions and approvals get no call site (EP-32; `track.py block --source engagement` from 31.5 fixes the shape).

### pass 1 (2026-10-25, implementer)

- planned: `--check` result field `reason` / actual: `reason_comment` / why: `reason` collides with the §3 status block's `reason` key / may affect: none
- planned: cli.ts only runs `resolutionPass` in the three chains / actual: also `RunOptions.resolution` + `resolveQuietly` (skipped under bun test), and the enqueued `target.payload` is overlaid onto the drain-path definition and the `invoke-skill` directive (`withQueuedPayload` in `startRun`) / why: `jobrun.py submit` rebuilds the directive from its own resolve, so the payload would never reach the session / may affect: none
- planned: closeout.ts exports `servedRoot` and a track-block lookup / actual: only `trackBlockSincePause` added; `servedRoot` is already exported from queue.ts / why: no re-export needed / may affect: none
- planned: lock exemption "claims without waiting" / actual: the exempt claim also writes no lock row (`claimed` event carries `lock_exempt`) / why: overwriting the lock would strip the paused run's lock for its resume / may affect: none
- planned: job JSON exactly per Settled shape 7 / actual: adds the required `job_schema_version` and a `description` / why: schema requirement and parity with the other shipped jobs / may affect: none
- planned: refusals as listed in shape 1 / actual: extra named refusals for bad argument combinations and for a ruling with no owner reply to cite / why: the ruling line needs a comment id; bad arguments still end in JSON / may affect: none
- planned: result `{…, story, …}` / actual: `story` is `N.M` from the entity's `source`; added `mode`, `outcome` and `issues` (fail) / why: unspecified in shape 1; they make the outcome visible / may affect: none
- planned: no refactor / actual: `newest_agent_body` split into `newest_agent_comment` plus a wrapper (same behaviour); `--fail` makes one extra live GET for `follow_up_comment_id` / why: `_block_issue` does not return the comment id / may affect: none
- planned: `validate-queued` / `validate-resumed` events (scope unspecified) / actual: service events / why: the key check and the re-arm are not tied to one run / may affect: none
- planned: supervisor tests via vitest, `closeout.test.ts` as one file / actual: `bun test` (the suites use `bun:test`); `closeout.test.ts` in 8 `-t` chunks, all 52 pass / why: no vitest in the repo; the host's `/tmp` is out of inodes / may affect: none
- planned: a transient failure records nothing / actual: on `--pass` the ruling is written before the transition, so a transient transition failure leaves the ruling in the spec (no `validation.jsonl` line; the retry does not duplicate it) / why: shape 1 orders the ruling write first / may affect: none

DRIFT: `validate --check` reports the reason as `reason_comment` — `reason` collides with the §3 block key — affects: none
DRIFT: the supervisor overlays the enqueued `target.payload` onto the `invoke-skill` directive (`withQueuedPayload`) — `jobrun.py submit` rebuilds the directive from its own resolve — affects: none
DRIFT: closeout.ts adds only `trackBlockSincePause`; `servedRoot` comes from queue.ts — already exported there — affects: none
DRIFT: the `validate-resolution` paused-holder claim writes no lock row (`lock_exempt` on `claimed`) — keeps the paused run's lock for its resume — affects: none
DRIFT: `validate-resolution.json` carries `job_schema_version` and `description` — schema requirement — affects: none
DRIFT: extra named refusals for bad argument combinations and a ruling with no owner reply — every path must end in JSON; the ruling cites a comment id — affects: none
DRIFT: the validate result adds `mode`, `outcome` and `issues`, with `story` as `N.M` — unspecified fields made explicit — affects: none
DRIFT: `newest_agent_body` is split into `newest_agent_comment` plus a wrapper, and `--fail` makes one GET for the follow-up id — `_block_issue` returns no comment id — affects: none
DRIFT: `validate-queued`/`validate-resumed` are service events — not tied to one run — affects: none
DRIFT: supervisor tests run under `bun test`; `closeout.test.ts` in 8 `-t` chunks — no vitest in the repo; `/tmp` is out of inodes — affects: none
DRIFT: a transient transition failure on `--pass` leaves the already-written ruling in the spec (idempotent on retry) — shape 1 orders the ruling first — affects: none
DRIFT: the queue source is `inbox.json` `resolved` items, not `applied[]` — the planner's ruling; `applied[]` never reaches the supervisor — affects: none
DRIFT: AC2's engagement questions and approvals get no call site — the engagement loop is EP-32 — affects: EP-32

### pass 2 (2026-10-25, review patches)

- planned: consult 2 "every mode other than check refuses when owner_resolved is false" / actual: only `--pass` refuses; `--fail` runs / why: the spec's matrix sends `owner_resolved: false` to `--fail` / may affect: none
- planned: resume the `--fail` retry when the issue is Blocked and the newest agent comment is not the follow-up / actual: also requires the newest move into Blocked to be newer than the newest move into `Block Resolved` / why: otherwise `--fail` posts on a never-resolved blocked issue / may affect: none
- planned: none / actual: a posted follow-up whose confirming read failed is refused on retry with no fail line; `validate-expired` re-queues it / why: avoids a duplicate fail line / may affect: none
- planned: — / actual: `validate-queued` and `validate-expired` documented in the contract's `validate-resolution` bullet / why: the expiry event needed a home / may affect: none
- planned: a test for the adopt-path overlay / actual: `withStoredPayload` unit-tested; the `runJob` wiring untested / why: no fake seam reaches `runJob` / may affect: none
- planned: job stop per Settled shape 7 / actual: `{until: 9999-12-31T23:59:59Z}` / why: `evaluate_stop` halts the job project-wide after one blocked run / may affect: none

DRIFT: consult 2's "every mode other than check" is read as `--pass`, because spec row 63 sends `owner_resolved: false` to `--fail` — affects: none
DRIFT: `validate-resolution.json` stop is `{until: 9999-12-31T23:59:59Z}`, not `on_status: [blocked]` — one blocked run would stop every later validation for the project — affects: none
DRIFT: the `--fail` retry resumes a block whose newest Blocked move postdates the newest `Block Resolved` move — a transient comment failure otherwise strands the issue — affects: none
DRIFT: the resolution pass records `validate-expired` and re-queues a key whose run ended with no outcome — otherwise the item stays `validating` forever — affects: none
DRIFT: `validate-queued`/`validate-expired` added to the driver-contract `validate-resolution` bullet — documentation of supervisor service events — affects: none
DRIFT: the `validate-expired` re-queue is capped at 3 per key — a deterministic refusal writes no line and would otherwise mint a host-tier planner session every pass — affects: none

### pass 3 (2026-10-25, follow-up review patches)

- planned: a re-arm refusal is recorded, never thrown / actual: also recorded, but `ResumeFailed` is retried on later passes, up to 3 attempts per run and issue / why: a transient spawn or lookup failure otherwise leaves a passed story paused forever / may affect: none
- planned: one sentence beside the existing `validate-resumed` description in driver-contract.md / actual: no such description existed, so one sentence describes the re-arm event and the retry cap / why: nothing to sit beside / may affect: none

DRIFT: a `ResumeFailed` re-arm is retried on later passes, at most 3 attempts per run and issue: a transient spawn or lookup failure otherwise leaves a passed story paused forever — affects: none
DRIFT: driver-contract.md gains one sentence describing the re-arm's `validate-resumed` event and its 3-attempt `ResumeFailed` retry — no `validate-resumed` description existed — affects: none

## Consult Log

- 2026-10-25T01:51:18Z — trigger: deviation-gt-0 — question: accept the implementer's pass-1 deviations (payload overlay via withQueuedPayload, lock_exempt claim with no lock row, reason_comment field, ruling-before-transition) at self-score 2? — ruling: accept-deviation score 1 — do: Record pass 1 as DEVIATION SCORE 1 and continue to review/close-out unchanged. Leave the DRIFT lines as written; no code or contract edit is required. — rule candidate: A deviation scores 1 when it touches only supervisor internals or names a field to match a key that already exists, and driver-contract.md already documents the built shape in the same pass; a consult is needed only when the contract text and the code disagree.
- 2026-10-25T01:55:59Z — trigger: high-severity-finding — question: treat F2 (--pass ignores owner_resolved) and F4 (job stop.on_status [blocked] halts all later validations) as patch rather than a bad_spec loopback; accept F4's deviation from Settled shape 7? — ruling: accept-deviation score 1 — do: Treat F2 and F4 as patch; re-engage the implementer to fix both in place; no bad_spec loopback. F2: in validate, right after owner_resolved is computed, every mode other than check refuses by name (blocked, exit 2) when owner_resolved is false, before the ruling write, the transition and the outcome line; add tests for an agent transition, an empty or absent accountId, and an older owner transition under a newer non-owner one. F4: set the job's stop to a schema-valid condition that never fires (prefer {"until": "9999-12-31T23:59:59Z"}); record a DRIFT line against plan Settled shape 7 (score 1); leave job.schema.json and the other jobs alone. — rule candidate: A job enqueued once per event whose spec treats blocked as a routine refusal must not carry stop.on_status ["blocked"]; a review finding on it is a patch, not bad_spec.
- 2026-10-25T02:05:45Z — trigger: deviation-gt-0 — question: accept the pass-2 patch deviations (--pass-only owner refusal against consult 2's literal wording, the Blocked-after-Resolved resume guard, refuse-then-expire recovery, contract event docs, the untested runJob wiring)? — ruling: accept-deviation score 1 — do: Keep --fail allowed whatever owner_resolved says, and keep the --pass-only refusal as built. Record pass 2 at DEVIATION SCORE 1 with the DRIFT line on consult 2's wording. Accept (b)-(e) unchanged. Make the F2 tests show that --pass refuses and --fail succeeds for each non-owner case (done: four fail tests added). — rule candidate: When a consult's DO line is broader than the finding it rules on, read it at the finding's scope; the frozen spec's I/O matrix wins over the paraphrase.
- 2026-10-25T02:12:07Z — trigger: high-severity-finding — question: follow-up review finding — the `validate-expired` re-queue in `recordedKeys` has no cap, so a deterministic no-line refusal mints a host-tier planner session every pass; patch with a cap, backoff, bad_spec loopback, or escalate? — ruling: accept-deviation score 1 — do: Apply option A as a patch: in `recordedKeys` count each key's `validate-expired` events by `detail.key`; at 3 keep it recorded and record no further `validate-expired` for it (no new event name). Document the cap of 3 in the resolution.ts header, the README expiry sentence and the driver-contract `validate-resolution` bullet. Add a bun test: a run that writes no line re-queues exactly 3 times, the 4th pass queues nothing, a new `reason_comment.id` queues again. Record DRIFT "the `validate-expired` re-queue is capped at 3 per key — a deterministic refusal writes no line and would otherwise mint a host-tier planner session every pass — affects: none"; keep the pass-2 DRIFT as written. — rule candidate: Any supervisor pass that re-queues a paid (host-tier or planner-model) run after an outcome-less end must carry a per-key retry cap, counted from the service events it already records; a review finding that the re-queue has no cap is a patch at score 1, not bad_spec.
- 2026-10-25T02:36:26Z — trigger: deviation-gt-0 — question: accept the follow-up-2 patches (the `ResumeFailed` re-arm retry capped at 3 per run and issue, the live-run pre-check before `enqueue`, the re-block key wording, a new driver-contract sentence on `validate-resumed`) at self-score 1, or score 2 for the contract sentence, or reject the retry? — ruling: accept-deviation score 1 — do: Record pass 3 as DEVIATION SCORE 1. Keep patches 1–3 and the driver-contract sentence as built. Add DRIFT "a `ResumeFailed` re-arm is retried on later passes, at most 3 attempts per run and issue: a transient spawn or lookup failure otherwise leaves a passed story paused forever — affects: none", then continue to close-out. — rule candidate: A supervisor re-arm or re-queue may treat a refusal code that leaves the run in its prior resumable state (e.g. `ResumeFailed` after `backToPaused`) as retryable, capped at 3 per key and counted from the service events it already records; documenting it in the `validate-resolution` driver-contract bullet is a score-1 DRIFT, not a seam. (observe record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review of story 31.7. The spec arrived `done` with `followup_review_recommended: true`. Both review layers ran again over `b9be0ce..` (this spec excluded) and three patches went in:
- The re-arm now retries a `ResumeFailed` resume on later passes, up to 3 attempts per run and issue (`MAX_RESUME_ATTEMPTS`).
- The resolution pass no longer calls `enqueue` while a `validate-resolution` run is live on the checkout. Before, `enqueue` overwrote that run's planner model and effort.
- The docs now say that only a re-block (a new agent `Blocked:` comment) starts a new key.

**Files changed (this pass).**
- `apps/supervisor/src/resolution.ts`: `finalResumes` and `MAX_RESUME_ATTEMPTS`, used by `rearm`; the live-run check before `enqueue` in `queueResolved`; the header wording
- `apps/supervisor/test/resolution.test.ts`: tests for retry then success, the cap of 3, `StoryLanded` attempted once, and a live run keeping its planner leg; a comment wording fix
- `apps/supervisor/README.md`: the re-block key wording; the 3-attempt `ResumeFailed` retry
- `plugins/tk-studio/contracts/driver-contract.md`: the re-block key wording; one sentence on the `validate-resumed` re-arm and its retry cap

**Review.** Two layers (blind-hunter, edge-case-hunter). 3 patches applied (medium 1, low 2), 0 deferred, 2 rejected, 0 bad_spec, 0 intent_gap. One consult (deviation-gt-0): accept-deviation score 1.

**Follow-up review recommendation:** true. Patched: high 0, medium 1, low 2; score 3×1 + 2 = 5, which reaches the threshold of 5.

**Verification.**
- `uv run python -m unittest discover tests` (from `plugins/tk-studio/lib`): 1820 tests OK (2 skipped). Run by the implementer and again by this session.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`. Run by the implementer and again by this session.
- `bun test` (run by the implementer; `node_modules` copied temporarily from the main checkout and removed afterwards; private TMPDIR; `TK_STUDIO_ROOT` set):
  - `test/resolution.test.ts`: 21 pass.
  - `test/queue.test.ts`: 92 pass, 2 skip. The first run had one failure because `bun` was not on PATH; it passed with `~/.bun/bin` on PATH.
  - `tsc --noEmit`: clean.
- Environment: the host filesystem is at 100% inode use (about 3.8k free). The implementer's first lib run hit `ENOSPC` while `node_modules` was copied in, and passed once it was removed. This session did not re-run `bun test`, to avoid copying `node_modules` again.
- `git status`: only the story's planned files.
- Unverifiable here: a live loop on a set-up site. The operator check is the same as in the first pass.

**Residual risks.**
- An exempt validation run holds no lock row, and `recover` does not resume it after a supervisor restart. The orphaned run is re-queued through `validate-expired` (cap 3).
- The `runJob` payload-overlay wiring is unit-tested only through `withStoredPayload`/`withQueuedPayload`.
- AC2's engagement questions and approvals have no call site (EP-32).
- After 3 expiries, or 3 `ResumeFailed` resumes, the pass gives up on that cycle until the issue is re-blocked. Then the operator resumes the run with `POST /runs/{id}/resume`.
- Host inode exhaustion can make the gate fail with `ENOSPC`.

DRIFT: a `ResumeFailed` re-arm is retried on later passes, at most 3 attempts per run and issue: a transient spawn or lookup failure otherwise leaves a passed story paused forever — affects: none
DRIFT: driver-contract.md gains one sentence describing the re-arm's `validate-resumed` event and its 3-attempt `ResumeFailed` retry — no `validate-resumed` description existed — affects: none

## Reconcile

- 2026-10-25 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, epic complete: no next story
