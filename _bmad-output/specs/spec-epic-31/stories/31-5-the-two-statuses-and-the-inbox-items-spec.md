---
title: 'The Two Statuses and the Inbox Items'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_revision: '65014fd77a47ee1d1449fb011c831a57e301a259'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-5.md'
  - '{project-root}/_bmad-output/specs/spec-epic-31/SPEC.md'
warnings: ['oversized']
deferred: []
deviation_score: 2
reconcile_verdict: adjust-stories
---

<intent-contract>

## Intent

**Problem:** As the owner, I want every issue that cannot progress to sit in `Blocked - Awaiting User` with its reason, and an inbox derived from that, so that one list says what needs me (§6.9 items 1 and 2, §7.4). Canonical: ST-119.

**Approach:** A new `tk-studio-track block` verb (`lib/track.py`, through `jirabackend`) moves the story's issue and its dependents to `Blocked - Awaiting User` with an agent comment that @mentions the owner. The supervisor's paused-run pass calls it. The 31.4 sync-back tick derives `_bmad-output/tracking/inbox.json` (`lib/inbox.py`). The supervisor serves it at `GET /inbox`, and the office's "!" follows a new `blocked_issue` field.

**Acceptance criteria (verbatim, epics.md Story 31.5):**
- AC1: **Given** a story the loop cannot progress (a dev session's `blocked` end, a `paused` run awaiting a ruling, an engagement question) **When** the loop reports it **Then** the issue (and each dependent story, by the plan's links) moves to `Blocked - Awaiting User` with a comment that @mentions the owner and names the reason and what resolves it (a `tk-studio-track block` verb the supervisor's paused-run pass and the engine's escalation hook call)
- AC2: **Given** the sync-back **When** it reads the mentions **Then** it derives `inbox_item {issue, priority, blocked_since, reason_comment, state: open | resolved | validating}` for every issue in that status, sorted by priority then time, into `_bmad-output/tracking/inbox.json`; the supervisor serves it at `GET /inbox` (a supervisor surface the web consumes, contract 0.1.26 additive) and the office shows a persistent "!" bubble on the desk whose work is blocked, cleared when the status changes, never when a message arrives

## Boundaries & Constraints

**Always:**
- Binding carries (invoke_dev_with):
  - Identify the owner only by `planning.jira.owner_account_id`. With none recorded, refuse by name (`blocked`). An absent or empty accountId never matches.
  - A comment is the owner's reply only when both `author.accountId` and `updateAuthor.accountId` are the owner's. Agent-authored comments are never the owner's reply. Add `update_author: owner | agent` to new comment-log lines (additive).
  - Transition by the target name `Blocked - Awaiting User` (never `_transition_to_category`), and refuse by name when no transition reaches it.
  - Read status by name from `external.jira.status`. `Blocked - Awaiting User` is `open` and `Block Resolved` is `resolved`. Canonical `blocked` alone is never enough.
  - Never rely on `planning.jira.filter_id`. Its absence is not an error.
  - Rewrite `inbox.json` only after a non-dry-run tick that read every page. A `rate-limited`, `error` or `blocked` tick leaves the previous file as it is.
- Every Atlassian write goes through `jirabackend` (AD-4). Studio scripts are stdlib-only and run with `uv run`. Writes are atomic. Every headless surface ends with the JSON status block (AD-11). No credential appears in a file, event or command line (NFR5). The plugin imports no driver or supervisor (AD-2).
- Contract 0.1.26 stays additive: the 31.5 clause, the §1 `GET /inbox` row and the §2 `tk-studio-track` row, with the conformance manifest updated in the same change (AD-19).
- Every test uses a fake Atlassian REST. No live call.

**Block If:**
- An escalation path is found that ends without a paused run.
- AC1 can be met only by a Jira write outside `jirabackend`, or by promoting anything besides the status move and the block comment (D9).
- The inbox needs a second JQL search per tick.
- The Files list in plans/31-5.md must grow.

**Never:**
- Add a hook to bmad-loop or to `.bmad-loop/plugins/`. The engine's escalation hook does not exist, so record a DRIFT line.
- Build the engagement-question call site (EP-32). The verb's `--source engagement` fixes the shape only.
- Touch `.claude-plugin/released-roster.json`, the plan-sync SKILL, `jobs/`, the release motion, or push.
- Clear the "!" on a comment or message event.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Block a story | Bound project; the story entity has `external.jira.key` and two dependents (via `depends_on`) | All three issues transition by name. Each gets one agent comment `[~accountid:<owner>] Blocked: <reason>\nResolves when: <resolves>`, and a dependent's comment adds `\nBlocked by: <key>`. The result is `complete`. | — |
| Re-block | The issue is already in the status, and the newest agent comment has the same body | Transition and comment are skipped and named | — |
| Refusals | No binding / absent env / no `owner_account_id` / never promoted / no transition reaching the status | `blocked`, naming the reason. No call when the binding or env is absent. | Exit 2 |
| Dependent fails | The story succeeds and a dependent's transition is refused | `partial` | — |
| Inbox tick | Complete non-dry-run tick; the issues are in the two statuses | `inbox.json` v1 `{inbox_version, generated_at, project_key, items[]}`, sorted by priority rank (`null` last) then `blocked_since` | — |
| Leave / keep | Status leaves the setup statuses / issue not returned by the search | Item removed / item kept | — |
| Failed tick | Dry-run, `rate-limited`, `error` or `blocked` | The previous `inbox.json` is untouched | — |
| `GET /inbox` | File missing | `{ok:true, project, generated_at:null, items:[]}`, never 404 | — |

</intent-contract>

## Code Map

The plan's Code Map in `_bmad-output/specs/spec-epic-31/plans/31-5.md` is the investigation, and its anchors were re-checked 2026-10-24. Read it first. Key anchors:
- `plugins/tk-studio/lib/jirabackend.py`: `_current_status` L636, `_transition_to_category` L645 (template for the new `transition_to_name`), `BLOCKED_STATUS` L969, `RESOLVED_STATUS` L970, `issue_comments` L1047 (GET only, so add `add_comment` as `POST /issue/{key}/comment`, v2 plain body with a wiki mention). Transport: `JiraClient.request`, `client_for`, `_resolve_settings`, `gateway_gaps`.
- `plugins/tk-studio/lib/syncback.py`: `SEARCH_FIELDS` L50 (add `priority`), `MENTION_RE` L52, `_who` L135, `write_state` L175, `log_comments` L236, `tick` L460 (call `inbox.derive` after the issue loop and cursor advance, before `write_state`, only on a complete non-dry-run read).
- `plugins/tk-studio/lib/plansync.py`: `sync_back` about L1976. The binding and env-gap helpers are about L2023-2034. Reuse them in `track.py` and do not copy them.
- `plugins/tk-studio/lib/interchange.py`: `depends_on`, `priority` P0–P3. Entity `source: "epics.md#story-N.M"` maps the loop key `N-M-…`.
- Skill pattern: `skills/tk-studio-report/` and `skills/tk-studio-plan-sync/SKILL.md`. Conformance: `contracts/conformance/runner.py` `discover_surfaces`, and `manifest.json` (plan-sync entry as the shape).
- Supervisor: `src/closeout.ts` `rulingRecorded` L367, `awaitRuling` L373, `closeOutPaused` L395. The subprocess pattern is `src/planstatus.ts` (`uvRunner`/`studioScript`, never throws). `src/api.ts` `readRoute` L660-661 (add `/inbox`), `/board` L726, route doc header L9-58. `src/office.ts` `OfficeAgent`, `forProject`, `projectOffice`. `src/conformance.ts` `VERB_SURFACES`/`SURFACE_CORES`.
- Web: `apps/studio-web/src/office/model.ts` `bubbleFor`/`Desk`, `src/office/OfficeScreen.tsx` DOM bubble, `src/live/store.ts` `OfficeAgent`.
- `bun` is installed at `~/.bun/bin/bun` (not on PATH). Use `PATH="$HOME/.bun/bin:$PATH"`.

## Tasks & Acceptance

**Execution:** these follow the plan's Files and Settled shapes 1–4 exactly.
- `plugins/tk-studio/lib/jirabackend.py`: add `transition_to_name` and `add_comment`.
- `plugins/tk-studio/lib/track.py` (new) and `skills/tk-studio-track/SKILL.md` (new): the `block` verb (Settled shape 1).
- `plugins/tk-studio/lib/inbox.py` (new) and `syncback.py`: `derive`, the sort and merge, `priority` in fields, `update_author` on lines, and the tick call (Settled shape 2).
- `contracts/driver-contract.md`, `conformance/manifest.json`, `apps/supervisor/src/conformance.ts`: the 31.5 clause, the two rows, the surface and its no-env refusal drive.
- `apps/supervisor/src/closeout.ts`: in `awaitRuling`, call `track.py block` when the project has a `planning.jira` binding, and record a `track-block` event per (story key, engine run id). Retry on a transient failure (Settled shape 4).
- `apps/supervisor/src/api.ts`, `office.ts`, `README.md`: `GET /inbox`, `readRoute`, `blocked_issue` (Settled shape 3).
- `apps/studio-web/src/office/model.ts`, `OfficeScreen.tsx`, `src/live/store.ts`: the "!" driven by `blocked_issue` alone.
- Tests: `test_track.py`, `test_inbox.py` (new). `test_syncback.py`, `test_jirabackend.py`, `test_driver_contract.py`. `apps/supervisor/test/{closeout,api,office}.test.ts`. `apps/studio-web/src/office/model.test.ts`. Cover every I/O matrix row.

**Acceptance Criteria:**
- Given a paused run awaiting a ruling on a bound project, when the supervisor's paused-run pass runs, then `track.py block` is invoked once per (story key, run id) and a `track-block` event records the result (closeout test).
- Given the I/O matrix rows, then lib tests assert each row (test_track, test_inbox, test_syncback).
- Given `GET /inbox` with a bearer or a cookie, then the answer is the file's items as served (api test). Given an open item for an agent's current story, then `blocked_issue` is set and the web shows "!". A comment event alone does not change it (office and model tests).

## Spec Change Log

## Review Triage Log

### 2026-10-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 3, low 3)
- defer: 0
- reject: 2 (low 2)
- addressed_findings:
  - `[high]` `[patch]` AC1's first trigger (a dev session's `blocked` end) never reached track.py: closeout.ts:148 classified it `not-landed`. Per consult, a not-landed paused story with spec `status: blocked` now calls `trackBlock` (reason from `Blocking condition:`), with four tests.
  - `[medium]` `[patch]` A transient Jira failure on the story was recorded as a final `blocked` refusal and never retried. track.py now ends it `partial`/`retry: true`, and closeout does not record it.
  - `[medium]` `[patch]` A re-block after `Block Resolved` with the same reason skipped the comment (no mention, stale `blocked_since`). The comment is now skipped only when the issue was already blocked.
  - `[medium]` `[patch]` `inbox.json` was rewritten on a tick that ended `rate-limited`/`error` in the Confluence mirror. It is now held via `INBOX_HOLD_CASES`.
  - `[low]` `[patch]` `reason_comment` could pick a third party's owner-mention. It now also requires the `[~accountid:…] Blocked:` form.
  - `[low]` `[patch]` The contract stream section and README `/office/events` row now say `office.agent` deltas carry `blocked_issue`, and that a change to it alone fires a delta.
  - `[low]` `[patch]` Dependents are limited to `type: story` (AC1's "dependent story"); `done`/`dropped` are skipped with a note.
- rejected:
  - unbounded next-pass retry of a persistent track.py failure: Settled shape 4 prescribes the next-pass retry, and this is plumbing.
  - "!" clearing when a run is cancelled: `selectRun` keeps paused runs (office.ts:292), so the bubble persists across the pause; a cancelled run is no longer the desk's work.

### 2026-10-24 — Review pass (follow-up)
- both layers ran (band L). The reviewers read the 215 KB baseline..HEAD code diff from a temp file instead of inline. Blind Hunter: 6 findings. Edge Case Hunter: 4. After deduplication, 8.
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 3 (low 3)
- addressed_findings:
  - `[medium]` `[patch]` A transient Jira failure on a dependent ended `partial` with `ok: true`. Closeout recorded it as final, so the dependent never reached `Blocked - Awaiting User` (AC1). A dependent's transient error now sets `retry: true` and `ok: false` after the remaining dependents are processed (track.py; `test_a_transient_dependent_failure_is_retried`).
  - `[medium]` `[patch]` The re-block comment skip read the */10-cron `comments.jsonl`, so a retry or a fast re-pause posted a duplicate owner @mention. The skip now reads the issue's comments live through `jirabackend.issue_comments`, and only when the issue is already blocked (track.py; three new or reworked re-block tests).
  - `[medium]` `[patch]` A complete read whose inbox was held (a page-mirror 429 or error) still saved the advanced cursor. An issue that left the status on that tick kept its open item and "!" (AC2). The prior cursor is now restored, with a "cursor unchanged" partial note (syncback.py; two new tests).
  - `[low]` `[patch]` A non-transient `add_comment` failure after a successful transition was reported as `transitioned: false`. It now keeps `transitioned: true` with `error: block comment refused: …`, and a transient one re-raises into the retry path (track.py; three tests).
  - `[low]` `[patch]` The supervisor README did not describe the dev-session `blocked` trigger, and its "Left for the resume" bullet was wrong. Both are corrected (README.md L130-134).
- rejected:
  - the released-roster guard is red: already ruled (Consult Log 22:11:50Z) and recorded as DRIFT, and the roster edit is under Never.
  - a dry run does not predict a missing-transition refusal: dry-run prediction is not named by the criteria or the I/O matrix.
  - a retry after a transient comment failure, following an earlier cycle with an identical reason, skips the fresh mention: this needs a transient comment failure right after a successful transition plus an identical prior-cycle reason. There is no reliable status-entry time without the changelog, and the owner already saw the issue blocked with that reason.

### 2026-10-24 — Review pass (follow-up 2)
- both layers ran (band L). The reviewers read the 232 KB baseline..HEAD code diff from a temp file. Blind Hunter: 2 findings. Edge Case Hunter: 2. After deduplication, 4.
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 1, medium 2, low 0)
- defer: 0
- reject: 1 (low 1)
- addressed_findings:
  - `[high]` `[patch]` A story paused on an escalation never got its "!" (AC2). `progress()` marks a `story-escalated` story `failed`, so `current_story` is null and `blockedIssueFor` found nothing (office.ts:604). On a `paused` run with no current story, `blocked_issue` now falls back to the paused story: the queue `paused_story_key`, else the standing journal `story-escalated` key. `current_story` is unchanged (office.ts `pausedStoryOf`; three office tests; contract wording, still 0.1.26).
  - `[medium]` `[patch]` A stale entity snapshot re-added an inbox item the tick had dropped, because `apply_statuses` leaves the snapshot on a conflict or an unmapped status. The "!" then came back after the status had changed (AC2, I/O row "Leave"). The snapshot seed now runs only on a first derive, when no `inbox.json` exists yet (inbox.py; two tests in test_inbox).
  - `[medium]` `[patch]` A run paused at stage `escalation` whose spec is neither `done` nor `blocked` (an engine-raised escalation awaiting a ruling, AC1) never moved its issue to `Blocked - Awaiting User`. It now gets the same `trackBlock` as the dev-blocked branch, with reason `paused_reason`, else "story escalated: awaiting a ruling", and no `awaiting-ruling` event (closeout.ts `escalationBlocked`; four closeout tests; README).
- rejected:
  - the "!" shows on every desk of the project: plan Settled shape 3 (plans/31-5.md, item 3) pins `blocked_issue` to the agent's `current_story`, which is per project (office.ts:610), so every desk whose story is blocked is "the desk whose work is blocked". Extra bubbles on idle desks are cosmetic.

## Design Notes

The settled shapes are in SPEC.md Design notes CAP-9/CAP-10 and plans/31-5.md "Settled shape" 1–4, and are binding. The engine escalation hook is absent (bmad-loop fires no hook on pause), so the paused-run pass is the only caller. This is a known DRIFT against AC1's wording, to be recorded.

Seams pinned by consult (deviation-gt-0, pass 1) for 31-6/31-7: `OfficeAgent.blocked_issue` is always on the wire as `{issue, state}` or `null`. The supervisor's `track.py block --directory` is the run's project root (`run.root`), the same root the binding, entities and `tracking/inbox.json` resolve from.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: expected green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run`: expected `ok: true`, including `tk-studio-track`.
- `env -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_TOKEN -u TK_ATLASSIAN_CLOUD_ID -u JIRA_API_TOKEN uv run plugins/tk-studio/lib/track.py block --directory . --story ST-119 --reason x --resolves y`: expected `blocked`, exit 2, with no call.
- `cd apps/supervisor && bun test && bun run typecheck`, and `cd apps/studio-web && bun run test`: expected green.
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ apps/ _bmad-output/specs/spec-epic-31/`: expected only pattern text.

**Manual checks (if no CLI):**
- Unverifiable here: a live block on the site, and the "!" in a browser. The operator pauses a run on a set-up project and checks Jira, the "Needs you" filter, `GET /inbox` and the office.

## Deviation Summary

### pass 1 (implementer, 2026-10-24)

- planned: verify gate fully green, with `released-roster.json` untouched / actual: 3 roster-guard tests are red (`test_release_roster.py:79 test_repo_roster_rides_the_version_gate` and two `test_drift_check.SkillsDirPlaneTestCase` cases) because the new `tk-studio-track` skill folder is not in the roster / why: the plan requires the folder and forbids the roster edit; the release motion fixes this, as at 3c1972c / may affect: 31-6, 31-7
- planned: block result `{ok, dry_run, issues[], notes[], written[]}` / actual: added `story`, `source` and a per-issue `error` (additive) / why: to show the source and give a failure reason / may affect: none
- planned: dry-run outcome unspecified / actual: a dry run that would move or comment ends `partial` (the publish precedent) / why: existing precedent / may affect: none
- planned: `--directory` for the supervisor's call unspecified / actual: the project root (`run.root`), not the worktree; the office reads the inbox from the same root / why: the binding, entities and `tracking/` live there / may affect: 31-7
- planned: `inbox.derive` right after the cursor advance / actual: after the owner-page mirror, still before `write_state`, under the same complete-read and non-dry-run guard / why: a single guard site / may affect: none
- planned: `blocked_issue` optional / actual: always present, `null` when nothing is blocked; one existing office test expectation updated / why: a simpler shape for the web and deltas / may affect: 31-6
- planned: "!" bubble text unspecified / actual: `! <issue key>`, which replaces the waiting/blocked reason bubble while set / why: one DOM bubble per desk / may affect: 31-6
- planned: skill folder holds SKILL.md / actual: no `customize.toml` added / why: Files names only SKILL.md / may affect: none
- planned: test_syncback adds coverage / actual: also updated the existing fake's pinned search-fields string and happy-path assertions / why: the new field and file / may affect: none
- planned: AC1 names "the engine's escalation hook" as a caller / actual: the supervisor's paused-run pass is the only caller, because bmad-loop fires no hook on a pause / why: the hook does not exist and is not this repo's to add (plan Risks) / may affect: 31-7

Implementer DEVIATION SCORE: 2

DRIFT: tk-studio-track skill unreleased, so the released-roster guard (test_release_roster.py:79 and two test_drift_check SkillsDirPlane cases) is red until the release motion — the plan forbids the roster edit and the loop never runs the release — affects: 31-6, 31-7
DRIFT: AC1's "engine's escalation hook" caller is absent; the supervisor's paused-run pass is the only caller of `tk-studio-track block` — bmad-loop fires no hook on a pause and it is not this repo's to add — affects: 31-7
DRIFT: `OfficeAgent.blocked_issue` is always present (`null` when none), not omitted — a simpler wire shape for deltas and the web — affects: 31-6
DRIFT: the supervisor calls `track.py block --directory <run.root>` (the project root) — Settled shape 4 left the root unnamed — affects: 31-7
DRIFT: local additive choices (result `story`/`source`/per-issue `error`; dry run with pending moves ends `partial`; derive after the page mirror under the same guard; `! <key>` bubble text; no customize.toml) — unspecified details settled by precedent — affects: none

### pass 1b (implementer relaunch, verify-red diagnosis, 2026-10-24)

- planned: supervisor suite in one `bun test` run / actual: the 6 red tests (sandbox.test.ts x5, closeout.test.ts load) were environmental: `TK_STUDIO_ROOT` was unset (src/sandbox.ts:115-116 throws; test/fakes.ts:75), and those files are unchanged since baseline. With it set and run one file at a time on a private TMPDIR (because of inode pressure), the result is 1050 pass, 0 fail; no code changed / why: the verify environment / may affect: none
Relaunch DEVIATION SCORE: 1 (verification method only; story deviation_score stays 2)

### pass 2 (review patches, 2026-10-24)

- planned: a transient failure ends with a non-`blocked` status such as `error` / actual: `partial` with `ok: false` and an additive `retry: true`; the CLI exits 0 for anything but `blocked`; closeout records no `track-block` on `retry: true` / why: the §3 status-block schema allows only `complete | partial | blocked` / may affect: 31-7
- planned: hold the inbox on a failed tick / actual: held on exactly `rate-limited` and `error` (a blocked tick returns earlier); an `unreachable`/`auth` Confluence-mirror failure after a complete Jira read still rewrites it / why: the binding carry names those cases, and the inbox is Jira-derived / may affect: none
- planned: reason from `Blocking condition:` / actual: the last such line, with an empty value or `none` falling back to "dev session ended blocked" / why: pass logs record `Blocking condition: none` / may affect: none
- planned: Settled shape 4 makes the awaiting-ruling path the only caller / actual: a paused run whose spec is `blocked` (not-landed) is a second trigger, which writes `track-block` and no `awaiting-ruling` (consult ruling) / why: AC1's first trigger never reached the old path (closeout.ts:148) / may affect: 31-7
Pass-2 DEVIATION SCORE: 2
DRIFT: the plan's premise that every dev `blocked` end reaches the paused-run pass as `awaiting-ruling` was wrong; a not-landed paused story with spec `status: blocked` now calls `track.py block` with reason from `Blocking condition:` and writes no `awaiting-ruling` — AC1's first trigger was otherwise unmet — affects: 31-7
DRIFT: tk-studio-track ends a transient Jira failure `partial` + `ok: false` + additive `retry: true` (§2 row and SKILL.md updated), and the supervisor retries it — the status-block schema has no `error` — affects: 31-7

### pass 3 (follow-up review patches, 2026-10-24)

- planned: SKILL.md and driver-contract.md edited only if a documented shape changed / actual: both edited, additively (the skip reads live, `retry: true` can come from a dependent, a refused comment keeps `transitioned: true`); the contract stays 0.1.26 and the manifest is unchanged / why: SKILL.md named `comments.jsonl`, and the supervisor acts on the dependent `retry: true` / may affect: 31-7
- planned: a `track retry: …` reason mirroring the story path / actual: it lists every failed dependent and how many were transient / why: one result can mix both kinds / may affect: none
- planned: no `_block_issue` signature change / actual: its second parameter is now `owner`, not `root` (a private helper with no other callers) / why: the live read needs the owner, not the root / may affect: none
Pass-3 DEVIATION SCORE: 2 (consult: #1 at 2, #2 and #3 at 1)
DRIFT: tk-studio-track's re-block comment skip reads the issue's comments live (`jirabackend.issue_comments`), not `comments.jsonl`, and a dependent's transient failure also ends `partial` + `ok: false` + `retry: true` (§2 track row and SKILL.md reworded, still 0.1.26) — the stale log posted duplicate mentions on retry, and a dependent was otherwise never retried — affects: 31-7

### pass 4 (follow-up review patches 2, 2026-10-24)

- planned: Settled shape 3 sets `blocked_issue` from the agent's `current_story` / actual: on a `paused` run whose `current_story` gives nothing, it reads the paused story (`paused_story_key`, else the standing journal `story-escalated` key); `current_story` is unchanged; the contract wording is amended additively, still 0.1.26 / why: a `story-escalated` story is `failed` in `progress()`, so the main paused paths never showed the "!" / may affect: 31-6
- planned: Settled shape 2 always seeds items from entity snapshots / actual: it seeds only on a first derive (no `inbox.json` yet) / why: a stale snapshot re-added a dropped item / may affect: none
- planned: the paused-run pass blocks on awaiting-ruling and on a spec `blocked` / actual: a not-landed run paused at stage `escalation` whose spec is neither `done` nor `blocked` also calls `track.py block` (reason `paused_reason`, else "story escalated: awaiting a ruling"); it writes no `awaiting-ruling` and the run stays paused / why: `landing()` sends any spec that is not done to not-landed (closeout.ts:160), so an engine escalation never reached a block (AC1) / may affect: 31-7
Pass-4 DEVIATION SCORE: 2 (consult: #1 and #3 at 2, #2 at 1; implementer had reported 1)
DRIFT: `blocked_issue` falls back to the paused story (`paused_story_key`, else the journal `story-escalated` key) when `current_story` is null on a paused run; `current_story` unchanged, contract still 0.1.26 — a `story-escalated` story is `failed` in the office projection, so the "!" never showed on a paused escalation — affects: 31-6
DRIFT: a not-landed run paused at stage `escalation` whose spec is neither done nor blocked calls `track.py block` with reason `paused_reason` (else "story escalated: awaiting a ruling") and no `awaiting-ruling` — `landing()` routes every not-done spec to not-landed, so an engine-raised escalation was otherwise never blocked (AC1) — affects: 31-7

## Consult Log

- 2026-10-24T22:11:50Z — trigger: verify-red — question: the 3 released-roster guard failures caused by the new tk-studio-track skill, with the roster edit forbidden: accept as the designed release-motion red, edit the roster, or halt? — ruling: apply — do: take option (a) and leave released-roster.json and the gate x3 untouched; record the 3 failures as unverifiable-here with the release-motion command (tools/release_archive.py + claude plugin tag) and one DRIFT naming tk-studio-track as unreleased; confirm no other test is red (test_gate_files_are_in_four_way_lockstep) and conformance ok — rule candidate: in bmad-build-auto.toml VERIFY GATE, a story that adds a skill leaves the released-roster guard red by design; record unverifiable-here + DRIFT, no consult or HALT
- 2026-10-24T22:12:41Z — trigger: deviation-gt-0 — question: accept the implementer's nine non-roster deviations (score 2)? — ruling: accept-deviation score 2 — do: accept all nine as reported; pin `blocked_issue` always `{issue,state}|null` and `--directory run.root` in Design notes; make sure a DRIFT line names the absent escalation hook; leave the `blocked_issue?:` TS type unchanged — rule candidate: an "optional … | null" field may always be sent as null, and a supervisor subprocess's --directory is run.root unless the plan says otherwise; both score-1, no consult
- 2026-10-24T22:35:52Z — trigger: high-severity-finding — question: AC1's dev-session blocked end never reaches track.py (closeout.ts:148 not-landed, :460 skip): patch, bad_spec or escalate? — ruling: apply — do: option (a) in closeout.ts + closeout.test.ts only: a shared narrow trackBlock; on not-landed with spec status exactly blocked, call it under trackOwed with reason from 'Blocking condition:' (fallback 'dev session ended blocked'), no awaiting-ruling event or notification, run left paused; four tests; one deviation and DRIFT line (plan premise wrong; 31-7 sees track-block without awaiting-ruling) — rule candidate: a not-landed paused story with spec status blocked is a block trigger, reason from 'Blocking condition:', patched in closeout.ts with no consult
- 2026-10-24T22:50:30Z — trigger: deviation-gt-0 — question: accept the pass-2 deviations (transient → partial+retry:true; inbox hold on rate-limited/error only; Blocking-condition fallback)? — ruling: accept-deviation score 2 — do: keep all three as built; make sure a closeout test pins no record on retry:true (present, closeout.test.ts:657) — rule candidate: a CLI's transient upstream failure that the caller should retry ends partial with ok:false and an additive retry:true, never blocked and never a new status value
- 2026-10-24T23:04:31Z — trigger: deviation-gt-0 — question: accept the follow-up pass's three deviations (SKILL.md and §2 track-row rewording; the retry reason text listing dependents; `_block_issue` taking `owner`)? — ruling: accept-deviation score 2 — do: keep all three as built; score #1 at 2 (the supervisor acts on the dependent `retry: true` and on the live skip), #2 and #3 at 1; leave the contract at 0.1.26 and the manifest unchanged; rerun conformance before closeout (done: `ok: true`) — rule candidate: wording added to a §2 row inside the open, in-flight contract version is additive and needs no consult when it adds no field or verb and leaves every manifest drive unchanged; score 2 when a driver acts on it, 1 otherwise
- 2026-10-24T23:22:04Z — trigger: deviation-gt-0 — question: accept the follow-up-2 pass's three deviations (`blocked_issue` paused-story fallback; inbox snapshot seed only on a first derive; engine-raised escalation as a block trigger), implementer score 1? — ruling: accept-deviation score 2 — do: keep all three as built; score #1 and #3 at 2 (31-6 acts on the widened `blocked_issue`; #3 may affect 31-7), #2 at 1; add two DRIFT lines (affects 31-6, 31-7); leave the contract at 0.1.26 and the manifest unchanged; rerun conformance before closeout (done after the patches: `ok: true`) — rule candidate: a not-landed paused story at stage `escalation`, with the spec neither done nor blocked, is a block trigger (reason `paused_reason`, no awaiting-ruling) and scores 2 with "affects: 31-7"; widening when an existing office/wire field is set scores 2 when the web acts on it, with no consult

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run the release motion: bump plugin.json, marketplace.json, and released-roster.json in lockstep (version gate + skill roster together); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was the second follow-up review pass on the completed story. It fixed three findings:
- A story paused on an escalation now gets its "!". `blocked_issue` falls back to the paused story when `current_story` is null.
- A stale entity snapshot can no longer re-add an inbox item the tick dropped. The seed runs only on a first derive.
- A run the engine paused at stage `escalation`, whose spec is neither `done` nor `blocked`, now moves its issue to `Blocked - Awaiting User`.

**Files changed (this pass):**
- `apps/supervisor/src/office.ts`: `pausedStoryOf`; the `blocked_issue` fallback to the paused story; header comment.
- `apps/supervisor/src/closeout.ts`: `escalationBlocked` and `ESCALATION_BLOCKED_REASON`, wired into the not-landed branch after `devBlocked`; header comment.
- `plugins/tk-studio/lib/inbox.py`: the snapshot seed only on a first derive; docstring.
- `apps/supervisor/test/office.test.ts`, `test/closeout.test.ts`, `plugins/tk-studio/lib/tests/test_inbox.py`: tests pinning each fix.
- `plugins/tk-studio/contracts/driver-contract.md`: the `blocked_issue` wording (§1 inbox row and the 0.1.26 office paragraph), additive, still 0.1.26.
- `apps/supervisor/README.md`: the `blocked_issue` fallback, and the engine-raised escalation bullet in the paused-pass section.

**Review:**
- Both layers ran (band L). Blind Hunter: 2 findings. Edge Case Hunter: 2. After deduplication, 4.
- Patches applied: 3 (high 1, medium 2, low 0). Deferred: 0. Rejected: 1.
- Follow-up review recommended: true. A high patch was applied, and the score is 3×2 + 1×0 = 6.

**Verification** (run by this session after the patches):
- **Lib suite:** 1749 run, 2 skipped, 3 failures. All three are the released-roster guard (`test_release_roster` `test_repo_roster_rides_the_version_gate` and two `test_drift_check.SkillsDirPlaneTestCase`), red by design until the release motion. Nothing else fails.
- **Conformance:** `ok: true`.
- **Supervisor,** one file at a time on a private TMPDIR with `TK_STUDIO_ROOT` set: `office.test.ts` 64 pass, `closeout.test.ts` 52 pass, `api.test.ts` 56 pass, 0 fail.
- **Typecheck:** `bun node_modules/typescript/bin/tsc --noEmit` exits 0. `bun run typecheck` cannot find `tsc` because `node_modules/.bin` has no links.
- **studio-web:** `bun node_modules/vitest/vitest.mjs run` gives 8 files and 114 tests passed. `bun run test` cannot find `vitest`, for the same reason.
- **No-env `track.py block --directory . --story ST-119 --reason x --resolves y`:** `blocked`, exit 2, with "no Atlassian call made".
- **Token grep:** only pattern text and placeholder fixtures. No added line matches.

**Unverifiable here:**
- The release-roster guard. The operator's release motion (`tools/release_archive.py`, `claude plugin tag`) bumps the gate and roster together.
- A live block and the "!" in a browser. On a set-up project, the operator pauses a run (including an engine escalation) and checks Jira, the "Needs you" filter, `GET /inbox?project=<id>` and the office.

**Residual risks:**
- The ungraded `POST /issue/{key}/comment` and transitions-by-name shapes are pinned only in fakes.
- The engagement-question trigger has no caller yet (EP-32).
- A persistent track.py failure is retried every pass without a cap.
- The "!" shows on every desk whose project's story is blocked, including idle desks. This follows plan Settled shape 3; this pass rejected the finding as cosmetic.
- An issue blocked outside the loop after `inbox.json` exists reaches the inbox only through the search, never a snapshot seed.
- The `node_modules/.bin` links are missing in this worktree, so `bun run typecheck` / `bun run test` need the direct entry files.

DRIFT: tk-studio-track skill unreleased, so the released-roster guard (test_release_roster.py:79 and two test_drift_check SkillsDirPlane cases) is red until the release motion — the plan forbids the roster edit and the loop never runs the release — affects: 31-6, 31-7
DRIFT: AC1's "engine's escalation hook" caller is absent; the supervisor's paused-run pass is the only caller of `tk-studio-track block` — bmad-loop fires no hook on a pause and it is not this repo's to add — affects: 31-7
DRIFT: `OfficeAgent.blocked_issue` is always present (`null` when none), not omitted — a simpler wire shape for deltas and the web — affects: 31-6
DRIFT: the supervisor calls `track.py block --directory <run.root>` (the project root) — Settled shape 4 left the root unnamed — affects: 31-7
DRIFT: local additive choices (result `story`/`source`/per-issue `error`; dry run with pending moves ends `partial`; derive after the page mirror under the same guard; `! <key>` bubble text; no customize.toml) — unspecified details settled by precedent — affects: none
DRIFT: the plan's premise that every dev `blocked` end reaches the paused-run pass as `awaiting-ruling` was wrong; a not-landed paused story with spec `status: blocked` now calls `track.py block` and writes no `awaiting-ruling` — AC1's first trigger was otherwise unmet — affects: 31-7
DRIFT: tk-studio-track ends a transient Jira failure `partial` + `ok: false` + additive `retry: true` — the status-block schema has no `error` — affects: 31-7
DRIFT: tk-studio-track's re-block comment skip reads the issue's comments live (`jirabackend.issue_comments`), not `comments.jsonl`, and a dependent's transient failure also ends `partial` + `ok: false` + `retry: true` (§2 track row and SKILL.md reworded, still 0.1.26) — the stale log posted duplicate mentions on retry, and a dependent was otherwise never retried — affects: 31-7
DRIFT: `blocked_issue` falls back to the paused story (`paused_story_key`, else the journal `story-escalated` key) when `current_story` is null on a paused run; `current_story` unchanged, contract still 0.1.26 — a `story-escalated` story is `failed` in the office projection, so the "!" never showed on a paused escalation — affects: 31-6
DRIFT: a not-landed run paused at stage `escalation` whose spec is neither done nor blocked calls `track.py block` with reason `paused_reason` (else "story escalated: awaiting a ruling") and no `awaiting-ruling` — `landing()` routes every not-done spec to not-landed, so an engine-raised escalation was otherwise never blocked (AC1) — affects: 31-7

## Reconcile

### 2026-10-24 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT line is additive inside the open 0.1.26 entry. `retry: true` rides the result JSON beside `ok`, not the §3 block, so the status-block schema still holds, and no AD or ruling is contradicted. No later acceptance criterion has to change. 31.7's "the supervisor's `awaiting-ruling` writes the block" still holds, but two more block triggers write `track-block` with no `awaiting-ruling`: a dev `blocked` end, and an engine escalation whose spec is not done. A transient failure now ends `partial` + `ok: false` + `retry: true`. 31-6 consumes the `GET /inbox` and `blocked_issue` shapes as built. Notes in `invoke_dev_with` can absorb both.
- Affected: 31-7-validation-of-a-resolution — "the supervisor's paused run resumes with the ruling written into the spec" assumes a paused block always has an `awaiting-ruling`. The dev-blocked and escalation triggers record only `track-block`.
- Affected: 31-6-the-inbox-and-issue-screens — "it lists open items sorted as served": `inbox.json` also carries `resolved`/`validating` items, `GET /inbox` needs `?project=<id>`, and a missing file is an empty list.
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 31-6-the-inbox-and-issue-screens
