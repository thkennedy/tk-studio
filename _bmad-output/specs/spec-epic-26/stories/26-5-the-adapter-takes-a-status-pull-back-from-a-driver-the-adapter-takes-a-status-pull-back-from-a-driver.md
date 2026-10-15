---
title: 'The Adapter Takes a Status Pull-Back from a Driver'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '3436a6843bc899852614fb01d9ead034e8a78295'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-26/plans/26-5.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The canonical plan never learns that a loop landed a story in another repository (hole 18), and a driver may not write canonical frontmatter itself (AD-4, AD-5).

**Approach:** One new planning-adapter verb, `plansync.py status`: it sets a canonical story's `status`, stamps `updated`, records the caller and a note in an `external.driver` snapshot, then re-runs the existing `sync` so the projection and `plan/index.md` follow. The shape is settled in `plans/26-5.md` "Settled shape" items 1–4, which this spec adopts verbatim. Epic 27's supervisor calls it; calling it is a non-goal here.

User story (epics.md §Story 26.5): As a driver author, I want a planning-adapter verb that sets a canonical story's status-class fields from outside, So that the supervisor can mark stories `review` when a run opens its PR and `done` when the PR merges, without writing canonical frontmatter itself (AD-4, AD-5; hole 18; Epic 27 consumes it).

Acceptance criteria (transcribed verbatim):

- AC1: **Given** `plansync.py status --directory <root> --id ST-NNN --status <enum> [--note <text>]` **When** it runs on a project whose canonical entity exists **Then** it sets the entity's `status` to the given canonical enum value, stamps `updated`, records the note and the caller in the entity's `external.driver` snapshot (never touching `external.<backend>` snapshots), re-syncs the projection and the index, and names every written file in its result (AD-5: status-class only; a value outside the enum is a named refusal; an unknown id is a named refusal)
- AC2: **Given** a story that a loop landed in another repository (a transcribed epic) **When** the verb is called on the owning project with that story's canonical id **Then** it updates the canonical file there and nothing in the other repository, and the result says which plan it wrote
- AC3: **Given** the driver contract §4 **When** the story closes **Then** the verb is documented as additive (0.1.21), the conformance manifest drives it (a headless success and a refused id), the lib suite pins the enum, the snapshot and the projection re-sync, and `plan/index.md` reflects the change after a run

## Boundaries & Constraints

**Always:**
- Stdlib-only, `uv run`; atomic writes via `plansync._atomic_write`; every refusal is a `PlanSyncError` surfaced as `{"ok": false, "error"}` with exit 2 (never argparse `choices`).
- Status-class only (AD-5): the verb writes `status`, `updated` and `external.driver` on the entity, nothing else; every other `external.<name>` entry is left as it was by the verb's own write.
- The verb calls the existing `sync(root, dry_run)` as-is; it never re-implements normalize/projection/index.
- Only `--directory` is touched.
- Driver contract stays `**0.1.21**`: append a `0.1.21 (Story 26.5)` clause after the existing `0.1.21 (Story 26.3)` clause (inside the header's parenthesis, ending `— additive`), never reword or bump; add the §4 subsection `### Status pull-back (0.1.21, Story 26.5)`.
- Lib tests use temp dirs and make no network call.

**Block If:**
- A criterion needs an edit to `interchange.py`, `shape.v1.json`, `backlogmd.py`, `jirabackend.py`, the `tk-studio-plan-sync` skill, `epics.md`, `SPEC.md` or its companions, or `stories.yaml`.

**Never:**
- Run `plansync.py status` or `sync` without `--dry-run` against this repository's own `_bmad-output/`.
- Call the verb from any supervisor/driver; edit the §2 plan-sync row; append the 26-5 SPEC.md design-notes bullet (gate rule; it stays in the plan).
- Edit `normalize`'s sprint-status pull (l.411–425).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy | existing story, `--status review --note "PR #4"` | entity `status: review`, `updated` = `external.driver.synced_at`, snapshot per Settled shape 1, sync run, `written` = [entity, sync's written…] deduped, `plan_dir` set | exit 0 |
| Unchanged status | status already `review` | still writes (new `updated`/`synced_at`) | exit 0 |
| Bad enum | `--status merged` | `status 'merged' is not in the canonical enum (draft, ready, in-progress, blocked, review, done, dropped)` | exit 2, nothing written |
| Unknown id | `ST-999`, or plan dir absent | `unknown id ST-999: no canonical entity in <plan dir>` | exit 2, nothing written |
| Epic id | `EP-001` | `EP-001 is a epic, not a story — status takes a story id` (the entity's `type`) | exit 2, nothing written |
| Blank caller | `--caller "  "` | `caller must be a non-empty string` | exit 2 |
| Multi-line note | note containing `\n` or `\r` | `note must be a single line` | exit 2 |
| Sprint-status pin | `implementation-artifacts/sprint-status.yaml` maps the story to a different canonical status | `status of <ID> is pinned to '<s>' by <sprint-status path> — update that file or remove the entry` | exit 2, nothing written (DRIFT, see Design Notes) |
| Dry run | `--dry-run` | names what it would write; writes nothing | exit 0 |
| Blocked sync | jira binding without `planning.jira.site` | `ok: false`, `blocked: true`, sync `reason`, `written` still names the entity write | exit 2 |
| Cross-repo | owning root A, other repo B holding a transcribed `_bmad-output/specs/spec-epic-N/stories.yaml` + story file | only A's canonical file changes; B byte-identical; `plan_dir` under A | exit 0 |

</intent-contract>

## Code Map

Investigated in `plans/26-5.md` §Code Map at `ed352dc`; anchors re-confirmed at `3436a68`. Lib paths under `plugins/tk-studio/lib/`.

- `plansync.py` -- the verb lands here. Docstring CLI block l.47–50; `PlanSyncError` l.99; `plan_dir` l.103; `_now` l.111; `_atomic_write` l.115; `_load_sprint_status(impl_dir, notes)` l.288 (story `N.M` → canonical status; reuse for the pin check); `normalize` l.316 (sprint pull l.411–425 is the revert trap); `generate_plan_index` l.546; `sync` l.596 (blocked-jira returns normalize's `written`, l.636–642); `main` l.668 (subparsers normalize/sync/validate; JSON + exit 0/2; utf-8 stdout).
- `interchange.py` (read-only) -- `STATUS_VALUES` l.39; `EXTERNAL_REQUIRED` l.41 (`key`, `synced_at`, `content_hash` — the driver snapshot carries all three); `scan_entities`, `parse_entity`, `render_entity` (canonical key order, unknown keys kept).
- `backlogmd.py` (read-only) -- `_content_hash` l.109: sha256 hex of NUL-joined parts, the construction to mirror. Backends only touch `external[BINDING]`; `driver` is inert to them.
- `miniyaml.py` (read-only) -- a note with a newline does not round-trip (hence the single-line refusal).
- `../contracts/driver-contract.md` -- header l.5 (append after `0.1.21 (Story 26.3)` clause); §4 at l.174 (add subsection before `### KB-injection directive (0.1.7)` l.215 or at §4's end).
- `tests/test_driver_contract.py` -- 0.1.21 pins near l.178/l.206; add `test_0_1_21_status_pull_back_clause_and_section_4`.
- `../contracts/conformance/manifest.json` -- `tk-studio-plan-sync` surface (l.136–152); drive `cwd` = plugin root; `{sandbox}` = empty temp dir.
- `../contracts/conformance/runner.py` (read-only) -- `expect: json` accepts exit 0/2; `refusal` needs nonzero/`ok: false` + `marker`.
- `tests/test_plansync.py` -- `PlanSyncTestCase.setUp` l.72, `_plan_file`/`_front` l.84–89, `SyncTests` l.327 (backlog-md binding setup l.330), `CliTests._run` l.458.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/plansync.py` -- add `status_pull_back(root, story_id, status, note="", caller="tk-studio-plan-sync", dry_run=False)` per Settled shape 1–3 and the I/O matrix; add the `status` subparser (`--directory --id --status [--note] [--caller] [--dry-run]`) and dispatch; docstring CLI line + short paragraph -- AC1, AC2.
- `plugins/tk-studio/lib/tests/test_plansync.py` -- `StatusTests(PlanSyncTestCase)` covering every row of the I/O matrix: all seven enum values accepted; outside value refuses with nothing written; unknown id (plan dir present and absent) and epic id refuse; snapshot shape incl. `content_hash` value; pre-existing `external.jira` unchanged under `bmad-files`; `updated` stamped; `written` names entity and `plan/index.md`; index shows the new status; backlog-md re-sync moves the task file's status; cross-repo byte-identity and `plan_dir`; dry run writes nothing; multi-line note, blank caller and sprint-status pin refuse; CLI exits 0/2 -- AC1–AC3.
- `plugins/tk-studio/contracts/driver-contract.md` -- header clause `0.1.21 (Story 26.5)` (… — additive) and §4 subsection: CLI, enum, snapshot fields, refusals, re-sync, `plan_dir`, "status-class only, AD-5", Epic 27 as consumer -- AC3.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- pin: header `**0.1.21**` not `**0.1.22**`; `0.1.21 (Story 26.3)` precedes `0.1.21 (Story 26.5)`; clause and §4 phrases pinned by their own text -- AC3.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- append the two drives of Settled shape 4 verbatim to `tk-studio-plan-sync` -- AC3.
- `plugins/tk-studio/contracts/conformance/fixtures/plan-status/_bmad-output/planning-artifacts/plan/EP-001.md` and `ST-001.md` (new) -- valid epic and story (parent `EP-001`, status `in-progress`), no `epics.md`, no index -- AC3.

**Acceptance Criteria:**
- Given the full lib suite, when run, then `StatusTests` and the contract pin pass and everything is green.
- Given the conformance runner, when run, then `ok: true` with both new plan-sync drives passing, and the `plan-status` fixture is unchanged afterwards.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 2, low 1)
- defer: 0
- reject: 7 (medium 2, low 5)
- addressed_findings:
  - `[high]` `[patch]` note/caller line-break refusal covered only `\n`/`\r`; miniyaml tokenizes with `str.splitlines`, so `\x0b \x0c \x1c \x85 \u2028 \u2029` wrote an unparseable entity (verified) — consult ruling applied: refuse every splitlines break with the existing messages; tests per character; §4 text updated.
  - `[medium]` `[patch]` `sync()` raising after the entity write surfaced as a refusal implying nothing written — now the blocked shape (`ok: false`, `blocked: true`, `reason`, `written` = entity); test with a foreign `plan/index.md`.
  - `[medium]` `[patch]` `--dry-run` under-reported (sync's dry run sees the old status) — dry run now names `plan/index.md` after the entity; §4 states the dry-run list semantics; test strengthened.
  - `[low]` `[patch]` contract header `Story / rulings` row lacked Story 26.5 (and AD-4/AD-5) — added.
- rejected (one line each):
  - cross-repo test "cannot fail": AC2's observable (other repo byte-identical, `plan_dir` under the owner) is asserted; the verb takes no input naming another repo, which is the guarantee.
  - `headless-clean` drive on a committed fixture / ambient binding: the drive is a dry run (fixture verified unchanged), and `expect: json` accepts exit 0 or 2.
  - CLI refusal coverage partial / two refusal strings not pinned in the doc test: plumbing; every refusal is pinned at function level.
  - backlog-md conflict leaves `ok: true`: the projection's existing conflict semantics, reported verbatim under `sync`.
  - normalize blocking after the entity write: the settled blocked-sync shape (plan Settled shape 2) covers it.
  - unparseable/duplicate target in `_find_entity`: still a refusal with nothing written; duplicates are blocked by the re-sync's normalize.
  - (dedup) Blind Hunter and Edge Case Hunter dry-run and sync-raise findings merged into the patches above.

### 2026-10-15 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 0
- reject: 3 (low 3)
- addressed_findings:
  - `[medium]` `[patch]` duplicate ids: the verb wrote an arbitrary copy before the re-sync's normalize blocked (AD-4: duplicates block before anything is written) — now runs normalize's step-1 duplicate precheck before any write and refuses with `duplicate ids block sync until renumbered (AD-4): …`; test `test_duplicate_id_refuses_before_any_write`; §4 Refusals updated.
  - `[medium]` `[patch]` backlog-md pull-back could revert the requested status (board edit pending, requested status = last-promoted `canonical_status`) while the result said `ok: true` — after a non-dry-run sync the verb re-reads the entity and, on a mismatch, returns `ok: false`, `blocked: true`, reason `status of <ID> was reverted to '<s>' by the re-sync (<binding> pull-back) …`; test `test_backlog_md_pull_back_revert_is_blocked`; §4 Re-sync updated.
  - `[low]` `[patch]` only `PlanSyncError`/`InterchangeError` were caught after the entity write, so an `OSError` from `sync` escaped with a traceback and nothing named the landed write, against §4's promise — the non-dry-run handler now catches any exception; test `test_any_sync_exception_after_write_reports_entity_written`; §4 wording updated.
  - `[low]` `[patch]` the snapshot's `note` = `""` default and its `content_hash` were unpinned (contract invariant) — test `test_no_note_snapshot_note_is_empty`.
- rejected (one line each):
  - `_sprint_pin` compares raw BMad values: false — `_load_sprint_status` maps through `SPRINT_STATUS_MAP` to the canonical enum (plansync.py l.319).
  - dry-run sync raise surfaces as a refusal, not the blocked shape: a dry run wrote nothing, so the refusal is truthful; §4's blocked clause is scoped to "after the entity write".
  - malformed target file reported as `unknown id`: still a refusal with nothing written; `validate`/`normalize` name the corrupt file (same reasoning as the first pass).

### 2026-10-15 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 4 (medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` a foreign `plan/index.md` made `sync()` raise after normalize and the backlog-md/jira projection had written, and the verb reported only the entity in `written` (AC1, contract 0.1.13) — now refused before any write via the shared `_refuse_foreign_index` (also used by `generate_plan_index`); test `test_sync_raise_after_write_reports_entity_written` became `test_foreign_index_refuses_before_any_write`, plus `test_foreign_index_refuses_under_backlog_md`; §4 Refusals and the post-write exception paragraph updated.
  - `[low]` `[patch]` `--dry-run` named `plan/index.md` when the sync dry run blocked — now only when `synced.get("ok")`; test `test_dry_run_blocked_sync_does_not_name_index`.
  - `[low]` `[patch]` `--dry-run` named `plan/index.md` when the status was unchanged (the real run leaves the index as it is) — now only when `previous != status`; test `test_dry_run_unchanged_status_does_not_name_index`; §4 dry-run sentence updated.
  - `[low]` `[patch]` §4 claimed `synced_at` equals the stored `updated`, but a projecting binding's promote re-stamps `updated` during the re-sync — §4 now says `synced_at` equals the `updated` the verb stamps, and a projecting promote may re-stamp it (wording only).
- rejected (one line each):
  - backlog-md both-changed conflict returns `ok: true` (both layers): the projection's existing conflict semantics, reported verbatim under `sync` exactly as `plansync.py sync` returns them; §2's `partial` is the skill-level outcome (same ruling as the first pass).
  - normalize block after the entity write relays a reason saying "nothing was written": Settled shape 2 relays the sync `reason` verbatim on a blocked sync; `written` is the authoritative record and names the entity.
  - §2 plan-sync row and `tk-studio-plan-sync` SKILL.md not updated: excluded by the intent contract (Never: edit the §2 row; Block If: an edit to the skill); AC3 names §4.
  - `shape.v1.json` `external` note does not mention `driver`: `external_entry` accepts it (unknown keys allowed), the verb is the adapter's pull-back, and editing `shape.v1.json` is a Block If.

## Design Notes

- Settled shape (plan §Settled shape 1): `external.driver = {key: <caller>, synced_at: <same _now() as updated>, content_hash: sha256 hex of id, status, note, each UTF-8 encoded and followed by one NUL byte (backlogmd._content_hash), caller, status, note ("" when absent), previous_status}`, replacing any prior `driver` snapshot whole.
- Result: `{"ok", "id", "status", "previous_status", "caller", "note", "path", "plan_dir", "dry_run", "sync", "written", "removed"}`; blocked sync adds `blocked: true` and `reason`.
- Sprint-status pin (plan Risks, adopted): `normalize` would silently revert the verb's status when `sprint-status.yaml` maps the story differently; the verb refuses instead, nothing written. This adds one refusal not named in the story: recorded as DRIFT, `affects: none`. No tk-studio or loop-driven project carries `sprint-status.yaml` today.

## Verification

**Commands:** (from `plugins/tk-studio/lib`)
- `uv run python -m unittest discover tests` -- expected: green.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `git status --short ../contracts/conformance/fixtures/plan-status` after the conformance run -- expected: only the new untracked/added files, no modification by the run.

## Deviation Summary

- DRIFT (planned): an added refusal when `sprint-status.yaml` pins the story to a different status — the re-sync's normalize would otherwise silently revert the requested status — affects: none.

### pass 1 (2026-10-15, implementer)

- planned: `content_hash` = sha256(id NUL status NUL note) / actual: computed with `backlogmd._content_hash(id, status, note)` itself, which also appends a NUL after `note` / why: the plan names that function's construction as the one to mirror; calling it is the exact copy / may affect: none (Epic 27 only reads the snapshot)
- planned: order status → find entity → refuse non-story → write / actual: caller and note checks right after the status check; sprint-status pin check after the story-type check; all before any write / why: the settled order does not place these refusals; "nothing written" holds / may affect: none
- DEVIATION SCORE: 1

DRIFT: the verb refuses when `sprint-status.yaml` pins the story to a different status (a refusal the story does not name) — the re-sync's `normalize` would otherwise silently revert the requested status — affects: none
DRIFT: `external.driver.content_hash` uses `backlogmd._content_hash` (trailing NUL after `note`) rather than the spec's literal `id NUL status NUL note` — the plan names that construction as the one to mirror — affects: none
DRIFT: caller/note/sprint-pin refusals are ordered around the settled validation order, all before any write — the settled order did not place them — affects: none

### pass 2 (2026-10-15, implementer, consult DO)

- DEVIATIONS: none (driver-contract §4 hash wording now states the exact bytes per the consult ruling)
- DEVIATION SCORE: 0

### pass 3 (2026-10-15, implementer, review patches)

- DEVIATIONS: none beyond the instructed patches; the widened line-break refusal is recorded below per the consult ruling.
- DEVIATION SCORE: 0

DRIFT: note/caller single-line refusal widened from `\n`/`\r` to every `str.splitlines` break — miniyaml tokenizes with `splitlines`, so the narrower check wrote unparseable entities; messages unchanged — affects: none

### pass 4 (2026-10-15, implementer, follow-up review patches)

- DEVIATIONS: none (the duplicate-id refusal applies AD-4's existing pre-write block; the revert outcome reports a status the re-sync did not keep)
- DEVIATION SCORE: 0

### pass 5 (2026-10-15, implementer, follow-up review 2 patches)
- Score 0. The foreign-index refusal is `generate_plan_index`'s existing refusal moved before the first write (shared helper), not a new refusal; the dry-run `written` narrowing and the §4 `synced_at` wording follow the review findings. Files touched: `plansync.py`, `tests/test_plansync.py`, `driver-contract.md` §4 only.

## Consult Log

- 2026-10-15T21:21:23Z — trigger: deviation-gt-0 — question: accept or reject the implementer's three score-1 deviations (sprint-pin refusal, content_hash via backlogmd._content_hash, refusal ordering) — ruling: accept-deviation score 1 — do: keep all three as implemented; state the exact hash bytes (each of id, status, note UTF-8 encoded and followed by one NUL byte, backlogmd._content_hash) in the driver-contract §4 subsection and the spec Design Notes; record the three DRIFT lines with affects: none — rule candidate: when a plan names an existing helper as the construction to mirror, the implementer calls it and the spec/contract describe its exact bytes; refusals the settled order does not place may go anywhere before the first write, without a consult.
- 2026-10-15T21:25:08Z — trigger: high-severity-finding — question: widen the note/caller single-line refusal beyond \n/\r to every str.splitlines break (miniyaml cannot round-trip \x0b \x0c \x1c \x85 \u2028 \u2029)? — ruling: accept-deviation score 1 — do: refuse a note on any str.splitlines break with `note must be a single line`; apply the same test to caller after the blank check with the existing `caller must be a non-empty string`; add a test per character in the note and one in the caller; record the DRIFT line — rule candidate: any string the plan adapter writes through miniyaml is refused if str.splitlines() would break it, using the field's existing refusal message.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review pass on the `plansync.py status` verb (status pull-back, driver-contract §4 at 0.1.21). Four patches: a foreign `plan/index.md` is refused before any write (it used to surface after the projection had written unnamed files), the dry run names `plan/index.md` only when the status changes and the sync is not blocked, and §4 now states the `synced_at`/`updated` equality only for the verb's own stamp.

**Files changed (this pass).**
- `plugins/tk-studio/lib/plansync.py` — `_refuse_foreign_index` shared by `generate_plan_index` and the verb's pre-write checks; dry-run index naming narrowed.
- `plugins/tk-studio/lib/tests/test_plansync.py` — `test_foreign_index_refuses_before_any_write` (replaces `test_sync_raise_after_write_reports_entity_written`), `test_foreign_index_refuses_under_backlog_md`, `test_dry_run_unchanged_status_does_not_name_index`, `test_dry_run_blocked_sync_does_not_name_index`.
- `plugins/tk-studio/contracts/driver-contract.md` — §4 "Status pull-back": foreign-index refusal, post-write exception wording, dry-run sentence, `synced_at` wording. Header and version untouched.

**Review.** Blind Hunter + Edge Case Hunter (band L). Patches applied 4 (high 0, medium 1, low 3); deferred 0; rejected 4.

**Follow-up review recommendation:** true. Patched: high 0, medium 1, low 3. Score 3×1 + 1×3 = 6 (≥ 5).

**Verification.** From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` — 1236 tests OK (1 skipped); `uv run python ../contracts/conformance/runner.py run` — exit 0, `ok: true`, `failures: []`; `git status --short ../contracts/conformance/fixtures/plan-status` — clean.

**Residual risks.** An unexpected exception inside `sync` after the entity write (e.g. an `OSError` mid-projection) still names only the entity file in `written`; §4 says so. A backlog-md both-changed conflict returns `ok: true` with the conflict under `sync.projection`, the same as `plansync.py sync`. Jira re-sync is still covered only on its blocked path. The 26-5 SPEC.md design-notes bullet stays parked in `plans/26-5.md` (gate rule).

DRIFT: the verb refuses when `sprint-status.yaml` pins the story to a different status (a refusal the story does not name) — the re-sync's `normalize` would otherwise silently revert the requested status — affects: none
DRIFT: `external.driver.content_hash` uses `backlogmd._content_hash` (a NUL after each of id, status, note) rather than the spec's literal `id NUL status NUL note` — the plan names that construction as the one to mirror — affects: none
DRIFT: caller/note/sprint-pin refusals are ordered around the settled validation order, all before any write — the settled order did not place them — affects: none
DRIFT: note/caller single-line refusal widened from `\n`/`\r` to every `str.splitlines` break — miniyaml tokenizes with `splitlines`, so the narrower check wrote unparseable entities; messages unchanged — affects: none

## Reconcile

- 2026-10-15 — score 1; reconcile not required.

Gate: Part A not-required; Part B epic complete: no next story (26-5 accepted; replan queue has no open entries)
