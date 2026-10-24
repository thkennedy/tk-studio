---
title: 'Sync-Back on a Timer'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_revision: '67929b3171a1add1cebf914da7a3f7132191c883'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-31/plans/31-4.md'
  - '{project-root}/kb/atlassian-free-tier.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Core job runs map only "no JSON" to run state blocked; a core's own `status` is never lifted into the run `state`, so `stop.on_status: ["blocked"]` on atlassian-sync-back (and every shipped core cron job) never fires on a self-reported blocked, and a single crash stops the timer for good.
    evidence: |-
      jobrun.execute_core marks any parsed JSON output `complete`; a sync-back refusal (exit 2, status blocked) is recorded as a complete run, with `blocked` visible only in summary.json's lifted `status`. Consult ruling (option b): a runner-wide seam, not patched in a feature story. Meets (b): a contract/schema invariant left unpinned.
    location: >-
      plugins/tk-studio/lib/jobrun.py execute_core; plugins/tk-studio/jobs/atlassian-sync-back.json
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Agents have no local copy of an issue's Atlassian state (status, comments, attachments) or of the owner's Confluence pages, so context would need live Atlassian queries (§6.8 c and e, D9).

**Approach:** As an agent working on a story, I want the issue's status, its comments, its attachments as links and the owner's Confluence pages in local memory, so that no agent queries Atlassian live for context. A new `plansync.py sync-back` verb (tick in a new `lib/syncback.py`) run by the shipped cron job `atlassian-sync-back` pulls them into `_bmad-output/tracking/` and `kb/confluence/`; the drift check gains a `tracking` plane.

## Boundaries & Constraints

**Always:**
- AC1 (verbatim): **Given** a project set up and the shipped job `atlassian-sync-back` (cron, every 10 minutes by default; `durable`) **When** it runs **Then** it pulls each tracked issue's status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`), its comments (append-only into `_bmad-output/tracking/<key>/comments.jsonl`: `{issue, author: owner | agent, body, mentions[], created, source: jira}`), its attachments as links, and every owner-authored Confluence page into `kb/confluence/<slug>.md` with a provenance header (read-only sources: a local edit is overwritten and reported); nothing local is promoted back; the run's record names counts and the newest comment seen.
- AC2 (verbatim): **Given** the sync-back **When** it is tested **Then** the lib suite covers the status mapping, the append-only comment log (a comment seen twice is written once), the attachment links, the page mirror and the overwrite report, with a fake REST; `tk-studio-activate`'s drift check gains a `tracking` plane that says when the last sync-back ran and whether the binding is reachable.
- Binding notes from 31-1 (kb/atlassian-free-tier.md §2 Q2–Q4, §4): one paged JQL search per tick over the tracked projects, never a GET per issue; cursor overlaps by a few minutes (`updated >= <cursor minus a few minutes>` in a form JQL reads unambiguously), ordered `updated ASC`; de-duplicate by key and `updated`; advance the cursor from the largest `updated` seen (not the host clock) and only after every page of the tick is read; an interrupted tick leaves the cursor where it was. On 429 wait `Retry-After`, else exponential backoff. Missing rate-limit headers are normal. Log observed `RateLimit-*` and `X-RateLimit-*` values, and every 429 with its `RateLimit-Reason`. The page mirror uses `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, refuses by name without it, and never re-uploads an unchanged attachment (sync-back never uploads). The tracking plane reports missing Confluence token, unreachable site and deactivated site as their own states, never "no changes"; deactivated names the owner's sign-in as the fix (kb §1 step 10). The loop never relies on its own API traffic to keep the site active.
- Binding notes from 31-2: the status mapping recognises `jirabackend.SETUP_STATUSES` (`Blocked - Awaiting User`, `Block Resolved`) by name and maps both to canonical `blocked`, keeping the Jira name under `external.jira` (AD-22, AD-6). Every other status keeps the category mapping. Round trips stay stable (AD-5): an unchanged `blocked` is never re-promoted into a different In Progress status. Use the same mapping in `pull_back` so `sync` and `sync-back` never flip an entity.
- The plan's five Settled shapes (`plans/31-4.md` §Settled shape 1–5) are the binding layout for tracking memory, the owner-page mirror, the search/cursor, the `tracking` plane cases and the shipped job.
- House rules: stdlib-only, run via `uv run`; atomic writes; headless surfaces end with the JSON status block; credentials never in tracked files or events; no test makes a live call; every file written is named in `written[]`.

**Block If:**
- The AC can be met only by promoting a comment, attachment or page to Atlassian, by changing an entity field other than `status`, or by a write bypassing the planning adapter (D9, AD-5, AD-4).
- The `tracking` plane needs a live network call (contract §6 read-only, manifest `external_calls: false`).
- The `{project_root}` job argument cannot be added without changing an existing job's behaviour or a required field of `job.schema.json`.
- The Files list must grow past the plan's twenty Files (oversize risk, Band L).

**Never:** promote anything local to Atlassian; run promote from sync-back; download or upload attachments; register the mirror in `kb/index.md` or pass it through the promotion gate; bump the contract version (extend the 0.1.26 entry with a "(Story 31.4)" clause); commit, push, or touch remotes; make a live call in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy tick | binding + all env; fake search returns issues, comments, attachments; owner pages | statuses applied, logs appended, pages mirrored, cursor advanced, `status: complete`, counts + newest_comment | none |
| Comment seen twice | same `(id, updated)` across ticks | written once; edit (new `updated`) appends a new line | none |
| Setup status | Jira status `Blocked - Awaiting User` / `Block Resolved` | canonical `blocked`, Jira name under `external.jira`; promote leaves it untouched | none |
| Local edit of mirror | body hash ≠ header hash | overwritten, named in `overwritten[]` | none |
| No Jira env / no binding | absent vars or `planning.jira` | `blocked`, each absent name, no call, exit 2 | refusal |
| No Confluence token | Jira env present | Jira half runs, mirror skipped, `partial`, case `token-missing` | named |
| No owner_account_id | binding lacks it | status still applied; comments, attachments, mirror skipped by name; `partial` | named |
| 429 exhausted / error between pages | fake forces 429 | cursor unchanged, `partial`, names `RateLimit-Reason` | retry with Retry-After / 1,2,4,8,16 s |
| Unreachable / deactivated | preflight connection error or 5xx / 404 or 410 | run records case `unreachable` / `deactivated`; plane reports it, deactivated fix = owner sign-in | own state |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-31/plans/31-4.md` §Code Map) is the investigation; its anchors were spot-checked on 2026-10-24 and hold (`jirabackend.py` :85, :93, :224, :355, :780, :795, :812; `jobrun.py` :337, :385, :437; `plansync.py` :163, :890, :1514, :1948). Read that section in full before editing. Key points:

- `plugins/tk-studio/lib/jirabackend.py` -- `canonical_status(name, category)` (name first via `SETUP_STATUSES`, then category); split `apply_statuses(plan_dir, {key: (name, category)}, dry_run)` out of `pull_back` :355-440 (echo suppression :396-401, snapshot :422-435), keep `{applied, conflicts, notes}`; `JiraClient._http` :262-286 transport optional 3-tuple `(status, body, headers)` (2-tuple fakes keep working); 429 retry in `request` with injectable `sleep`, named `RateLimited` carrying `RateLimit-Reason`; rate-limit header record; `search_jql(client, jql, fields)` pager over `GET /search/jql` (`nextPageToken`) capped at `MAX_PAGES`. Reuse `auth_failure` :165-199, `_resolve_settings` :663, `client_for` :713, preflight `GET /myself`.
- `plugins/tk-studio/lib/confluence.py` -- `_http` :121 same 3-tuple + 429; `list_space_pages(client, space_id)` over `GET /spaces/{id}/pages?body-format=storage&limit=250` via `_paged_results` :173-194; `env_gaps()` :79.
- `plugins/tk-studio/lib/plansync.py` -- `main` :1948 add `sync-back --directory ROOT [--dry-run]`; model result/finisher on `_publish_result` :1520 / `_finish_publish` :1526 / `SETUP_BLOCK_KEYS` :883; `_recorded` :890; page index `PAGE_INDEX_REL` :1514, `_load_page_index` :1638; `_atomic_write` :163.
- `plugins/tk-studio/lib/syncback.py` (new) -- the tick (Settled shapes 1–3).
- `plugins/tk-studio/lib/jobrun.py` -- `execute_core` :385-433 substitutes exact `{project_root}` in `target.core[1:]` with the root from `submit` :437/:477 and `wake`; `_summarize_result` :337 also lifts `status`, `counts`, `newest_comment`.
- `plugins/tk-studio/jobs/maintenance-conformance.json:5-14` -- cron shape to copy for `jobs/atlassian-sync-back.json` (Settled shape 5).
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py` -- planes tuple in `main()` :494-505; add `check_tracking` (Settled shape 4), local reads only.
- "four planes" text pins: `driver-contract.md` §6 :587-600, `tests/test_driver_contract.py:982`, `contracts/events/taxonomy.v1.json:31`, `skills/tk-studio-activate/SKILL.md:8,31`, `contracts/conformance/manifest.json:12`; `tests/test_drift_check.py:468-515` mocks planes in `main()` tests.
- Fakes: `tests/test_jirabackend.py` `FakeJira` :42-123; `tests/test_tracking_setup.py` `FakeAtlassian` :51, `SetupTestCase` :248; `tests/test_publish.py` `FakeConfluencePublish` :59, `PublishTestCase` :147.
- Contract: extend the 0.1.26 entry (cell :5) with "(Story 31.4)", plan-sync row :285 (`sync-back` verb, `sync_back?` payload), §4 `{project_root}` note, §6 `tracking` plane + "five-plane"; asserts beside `test_0_1_26_names_publish` :660.

## Tasks & Acceptance

**Execution (the plan's Files list is the boundary; any other file is a recorded deviation):**
- `plugins/tk-studio/lib/jirabackend.py` -- canonical_status, apply_statuses, search_jql, 3-tuple transport, 429 retry, rate-limit record -- shared request path and stable mapping.
- `plugins/tk-studio/lib/confluence.py` -- list_space_pages, 3-tuple, 429 retry -- page mirror source.
- `plugins/tk-studio/lib/syncback.py` (new) -- the tick, result `{ok, dry_run, counts, newest_comment, applied[], conflicts[], overwritten[], rate_limit, notes[], written[]}` -- keeps plansync to wiring.
- `plugins/tk-studio/lib/plansync.py` -- `sync-back` verb, refusals, §3 block last -- the headless surface.
- `plugins/tk-studio/lib/jobrun.py` (+ `lib/job.py` only if `validate_definition` refuses the token) -- `{project_root}` argument and summary keys -- the job's record.
- `plugins/tk-studio/jobs/atlassian-sync-back.json` (new) -- the shipped cron job, undeclared by default.
- `plugins/tk-studio/contracts/job.schema.json` -- additive `{project_root}` description.
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`, `skills/tk-studio-activate/SKILL.md` -- `tracking` plane, five planes.
- `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md` -- `sync-back` verb and `sync_back?` relay.
- `plugins/tk-studio/contracts/driver-contract.md`, `contracts/conformance/manifest.json`, `contracts/events/taxonomy.v1.json` -- contract surface (AD-19), manifest `sync-back` refusal drive (no env: `blocked`, no call).
- `plugins/tk-studio/lib/tests/test_syncback.py` (new), `tests/test_jirabackend.py`, `tests/test_drift_check.py`, `tests/test_job.py`, `tests/test_driver_contract.py` -- every I/O matrix row and AC2's list, with fake REST.

**Acceptance Criteria:**
- Given the sync-back verb and a fake REST, when the lib suite runs, then tests prove the status mapping (incl. both setup statuses → `blocked`, Jira name kept), the append-once comment log, edits, attachment links, the page mirror and overwrite report, the cursor (incl. an interrupted tick), the 429 path, the three named states and the refusals.
- Given the shipped type `atlassian-sync-back`, when loaded, then it is cron `*/10 * * * *`, durable, a core target with `{project_root}` substituted by `execute_core`, and its summary names `status`, `counts`, `newest_comment`.
- Given this repo, when the drift check runs, then a `tracking` plane is present (`not-bound` or `never-run`) with no network.

## Spec Change Log

- 2026-10-24 — no bad_spec loopback. Per consult (pass 2), the plan's Risks line "plan/index.md and the projection follow at the next sync" is superseded for 31.4: a tick that applied a status change regenerates plan/index.md locally (never promote). plans/31-4.md was left unedited (outside this session's write scope).

## Review Triage Log

### 2026-10-24 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 4, low 2)
- defer: 1 (medium 1)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` apply_statuses left a stale snapshot canonical_status when local already equalled the mapped status, so the next promote moved Jira out of Blocked (AD-5); the snapshot is refreshed and a promote-makes-no-transition test pins it (consult ruling: apply)
  - `[medium]` `[patch]` the cursor advanced past comments/attachments skipped for a missing owner_account_id; the cursor now holds, and a rerun after recording the owner logs them (test extended). The KEY_RE variant was reverted to a note per consult ruling (non-recoverable skip)
  - `[medium]` `[patch]` Retry-After waits were unbounded against the 300 s job guard; a 30 s per-wait cap and 90 s per-client budget raise RateLimited at once so last_run and RateLimit-Reason are recorded
  - `[medium]` `[patch]` the consult-ruled contract sentence (last_run record fields, rate-limited/error cases) was missing from the 0.1.26 clause; added with asserts
  - `[medium]` `[patch]` sync-back left plan/index.md stale after a status change (FR14); local-only generate_plan_index now runs, named in written[]
  - `[low]` `[patch]` refusals and preflight failures reset last_run.newest_comment; the previous value carries forward
  - `[low]` `[patch]` non-network request errors (search 400, other 4xx, MAX_PAGES) were reported as unreachable; new run case `error`, and the contract text now names the `updated` stamp
  - deferred: job stop.on_status blocked never fires for a core's self-reported blocked (runner-wide seam, consult ruling option b)

### 2026-10-24 — Review pass (follow-up)
- Scope: the plugin diff since `67929b3171a1add1cebf914da7a3f7132191c883`. `_bmad-output/` bookkeeping was excluded. Both layers ran (band L).
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 11
  - stop.on_status / crash-stops-timer (two findings): a duplicate of the existing DW-38 deferral.
  - execute_core with root None: every caller (`submit`, `wake`) passes the root, so this is plumbing.
  - Dirty working tree from tracking writes: the plan's Risks "Working tree" bullet makes this the operator's call.
  - No lock against a concurrent plansync: pre-existing across every plansync verb, not caused here.
  - test_this_repo_is_not_bound_or_never_run depends on the repo: it mirrors the spec's own AC3 for this repo.
  - Missing interrupted-overflow and mirror-error tests: an assertion gap on plumbing; the interrupted tick is covered via the search.
  - A third-party author logged as `agent`: Settled shape 1 and SPEC Constraints allow only two values.
  - Clock skew beyond the 5-minute overlap: Settled shape 3 settles the relative bound.
  - First tick over MAX_PAGES or the guard: MAX_PAGES = 100 pages per search.
  - pull_back.applied showing `external.jira.status`: a consult-accepted seam.
- addressed_findings:
  - `[medium]` `[patch]` A legacy snapshot was never re-mapped to `blocked`. An entity pulled before 31.4 with Jira `Blocked - Awaiting User`/`Block Resolved` had snapshot canonical `in-progress`, and echo suppression kept it there for good. apply_statuses now re-maps a `SETUP_STATUSES` name whose mapping moved, when there is no pending local change (jirabackend.py:571-584). Tests: `test_a_legacy_snapshot_re_maps_to_blocked`, `test_a_legacy_snapshot_with_a_pending_local_change_is_untouched`.
  - `[low]` `[patch]` A CRLF checkout of a mirror file was reported as a local edit. The mirror comparison now also tries the CRLF-normalized text (syncback.py `_mirror_edited`). Test: `test_a_crlf_checkout_is_not_a_local_edit`.
  - `[low]` `[patch]` A header-only local edit (for example `read_only: false`) was neither overwritten nor reported. The header, with `synced_at` ignored, is now compared with the header the mirror would write. Test: `test_a_header_only_edit_is_overwritten_and_reported`.
  - `[low]` `[patch]` `counts.statuses_applied` counted snapshot-only refreshes. It now counts entries with `status` in fields, and applied[] is unchanged (syncback.py:537). Test: `test_a_snapshot_only_refresh_is_not_counted`.

### 2026-10-24 — Review pass (follow-up 2)
- Scope: the plugin diff since `67929b3171a1add1cebf914da7a3f7132191c883`. `_bmad-output/` bookkeeping was excluded. Both layers ran (band L).
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 0, low 5)
- defer: 0
- reject: 7
  - stop.on_status / crash-stops-timer (one finding from each layer): a duplicate of the existing stop.on_status deferral.
  - A 429 exhausted on the preflight ends `partial`: this matches the plan's rule that a 429 after the retries is `partial`. The assertion gap is plumbing.
  - "Gone page" notes repeat every tick: `notes[]` is per run, and Settled shape 2 names a gone page in each run's notes.
  - A both-changed conflict lets the cursor advance: the contract's resolution path is "edit one file, then rerun sync", and `sync`'s pull-back re-reads every entity by key, so recovery does not depend on the sync-back window.
  - An OSError on a write gives a traceback: `main` handles errors the same way across every plansync verb (PlanSyncError only). This is an environment failure, not caused here.
  - A third-party author logged as `agent`: Settled shape 1 allows only two values. This was already rejected in the follow-up pass.
- addressed_findings:
  - `[low]` `[patch]` A mid-tick 5xx made the plane read drift/`unreachable` on a `partial` tick, against §6 ("a connection error or 5xx on preflight"). `check_tracking` now applies `unreachable` only to a `blocked` run, and a partial `unreachable` is read by age and status. The §6 text says so. Tests: `test_unreachable_is_a_plane_case_only_on_a_failed_preflight`, `test_a_mid_tick_5xx_is_partial_and_the_plane_reads_it_by_age`.
  - `[low]` `[patch]` The `stale` fix said "has not ticked" for a recent tick that ended `blocked` (`error`/`rate-limited`). A recent non-complete tick now names its status, case and reason, and the plane case stays `stale`. Test: `test_a_recent_blocked_tick_names_its_outcome_not_a_missing_tick`.
  - `[low]` `[patch]` The contract text left out three behaviours: a preflight non-auth status ends `blocked` (case `error`), an unrecorded `planning.confluence.space_id` ends `partial`, and the comment-overflow read is the only per-issue GET. All three are now in the 0.1.26 (Story 31.4) clause, the plan-sync row and the plan-sync SKILL.md, with asserts in `test_0_1_26_names_sync_back`.
  - `[low]` `[patch]` A lost sync-state.json reported an unedited, older-version mirror file in `overwritten[]`. `_mirror_edited` now skips `version`/`title`/`url` when the page has no state entry. Test: `test_a_lost_sync_state_is_not_an_overwrite_of_an_unedited_file`.
  - `[low]` `[patch]` Two contract-named paths had no tests: `{project_root}` substitution through `submit`, and the Confluence rate-limit record. Tests: `test_submit_substitutes_the_submitting_project_root`, `test_the_confluence_rate_limit_lands_in_the_record`.

## Design Notes

Settled shapes live in `plans/31-4.md` and are not restated here to avoid divergence; the implementer reads them verbatim. Notable: the JQL bound is relative (`updated >= -<n>m`, n = minutes since cursor rounded up + 5) so no time zone is needed; `author` is `owner` only when `author.accountId` equals the recorded non-empty `owner_account_id`, else `agent`; the mirror body is storage XHTML verbatim under a YAML provenance header with `content_hash: sha256:<hex>`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `env -u TK_ATLASSIAN_AGENT_EMAIL -u TK_ATLASSIAN_AGENT_TOKEN -u TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN -u TK_ATLASSIAN_CLOUD_ID -u JIRA_API_TOKEN uv run plugins/tk-studio/lib/plansync.py sync-back --directory .` -- expected: `blocked`, exit 2, names absent vars or binding, no call
- `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory .` -- expected: `tracking` plane present, `not-bound` or `never-run`
- `git grep -n -E "ATATT3|_TOKEN=[^ ]" -- plugins/ _bmad-output/specs/spec-epic-31/` -- expected: only pattern text
- `git status --porcelain` -- expected: only the plan's Files

**Manual checks (if no CLI):**
- unverifiable-here: a live tick (operator network approval, kb §1 step 8). Operator runs `uv run plugins/tk-studio/lib/plansync.py sync-back --directory <project> --dry-run`, then without `--dry-run`, then the rate-limit header probe (kb §2 Q3).

## Deviation Summary

### pass 1 (2026-10-24, implementer)

- planned: `sync-state.json` `last_run` = `{at, status, case, counts, newest_comment}`; the result keys as listed / actual: added `last_run.reason` and a top-level `case` in the result / why: the tracking plane's fix has to name the absent variable or quote the 401/403 text / may affect: 31-5
- planned: `apply_statuses` applies status changes only / actual: when the Jira name changes but still maps to the current canonical status, it updates only `external.jira.status` (field `external.jira.status`); `pull_back` gets the same behaviour / why: AC1 keeps the Jira original under `external.jira` / may affect: 31-5, 31-7
- planned: `apply_statuses(plan_dir, {key: (name, category)}, dry_run)` / actual: extra optional `assignees=` argument so `pull_back` keeps its assignee handling / why: the original pull-back handled status and assignee together / may affect: none
- planned: a refusal for missing Jira variables makes no call / actual: still no call, but on a bound project it writes `sync-state.json` (`last_run` blocked, `token-missing`), named in `written[]` / why: the plane's `token-missing` case needs a recorded last run / may affect: none
- planned: run case uses the plane's cases / actual: also records `rate-limited`; the plane treats it by age and status, a blocked run with another case reads `stale` / why: an exhausted 429 is its own outcome / may affect: none
- planned: none stated / actual: rate-limit paths drop the gateway cloud id / why: they land in `sync-state.json` / may affect: none
- planned: plan-sync row's core list gains `sync-back` / actual: old `sync|normalize|setup|publish` cell kept, `; lib/plansync.py sync-back (0.1.26, Story 31.4)` appended / why: 31.2/31.3 contract tests assert the old string exactly / may affect: none
- planned: `check_tracking` reads config / actual: an unreadable config gives `not-bound` with a detail line / why: `test_nested_root`'s non-UTF-8 config case would otherwise crash the drift check / may affect: none

DEVIATION SCORE: 1 (consult: raised to 2)

DRIFT: sync-state last_run gains `reason` and the result a top-level `case` — the plane's fix must name the absent variable or the 401/403 text — affects: 31-5
DRIFT: apply_statuses (and pull_back) refresh external.jira.status when the Jira name changes within the same canonical status — AC1 keeps the Jira original under external.jira — affects: 31-5, 31-7
DRIFT: apply_statuses takes an optional assignees= argument — pull_back's assignee handling stays in the shared function — affects: none
DRIFT: a no-env refusal on a bound project writes sync-state.json (blocked, token-missing) with no call — the plane's token-missing case needs a recorded run — affects: none
DRIFT: run case `rate-limited` added beside the plane's cases — an exhausted 429 is its own outcome — affects: none
DRIFT: rate-limit record paths drop the gateway cloud id — they land in sync-state.json — affects: none
DRIFT: plan-sync row keeps the old core cell and appends the sync-back clause — 31.2/31.3 contract tests pin the old string — affects: none
DRIFT: check_tracking reads an unreadable config as not-bound with a detail — a non-UTF-8 config would crash the drift check — affects: none
DRIFT: 31-5 and 31-7 plan against `last_run.reason`, the sync-back result's top-level `case` (incl. `rate-limited`), and `applied[].fields` = `["external.jira.status"]` when the Jira name changes but the canonical status does not — consult ruled these a seam later stories rely on — affects: 31-5, 31-7

## Consult Log

- 2026-10-24T20:46:16Z — trigger: deviation-gt-0 — question: accept the pass-1 additive deviations (last_run.reason, result case, rate-limited, external.jira.status refresh) and at what score? — ruling: accept-deviation score 2 — do: keep the additions as built and set score 2; add one sentence to the 0.1.26 tracking-plane clause naming the last_run record {at, status, case, counts, newest_comment, reason} and the rate-limited case (read as ok/stale, never a ninth plane case); add a DRIFT line telling 31-5/31-7 to plan against them — rule candidate: When a deviation adds a field or enum value to a record the contract exposes and names a later story in "may affect", score it 2 and add the value to the in-flight contract clause in the same story; no consult needed.
- 2026-10-24T20:51:52Z — trigger: high-severity-finding — question: patch the stale-snapshot round-trip defect in apply_statuses here, and how to treat the job stop.on_status blocked never firing? — ruling: apply — do: (1) patch apply_statuses to refresh snapshot status and canonical_status when local already equals mapped but the snapshot's canonical_status differs, with a promote-makes-no-transition test; (2) option (b): leave execute_core and the job's stop as Settled shape 5 pins them and defer the runner-wide core-status mapping to the ledger; reject (a) and (c) — rule candidate: A finding that would change jobrun outcome mapping or a shipped job's stop semantics is deferred as a cross-job runner seam; a finding that breaks the story's own pinned AD-5 round-trip in code the story creates is patched in-story with a test.
- 2026-10-24T20:58:54Z — trigger: deviation-gt-0 (pass 2) — question: accept the pass-2 deviations (plan/index.md regeneration, KEY_RE-dropped issue holds the cursor, run case error)? — ruling: accept-deviation score 2 ((a) accept score 1, (c) accept score 2, (b) reject) — do: keep the index regeneration (the plan Risks line is recorded as superseded here in the Deviation Summary instead of editing plans/31-4.md, which lies outside this session's write scope); keep case error and set the score to 2; revert (b): a KEY_RE-dropped issue goes to notes[] and the cursor advances, and drop "or a dropped non-Jira key" from driver-contract.md and syncback.py — rule candidate: Hold the cursor only for a skip that a later tick can recover once an operator acts; a skip that is the same on every re-read goes in notes[] and the cursor advances.

### pass 2 (2026-10-24, implementer review patches)

- planned: plan Risks "plan/index.md and the projection follow at the next sync; sync-back writes entity files only" / actual: a non-dry-run tick that changed a status regenerates plan/index.md (local-only), named in written[] / why: review finding (FR14) / may affect: none
- planned: an issue dropped by KEY_RE is a note / actual (after consult revert): unchanged — a note, cursor advances / why: consult rejected the cursor hold / may affect: none
- planned: Settled shape 4 names no case for a non-network request error / actual: run case `error` (non-5xx 4xx other than 404/410, search 400, MAX_PAGES), read by the plane by age and status / why: review finding; unreachable must mean connection error or 5xx / may affect: 31-5, 31-7

DEVIATION SCORE: 2 (consult)

DRIFT: sync-back regenerates plan/index.md (local-only) after a tick that changed a status — FR14 keeps the index on the canonical files — affects: none
DRIFT: run case `error` added for non-network request errors, documented in the 0.1.26 clause beside rate-limited — unreachable must mean connection error or 5xx — affects: 31-5, 31-7
DRIFT: 429 waits capped at 30 s each and 90 s per client, then RateLimited at once — an unbounded Retry-After would hit the job's 300 s guard before last_run is written — affects: none

### pass 3 (2026-10-24, implementer follow-up review patches)

- planned (review brief P1): re-map whenever `canonical_status(name, category)` differs from the snapshot's canonical_status / actual: re-map only when the Jira name is in `SETUP_STATUSES` / why: one Jira category covers several canonical statuses (`review` is promoted as `In Progress` and its snapshot keeps `review`); the broad rule flipped such entities on every pull and failed 5 AD-5 round-trip tests. The SETUP_STATUSES names are the only ones where name-first mapping differs from the old category mapping / may affect: none
- planned (review brief P3): compare the whole provenance header / actual: when the page has a new version since the last mirror, `title`/`url` are left out of the comparison and `version` is checked against state / why: a remote rename arrives with a new version and is not a local edit / may affect: none

DEVIATION SCORE: 0 for this pass. Both items refine the review brief, not the story, an AD or the contract. The frontmatter keeps 2 from passes 1–2.

### pass 4 (2026-10-24, implementer follow-up 2 review patches)

- No deviation from the patch brief. Every change is inside the plan's Files list, and the contract stays at 0.1.26 (the Story 31.4 clause and the §6 text were extended). One note: the P1 and P2 sentences in §6 clarify how the plane reads an existing `last_run.case`. They add no plane case, field or enum value.

DEVIATION SCORE: 0 for this pass. The frontmatter keeps 2 from passes 1–2.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of the committed 31-4 sync-back. The Blind Hunter and the Edge Case Hunter reviewed the plugin diff since the baseline. Five low-severity patches were applied:
- The tracking plane reads `unreachable` only for a failed preflight.
- The `stale` fix names a recent tick's recorded failure instead of saying "has not ticked".
- The contract and the SKILL text now name three sync-back behaviours they had left out.
- A lost sync-state no longer reports an unedited mirror as overwritten.
- Two contract-named paths now have tests.

**Files changed (this pass).**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: `check_tracking` reads `unreachable` only from a blocked run, and a recent non-complete tick names its outcome in the `stale` detail and fix.
- `plugins/tk-studio/lib/syncback.py`: `_mirror_edited` skips version, title and url when the page has no state entry.
- `plugins/tk-studio/contracts/driver-contract.md`: three behaviours added to the 0.1.26 (Story 31.4) clause and the plan-sync row: a preflight `error` ends blocked, a missing space_id ends partial, the comment overflow is the only per-issue GET. The two plane-reading sentences added to §6.
- `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md`: the same three behaviours.
- `plugins/tk-studio/lib/tests/test_drift_check.py`, `test_syncback.py`, `test_job.py`, `test_driver_contract.py`: the tests and asserts named in the Review Triage Log.

**Review findings breakdown.** Patches applied: 5 (high 0, medium 0, low 5). Deferred: 0. Rejected: 7, with reasons in the Review Triage Log. The existing stop.on_status deferral is unchanged, and the deferred-work ledger was not touched.

**Follow-up review recommendation.** `true`. The patched counts are high 0, medium 0, low 5, and the score is 3 × 0 + 1 × 5 = 5, which meets the threshold of 5. No patched finding was high, and every one was a contract-text, plane-reading or test-coverage refinement.

**Verification.**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: 1687 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `sync-back --directory .` with the agent variables unset: `blocked`, exit 2. It names the absent `planning.jira` binding and makes no call.
- `drift_check.py --directory .`: the `tracking` plane is `ok` / `not-bound`.
- `git grep -n -E "ATATT3|_TOKEN=[^ ]"`: only pattern text in the plans and specs, plus an existing fake fixture in `test_installer_apps.py`. No token value.
- `git status --porcelain` before the commit: only plan Files plus this spec.

**Residual risks.**
- The stop.on_status deferral still stands: a core's self-reported `blocked` never stops the job, and one crash stops the timer.
- A live tick is unverifiable here. The operator runs `uv run plugins/tk-studio/lib/plansync.py sync-back --directory <project> --dry-run`, then the same without `--dry-run`, then the rate-limit header probe (kb §2 Q3).


## Reconcile

### 2026-10-24 — adjust-stories

- Score: 2
- Reasoning: Every deviation is additive. The consult accepted them at score 2 and put them into the 0.1.26 clause in this story, so none contradicts an AD, the contract or a ruling. Two later stories were planned against the bare canonical status. Both setup statuses map to canonical `blocked`, so the owner's move from `Blocked - Awaiting User` to `Block Resolved` (and back) leaves canonical `status` unchanged. It shows only in `external.jira.status`, with `applied[].fields` = `["external.jira.status"]`. Separately, a tick can now end `rate-limited` or `error`, with `last_run.reason`. Notes in `invoke_dev_with` can absorb both. No acceptance criterion changes.
- Affected: 31-5-the-two-statuses-and-the-inbox-items — "the office shows a persistent "!" bubble … cleared when the status changes" and "derives `inbox_item {… state: open | resolved | validating}` for every issue in that status". Canonical `status` stays `blocked` through Block Resolved, so both must read `external.jira.status` by name.
- Affected: 31-7-validation-of-a-resolution — "Given an issue in `Block Resolved` When the sync-back sees it". The tick reports it only as `applied[].fields` = `["external.jira.status"]`, never as a canonical status change.
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 31-5-the-two-statuses-and-the-inbox-items
