---
title: 'Every Stage Leaves a Start and a Stop'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '4a6c742e6bbf6991b1a5e9eab18cb8a09792382b'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-8.md'
  - '{project-root}/plugins/tk-studio/contracts/driver-contract.md'
warnings: ['oversized']
deferred:
  - summary: >-
      `measurepush.py push` harvests Stage Log rows only from the studio repo it is given, so rows in other registered project roots never become `stage` events.
    evidence: |-
      harvest_stages(directory) is called with the push's single --directory (the studio repo root); AC3 says a stage event carries each row. Deferral class (a): behaviour the criteria name.
    location: >-
      plugins/tk-studio/lib/measurepush.py:300
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A story's stages (plan, dev, each review pass, each consult, the gate, the host leg and its re-runs, the close-out, the merge) leave no start/stop record with model, effort, tokens and cost; the EP-34 retro had to infer stage times from PR timestamps, and the ledger's `job-run` line carries one cost per run.

**Approach:** One append-only `## Stage Log` table in the story's executor spec, written by the engine hook (per pass), the supervisor (its legs, at the plan pull-back) and the operator (`plansync.py stage --start|--stop`); the supervisor mirrors each row to the story's Jira issue as start/finish comments plus a worklog; `measurepush.py push` carries each row as a `stage` ledger event; a report verb rolls them up per story and epic beside Jira's stamps.

**User story (epics.md §Story 35.8, verbatim):** As the owner, I want every stage of a story's life (its planning, the dev pass, each review pass, each consult, the gate, each host leg, the close-out and the merge) to log its start and stop with the model, the effort and the tokens it used, in the story's own document and mirrored as timestamped comments on the story's Jira issue, So that I can read how long each epic, story and stage takes and what it costs the way I would read a developer's timesheet, with Jira's server clock as the cross-check against any box's clock.

**Acceptance criteria (epics.md §Story 35.8, transcribed):**

- **AC1.** Given a story run by the loop, When a stage starts and when it stops (the planner's plan, the dev pass, review pass 1, 2, 3 …, each consult, the gate; then the supervisor's host leg and each of its legs, a re-run, the close-out, the merge), Then the story's spec file carries a `## Stage Log` table with one row per stage occurrence: `stage`, `pass`, `started`, `ended` (ISO-8601 UTC from the clock of whoever ran it), `session_id`, `model`, `effort`, `tokens_in`, `tokens_out`, `cost_usd` (when metered), `outcome`; the engine's hook (`.bmad-loop/bmad_loop_hook.py`, the studio-pipeline gate plugin) writes the rows it runs from bmad-loop's own per-pass session records (the stream's usage lines summed at pass end), the supervisor appends its legs through the plan pull-back after the merge, the operator's planning stage is a row the planning session writes by hand through `plansync.py` (`stage --start | --stop`); elapsed is never stored, only derived; a gap between a stop and the next start is reported as a gap, never hidden.
- **AC2.** Given a project bound to Jira (`planning.jira`, `plansync.py setup`; tk-studio is the first), When a stage row is written, Then the supervisor (never the sandboxed engine) posts one comment on the story's Jira issue at the start (`Stage <name> [pass n] started — <engine timestamp>; model: X; effort: Y`) and one at the stop (`… finished — <engine timestamp>; model: X; effort: Y; tokens: in/out; cost: $Z`), so the comment's server-side `created` stamp is the external clock and `created` minus the body's own timestamp measures relay lag and clock skew; a worklog with the derived span is added at the stop; a post that fails is retried on the next tick and never blocks the run (the row in the doc is the record of truth); the epic's issue gets a rollup comment at the retro.
- **AC3.** Given the ledger and the retro, When `measurepush.py push` and `tk-studio-report` run, Then a `stage` event (taxonomy extended additively) carries each row to the ledger, the report verb rolls them up per story and per epic (cycle time from the first start to the merge, hands-on time as the sum of the spans, the planning share, review rounds, re-runs, tokens and cost per stage type) beside Jira's own numbers with the skew named, the retrospective reads the rollup instead of PR timestamps, and the contract (0.1.30 or the next, additive) names the table, the comment shapes and the event; conformance drives the table writer and the comment poster with fakes.

## Boundaries & Constraints

**Always:**
- Settled shape (SPEC design notes CAP-17/18, plan §Settled shape): `## Stage Log` sits after `## Consult Log` (created there, or at the end of the file before `## Auto Run Result` if absent — never after it); rows append only; the engine's clock for its rows, the host's for the supervisor's; the comment body carries the row's own timestamp; one row per stage occurrence; the planning stage of a story is the planner-tier plan session; the epic's planning is one row on the epic's plan entry.
- The sandboxed engine never calls Jira; the supervisor posts through the agent seat (`TK_ATLASSIAN_AGENT_*`, gateway, by name only — AD-3/NFR5), idempotent by a row key in the comment body, retried next pass, never blocking a run.
- Stdlib-only Python under `uv run` (NFR9); atomic writes; every headless verb ends in the JSON status block (AD-11); nothing in the plugin imports a driver or the supervisor (AD-2).
- Every surface change additive on the contract at 0.1.30 (AD-19): a `**0.1.30 (Story 35.8, additive).**` paragraph and the header clause extended; conformance green.
- Every hook path exits 0 (non-blocking, like `meter_hook.py`); a stage-log failure never fails a pass.

**Block If:**
- bmad-loop's `post_session` hook stage turns out not to fire for declarative plugin hooks (no per-pass boundary reachable) — HALT, the AC1 engine path would have no source.

**Never:**
- Store elapsed/duration in the table or the event (the worklog's `timeSpentSeconds` is derived at post time, the secondary record).
- Name a ledger payload key with `token` in it (`ledger._CREDENTIAL_KEY_RE` redacts it, `meter.py:79-81`); the event uses `usage {input, output}`.
- Edit `epics.md`, canonical plan files by hand, `stories.yaml`, `.bmad-loop/routing.toml|policy.toml`; push, tag, release, or bump the contract past 0.1.30.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Engine pass ends | `post_session`, story spec exists | one row appended (stage from role/phase: dev / review n / gate; plan), consult subagents found in the session's transcripts each add a `consult` row | any failure: hook exits 0, stderr note |
| Spec not yet written | plan session ends / `stage --start` before the spec exists | row buffered in `<spec_folder>/stages/<key>.jsonl`, flushed (by key, started order) into the table on the next write | — |
| Duplicate write | same row key written twice | table unchanged (`appended: 0`) | — |
| Operator start/stop | `stage --start` then `--stop` same story+stage | `--start` appends a row `ended: —`, `outcome: running`; `--stop` completes that open row (the only in-place change) | `--stop` with no open row: `ok:false` refusal naming it |
| Supervisor rows | merged PR pulled back to `done` | host-leg / re-run / close-out / merge rows appended to the served checkout's spec, model/effort/tokens `—` | plansync failure: queue event, retried next pass |
| Jira post ok | Jira-bound, unposted row | start comment, stop comment, worklog at stop; `_bmad-output/tracking/stage-posts.json` records ids + `created` | — |
| Jira post fails | gateway 5xx/auth | `stage-post` queue event `ok:false`; next pass retries; run state untouched | never throws |
| Lost post state | state file missing, comment already on issue | marker `[stage:<row key>]` found via GET comments → not re-posted | — |
| Not Jira-bound | no `planning.jira` | rows written, nothing posted (`posted: skipped: not bound`) | — |
| Gap | stop at t1, next start at t2>t1 | report lists `gap <t1>..<t2>` between those rows | — |

</intent-contract>

## Code Map

- `.bmad-loop/plugins/studio-pipeline/plugin.toml` -- declarative only; has `[hooks.pre_commit]`, `[hooks.post_commit]` (meter_hook.py). **Outside the plan's Files**: needs `[hooks.post_session]` (bmad-loop `plugins/manifest.py:39` accepts any stage) — a recorded deviation.
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` -- `_studio_root(env)`, `main()` runs `meter.py story` via `sys.executable` (:58); exits 0 always. Add the stage path when `BMAD_LOOP_STAGE=post_session` (invokes `plansync.py stage --from-pass`).
- `.bmad-loop/bmad_loop_hook.py` -- relay: writes `<run>/events/<ns>-<task_id>-<Event>.json` `{ts, event, task_id, session_id, transcript_path, cwd}`; the session-id/transcript join source. Touch only if needed.
- bmad-loop 0.9.1 (read-only, `~/.local/share/uv/tools/bmad-loop/.../bmad_loop/`): `engine.py:~3607` journal `session-end {task_id, status, tokens}`, `:3657` emits `post_session` (role, session_status); `plugins/bus.py:77 _hook_env` gives `BMAD_LOOP_STAGE|RUN_ID|RUN_DIR|REPO_ROOT|WORKTREE|STORY_KEY|ROLE|PHASE` (no task/session id); `model.py:93 SessionRecord {task_id, role, status, model, session_id, transcript_path, usage}` in `state.json tasks.<key>.sessions[]`; journal `session-start`/`session-end` lines carry `ts` → started/ended.
- `plugins/tk-studio/lib/meter.py` -- reuse: `_usage_records` (:338), `_tokens` (:376), `price` (:423, `prices.json`) for tokens/cost; `_story_sessions` (:200) event-file join; subagent transcripts layout used by `collect` (:226).
- `.bmad-loop/routing.current.json` -- effort per leg (`implementer` for dev, `reviewers` for review/gate, `consult`, `planner`).
- `.bmad-loop/plugins/studio-pipeline/consult.md` -- first line `# Consult: a ruling on one objective trigger`: the marker identifying a consult subagent transcript.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`, `gate.md` -- planner's plan instructions (add the `stage --start/--stop --stage plan` calls); gate never edits the Stage Log.
- `plugins/tk-studio/lib/plansync.py` -- CLI `main` :2069, subparsers :2075–2110, dispatch :2116–2141 (JSON out, exit 0/2); `status_pull_back` :786. Add verbs `stage` (`--start|--stop|--append|--from-pass`) and `stage-post`.
- `plugins/tk-studio/lib/jirabackend.py` -- `JiraClient` :346 (injectable `transport`), `client_for` :945, `_resolve_settings` :871, `add_comment` :1209, scopes :1022, `external.jira.key` in entity frontmatter (:840–846). Add `add_worklog`, `list_comments` (module is plansync's jira backend; include it with plansync).
- `plugins/tk-studio/lib/syncback.py:57` -- `TRACKING_REL = _bmad-output/tracking` precedent for `stage-posts.json`.
- `apps/supervisor/src/planstatus.ts` -- `mergePass` :330 (per terminal run, `callStatus(dir, id, "done")` on MERGED); `planEntity` :212, `specKey` :159, `callStatus` :233 shells plansync; `record(...)` queue events. Add `stagePass` (rows + post), called at the end of `mergePass`.
- `apps/supervisor/src/hostverify.ts` -- `HostVerifyRan` :96 (`duration_ms`, `Date.now()` :329–334), `LegHistoryEntry` :691; add `started_at` (additive) so the leg row has a real start stamp.
- `apps/supervisor/src/hostleg.ts` (`rerunHostLeg` :228), `worktree.ts` (`closeOut` :548), `closeout.ts` (`jiraBound` :413) -- leg/close-out timestamps from queue events (`QueueEvent.at`, `queue.ts:511`).
- `apps/supervisor/test/fakes.ts` -- `fakePlansync()` :126, `fakeGh`; tests `apps/supervisor/test/planstatus.test.ts`, `hostverify.test.ts`.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- entry shape `{emitter, payload{field:{type, required, enum?, note?}}}`; `ledger.validate` :75 rejects unknown fields; `ledger.emit` :201.
- `plugins/tk-studio/lib/measurepush.py` -- `push`; add the stage-row harvest (emit `stage` per new row key, before the push).
- `plugins/tk-studio/lib/observe.py` -- `record_observation` :35 pattern for an emit helper.
- `plugins/tk-studio/skills/tk-studio-report/scripts/report.py` (61 lines, emits a `report` event) + `SKILL.md`; no `lib/report.py` exists — create `plugins/tk-studio/lib/report.py` (the plan's Files name) with the rollup verb.
- `plugins/tk-studio/contracts/driver-contract.md` -- header :5 (0.1.30 clause), `**0.1.30 (Story 35.1, additive).**` :1531, `## 8. Conformance` :1600. `lib/tests/test_driver_contract.py` `test_0_1_30_story_35_1_rerun_whole_leg` :2408 pins the header.
- `plugins/tk-studio/contracts/conformance/manifest.json` + `e2e_*.py` drives (e.g. `e2e_asset_manifest.py`) under `cli_drives`; `runner.py _run_drive` :210.
- Tests: `lib/tests/test_plansync.py`, `test_jirabackend.py` (`FakeJira` :43 transport), `test_meter.py` (`usage_line` :40), `test_nested_root.py:406` (imports meter_hook).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/plansync.py` -- the Stage Log writer: parse/render the table (columns exactly AC1's, `—` for empty), row key `sha1(story|stage|pass|started)[:12]` derived from the row, never a column (no table change beyond AC1's columns), append-only insert after `## Consult Log` (else before `## Auto Run Result`, else end), pending buffer `<spec_folder>/stages/<key>.jsonl`; spec resolution `--story <key>` → `_bmad-output/specs/*/stories/<key>-*.md` (exactly one, else refusal), `--entity <id>` → plan entity file (the epic's planning row). Verbs: `stage --start|--stop --story|--entity --stage --pass --model --effort [--session-id] [--outcome]`; `stage --append --story --row-json` (supervisor); `stage --from-pass --run-dir --story --role --phase --worktree` (hook: joins `state.json` sessions + journal ts + transcripts, sums usage via `meter._tokens`, prices via `meter.price`, review pass = count of that story's prior review sessions + 1, gate when phase/stage is `pre_commit_gate`, consult rows from subagent transcripts whose first user message starts with the consult.md marker); `stage-post --directory --story --id [--dry-run]` (Jira poster: start comment, stop comment, worklog; marker `[stage:<key> start|stop]` in body; state in `_bmad-output/tracking/stage-posts.json` `{key:{start:{id,created}, stop:{id,created}, worklog:{id}}}`; GET comments before posting to dedupe; not bound → skipped). All end in the JSON status block.
- `plugins/tk-studio/lib/jirabackend.py` -- `add_worklog(client, key, started, seconds, comment)` (`POST /issue/{key}/worklog`, Jira `started` format `YYYY-MM-DDTHH:MM:SS.000+0000`), `list_comments(client, key)`; scopes as needed.
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` + `plugin.toml` -- `[hooks.post_session]` → `meter_hook.py`, which on `BMAD_LOOP_STAGE=post_session` runs `plansync.py stage --from-pass` and exits 0 on every path; post_commit behaviour unchanged.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`, `gate.md` -- planner brackets its plan with `plansync.py stage --start/--stop --stage plan`; gate.md: the Stage Log is append-only, never hand-edited.
- `apps/supervisor/src/hostverify.ts` -- `started_at` ISO on `HostVerifyRan` (additive).
- `apps/supervisor/src/planstatus.ts` -- `stagePass(queue, deps)`, run at the end of `mergePass`: for each terminal run with a `plan-status` `done ok` event, build rows from its queue events (each `host-verify` leg → `host-leg` pass 1 for the close-out leg, `re-run` pass n for `rerun` legs; `close-out`; `merge` at `mergedAt`), `plansync.py stage --append` into the owner root's spec, then when `jiraBound(root)` `plansync.py stage-post`; record one `stage-post` queue event `{story_key, appended, posted, ok, detail}`; retry on later passes until an `ok:true` `stage-post` exists; never throws.
- `apps/supervisor/test/planstatus.test.ts`, `hostverify.test.ts` -- fakes (`fakePlansync`, `fakeGh`): rows appended after merge, post retried after a failure, run state untouched, `started_at` present.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- `stage` event, emitter `measurepush`: `project, story, stage, pass, started, ended, session_id, model, effort, usage{input,output}, cost_usd, outcome, row_key, source` (required: story, stage, started, row_key).
- `plugins/tk-studio/lib/measurepush.py` (+ `observe.py` helper if used) -- before `push`, harvest every spec's Stage Log rows (completed rows only) and emit a `stage` event per row key not yet in the ledger.
- `plugins/tk-studio/lib/report.py` (new) + `skills/tk-studio-report/SKILL.md` (+ script delegation if natural) -- `rollup --directory (--story <key> | --epic <N>) [--post --id <epic entity>]`: per story and epic cycle time (first start → merge ended), hands-on (sum of spans), planning share, review rounds, re-runs, gaps listed, tokens and cost per stage type, Jira stamps from `stage-posts.json` with per-boundary skew (`created − body ts`) and the max named; `--post` adds one idempotent rollup comment to the epic's issue; JSON status block. SKILL.md: the retrospective reads this rollup instead of PR timestamps.
- `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md`, README rows -- document `stage` and `stage-post`.
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- header clause extended; `**0.1.30 (Story 35.8, additive).**` paragraph after 35.1's naming the table (columns, place, append-only, buffer), the comment shapes, the worklog, `stage-posts.json`, the `stage` event, the verbs; pin it in a new test, keep 35.1's tests green.
- `plugins/tk-studio/contracts/conformance/e2e_stage_log.py` + `manifest.json` -- drive the writer (start/stop/append/from-pass over a fixture run dir with usage lines; idempotent; buffer flush) and the poster over an in-process fake Jira transport (two comments + worklog, dedupe, failure → retry ok); `cli_drives` entry.
- `plugins/tk-studio/lib/tests/test_stage_log.py` (new) -- unit tests of the I/O matrix rows.

**Acceptance Criteria:**
- Given a fixture run dir (state.json sessions, journal ts, transcripts with usage lines, one consult subagent), when the hook's `stage --from-pass` runs for dev, review, review, gate, then the spec carries rows `dev 1`, `review 1`, `review 2`, `consult 1`, `gate 1` with summed tokens and cost, and no elapsed column (AC1; lib test + conformance).
- Given `plansync.py stage --start` then `--stop` for `plan`, then the row is open then completed; given the supervisor's `stage --append` rows, then they land after the engine rows (AC1).
- Given a fake Jira, when `stage-post` runs, then the start and finish comments match AC2's shapes with the marker, a worklog carries the derived span, a second run posts nothing, and a failing transport yields `ok:false` with the row unposted and a later run posting it (AC2; conformance).
- Given rows and `stage-posts.json`, when `report.py rollup --epic 35` runs, then the JSON names cycle time, hands-on, planning share, review rounds, re-runs, gaps, tokens/cost per stage type and the skew (AC3).
- Given rows, when `measurepush.py push` runs (dry/local), then one valid `stage` event per completed row key lands and a second run adds none (AC3).
- The supervisor's merge → `stagePass` path appends rows and posts with fakes; a post failure does not change the run's state and is retried (AC1/AC2; `bun test`).

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- layers: blind-hunter + edge-case-hunter (band L); CONTENT handed as the diff file `/tmp/review-35-8/diff.patch` (3446 lines) rather than inlined
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 2high, medium 7medium, low 2low)
- defer: 1: (high 0high, medium 1medium, low 0low)
- reject: 4: (high 0high, medium 2medium, low 2low)
- addressed_findings:
  - `[high]` `[patch]` stage-post answered ok with rows only buffered / spec stale at the owner root and the story was never retried: `unposted` + `awaiting[]`, `partial` + `retryable` while pending; supervisor records ok only at zero unposted; a newer host-verify re-enters the story
  - `[high]` `[patch]` planner's plan row buffered at the project root never reached the worktree table: `stage --from-pass --repo-root` flushes the repo-root buffer; meter_hook passes `BMAD_LOOP_REPO_ROOT`; unit + e2e `two-roots`
  - `[medium]` `[patch]` stage lease claimed/released every tick forever: retries bounded at `PLAN_RETRY_LIMIT`, one settled give-up
  - `[medium]` `[patch]` permanent refusals retried forever: refusals settled once, only `retryable` failures retried
  - `[medium]` `[patch]` pending work read before the lease: re-read under `claimPlanPhase`
  - `[medium]` `[patch]` busy-queue `closed_out` + `ended` produced two close-out rows: one row per close-out record
  - `[medium]` `[patch]` nested `apps/supervisor/.bmad-loop` plugin had no post_session hook: `[hooks.post_session]` added, nested meter_hook a pinned byte copy
  - `[medium]` `[patch]` gate pass miscounted from labels: `_session_stage` classes every session by the same evidence
  - `[medium]` `[patch]` hands-on double-counted nested consult spans: excluded, reported as `nested_s`/`nested[]`
  - `[low]` `[patch]` 60 s worklog floor logged unworked time: spans <60 s skip the worklog (`skipped: span <60s`), comments still post
  - `[low]` `[patch]` `rollup --post` untested: three tests (once by marker, not bound, failing Jira)
- rejected: skew measures time-since-merge (AC2 itself names relay lag; posting after the pull-back is the settled shape); supervisor rows uncommitted in the owner checkout (same path as the plan status pull-back, which plansync never commits); legacy `JIRA_API_TOKEN` fallback (the existing `client_for` precedent, not the owner seat); cross-machine duplicate `stage` events (`row_key` is the consumer's dedupe key; ledgers are per machine)

### 2026-10-29 — Review pass (follow-up)
- layers: blind-hunter + edge-case-hunter (band L); CONTENT handed as the diff file `/tmp/rev-35-8/diff.patch` (4315 lines, baseline..HEAD excluding `_bmad-output`)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1high, medium 4medium, low 1low)
- defer: 0
- reject: 5: (high 0high, medium 3medium, low 2low)
- addressed_findings:
  - `[high]` `[patch]` stage pass counted buffered-only appends (the spec not yet at the owner checkout, which the supervisor never fast-forwards) toward `PLAN_RETRY_LIMIT` and settled a give-up, stranding the supervisor rows and the whole Jira mirror: buffered outcomes are now an uncounted, never-settled wait, lease-free while no `_bmad-output/specs/*/stories/<key>-*.md` exists at the owner root (`ownerSpecPresent`); bun tests over 26 ticks (consult: accept-deviation score 1)
  - `[medium]` `[patch]` `measurepush.py push` died with a traceback when the stage harvest raised (non-UTF-8 spec, read error, ledger rejection): harvest guarded, error recorded under `stage_events`, push continues; `stage_documents`/`stage_rows` skip an undecodable spec; two tests
  - `[medium]` `[patch]` `report.py rollup` escaped the AD-11 status block on a non-`JiraError`/read fault: generic catch ends `blocked`; two tests
  - `[medium]` `[patch]` close-out after a re-run spanned from the old host-leg end (overlapping the re-run; a second close-out got a zero span): a re-run also sets `legEnd`; bun test for both orders
  - `[medium]` `[patch]` AC3 "the retrospective reads the rollup" was documentation only: `_bmad/custom/bmad-retrospective.toml` persistent fact directs the retro to `report.py rollup --epic <N>` (consult: accept-deviation score 1, file outside Files)
  - `[low]` `[patch]` plan-sync SKILL.md gave `stage-post` only `complete`/`blocked`: names `partial` while rows are unposted
- rejected: an open row never stopped has no close (`stage --stop` closes it; the open row is the truthful record a stop never came, AC1's "never hidden"; retries stay bounded); the epic planning row has no supervisor post (AC2 posts on the story's issue, the epic's issue gets the rollup comment; the row is hand-written per AC1 and `stage-post --id <EP>` posts it); nested-project Stage Logs not harvested (the same single-root cause as the open DW-96, not re-filed); supervisor rows uncommitted in the owner checkout (rejected in the first pass, same path as the plan status pull-back); missing agent token / `external.jira.key` refusals settled (configuration refusals, not a failed post; drift check names them; a newer host-verify re-enters)

### 2026-10-29 — Review pass (second follow-up)
- layers: blind-hunter + edge-case-hunter (band L); CONTENT handed as the diff file `/tmp/rev3-35-8/diff.patch` (4516 lines, baseline..HEAD `61212ab84eaf6fb929c7cc07c8f0135e4382b627` excluding `_bmad-output`)
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 2high, medium 4medium, low 1low)
- defer: 0
- reject: 2: (high 0high, medium 1medium, low 1low)
- addressed_findings:
  - `[high]` `[patch]` one run resolves several stories and the same run-level supervisor rows (host-leg / re-run / close-out / merge) land in every done story's table, so the epic rollup counted their spans, re-runs and by-stage totals once per story: `rollup_epic` keeps one copy of each supervisor occurrence (stage, pass, started, ended) and runs one rollup over the epic's rows; per-story rollups and tables unchanged; contract + report SKILL sentence; test (3 stories, one re-run → epic `reruns: 1`, host-leg seconds once) (consult: apply)
  - `[high]` `[patch]` `stageTodo` owed every terminal run with a `plan-status done ok` event, so the first tick after deploy would back-fill every run merged since 27.5 (old specs modified, zero-span host-leg rows, comments and worklogs on closed TKSTUDIO issues): `mergePass` marks its `done` events `stage: true`, the stage pass owes only marked events, pre-35.8 runs are never back-filled; README Events list + Stage Log bullet, contract paragraph; bun test (unmarked done → no lease, no gh, no append, no post) (consult: apply)
  - `[medium]` `[patch]` a story's `plan` row made inside another story's gate (gate.md Part B) was counted twice at epic level and inflated planning share: the `_container` nesting rule applies across the epic's stories (into `nested_s`, out of `planning_s`); test
  - `[medium]` `[patch]` the contract (0.1.30 Story 35.8 paragraph) and README still called buffered-only rows a retry with a give-up, while the code makes them an uncounted, never-settled, lease-free wait: both texts match the code; `test_driver_contract.py` pins the wait phrase and the old phrase's absence
  - `[medium]` `[patch]` a paused close-out (recorded on the `paused` transition, `worktree.ts:961`) left no `close-out` row (AC1 one row per occurrence): `supervisorRows` reads `paused` events carrying `closeout`, same dedupe and `legEnd`; bun test (paused close-out + relaunch close-out → two rows)
  - `[medium]` `[patch]` AC2 "the epic's issue gets a rollup comment at the retro" had no wiring: the retro persistent fact runs `report.py rollup --epic <N> --post` and reports the `post` result verbatim (a blocked post is a reported gap, never a stop)
  - `[low]` `[patch]` no test drove `measurepush.py push` itself to emit `stage` events (AC3 names push): `test_push_emits_one_stage_event_per_completed_row_then_none`
- rejected: cross-machine duplicate `stage` events for the same git-tracked rows (rejected in the first pass: `row_key` is the consumer's dedupe key, ledgers are per machine); the gate's planning usage is metered under the `gate` row and the hand-written `plan` row carries no tokens (the gate is one bmad-loop session, the per-pass record AC1 names; inline planning usage has no separate source to split)

## Design Notes

- Comment bodies (AC2 shapes, marker appended): `Stage review [pass 2] started — 2026-10-28T23:41:00Z; model: claude-opus-5-5; effort: medium [stage:ab12cd34ef56 start]` and `Stage review [pass 2] finished — 2026-10-28T23:52:10Z; model: claude-opus-5-5; effort: medium; tokens: 812345/10234; cost: $1.23 [stage:ab12cd34ef56 stop]`. `[pass n]` omitted when the stage has no pass number.
- `tokens_in` = input + cache-read + cache-creation tokens (everything prompt-side); `tokens_out` = output tokens; `cost_usd` from `meter.price`, `—` when unpriced.
- Supervisor rows: model/effort/tokens/cost `—` (the host leg runs no model); started/ended from the host clock (`started_at`/`recorded_at`, queue event `at`, gh `mergedAt`).
- Posting happens after the pull-back (the doc row is the truth); the comment's `created` minus the body timestamp is the measured relay lag + skew.
- `unverifiable-here`: the live TKSTUDIO posting and the epic rollup comment run on the operator's box: `uv run plugins/tk-studio/lib/plansync.py stage-post --directory <root> --story 35-8-every-stage-leaves-a-start-and-a-stop --id ST-153` and `uv run plugins/tk-studio/lib/report.py rollup --directory <root> --epic 35 --post --id <EP id>`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && bun test` -- expected: 0 fail

## Deviation Summary

### pass 1 (2026-10-29, implementer)

- planned: `[hooks.post_session]` in `plugin.toml` / actual: added / why: the Code Map names it outside the plan's Files / may affect: none
- planned: files named in the Code Map / actual: re-rendered `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` and `gate.md` via `tools/restructure/nest_pipeline.py` / why: `test_nest_pipeline` requires the supervisor copy to equal the render of the root copy / may affect: none
- planned: `--entity` writes the epic's planning row on the plan entity / actual: `normalize` also keeps a `## Stage Log` section when it refreshes an entity body from `epics.md` / why: otherwise the next normalize wipes the row; the table also reaches the Jira description through promote / may affect: later stories touching normalize or promote
- planned: `add_worklog`, `list_comments` / actual: also `list_worklogs` and an optional `who` arg on `issue_comments` / why: worklog dedupe after lost state / may affect: none
- planned: `stage-post --directory --story --id` / actual: `--story` optional (posts the `--id` entity's own table); `stage` verbs take `--dry-run`, `--directory` / why: posting the epic planning row; plansync verb convention / may affect: none
- planned: `stage-post` queue event `{story_key, appended, posted, ok, detail}` / actual: also `id`, `directory`, `merged_at`; an identical repeated failure is not re-recorded; the pass holds a `plan-lease {phase: "stage"}` / why: retry without another gh call, bounded event growth, no double posting across processes / may affect: none
- planned: rows as listed / actual: merge row has no pass; close-out row spans from the preceding leg to the close-out event; worklog span floor 60 s; `stage --start` refuses a second open row for the same stage+pass / why: choices left open by the spec / may affect: none
- planned: conformance drive under `cli_drives` / actual: under the `tk-studio-plan-sync` surface's drives (+ one sandbox refusal drive) / why: `cli_drives` only runs the meta-CLI's module drives / may affect: none
- planned: 35.1's tests unchanged / actual: 35.1's Stories-row check relaxed to `"Story 34.8 (Epic 34), Story 35.1"`; two planstatus tests filtered to `status` calls and review/done leases / why: the row now names 35.8 and the new stage pass adds calls and a lease / may affect: later Epic 35 stories that extend the Stories row
- planned: measurepush is "mover, not emitter" / actual: docstring names `stage` as the one event it emits / why: the spec makes measurepush the `stage` emitter / may affect: none

DEVIATION SCORE: 1

DRIFT: `[hooks.post_session]` added to studio-pipeline `plugin.toml` (outside the plan's Files) — the only per-pass boundary bmad-loop exposes to a declarative plugin — affects: none
DRIFT: supervisor-nested `task-planning.md`/`gate.md` re-rendered — `test_nest_pipeline` pins them to the root render — affects: none
DRIFT: `plansync.py normalize` preserves an entity's `## Stage Log` — the epic's planning row would otherwise be wiped on refresh — affects: later stories touching normalize/promote
DRIFT: `list_worklogs` + `issue_comments(who)` added to jirabackend — worklog dedupe after lost state — affects: none
DRIFT: `stage-post --story` optional; `stage` verbs take `--dry-run`/`--directory` — epic planning row posting, verb convention — affects: none
DRIFT: `stage-post` queue event carries `id`/`directory`/`merged_at`, dedupes identical failures, takes a `stage` plan-lease — bounded retries without double posting — affects: none
DRIFT: merge row passless, close-out span from the preceding leg, worklog floor 60 s, one open row per stage+pass — left open by the spec — affects: none
DRIFT: e2e drive under the plan-sync surface, not `cli_drives` — `cli_drives` runs only module drives — affects: none
DRIFT: 35.1 contract-test Stories-row check relaxed; two planstatus tests filtered — the row now names 35.8, the stage pass adds calls — affects: later Epic 35 stories extending the Stories row
DRIFT: measurepush docstring names `stage` as its one emitted event — spec makes it the emitter — affects: none

### verify (pass 1, orchestrator)

- lib suite: 2388 tests OK (skipped=2); conformance: ok true (22 surfaces, 155 checks, failures []).
- supervisor `bun test` (TK_ATLASSIAN_* unset): 21 failures, the identical set at baseline `4a6c742e6bbf6991b1a5e9eab18cb8a09792382b` in a throwaway worktree; no new failure.
- Matrix test audit: every I/O row covered by `lib/tests/test_stage_log.py` (20 tests) or `apps/supervisor/test/planstatus.test.ts` "Story 35.8" describe; all ran green.

### review patch pass 2 (2026-10-29, implementer)

- planned: skip the stage claim when the failure is unchanged / actual: a lease per retrying pass, bounded at `PLAN_RETRY_LIMIT`, then one settled give-up; no claim until a newer `host-verify` / why: unchanged is unknowable without trying, AC2 retries next tick / may affect: none
- planned: refusals never retried / actual: a newer `host-verify` re-enters any settled story once per new leg / why: one rule for "something new is owed" / may affect: none
- planned: stage branch in the nested meter_hook / actual: nested `plugin.toml` gains `[hooks.post_session]`; nested `meter_hook.py` is a byte copy of the root (gains the 0.1.22 walk-up) / why: matching the root copy's behaviour; pinned by `NestedPipelineCopyTests` / may affect: none
- planned: stage-post reports the unposted count / actual: also `awaiting[]`; pending is `status: "partial"` / why: AD-11 status vocabulary / may affect: none
- planned: hands-on excludes nested spans / actual: adds `nested_s`, `nested[]` to the rollup / why: excluded time stays visible / may affect: none

DEVIATION SCORE: 1

DRIFT: stage-lease retries bounded at PLAN_RETRY_LIMIT with one settled give-up — an unchanged failure is unknowable without retrying — affects: none
DRIFT: a newer host-verify re-enters a settled story (refusals included) once per leg — one rule for new owed rows — affects: none
DRIFT: nested apps/supervisor studio-pipeline `plugin.toml` + byte-copied `meter_hook.py` (outside Files) — the nested engine would write no rows otherwise — affects: none
DRIFT: stage-post `partial` + `unposted` + `awaiting[]` — AD-11 vocabulary for a pending post — affects: none
DRIFT: rollup `nested_s`/`nested[]` — keeps excluded consult time visible — affects: none

### verify (review pass, orchestrator)

- lib suite: 2399 tests OK (skipped=2); conformance: ok true (155 checks, failures []); supervisor `bun test`: 21 failures, identical to the baseline set; no new failure.

### review patch pass 3 (2026-10-29, follow-up review, implementer)

- planned: buffered-only appends retried, bounded at `PLAN_RETRY_LIMIT` / actual: a buffered answer is a recorded wait (`waiting: true`), uncounted, never settled; `stagePass` takes no lease and makes no call while the spec is absent at the owner root; a wait-only tick releases the lease settled, restarting the retry window / why: consult ruling (waits on an operator pull are not failures a retry can change; `releasePlanPhase` is boolean-settled) / may affect: none
- planned: — / actual: the old "rows only buffered … retried" bun test rewritten to expect a recorded wait; existing stage-pass tests place the spec at the owner checkout first / why: the ruled behaviour replaces the retry semantics / may affect: none
- planned: AC3's retro clause met by SKILL.md / actual: new `_bmad/custom/bmad-retrospective.toml` (outside Files) / why: consult ruling; documentation alone leaves the clause unmet / may affect: none
- planned: — / actual: `plansync.stage_documents`/`stage_rows` skip a spec they cannot decode / why: the measurepush harvest guard; a bad spec must not stop the push / may affect: none

DEVIATION SCORE: 1

DRIFT: buffered-only stage waits are uncounted, never settled and lease-free (a wait-only tick releases the lease settled) — a give-up after 24 buffered ticks stranded rows and the Jira mirror until the owner pulled — affects: none
DRIFT: buffered-retry bun test rewritten to a recorded wait; stage-pass tests write the owner-checkout spec — the ruled behaviour replaces the old semantics — affects: none
DRIFT: `_bmad/custom/bmad-retrospective.toml` added (outside Files) — AC3's retro clause had no mechanism — affects: none

### verify (follow-up review pass, orchestrator)

- lib suite: 2403 tests OK (skipped=2); conformance: ok true, failures []; supervisor `bun test` (TK_ATLASSIAN_AGENT_* unset): 25 fail / 1496 pass, failure set byte-identical to clean HEAD `eb0d030` in a throwaway worktree in this environment (1494 pass / 25 fail there); `planstatus.test.ts` 37/0, `hostverify.test.ts` 58/0.

### review patch pass 4 (2026-10-29, second follow-up review, implementer)

- P1 `report.py` `SUPERVISOR_STAGES`, `_epic_spans`; `rollup_epic` runs one `rollup()` over the epic's deduped rows (`_merge_totals` removed, unused); module docstring; contract and report SKILL sentence; two tests in `test_stage_log.py`.
- P2 `planstatus.ts` `mergePass` writes `stage: true` on its `done` events; `stageTodo` owes only those; header, README, contract; one new bun test; three exact-match tests gain `stage: true`.
- P3 contract and README describe buffered rows as an uncounted wait; `test_driver_contract.py` pins the wait phrase and the new P1/P2/P4 phrases.
- P4 `supervisorRows` reads `paused` events carrying `closeout`; one bun test.
- P5 `_bmad/custom/bmad-retrospective.toml` runs the rollup with `--post` and reports the post result.
- P6 `test_measurepush.py` drives `push` over completed rows: 3 emitted, then 0.
- Implementer deviations: none reported. Every file touched was already in this story's change set.

DRIFT: the epic rollup counts each span once (the run's shared supervisor rows matched on stage, pass, started, ended; a span inside another story's engine span nested) — every multi-story run's epic hands-on, re-runs and by-stage totals were multiplied by its story count — affects: none
DRIFT: `plan-status` `done` events gain the additive `stage: true`, and the stage pass owes only marked events — owing every historical `done` would back-fill pre-35.8 runs into old specs and closed Jira issues — affects: none

### verify (second follow-up review pass, orchestrator)

- `uv run python -m unittest discover tests`: 2406 OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: ok true, failures [].
- `bun test test/planstatus.test.ts test/hostverify.test.ts` (bun on PATH): 97 pass, 1 skip, 0 fail.
- `bun test` (full, `TK_ATLASSIAN_AGENT_*` unset): 25 fail, the identical set by name as clean HEAD `61212ab` in a throwaway worktree.
- Note: without `~/.bun/bin` on PATH the fake binaries (`#!/usr/bin/env bun`) cannot start, and 17 planstatus tests fail at clean HEAD too. That is environmental.

## Consult Log

- 2026-10-29T00:27:21Z — trigger: deviation-gt-0 + file-outside-files — question: accept the ten pass-1 deviations and six files outside Files at score 1, or score 2 for normalize-preserves-Stage-Log / relaxed 35.1 Stories-row check? — ruling: accept-deviation score 1 — do: keep all ten deviations and six files at deviation_score 1; keep DRIFT lines (a) and (b); do not revert, run the gate as planned — rule candidate: a file outside Files is score 1 when the executor spec's Code Map pre-declared it or it is a test-pinned re-rendered mirror of a file in Files; a contract-test row check relaxed only to admit the current story's own row entry is score 1
- 2026-10-29T00:55:00Z — trigger: deviation-gt-0 + file-outside-files (review patch pass 2) — question: accept the five pass-2 deviations and the nested plugin.toml/meter_hook.py at score 1, score 2, or reject one? — ruling: accept-deviation score 1 — do: keep all five and the two nested files at deviation_score 1, do not revert; add a pass-2 block with five DRIFT lines affects: none; run the gate as planned — rule candidate: a deviation is score 1 when its only surface change is in the story's own additive contract paragraph, it uses published status words, and any file outside Files is a test-pinned byte/render mirror of a file in Files

- 2026-10-29T01:08:38Z — trigger: high-severity-finding (follow-up review) — question: stagePass counts buffered-only appends (spec not yet at the owner checkout) toward PLAN_RETRY_LIMIT and settles a give-up, stranding rows and the whole Jira mirror; patch, keep, or escalate? — ruling: accept-deviation score 1 — do: buffered-only outcomes are uncounted, never settled, and lease-free while no `<directory>/_bmad-output/specs/*/stories/<story_key>-*.md` exists; once it appears claim/append/post as today; bun test over >24 buffered ticks then spec appears → ok; DRIFT "buffered-only waits are uncounted and lease-free", affects: none — rule candidate: a supervisor retry bound counts only failures a retry could change; a wait on an operator action is polled each tick by a lease-free precondition check, never counted or settled
- 2026-10-29T01:08:38Z — trigger: file-outside-files (follow-up review) — question: meet AC3's "the retrospective reads the rollup" with a new `_bmad/custom/bmad-retrospective.toml` persistent fact (outside Files), or keep SKILL.md documentation + unverifiable-here? — ruling: accept-deviation score 1 — do: create `_bmad/custom/bmad-retrospective.toml` with one `[workflow] persistent_facts` entry directing the retro to `report.py rollup --epic <N>` for stage times, cycle, hands-on, planning share, review rounds, re-runs, tokens/cost per stage type (never PR timestamps; skip only when no Stage Log rows), header like bmad-build-auto.toml; record deviation score 1 affects none; drop the unverifiable-here note for this clause — rule candidate: when an AC requires a stock BMad skill to behave a certain way, the planner's Files include the matching `_bmad/custom/<skill>.toml` override; a SKILL.md mention alone does not meet the AC
- 2026-10-29T01:28:20Z — trigger: deviation-gt-0 (follow-up review patch pass 3) — question: accept the implementer's two pass-3 DRIFTs (a wait-only tick releases the stage lease settled, restarting the PLAN_RETRY_LIMIT window; the old buffered-retry test rewritten to a recorded wait) at score 1, or reject? — ruling: accept-deviation score 1 — do: keep both, record both DRIFT lines at deviation_score 1 affects: none; add the header clause "a tick whose only non-ok outcomes are waits lets the lease go settled, so the retry window starts again after it"; run the gate as planned — rule candidate: when a retry bound counts boolean-settled lease releases, a wait-only tick releases settled and restarts the window; score 1 local as long as any tick with a real retry still releases unsettled

- 2026-10-29T01:39:52Z — trigger: high-severity-finding (second follow-up review) — question: the epic rollup counts the run's shared supervisor rows (host-leg/re-run/close-out/merge, appended to every done story of a multi-story run) once per story, and a story's `plan` row lying inside another story's `gate` row twice; fix at the epic rollup, append supervisor rows to one story only, or reject? — ruling: apply — do: in `rollup_epic` count each supervisor occurrence (same stage, pass, started, ended) once across stories for hands_on_s, reruns and by_stage, and apply the `_container` nesting rule across the epic's stories (contained time to nested_s, not hands_on_s or planning_s); per-story rollups and tables unchanged; tests: 3-story run with one re-run gives epic reruns 1 and host-leg seconds once, Y's plan inside X's gate is nested at epic scope; one sentence in the 0.1.30 Story 35.8 contract paragraph and the report SKILL that the epic counts each span once; score as a seam fix (2) — rule candidate: any aggregate above story level counts each span once: rows copied into several stories' tables are matched on (stage, pass, started, ended), and a span inside another story's engine span counts as nested
- 2026-10-29T01:39:52Z — trigger: high-severity-finding (second follow-up review) — question: `stageTodo` owes every terminal run with a `plan-status done ok` event, so the first tick after deploy back-fills every run merged since 27.5 (old specs modified, zero-span host-leg rows, comments and worklogs on closed TKSTUDIO issues); back-fill history or only runs pulled back by a stage-capable supervisor, and with which cutoff? — ruling: apply — do: reading (2), cutoff (a): `mergePass` marks the `done` `plan-status` events it records with additive `stage: true`, `stageTodo` owes only `done ok` events carrying it, pre-35.8 done events never staged; README Events list gains `stage?`, the README Stage Log bullet and the contract's 0.1.30 Story 35.8 paragraph say "each run pulled back to `done` by a stage-capable supervisor (its `done` event carries `stage: true`); runs merged before 35.8 get no supervisor rows and are never back-filled"; a fake-backed bun test: a done ok event without `stage` gives no lease, no gh pr view, no stage --append, no stage-post, existing stage tests mark their done events `stage: true` — rule candidate: any new supervisor pass that keys on historical queue events is gated by a marker the new code writes (an additive event field or version), never by events written before it shipped; the story spec says "going forward" or "back-fill" explicitly

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| host-leg | 1 | 2026-10-29T02:32:40Z | 2026-10-29T02:32:40Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-10-29T02:32:40Z | 2026-10-29T02:32:47Z | — | — | — | — | — | — | PR |
| merge | — | 2026-10-29T02:34:45Z | 2026-10-29T02:34:45Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261028T233820Z-6a30c0` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review of the completed story. Both review layers ran over baseline `4a6c742e6bbf6991b1a5e9eab18cb8a09792382b`..HEAD `61212ab84eaf6fb929c7cc07c8f0135e4382b627`, and seven patches were applied:
- The epic rollup counts each span once. A run's shared supervisor rows are no longer multiplied by its story count, and a plan made inside another story's gate counts as nested.
- The stage pass owes only `done` events marked `stage: true`, so runs merged before 35.8 are never back-filled into old specs or closed Jira issues.
- A paused close-out gets its own `close-out` row.
- The retro posts the epic rollup comment (`--post`), as AC2 asks.
- The contract and README describe buffered rows as the uncounted wait the code implements.
- A test drives `measurepush.py push` itself to emit `stage` events.

**Files changed (this pass).**
- `plugins/tk-studio/lib/report.py`: epic dedupe of supervisor occurrences and cross-story nesting (`SUPERVISOR_STAGES`, `_epic_spans`, `rollup_epic`).
- `apps/supervisor/src/planstatus.ts`: `stage: true` on done events, `stageTodo` filter, paused close-out rows, header.
- `apps/supervisor/test/planstatus.test.ts`: the pre-35.8 no-back-fill test, the paused close-out test, `stage: true` in exact matches.
- `apps/supervisor/README.md`: Events field `stage?`, the Stage Log bullet (wait, paused, no back-fill).
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.30 Story 35.8 paragraph (wait, no back-fill, paused, epic counts each span once).
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: pins for the new phrases, and the old retry phrase's absence.
- `plugins/tk-studio/lib/tests/test_stage_log.py`: two epic rollup tests.
- `plugins/tk-studio/lib/tests/test_measurepush.py`: the push-emits-stage-events test.
- `plugins/tk-studio/skills/tk-studio-report/SKILL.md`: the epic counts each span once.
- `_bmad/custom/bmad-retrospective.toml`: the rollup runs with `--post` and its post result is reported.

**Review.**
- Patches applied: 7 (2 high, 4 medium, 1 low).
- Deferred: 0.
- Rejected: 2 (reasons in the Review Triage Log).
- Consults: 2, both `apply`.
- Follow-up review recommended: true (patched highs: 2; score 3×4 + 1×1 = 13).

**Verification.**
- `uv run python -m unittest discover tests`: 2406 OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: ok true, failures [].
- `bun test test/planstatus.test.ts test/hostverify.test.ts`: 97 pass, 0 fail.
- Full `bun test`: 25 fail, the same set by name as clean HEAD in this environment; none is new.

**unverifiable-here** (the operator runs these on the box that holds the agent seat):
- `uv run plugins/tk-studio/lib/plansync.py stage-post --directory <root> --story 35-8-every-stage-leaves-a-start-and-a-stop --id ST-153`
- `uv run plugins/tk-studio/lib/report.py rollup --directory <root> --epic 35 --post --id <EP id>`

**Residual risks.**
- An epic whose `done` pull-back was recorded by a supervisor older than this change gets no supervisor rows. That may include epic 35 itself, if the host supervisor is updated only after this run merges.
- With `--post`, `run_rollup` looks up the epic's plan entity before it checks the Jira binding. An unbound project with no `EP-*` entity therefore answers `blocked: no plan entity`, not `posted: skipped: not bound`. The retro reports that as a gap.
- The gate's planning usage is metered under `gate`, and the hand-written `plan` row carries no tokens.
- The `stage` harvest still reads only the given root (DW-96).
- The supervisor's bun tests need `bun` on PATH (`#!/usr/bin/env bun` fakes).

DRIFT: buffered-only stage waits are uncounted, never settled and lease-free (a wait-only tick releases the lease settled) — a give-up after 24 buffered ticks stranded rows and the Jira mirror until the owner pulled — affects: none
DRIFT: buffered-retry bun test rewritten to a recorded wait; stage-pass tests write the owner-checkout spec — the ruled behaviour replaces the old semantics — affects: none
DRIFT: `_bmad/custom/bmad-retrospective.toml` added (outside Files) — AC3's retro clause had no mechanism — affects: none
DRIFT: the epic rollup counts each span once (the run's shared supervisor rows matched on stage, pass, started, ended; a span inside another story's engine span nested) — every multi-story run's epic hands-on, re-runs and by-stage totals were multiplied by its story count — affects: none
DRIFT: `plan-status` `done` events gain the additive `stage: true`, and the stage pass owes only marked events — owing every historical `done` would back-fill pre-35.8 runs into old specs and closed Jira issues — affects: none

## Reconcile

### 2026-10-29 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is additive at 0.1.30 and no later story's acceptance criteria change. One later story was planned against files 35-8 changed. Unstarted 35-2's plan (written 2026-10-28, before 35-8 landed) places its contract paragraph before `## 8. Conformance` at `:1600`, but 35.8's paragraph now sits there (`## 8. Conformance` is at :1710). 35-2 also rewrites `task-planning.md` §1/§3/§4, where §3 now opens with the 35.8 Stage Log bracket, and it extends the contract-test Stories row that 35.8 now pins as `Story 35.1, Story 35.8 (Epic 35)`. The supervisor copy of `task-planning.md`, which `test_nest_pipeline` pins, is not in its Files. The `hostverify.ts` anchors in 35.3/35.6 shift by 3–4 lines (`started_at`): noise, not affecting. `normalize` keeping `## Stage Log` touches no later Epic 35 story.
- Affected: 35-2-every-story-gets-its-plan-and-its-records — plans/35-2.md: "The 35.1 paragraph runs :1531-1598; add `**0.1.30 (Story 35.2, additive).**` before `## 8. Conformance` (:1600)."
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 35-3-the-slice-path-hardened (replan queue 35-2 entry applied and closed; plan stage row buffered in stages/35-3-the-slice-path-hardened.jsonl)
