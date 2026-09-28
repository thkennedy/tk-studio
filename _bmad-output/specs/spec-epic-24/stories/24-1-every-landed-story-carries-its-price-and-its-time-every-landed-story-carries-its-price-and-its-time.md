---
title: 'Every Landed Story Carries Its Price and Its Time'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
baseline_revision: 'c3eda5c17f8406f1698f8eb7432b50528551da0b'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-24/plans/24-1.md'
  - '{project-root}/kb/execution-pipeline-model-routing.md'
warnings: [oversized]
deferred: []
---

# Every Landed Story Carries Its Price and Its Time

<intent-contract>

## Intent

**Problem:** Mixed-model routes can't be priced from the v2 weighted-token counters, because they assume one price. On the sbx engine the transcripts live only inside the microVM. Routes can't be judged on dollars and wall-clock time. (Story 24.1, `_bmad-output/planning-artifacts/epics.md` "### Story 24.1", Canonical ST-076.)

**Approach:** At the landed-story boundary (`post_commit`), a studio-side meter does three things. It copies the story's session and subagent transcripts into the run dir. It prices them against a committed, dated, sourced price table. It records one `observation` per story.

**Acceptance criteria (verbatim from epics.md Story 24.1):**

- AC1: **Given** a bmad-loop run on the sbx engine **When** a story reaches its boundary **Then** the session transcripts and subagent transcripts for that story are copied out of the microVM into the run's directory in the mounted checkout (gitignored), so they reach the host and its nightly backup.
- AC2: **Given** a story's transcripts and a committed price table (model id → input, output, cache-write 5-minute, cache-write 1-hour and cache-read $ per MTok, with the table's date and source; the figures are the sourced table in `kb/execution-pipeline-model-routing.md`, ruled 2026-09-28) **When** the meter prices the story **Then** it reports dollars per model and per leg (session, implementer, reviewers, consult, seam, review, triage, supervise), the story's wall-clock from first dispatch to landed commit, its attempt count, and the route in force (from `routing.current.json`); a model missing from the price table is a named refusal, never a guessed price.
- AC3: **Given** a priced story **When** the meter records it **Then** one `observation` event per story lands in this machine's ledger, carrying the story key, route, dollars, wall-clock and attempts, and the lib suite pins the pricing arithmetic, the missing-price refusal, and a mixed-model story.

## Boundaries & Constraints

**Always:** Stdlib-only Python run via `uv run` (NFR9). Atomic writes. The CLI ends with a JSON status block (AD-11): `{"ok": false, "error": …}` and exit 2 on refusal. The ledger write goes only through `observe.record_observation` → `ledger.emit` (AD-12), and happens only after pricing succeeds. Dedupe usage by `message.id` before summing. Every price comes from `prices.json`, which is transcribed from the kb table with its date, source and `derived` flags. Unknown legs go to a named `unknown` bucket, never folded silently into another leg. The hook always exits 0, so a meter failure never blocks the run.

**Block If:** A structured (numeric-field) `observation` payload turns out to be required. That would change `taxonomy.v1.json` and `driver-contract.md`, a contract surface under AD-19.

**Never:** Modify the bmad-loop engine or import it (AD-2). Use the journal's `tokens` / `tokens_weighted` for dollars. Guess a price or a multiplier outside the kb table. Change `policy.toml`, run retention, `taxonomy.v1.json` or `.gitignore`. Retro-price Epic 20 (that is Story 24.2's call). Commit real transcripts or fixtures copied from them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Arithmetic | 1M each of input, output, cache-write 5m, cache-write 1h, cache-read on one model, fixture table | total = the sum of the five rates exactly | none |
| Duplicate lines | several lines sharing one `message.id` | counted once | none |
| Missing price | a transcript model absent from the table | `ok:false`, the error names the model, no dollars reported, no observation emitted | exit 2 |
| Mixed model | dev session on model A, implementer subagent on model B | per-model and per-leg dollars each sum to the total | none |
| No TTL split | usage with `cache_creation_input_tokens` and no `cache_creation` object | priced at the 5m rate, story flagged `ttl_unknown` | none |
| Timing | another story's journal lines interleaved | wall-clock = this key's first `session-start` → its `story-done`; attempts from `state.json` `tasks[key].attempt` | none |
| Copy-out | session + `subagents/agent-*.jsonl` + `.meta.json` | land under `<run_dir>/transcripts/<key>/<task_id>/` | a `transcript_path` that no longer exists is listed by name in `missing_transcripts` |
| Idempotent | meter re-run for the same story | no second observation (`transcripts/<key>/metered.json` marker) | none |
| Seam/supervise | no such sessions | legs present with `0` | none |

</intent-contract>

## Code Map

The investigation is `plans/24-1.md` ## Code Map, verified against run `20260928-090746-8360` and re-checked for this spec. The essentials:

- `<run_dir>/events/<ts>-<task_id>-<Event>.json`: `session_id` and `transcript_path`. `task_id` = `<story_key>-<role>-<n>` (`dev`, `review`, `triage`). Subagents live at `<transcript stem>/subagents/agent-*.jsonl` plus `agent-*.meta.json` (`agentType`, `description`, `model`).
- Usage: assistant lines with `message.usage`, `message.model`, `message.id`. The fields are `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
- `<run_dir>/journal.jsonl`: `ts` in epoch seconds and `kind` ∈ `session-start` (`story_key`, `role`, `model`), `story-done` (`commit`), …. `<run_dir>/state.json` → `tasks[<key>].attempt`.
- `<repo_root>/.bmad-loop/routing.current.json`: leg objects with `model`. Record the leg→model map.
- `.bmad-loop/plugins/studio-pipeline/plugin.toml`: copy the `[hooks.pre_commit]` shape (`uv run --no-project python "{scripts}/…"`, `blocking = false`, `fail_closed = false`) into `[hooks.post_commit]`. The env carries `BMAD_LOOP_RUN_DIR`, `BMAD_LOOP_RUN_ID`, `BMAD_LOOP_REPO_ROOT` and `BMAD_LOOP_STORY_KEY`. `post_commit` fires only for landed stories.
- `plugins/tk-studio/lib/observe.py:30` `record_observation(source, description, evidence, project)`: use `source="other"`.
- `plugins/tk-studio/lib/tests/test_observe.py:22-40`: `TK_STUDIO_HOME` tempdir isolation and the ledger read-back pattern.
- `kb/execution-pipeline-model-routing.md:107-139`: the sourced price table (5 models, derived-column notes, the `claude-haiku-4-5` bare alias, the `ttl_unknown` rule).
- `.gitignore:6` already ignores `.bmad-loop/runs/`. Conformance (`contracts/conformance/runner.py:73`) enumerates only `skills/*/SKILL.md`, so `manifest.json` is **not** touched.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/prices.json` (new): `{"date": "2026-09-28", "source": "<kb source line>", "aliases": {"claude-haiku-4-5": "claude-haiku-4-5-20251001"}, "models": {"<id>": {"input", "output", "cache_write_5m", "cache_write_1h", "cache_read", "derived": [<derived column names>]}}}` in $ per MTok, exactly the kb table. Cache writes are derived for every model. Cache reads are derived for all but Opus 5.5 and Fable 5.1.
- `plugins/tk-studio/lib/meter.py` (new): `collect(run_dir, story_key)` copy-out; `price(...)` → per model, per leg, total, `ttl_unknown`; timing and attempts; route; `record(...)` → one observation plus the idempotence marker. CLI: `meter.py story --run-dir D --story-key K [--repo-root R] [--prices P] [--no-record]` prints one JSON object. Leg attribution lives in one function (see Design Notes).
- `.bmad-loop/plugins/studio-pipeline/meter_hook.py` (new): resolves the studio root (`TK_STUDIO_ROOT`, else `BMAD_LOOP_REPO_ROOT` when it holds `plugins/tk-studio/lib/meter.py`), runs `meter.py story` from the hook env, prints its JSON, and always exits 0.
- `.bmad-loop/plugins/studio-pipeline/plugin.toml` (modify): add `[hooks.post_commit]` and a header comment line for it.
- `plugins/tk-studio/lib/tests/test_meter.py` (new): one test per I/O Matrix row, with inline fixtures in a tempdir run dir, a fixture price table and `TK_STUDIO_HOME` isolation. Also a test that `prices.json` holds the five kb models with `date` and `source`.

**Acceptance Criteria:**
- Given a fixture run dir with events, journal, state and transcripts, when `meter.py story` runs, then the transcripts sit under `<run_dir>/transcripts/<key>/<task_id>/` and the JSON reports `usd_total`, `usd_by_model`, `usd_by_leg` (all eight legs plus `unknown` when non-zero), `wall_clock_s`, `attempts`, `route`, `prices_date` and `ttl_unknown`.
- Given a priced story, when it is recorded, then the ledger holds exactly one `observation`. Its `source` is `other`. Its description starts `meter:` and holds `story=<key> route=<leg:model,…> usd=<total> usd_by_model=<…> usd_by_leg=<…> wall_clock_s=<n> attempts=<n>`. Its `evidence` is the project-relative transcripts dir.
- Given AC1's sbx-boundary behaviour, when the operator's next landed story runs, then `<run_dir>/transcripts/<key>/` exists on the host. This is `unverifiable-here` beyond the plugin.toml hook and the live smoke below.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 1, medium 2, low 4)
- defer: 0
- reject: 5 (high 0, medium 1, low 4)
- addressed_findings:
  - `[high]` `[patch]` Dedupe kept the first line per `message.id`; real transcripts (78 cases) carry the final output_tokens on the last line. Now keeps the last line (live smoke $6.49 → $7.14).
  - `[medium]` `[patch]` Missing transcripts recorded partial dollars as though complete. The observation description now carries `missing_transcripts=<n>`.
  - `[medium]` `[patch]` Task ids with non-`[A-Za-z_]` labels (plugin workflow sessions) were silently dropped. Now parsed `^(.+)-\d+$` → named `unknown` leg.
  - `[low]` `[patch]` A partial `cache_creation` split left the remainder unpriced. The remainder is now priced at 5m and flagged `ttl_unknown`.
  - `[low]` `[patch]` The "Acceptance Auditor" layer mapped to implementer. `auditor` added to the reviewers pattern.
  - `[low]` `[patch]` Null wall-clock/attempts rendered as `None`. Now rendered `none`.
  - `[low]` `[patch]` Subagents were attached again per session when a task had two transcripts. Now attached once per task.
- rejected (one line each):
  - route not cross-checked against routing.current.json `story` → AC2 names routing.current.json as the source; there is no pinned key format to compare against.
  - transcripts gitignore unproven → `.gitignore:6` already ignores `.bmad-loop/runs/`.
  - meter_hook.py untested → plumbing (deferral discipline); the hook always exits 0 and its error paths were exercised by hand.
  - price-table date/source refusal untested → the committed table's date/source is pinned by test; refusal paths are plumbing.
  - marker not atomic with the ledger emit → the crash window between two local writes; emit-then-mark keeps a crash from ever losing the observation. Not a defect in normal operation.

### 2026-09-28 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both run), over `c3eda5c..` excluding `_bmad-output/`
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 4, low 1)
- defer: 0
- reject: 4 (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` Reviewer-layer and consult subagents launched from a review/triage session were billed to the parent leg (`review`), not `reviewers`/`consult`, although the workflow routes them to `route.reviewers.model`/`route.consult.model`. `leg_for` now classifies any known session's subagent by description first, and falls back to implementer (dev) or the parent leg (review/triage). Live smoke: reviewers 0.85 → 1.69, review 2.62 → 1.78, total unchanged.
  - `[medium]` `[patch]` The observation's project was the repo basename, which ignores AD-20. It is now `job.project_key(repo_root)`: the tracked `project_id`, else the basename, through `safe_name`.
  - `[medium]` `[patch]` The ledger record dropped `ttl_unknown`, although the kb ruling says "never silently". The description now ends ` ttl_unknown=<bool> prices_date=<date>`, and the marker carries `ttl_unknown`.
  - `[medium]` `[patch]` Non-standard `speed` (fast mode), `service_tier` or `inference_geo` were billed at table rates, which is a guessed price. They are now a named refusal (`<model> (speed=fast)`) on the missing-price path, with no dollars and no observation.
  - `[low]` `[patch]` A non-object price entry and a shallow run dir without `--repo-root` both crashed with a traceback. They now give the AD-11 JSON refusal and exit 2.
- rejected (one line each):
  - The observation lands in the microVM's `~/.tk-studio`, which is not host-mounted, while the marker sits in the mounted run dir. AC3 reads "this machine's ledger" and the meter runs on the VM. The per-machine ledger reaches shared storage through `tk-studio-measure-push`. The store's placement is pre-existing and affects every VM event. Carried as a residual risk.
  - A host re-run is blocked by the marker. The marker exists for AC3's "one per story", and no criterion names a host re-run.
  - Wall-clock includes time the run sat paused on escalation. AC2 defines wall-clock as first dispatch to landed commit, and the code matches that. Carried as a residual risk.
  - Standalone `prices_date` provenance note. Folded into the `ttl_unknown` patch; not a separate finding.

### 2026-09-28 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L, both run), over `c3eda5c..` excluding `_bmad-output/`
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 2, low 5)
- defer: 0
- reject: 2 (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Implementer relaunches from a review/triage session were billed to the parent leg. Real review-session descriptions ("Implementer: 24-1 review patches", "Apply review patches 20-2") are implementer work on `route.implementer.model`. `leg_for` now sends any known-role session's non-consult, non-reviewer subagent to `implementer`. Live smoke: review 1.78 → 1.39, implementer 1.30 → 1.69, total unchanged.
  - `[medium]` `[patch]` A refusal was named to nobody: the non-blocking hook's stdout is discarded and it exits 0. `meter.py` now writes `transcripts/<key>/meter-refusal.json` (`{ok, error, ts}`) atomically on refusal, and a later successful recording run removes it.
  - `[low]` `[patch]` Non-zero `server_tool_use.web_search_requests`/`web_fetch_requests` were priced at $0 (a guessed price). They are now a named refusal on the premium path. Zero counts (820/820 real records) price as before.
  - `[low]` `[patch]` The pre_commit gate session (declared `role = "review"`) priced under `unknown`. The journal's `session-start` `role` now overrides the task-id label.
  - `[low]` `[patch]` A malformed price table refused before copy-out, which loses AC1's transcripts. The order is now copy-out, then prices.
  - `[low]` `[patch]` Non-UTF-8 JSON, a non-object `aliases`, and a non-object `state.json` task crashed with a traceback. They now give an AD-11 JSON refusal, or `attempts` null.
  - `[low]` `[patch]` Only one of the five committed price rows was pinned. All five rows and the haiku alias are now pinned against the kb table.
- rejected (one line each):
  - A dev-session implementer described with hunter words ("Fix edge case hunter findings") would bill to reviewers. No real description matches, and the new test pins that the five real relaunch descriptions miss the reviewers regex.
  - A gate `task_id` truncated for story keys of about 98+ characters drops out of the prefix match. No story key is anywhere near that length (the engine caps segments at 120).

## Design Notes

- **Leg attribution:** one function. By session role, `dev` → `session`, `review` → `review`, `triage` → `triage`. For dev-session subagents, a `meta.json` `description`/`agentType` naming consult → `consult`, one naming a hunter/reviewer/review layer → `reviewers`, and anything else → `implementer`. A session role outside the three → `unknown`. `seam` and `supervise` report `0`.
- **Zero-usage records:** Claude Code's `<synthetic>` assistant lines carry all-zero usage. Skip zero-usage records before the price lookup, so they neither refuse nor cost anything.
- **Rounding:** compute in floats, and report dollars rounded to 6 decimals. Tests compare hand sums with `assertAlmostEqual`.
- **Wall-clock:** `story-done.ts` minus the key's first `session-start.ts`, in seconds. If either is missing, report `null`, never a guess.

## Verification

**Commands** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_meter tests.test_observe`: expected green.
- `uv run python -m unittest discover tests`: expected the full lib suite green.
- `uv run python ../contracts/conformance/runner.py run`: expected `ok: true`.
- Live smoke, read-only (no ledger write): `uv run python meter.py story --run-dir ../../../.bmad-loop/runs/20260928-090746-8360 --story-key 20-2-contract-0-1-18-names-the-supervisor-and-hermes --repo-root ../../.. --no-record`. Expected: `ok: true` with dev and review sessions priced on `claude-opus-5-5`. Then `git status --short` shows only the story's own files.

## Deviation Summary

None. Nothing was implemented; the run halted at planning.

### pass 1 (2026-09-28, implementer)

- planned: CLI JSON reports usd_total, usd_by_model, usd_by_leg, wall_clock_s, attempts, route, prices_date, ttl_unknown / actual: also reports story_key, tokens_by_model, transcripts_dir, copied, missing_transcripts, sessions (task/role/leg + subagent→leg), recorded, already_recorded / why: missing_transcripts is required by the matrix; the rest make leg attribution and idempotence auditable; observation description carries exactly the specified fields / may affect: 24-2
- planned: Design Notes attribute subagents only for dev sessions / actual: subagents of review/triage sessions inherit the parent leg (review/triage); unknown-role sessions and their subagents go to `unknown` / why: spec silent; keeps all spend in a named leg / may affect: none
- planned: a gone transcript_path is listed in missing_transcripts / actual: if a prior meter run already copied it into the run dir, the copy is priced and it is not listed / why: re-runs after the microVM transcripts are gone must still price / may affect: 24-2
- planned: no rule for no sessions or no routing.current.json / actual: no session events → refusal (exit 2); missing routing.current.json → route null (`route=none`), no refusal / why: spec silent / may affect: none
- planned: record_observation(..., project) with project unspecified / actual: project = repo root directory name / why: envelope needs a project key / may affect: none
- planned: copy [hooks.pre_commit] shape / actual: same shape with timeout_sec = 300 (not 60) / why: copy + price of several MB of transcripts can exceed 60s / may affect: none
- planned: usd_by_model keyed by model id / actual: bare alias claude-haiku-4-5 folds into claude-haiku-4-5-20251001 / why: one model, one key / may affect: none

DEVIATION SCORE: 1

DRIFT: meter CLI JSON carries extra audit keys (sessions, copied, missing_transcripts, tokens_by_model, recorded) — needed for the matrix's missing_transcripts row and for auditability — affects: 24-2
DRIFT: subagents of review/triage sessions attributed to their parent leg — spec named only dev-session subagents — affects: none
DRIFT: an already-copied transcript is priced from the run-dir copy, not reported missing — re-run after microVM loss must still price — affects: 24-2
DRIFT: post_commit hook timeout_sec 300 instead of pre_commit's 60 — transcript copy can exceed 60s — affects: none

### pass 2 (2026-09-28, implementer, review patches)

- planned: parse task label `^(.+)-\d+$`, never drop an id / actual: `_story_sessions` skips ids that start with `<longer_key>-` for another story key in state.json `tasks` that extends this key / why: a sibling story whose key extends this one would otherwise be priced here (double count) / may affect: none
- planned: parse task label `^(.+)-\d+$` / actual: an id with no `-<n>` suffix keeps its whole remainder as role → `unknown` / why: never drop an id / may affect: none

DEVIATION SCORE: 1

DRIFT: meter skips task ids belonging to a longer sibling story key — prefix matching would double-count sessions — affects: none
DRIFT: an unsuffixed task label goes to the unknown leg instead of being dropped — the spec forbids silent drops — affects: none

### pass 3 (2026-09-28, implementer, follow-up review patches)

- planned: leg_for maps only dev-session subagents by description; review/triage subagents stay on their parent leg (pass-1 DRIFT 2) / actual: every known-role session's subagent is classified first (consult → consult; hunter/reviewer/auditor → reviewers); only the fallback differs (dev → implementer, review/triage → parent leg) / why: reviewer and consult subagents run on their own routed legs whatever session launches them (follow-up review patch 1). Supersedes pass-1 DRIFT 2 / may affect: 24-2
- planned: observation description `story … attempts … missing_transcripts` / actual: appended ` ttl_unknown=<bool> prices_date=<date>` / why: the kb ruling says `ttl_unknown` is never silent in the story record / may affect: 24-2
- planned: premium-modifier refusal named as `<model> (speed=fast)` / actual: carried inside the existing missing-price refusal / why: one refusal path. The consult ruled `apply`: it conforms and is not a deviation / may affect: none

DEVIATION SCORE: 1

DRIFT: subagents of review/triage sessions are classified by description before falling back to the parent leg (supersedes the pass-1 parent-leg rule) — reviewer and consult subagents run on their own routed models — affects: 24-2
DRIFT: observation description gains trailing ttl_unknown and prices_date fields — the kb ruling forbids a silent ttl_unknown — affects: 24-2

### pass 4 (2026-09-28, implementer, follow-up review 2 patches)

- planned: a review/triage session's non-consult, non-reviewer subagent stays on the parent leg (pass-3 DRIFT) / actual: it goes to `implementer` for any known-role session / why: the review step relaunches the implementer on `route.implementer.model` (follow-up-2 patch 1) / may affect: none (consult ruling)
- planned: none / actual: a refusal writes `transcripts/<key>/meter-refusal.json`, which a later successful recording run removes / why: the non-blocking hook discards stdout, so AC2's named refusal must be visible somewhere / may affect: none (consult ruling)
- planned: a later success removes the refusal file / actual: only a recording success removes it, and a `--no-record` success leaves it / why: no observation exists yet, so the refusal still holds / may affect: none
- planned: write the refusal file whenever the run dir and key are known / actual: write it only when the run dir holds `journal.jsonl` or `events/` / why: a bad `--run-dir` must not get a `transcripts/` tree / may affect: none
- planned: role parsed from the `task_id` label / actual: the journal's `session-start` `role` wins when present, and `sessions[].role` shows it / why: the gate session is declared `role = "review"` / may affect: none
- planned: premium-modifier refusal only / actual: non-zero web search/fetch counts refuse on the same path; other `server_tool_use` keys are ignored / why: never a guessed price / may affect: none

DEVIATION SCORE: 1 (the implementer reported 2; the consult ruled `accept-deviation score 1`)

DRIFT: a non-consult, non-reviewer subagent of a review/triage session is billed to implementer (replaces the pass-3 parent-leg fallback) — the review step relaunches the implementer on route.implementer.model — affects: none
DRIFT: a refusal writes transcripts/<key>/meter-refusal.json — the non-blocking hook discards stdout, so a named refusal must survive the run — affects: none

## Consult Log

- 2026-09-28T09:37:59Z — trigger: halt — question: AC 2 needs a committed price table with cache-write (and cache-read) $/MTok per model, but the repo states cache-read only for Opus 5.5 and no cache-write for any model (plans/24-1.md:65 Block If); halt, or commit a table with null fields? — ruling: escalate — do: HALT blocked at planning; do not commit prices.json with null fields, and do not derive any figure from a multiplier convention. List what the operator must supply, with source and date. On re-drive, build the meter, copy-out and lib tests against a fixture table, and commit the real table only from the operator's figures. — rule candidate: Any story AC that needs an external pricing or vendor fact not stated in the repo gets a planner Block If that escalates before dispatch, and the launch bootstrap refuses to seed that story until SPEC open questions tagged as facts are answered. (observation recorded, ok)

- 2026-09-28T09:41:02Z — trigger: halt — question: story file is status ready-for-dev but holds no intent contract (prior run halted at planning, operator since answered in c3eda5c); route to step-02 as draft, step-03 literally, or HALT? — ruling: apply — do: treat ready-for-dev as stale, read as draft, run step-02 on this same file keeping Deviation Summary and Consult Log append-only; let step-02's ready gate set status, HALT blocked 'spec failed ready-for-development standard' if it fails after one repair; price tests against a fixture table and commit prices.json only from kb/execution-pipeline-model-routing.md with derived flags and source line — rule candidate: A run that halts at planning writes status blocked (or draft once answered), never ready-for-dev; step-01 routes any story file without Tasks & Acceptance to step-02 whatever its status.

- 2026-09-28T09:47:19Z — trigger: deviation-gt-0 — question: accept the implementer's 7 deviations at score 1, or rescore to 2 because entries 1 and 3 name 24-2? — ruling: accept-deviation score 1 — do: record at score 1, continue to review, change nothing in meter.py or plugin.toml — rule candidate: a deviation's may-affect counts toward score 2 only when it changes a surface a later story's AC names (for the meter: the observation description / ledger record); extra CLI JSON keys stay score 1 unless a later AC reads that JSON.

- 2026-09-28T09:52:35Z — trigger: deviation-gt-0 — question: accept pass-2 deviations (longer-sibling-key skip; unsuffixed label → unknown) at score 1, or reject? — ruling: accept-deviation score 1 — do: keep both behaviours, log at score 1 may-affect none, keep test_longer_story_key_tasks_not_claimed and test_plugin_workflow_task_id_priced_under_unknown as the pins — rule candidate: when matching sessions to a story by task-id prefix, exclude ids that start with a longer state.json story key plus `-`, and route unparseable labels to the named unknown leg; both local, no consult needed.

- 2026-09-28T10:01:26Z — trigger: deviation-gt-0 — question: implementer reported score 1 because the premium-modifier refusal (`claude-opus-5-5 (speed=fast)`) rides inside the existing missing-price refusal rather than a separate error; accept at 1, count as 0, or reject? — ruling: apply — do: keep the single refusal path in meter.py; record it as conforming, not a deviation, and close patch 5 with `test_fast_speed_is_named_refusal_and_emits_nothing` as the pin — rule candidate: When an instruction's example string appears verbatim in the implemented error and every stated requirement is pinned by a test, the implementer reports conforming and does not raise deviation-gt-0. (observation recorded, ok)

- 2026-09-28T10:13:29Z — trigger: deviation-gt-0 — question: follow-up-2 patches changed the review/triage fallback leg to implementer and added `transcripts/<key>/meter-refusal.json`; the implementer scored 2 (24-2 may plan against them). Accept, at what score, or reject? — ruling: accept-deviation score 1 — do: record (A), (B) and the four local items at DEVIATION SCORE 1 with "may affect: none"; change nothing in meter.py; log (A) as a DRIFT that replaces the pass-3 review/triage parent-leg fallback / keep test_review_session_implementer_relaunches_billed_to_implementer, test_later_successful_run_removes_stale_refusal, test_refusal_file_write_failure_keeps_printed_refusal, test_web_search_requests_is_named_refusal_and_emits_nothing and test_zero_server_tool_counts_price_normally as the pins; continue to review — rule candidate: Changes that move spend between legs but keep the total and the observation description format, and new run-dir files that no later AC reads, are score 1 by default; score 2 only when a later story's AC names usd_by_leg or that file. (observation recorded, ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was the second follow-up review of the landed meter. Both layers re-reviewed `c3eda5c..` (excluding `_bmad-output/`), and 7 patches were applied:

- Implementer relaunches from review and triage sessions are billed to `implementer`.
- A refusal leaves `transcripts/<key>/meter-refusal.json` in the run dir.
- Web search and fetch request counts are a named refusal, not a $0 price.
- The journal's `session-start` role drives leg attribution.
- Copy-out runs before the price table loads.
- Three more traceback paths now give the AD-11 JSON refusal.
- All five committed price rows are pinned against the kb.

The story's behaviour is otherwise unchanged. At `post_commit` the meter copies transcripts into the gitignored run dir, prices them per model and leg from the sourced 2026-09-28 table, times and counts attempts, and records one `meter:` observation per story. The observation description format is unchanged.

**Files changed (this pass):**
- `plugins/tk-studio/lib/meter.py`: `leg_for` falls back to implementer for every known-role session; a new `_state_tasks` guard; the journal role wins over the task label; the server-tool refusal; copy-out comes before `load_prices`; `aliases` validation; `ValueError` is caught on reads; the refusal file is written and cleared.
- `plugins/tk-studio/lib/tests/test_meter.py`: 14 new or changed tests pin each patch (test_meter goes from 34 to 48 tests), and three old parent-leg pins now expect `implementer`.

**Files of the story overall:** `meter.py`, `prices.json` and `tests/test_meter.py` (all under plugins/tk-studio/lib), plus `.bmad-loop/plugins/studio-pipeline/meter_hook.py` and `.bmad-loop/plugins/studio-pipeline/plugin.toml`.

**Review:** 7 patches applied (high 0, medium 2, low 5), 0 deferred, 2 rejected (see the Review Triage Log, follow-up 2).

**Follow-up review:** recommended (true). Patched high = 0, medium = 2, low = 5; score 3×2 + 5 = 11 ≥ 5.

**Consult:** one, on `deviation-gt-0`. The implementer reported 2; the ruling was `accept-deviation score 1` (see the Consult Log).

**Verification:**
- `uv run python -m unittest tests.test_meter tests.test_observe` → 53 tests OK (implementer).
- `uv run python -m unittest discover tests` → 792 tests OK (re-run independently by this session).
- `uv run python ../contracts/conformance/runner.py run` → `ok: true` (re-run independently).
- Live smoke on run 20260928-090746-8360 / story 20-2 (`--no-record`, re-run independently) → `ok: true`, usd_total 7.144789 (unchanged), ttl_unknown false. By leg: session 2.367775, implementer 1.692096, reviewers 1.693262, review 1.391655, others 0. The $0.39 that moved is the review session's "Implementer: apply 20-2 review patches" subagent.
- `git status --short` before the commit: only `meter.py`, `test_meter.py` and this spec.

**Unverifiable here:** AC1 at a real sbx boundary. After the next landed story, the operator checks it on the host with `ls .bmad-loop/runs/<run_id>/transcripts/<story_key>/`, then inside the sandbox with `grep '"meter:' ~/.tk-studio/measurements/*.jsonl`. If a story refused, the reason is in `transcripts/<story_key>/meter-refusal.json`.

**Residual risks:**
- Refusals raised inside `meter_hook.py` itself (studio root unresolved, missing env, subprocess timeout) still leave no refusal file. Patch 2 covers only `meter.py`.
- On sbx the `meter:` observation lands in the microVM's `~/.tk-studio`, which is not host-mounted. It survives sandbox removal only if the operator first runs `uv run plugins/tk-studio/lib/measurepush.py push --directory /c/GitHub/tk-studio` from the sandbox.
- Wall-clock includes any time the run sat paused on escalation, per AC2's definition.
- Leg attribution is a description heuristic, with the unknown leg named.
- Run retention (`run_retention = 10`) may archive run dirs before the nightly backup sees them.

DRIFT: meter CLI JSON carries extra audit keys (sessions, copied, missing_transcripts, tokens_by_model, recorded) — needed for the matrix's missing_transcripts row and for auditability — affects: 24-2
DRIFT: subagents of review/triage sessions are classified by description (consult, reviewers) before falling back — reviewer and consult subagents run on their own routed models — affects: 24-2
DRIFT: an already-copied transcript is priced from the run-dir copy, not reported missing — a re-run after microVM loss must still price — affects: 24-2
DRIFT: post_commit hook timeout_sec 300 instead of pre_commit's 60 — transcript copy can exceed 60s — affects: none
DRIFT: meter skips task ids belonging to a longer sibling story key — prefix matching would double-count sessions — affects: none
DRIFT: an unsuffixed task label goes to the unknown leg instead of being dropped — the spec forbids silent drops — affects: none
DRIFT: observation description gains trailing ttl_unknown and prices_date fields — the kb ruling forbids a silent ttl_unknown — affects: 24-2
DRIFT: a non-consult, non-reviewer subagent of a review/triage session is billed to implementer (replaces the pass-3 parent-leg fallback) — the review step relaunches the implementer on route.implementer.model — affects: none
DRIFT: a refusal writes transcripts/<key>/meter-refusal.json — the non-blocking hook discards stdout, so a named refusal must survive the run — affects: none
