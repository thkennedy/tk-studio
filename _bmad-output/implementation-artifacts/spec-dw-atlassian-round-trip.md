---
title: 'DW bundle atlassian-round-trip: honest Jira status names and setup (DW-95, DW-107, DW-114, DW-36)'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: 'd24244ea8464be6362dfc50a63450ae4cc634136'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals, oversized]
deferred:
  - summary: >-
      The `POST /workflows/update` transitions keep the legacy `from`/`to` keys copied from `GET /workflow/search` and new GLOBAL transitions carry no `id`; the live endpoint may want `toStatusReference`/`links[].fromStatusReference`.
    evidence: |-
      Both review layers flagged it. The test fake checks only uppercase types and the version, so any transition shape passes. The spec's Design Notes kept the body shape ungraded (kb §2 Q1 grade C), so the first live setup may still be refused and fall back to the owner steps. Deferral class (a): a defect in the workflow-update behaviour DW-107 names.
    location: >-
      plugins/tk-studio/lib/jirabackend.py update_workflow
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Jira round trip lies about status names: `canonical_status` maps by category only, so the owner's `DNI` (Done category, reserved for dropped work, `DROPPED_STATUS_NAMES`) pulls back as `done` (DW-95), and a landed story whose backend status is a Done-category name other than `Done` is stored silently (DW-114, hole 100). `plansync setup`'s workflow update is refused (lowercase transition types copied from `GET /workflow/search`, no workflow version) and demands a status literally named `To Do` although the simplified workflow's To Do category holds `Backlog` (DW-107, hole 92); setup never creates `DNI`. The kb token record omits `write:space:confluence`, which setup's space create needs (DW-36).

**Approach:** Name-map `DROPPED_STATUS_NAMES` to canonical `dropped` in `canonical_status`; make the pull-back emit a loud note (result `notes` and the entity's snapshot) for a Done-category backend name that is neither `Done` nor a dropped name. Fix setup: accept any To Do-category status, create `DNI` (Done category) beside the two setup statuses, and send a workflow update with uppercased types, the version from `GET /workflows/search`, and the global transitions it needs. Add the missing scope to the kb record.

## Boundaries & Constraints

**Always:** stdlib-only; atomic writes (`_atomic_write`); every new setup step is idempotent (recognise first, create only when absent; a rerun after success writes nothing); a setup refusal stays a note plus the owner's numbered browser steps, never a raise; a dry run contacts no write endpoint; credentials never land in notes or files.

**Block If:** a change would alter a contract surface under `plugins/tk-studio/contracts/` (driver-contract, schemas, conformance fixtures) — none is expected; HALT rather than edit one.

**Never:** edit the deferred-work ledger, `epics.md`, plan files, `stories.yaml` or `.bmad-loop/*.toml`; change promote's picker (#275) or promote's dropped-entity skip; add a dependency; touch Confluence code beyond reading it; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DNI pulled back | snapshot `Done`/`done`, entity `done`, Jira now `DNI` (cat done) | entity `dropped`, snapshot `status: DNI`, `canonical_status: dropped` | none |
| Legacy hole-100 snapshot | snapshot `DNI`/`done`, entity `done`, Jira still `DNI` | re-mapped to `dropped` (the stale-remap branch now covers `DROPPED_STATUS_NAMES` as it does `SETUP_STATUSES`) | unpromoted local change → untouched |
| Non-canonical landed name | Jira `Closed` (cat done), entity `done` | entity stays `done`; result note names entity, key, `'Closed'` and `'Done'`; snapshot gets `status_note` | note repeats every pull-back while the name stays |
| Canonical landed name | Jira `Done` | no note; any prior `status_note` removed from the snapshot | — |
| Setup, To Do category | project's To Do-category status is `Backlog`, no `To Do` | `found` includes the To Do slot (satisfied by `Backlog`); no owner step asks for `To Do` | — |
| Setup, DNI absent (company-managed) | no `DNI` on site | `POST /statuses` creates `DNI` in DONE category (setup statuses stay IN_PROGRESS); `created` lists `status DNI` | refusal → note + company steps naming `DNI` |
| Setup, team-managed | — | owner steps also ask to add `DNI` in the Done category with a global transition | — |
| Workflow update | legacy search transitions typed `initial`/`directed`/`global` | `POST /workflows/update` body: every type uppercased; `version` = the matching `GET /workflows/search` value's `version`; DNI on `statuses`; DIRECTED Blocked→Block Resolved; GLOBAL (`from: []`) transitions into the To Do-category status, `Blocked - Awaiting User` and `DNI`, each added only when no GLOBAL transition into it exists | no exact-name match in `/workflows/search` → no update, note + company steps |
| Setup rerun | workflow already complete | reported in `found`; no `POST /workflows/update` | — |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/jirabackend.py:100-109` -- `FROM_BACKEND_CATEGORY`, `DROPPED_STATUS_NAMES = {"DNI"}`.
- `plugins/tk-studio/lib/jirabackend.py:127-136` -- `canonical_status`: name-map `SETUP_STATUSES`→`blocked`; add `DROPPED_STATUS_NAMES`→`dropped` before the category fallback.
- `plugins/tk-studio/lib/jirabackend.py:546-660` -- `apply_statuses` (pull-back + sync-back share it). Changed-name branch 576-592; stale-remap else branch 593-610 (extend its `b_status in SETUP_STATUSES` guard to dropped names); write-back 632-639. Add the loud-note rule here so both `pull_back` and the sync-back get it; a snapshot whose `status_note` changes counts as a refresh (written).
- `plugins/tk-studio/lib/jirabackend.py:752-758` -- promote skips `dropped` entities (read-only; a pulled-back `dropped` never re-promotes).
- `plugins/tk-studio/lib/jirabackend.py:1030-1035` -- `BLOCKED_STATUS`, `RESOLVED_STATUS`, `SETUP_STATUSES`, `TEMPLATE_STATUSES`; add the DNI name constant (reuse `DROPPED_STATUS_NAMES`'s member) and its Done category.
- `plugins/tk-studio/lib/jirabackend.py:1358-1393` -- `find_statuses`: `"To Do"` slot satisfied by any in-scope project status whose category is To Do (`statusCategory` is `"TODO"` on `/statuses/search`, `{"key": "new"}` on `/project/<key>/statuses`); the DNI status found like the setup statuses (site-wide, in scope).
- `plugins/tk-studio/lib/jirabackend.py:1396-1413` -- `create_statuses`: per-name category (DNI → `DONE`).
- `plugins/tk-studio/lib/jirabackend.py:1416-1458` -- `find_workflow` (legacy `/workflow/search`, keep for statuses/transitions), `has_resolution_transition`, `add_resolution_transition` (the refused body). Add the `/workflows/search` version lookup via `_paged_values` (1064).
- `plugins/tk-studio/lib/plansync.py:1162-1175` -- `_STATUS_CATEGORY`, `_template_status_steps`; `_company_status_steps`/`_team_status_steps` (~1130-1185) must name `DNI` and its global transition.
- `plugins/tk-studio/lib/plansync.py:1374-1445` -- setup step 4: status discovery, create, workflow update, dry-run `would` lines.
- `plugins/tk-studio/lib/tests/test_jirabackend.py:1127-1154` -- `DroppedStatusPickTests` pattern (fake `STATUSES` name→category).
- `plugins/tk-studio/lib/tests/test_tracking_setup.py:55-200` -- setup fake: `template_statuses`, `_new_status` (hardcodes IN_PROGRESS), workflows, `/workflow/search`, `/workflows/update`; extend with `/workflows/search` (values `{name, id, version}`), per-status category, lowercase legacy transition types.
- `plugins/tk-studio/lib/confluence.py:39,228` -- `SCOPE_SPACE = "write:space:confluence"` on `POST /spaces` (read-only evidence).
- `kb/atlassian-free-tier.md:20-21` -- §1 step 5 scope lists; Jira line says "the two statuses".

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jirabackend.py` -- `canonical_status` dropped mapping; `apply_statuses` stale-remap for dropped names + loud note (`notes` line and `external.jira.status_note`, removed once the name is canonical); setup helpers per the matrix (To Do-category acceptance, DNI create in DONE, `/workflows/search` version, uppercase types, GLOBAL transitions, a completeness check replacing/extending `has_resolution_transition`); update affected docstrings -- DW-95, DW-114, DW-107.
- `plugins/tk-studio/lib/plansync.py` -- setup step 4 wires DNI into found/created/would/missing and the owner steps; a To Do-category status satisfies `To Do`; workflow label(s) reflect the transitions added -- DW-95, DW-107.
- `plugins/tk-studio/lib/tests/test_jirabackend.py` -- tests for each pull-back matrix row (DNI→dropped, legacy remap, `Closed` note + snapshot field, `Done` clears note) and `canonical_status("DNI","done") == "dropped"`.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py` -- fake gains `/workflows/search`, per-status categories, lowercase legacy types, a `Backlog` To Do variant; tests for each setup matrix row; existing tests updated only where DNI/transition labels legitimately change outputs.
- `kb/atlassian-free-tier.md` -- add `write:space:confluence` (setup's space create) to the agent Confluence scope list; Jira line names the three created statuses (incl. `DNI`, Done category) -- DW-36, DW-95.

**Acceptance Criteria:**
- Given a bound entity at `done` whose issue moves to `DNI`, when `pull_back`/sync-back runs, then the entity file reads `status: dropped` and its snapshot `canonical_status: dropped`.
- Given a landed entity whose issue sits in a Done-category status named other than `Done` or a dropped name, when the pull-back runs, then the result's `notes` carries a line naming the entity, key and backend name, and the entity file's `external.jira.status_note` records it; it is never a silent `done`.
- Given a fresh company-managed project whose To Do category holds only `Backlog`, when `plansync setup` runs, then no owner step asks for a status named `To Do`, `DNI` is created in the Done category, and the single `POST /workflows/update` body has uppercase transition types, the `/workflows/search` version, and GLOBAL transitions into the To Do-category status, `Blocked - Awaiting User` and `DNI`; a rerun is `complete` with no further writes.
- Given the kb record, when an operator builds the agent Confluence token from §1 step 5, then `write:space:confluence` is in the list.
- Given the verify gate, when run from `plugins/tk-studio/lib`, then both commands pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` DW-114 note claimed "kept as done" on a conflict or a non-done entity — the note is now computed after the conflict check and only for a resulting `done`; tests for both cases
  - `[medium]` `[patch]` GLOBAL transition into a To Do-category status absent from the update's `statuses` — the To Do slot's id is now sent; test added
  - `[low]` `[patch]` team-managed owner steps asked for a global transition into DNI only — they now ask for all three
  - `[low]` `[patch]` docstrings overclaimed live acceptance of the update body — reworded as ungraded (kb §2 Q1)
  - `[low]` `[patch]` the note-only write path had no test — `test_a_missing_note_alone_is_written`
  - `[low]` `[patch]` three blank lines before the two new test classes — fixed
- note: the diff was handed to both reviewers as the file `/tmp/atl-rt.diff`, not pasted inline (53 KB)

### 2026-10-29 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[low]` `[patch]` `DNI_STATUS = next(iter(DROPPED_STATUS_NAMES))` named a created status from an unordered frozenset (a second dropped name would make setup's created name vary per process, breaking rerun idempotency) — `DNI_STATUS = "DNI"` is now a literal and `DROPPED_STATUS_NAMES = frozenset({DNI_STATUS})`
  - `[low]` `[patch]` kb §2 Q1's attended-probe list did not name `GET /workflows/search`, which setup now reads for the update's `version` — probe bullet added
- rejected: dry-run `would_create` lists every workflow label while a created status lacks an id — an upper-bound prediction by design, the same shape as baseline's `if not both: would.append(label)`, not named by the ACs
- rejected: granular-scope fallback lacks `read:workflow:jira` — the list is an explicit "for example" (grade D), and the legacy `/workflow/search` read needed the same scope at baseline
- rejected: kb lines 30 and 106 still say "the two statuses" — they are the historical 31.1 halt rule and 31.2 record, not the operator's current instructions (§1 step 5 was updated)
- note: edge-case-hunter returned no findings; both layers ran; the diff (code files since `baseline_revision`, the ledger and spec excluded) was handed as `/tmp/atl-rt-followup.diff` (62 KB)

## Design Notes

- "Landed" (DW-114) = Done category. The note rule applies only there: To Do/In Progress names vary per workflow (`Backlog`) and are already round-tripped by AD-5; `SETUP_STATUSES` and dropped names are name-mapped, hence canonical by definition. Canonical Done-category name: `"Done"`.
- `status_note` lives in the `external.jira` snapshot (uncontracted; `interchange` does not validate snapshot keys), e.g. `status_note: "backend status 'Closed' is not the Done category's canonical 'Done' (DW-114)"`.
- Global transitions into To Do and Blocked come from DW-107's fix ("setup add the global transitions it needs"), mirroring what the owner did by hand on TKSTUDIO.
- The workflow update body shape beyond these fixes stays as today (ungraded, kb §2 Q1 grade C); live proof is the operator's attended `plansync setup` rerun (unverifiable here).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK, no failures.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

### pass 1 (2026-10-29)

- planned: a completeness check replacing/extending `has_resolution_transition`, keep `add_resolution_transition` / actual: `add_resolution_transition` replaced by `update_workflow(client, workflow, version, status_ids, transitions)`; new helpers `find_workflow_version`, `workflow_transitions`, `has_global_transition`; new constants `TODO_STATUS`, `DNI_STATUS`, `DNI_CATEGORY`, `CREATED_STATUSES`, `STATUS_CATEGORY`, `CANONICAL_DONE_STATUS`; `has_resolution_transition` kept / why: the update now carries version, extra statuses and several transitions / may affect: none
- planned: no scope named for `/workflows/search` / actual: `SCOPE_CONFIGURATION` / why: the new workflows API is admin-only; only a 403's scope name depends on it / may affect: none
- planned: workflow labels unspecified / actual: `global transition -> <status>` and `status To Do (satisfied by <name>)`; existing Blocked -> Block Resolved label unchanged / why: one label per transition / may affect: none
- planned: no change to `applied[].fields` / actual: note-only write reports `fields: ["external.jira.status_note"]` / why: a note-only change is written and needs a field name / may affect: none
- planned: existing tests changed only for DNI/labels / actual: `test_template_without_to_do_ends_partial_naming_it` starts from `["In Progress", "Done"]` (Backlog now satisfies the slot; Backlog case moved to `DW107SetupTests`); the fake's legacy `/workflow/search` no longer returns `version`, its Create transition gained a type / why: DW-107 changes that test's input; the fake mirrors the real API / may affect: none
- planned: company owner steps name `DNI` and its global transition / actual: a new final step asks for global transitions into the To Do-category status, `Blocked - Awaiting User` and `DNI`; "Update workflow" moved to it / why: owner fallback matches what setup does / may affect: none

DRIFT: `add_resolution_transition` replaced by `update_workflow` plus helpers — the update needs version, statuses and several transitions — affects: none
DRIFT: `/workflows/search` read under `manage:jira-configuration` — admin-only endpoint — affects: none
DRIFT: new setup labels `global transition -> <status>`, `status To Do (satisfied by <name>)` — one label per transition — affects: none
DRIFT: note-only pull-back write reports `fields: ["external.jira.status_note"]` — note-only writes needed a field name — affects: none
DRIFT: `test_template_without_to_do_ends_partial_naming_it` input changed; fake legacy search drops `version` — DW-107 rule changes the input — affects: none
DRIFT: company owner steps gain a global-transitions step — matches setup's own update — affects: none

### pass 2 (2026-10-29, review patches)

- planned: team-managed steps text-only / actual: `_team_status_steps` gained optional `have` so the step names the real To Do status; its one caller passes it / why: matches the company steps / may affect: none
- planned: no note rewrite on a non-done entity / actual: an existing `status_note` on a non-`done`, non-conflict entity is removed in one write (`fields: ["external.jira.status_note"]`), then nothing / why: the note exists only while the entity is `done` / may affect: none
- consult follow-up: `test_a_conflict_over_an_existing_note_leaves_the_file_byte_identical` added (pass 3, DEVIATIONS: none)

DRIFT: `_team_status_steps` takes `have` to name the real To Do status — owner step text only — affects: none
DRIFT: a stale `status_note` on a non-done, non-conflict entity is removed in one write — the note exists only while done — affects: none

### follow-up review pass (2026-10-29)

- two low review patches (`DNI_STATUS` literal; kb Q1 probe bullet), within Files; implementer DEVIATIONS: none; no consult trigger fired
- the orchestrator-owned `deferred-work.md` change was left uncommitted and untouched, per the invocation's instruction

## Consult Log

- 2026-10-29T18:11:12Z — trigger: deviation-gt-0 — question: accept the six pass-1 deviations (update_workflow rename, /workflows/search scope, new setup labels, note-only applied field, test input change, owner global-transition step)? — ruling: accept-deviation score 1 — do: accept all six as recorded, contracts untouched; keep new labels and applied[].fields as free-form strings, no schema/fixture — rule candidate: item strings inside plan-sync result arrays (found[], created[], would_create[], owner_steps[], applied[].fields) are informational, so changing them is a score-1 deviation with no consult unless driver-contract.md or a schema names the entry format
- 2026-10-29T18:21:55Z — trigger: deviation-gt-0 (patch pass) — question: accept `_team_status_steps(have)` and the one-time `status_note` removal on a non-done entity; does it write on the conflict path (AD-5)? — ruling: accept-deviation score 1 — do: keep both, add no snapshot write on the conflict path; add a test that a conflicted entity's file is byte-identical; log the removal as an extension of the matrix's canonical-name row — rule candidate: any new snapshot field written by apply_statuses must be computed after the conflict `continue`, so conflicted entities are never written


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory <root>` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review (the spec came in `done` with `followup_review_recommended: true`) of the bundle that resolves DW-95, DW-107, DW-114 and DW-36. It is implemented in 3ffd8ca. Both review layers ran against the code diff since `baseline_revision`. Two low patches were applied:
- `DNI_STATUS` is now a literal, and `DROPPED_STATUS_NAMES` is derived from it. Setup's created status name can no longer depend on frozenset iteration order.
- The kb §2 Q1 attended-probe list now names `GET /workflows/search`.

**Files (this pass):**
- `plugins/tk-studio/lib/jirabackend.py`: `DNI_STATUS = "DNI"` now sits before `DROPPED_STATUS_NAMES = frozenset({DNI_STATUS})`, and the `next(iter(...))` derivation is removed.
- `kb/atlassian-free-tier.md`: §2 Q1 gains a probe bullet for `…/rest/api/3/workflows/search?queryString=<KEY>`.

**Review:**
- Patches applied: 2 (both low).
- Deferred: 0.
- Rejected: 3 (dry-run upper-bound labels, a speculative granular read scope, historical kb wording).
- Edge-case-hunter: no findings.
- The bundle's earlier deferral (the `/workflows/update` body shape) still stands.

**Follow-up review:** not recommended. Patched findings: high 0, medium 0, low 2. Score 3×0 + 2 = 2, which is below 5, so false.

**Verification:**
- `uv run python -m unittest discover tests`: 2529 tests OK (4 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- No contract files changed.

**Residual risks / unverifiable-here:**
- Whether the live site accepts the `/workflows/update` body is still ungraded (see `deferred`). The operator checks it with an attended `uv run plugins/tk-studio/lib/plansync.py setup --directory <project root>` on a fresh company-managed project.
- The uncommitted `_bmad-output/implementation-artifacts/deferred-work.md` change belongs to the orchestrator. Per the invocation, it was not touched or committed, so the tree stays dirty by that one file only.

DRIFT: none this pass (bundle deviation_score 1 stands, from the passes above)

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Part B note: this unit is a sweep DW bundle, not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 (acceptance audit against a plan, remediation entry, replan queue, next-story plan) has nothing to act on. The spec's own ACs were spot-checked instead: AC1 `test_dni_pulls_back_as_dropped`, `test_a_legacy_dni_snapshot_re_maps_to_dropped`; AC2 `_landed_status_note` plus the `Closed` tests in `test_jirabackend.py`; AC3 `DW107SetupTests` (rerun complete, no writes); AC4 `kb/atlassian-free-tier.md:21` names `write:space:confluence`; AC5 per the Auto Run Result (2529 OK, conformance `ok: true`). Live acceptance of the `/workflows/update` body can't be checked here (it needs the operator's attended `plansync setup` rerun; see `deferred`).
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met, and the live workflow-update check can't be done here
