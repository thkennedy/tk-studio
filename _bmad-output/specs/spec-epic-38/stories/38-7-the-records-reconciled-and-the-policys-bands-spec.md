---
title: 'The Records Reconciled and the Policy''s Bands'
type: 'chore'
created: '2026-11-09'
status: 'done'
baseline_revision: '55fa151874c97c1290dfd4a0c5e2f86f3a50ed4c'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-7.md'
  - '{project-root}/AGENTS.md'
warnings: [multiple-goals, oversized]
deferred:
  - summary: >-
      `launch.py check` compares band L against `[limits.by_band] L` even when `start` will not apply it (main checkout, or a run-epic instance without `stop.after_stories` 1), so no `budget_mismatch` shows while the engine runs the L story at the global cap.
    evidence: |-
      `_compare_per_band` uses the by-band figure whenever the entry exists; `apply_followup_cap` writes it only in a linked worktree with after_stories 1 (blind-hunter and edge-case-hunter, review pass 1). Deferral class (a): a defect in behaviour AC3 names (the cap compared like the other band figures and read by the engine's cap check).
    location: >-
      plugins/tk-studio/lib/launch.py (_compare_per_band / apply_followup_cap)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The Epic 37 records do not read what was built (A4, A5, C9 of `spec-epic-37/RETROSPECTIVE.md`): `by Story 37.x` statuses carry no PR and the ledger test forbids only the old phrase; DW-168 is open; no `eol=lf` rule exists; the Epic 37 SPEC's version lines and questions are stale; the contract lacks an order note and the `deferred mint` marker-failure answer (DW-169). Tim's R5 (the follow-up-review cap 2 for band L only, TKSTUDIO-211, DW-175) cannot be written into the policy, and DW-182 left three setup defects.

**Approach:** A cited docs pass over the records, a PR-reference ledger test with run-branch detection, and small lib changes (the per-band cap read, compared and applied per run; the v3 `expand` spelling; the folder hand-off; `setup --verify-workflow`). It decides nothing that is the owner's.

The acceptance criteria, transcribed verbatim from `epics.md` `### Story 38.7`:

**AC1.** **Given** the 24 `resolved <date> by Story 37.x` statuses (DW-133, DW-135 to 144, DW-148 to 151, DW-154, DW-155, DW-157, DW-159 to 162, DW-164), `test_plansync.py:1171-1172` (forbids only the old phrase) and `.gitattributes` (no rule for `*.py`, `*.ts`, `*.md`; the `fc1e2aa`/`e0512c4` CRLF round trip) **When** this story's docs pass runs **Then** every such status names its PR (`thkennedy/tk-studio#326` to `#342` by the story's landing), the test requires a PR reference on every `resolved … by Story` status outside a run branch (the in-loop form `by Story N.M` allowed only until the close-out fills it at merge), `.gitattributes` carries `*.py text eol=lf`, `*.ts text eol=lf` and `*.md text eol=lf` with `git ls-files --eol` clean after a renormalise, DW-110's `narrowed:` first word and DW-23/24's bare `status: resolved` read as the parse wants, and the ledger tests pass

**AC2.** **Given** `spec-epic-37/SPEC.md` (`:92, :106, :117` say 0.1.32 under a 0.1.33 header; `:128-131` the four open questions unannotated; `:29` parsers that do not exist; `:35, :74` either/or choices since settled; `:137` `#<PR>`; `:39`), the 36-4 spec `:261`, the contract's 0.1.32 paragraphs before the 0.1.33 one, DW-168 and DW-169 **When** this story lands **Then** each line reads as built with its source cited; the contract carries one note that the 0.1.32 story paragraphs predate 0.1.33's header (the order kept) and its 0.1.32 paragraph states the `deferred mint` answer when the marker write fails after the counter write (`blocked`, exit 2, `written` naming the counter only, the ids burned; DW-169) with its pin test; DW-168 reads narrowed to CAP-14 (b)/(c) and DW-182, or closed when the operator has recorded (b)/(c) from this epic's first live run (the per-tick `hold` events; the latest hold's pid and `detail.start` against `tasklist` / `Get-Process … StartTime` while in flight) in the 36-5 spec's Consult Log, which this story asks for through its own consult log in the Epic 34/35 form

**AC3.** **Given** `[limits] max_followup_reviews = 1` (`.bmad-loop/policy.toml:10`, one global figure; `routing.toml`'s band table with no field; `launch.py:221` `BUDGET_NOT_COMPARED`), Tim's R5 (TKSTUDIO-211: the cap 2 for band L only; DW-175) and DW-182's three parts **When** this story lands **Then** a per-band override (`[limits.by_band] L = { max_followup_reviews = 2 }`, or a column in `routing.toml`'s band table) is read by the engine's cap check (a base patch beside the others in `kb/bmad-base-patches.md` when the engine does not read it), `launch.py` compares it like the other band figures (`BUDGET_COMPARED`) and the loop's README names the policy; the 36-6 ask's v3 read reads `expand=values.transitions` wherever quoted (the 36-6 spec `:263`, 37-7's CAP-16) and `find_workflow_version` uses it; the setup's folder step hands the five folders to the owner's numbered steps when the children read is refused by scope (no unadopted folder created) and a `setup --verify-workflow` form (one global transition removed and restored on a scratch project key) exists behind its flag, the live call staying Tim's; the follow-up-review entries (DW-145, 152, 156, 158, 163, 181) stay `open (owner's decision …)` and the handoff carries one list of what stays Tim's (TKSTUDIO-220 to 224, the fourth sweep's `max_runs` once 38.3 lands, DW-178, DW-179, the pre-36.6 engagement jobs' rhythm, the TUA reachability proof, the attended engagement); nothing else is decided here; the contract names the band override (0.1.34, additive)

**Owner decisions since planning (the dispatch's refresh, 2026-11-09; they stand and this story decides none):**
- TKSTUDIO-235 closed all six follow-up-review entries (DW-145, 152, 156, 158, 163 and **181**): they stay byte-unchanged (no relabel); DW-186/188 untouched. AC3's "stay `open (owner's decision …)`" is overtaken — one `DRIFT:` line, affects: none.
- CAP-14 (b)/(c) is recorded (36-5 spec Consult Log, 2026-11-07T21:07Z): DW-168 **closes**, and the 38-7 ask cites that record.
- DW-182 keeps its `decision:` line and its awaiting clause.
- The handoff's "Still Tim's" list was retired 2026-11-07: each owner item is named by its Jira task where one exists; TKSTUDIO-234 answered the fourth sweep's `max_runs` (6).
- The PR rule also needs the eleven PR-less `by Story 38.1`-`38.6` closures filled (38.1 #350, 38.2 #352, 38.3 #357, 38.4 #359, 38.5 #363, 38.6 #368). 38.7's own closures stay `by Story 38.7`.

## Boundaries & Constraints

**Always:**
- Plan `plans/38-7.md` "Settled shape" 1-15 is the implementation detail, as amended by the owner decisions above and the Consult Log ruling below.
- New text opens and `subprocess.run` name `encoding="utf-8"`; the LF rewrite is a bytes write (AGENTS.md pitfalls). Stdlib-only Python; atomic writes; contract changes additive (0.1.34) with pin tests in the same story.
- Re-grep anchors by text; line numbers moved after 38.1-38.6 and the sweeps.
- Shape 1 exactly as pinned: a detached HEAD is strict; nothing reads `TK_SUPERVISOR_HOST_LEG` (Consult Log 14:30Z).
- Every deviation is a `DRIFT:` line in the implementer's report.

**Block If:**
- The implementation would edit `.bmad-loop/policy.toml` or `.bmad-loop/routing.toml` (forbidden; the operator adds `[limits.by_band]` on the box).
- A bmad-loop engine code patch is needed for the cap (AD-4).
- The launch row's "never edited" pin cannot be kept by scoping it to the run worktree's cap.
- A `bmad-spec` re-render of `spec-epic-37/SPEC.md` is proposed.
- Any follow-up-review entry's status (DW-145, 152, 156, 158, 163, 181, 186, 188) would change, or any owner item would be decided.

**Never:** `git push`, PRs, tags, release motion; edits to `epics.md`, `stories.yaml`, planning `plan/` files, or anything under `supervision/`; splitting the story; a live Jira/Confluence call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PR rule on run branch | HEAD `supervisor/run-q-run-epic-38-…`, `by Story 38.7` with no PR | passes; a PR-less `by Story 37.x` fails | message names each id and `by Story N.M (owner/repo#N)` |
| PR rule elsewhere | `main`, `docs/*`, detached `HEAD` | every `resolved … by Story N.M` needs `owner/repo#N` | git missing/failing → `skipTest` naming the cause |
| Band compare | budget-bands L `followup_reviews_max: 2`, policy without `by_band` | `compared[]` entry per band with `policy_key`; L mismatch (`1 < 2`) | non-table `by_band`/non-int → `not_compared` with reason |
| Cap write at start | linked worktree (`.git` file), plan band L with by-band entry, `after_stories` 1 | `[limits] max_followup_reviews = 2` written atomically; `followup_cap.applied: true` | main checkout / after_stories≠1 / no entry → no write, reason named; bad re-read → original restored |
| Folder step refused | children read 401/scope, some folders unrecorded | nothing created; unrecorded titles in numbered steps; dry run lists steps, not `would_create` | recorded folders reported `(recorded)` |
| `--verify-workflow` | scratch key ≠ bound key | first present GLOBAL transition removed, re-read absent, restored, re-read present | missing/equal key → `blocked` exit 2 before any call; failed restore → `blocked` naming the v3 body; none present → `blocked` |
| v3 read | `find_workflow_version` | query carries `expand: values.transitions` | fake answers 400 to any other expand |

</intent-contract>

## Code Map

Authoritative investigation: `_bmad-output/specs/spec-epic-38/plans/38-7.md` §Code Map (with its "Refreshed at the 38-6 gate" block superseding older anchors) and §Settled shape 1-15. Anchors re-checked 2026-11-09 at HEAD `55fa1518`:

- `_bmad-output/implementation-artifacts/deferred-work.md` -- the ledger (parser `lib/dwledger.py`; `plansync.ledger_resolve` reads the status's first word). The eleven PR-less 38.x closures are now at :1412, :1420, :1428, :1462, :1470, :1478, :1488, :1504, :1512, :1536, :1562 (re-grep `^status: resolved .* by Story 38\.[1-6]`). DW-181 :1538 (resolved by TKSTUDIO-235, untouched); DW-182 :1546, its `decision:` line and status :1554. Precedent form `by Story 34.7 (thkennedy/tk-studio#216)`.
- `.tk-studio/plan-counter.yaml` -- `deferred-work: 207` next; minted only through `plansync.py deferred mint` (`plansync.py:2424` `mint_deferred`, subparser :2542) for the consult-ruled new entry.
- `_bmad-output/specs/spec-epic-36/stories/36-5-…-spec.md:221` -- the CAP-14 (b)/(c) record, 2026-11-07T21:07Z (DW-168's closing citation).
- `plugins/tk-studio/lib/tests/test_plansync.py` -- `RealLedgerContentTests`, `test_no_placeholder_pr_number_remains` (kept); the new PR-rule test beside it.
- `plugins/tk-studio/lib/launch.py` -- `BUDGET_COMPARED`/`BUDGET_NOT_COMPARED`, `compare_budget`, `reconcile_verify_commands` (atomic write/re-read/restore pattern), `next_story`, `run_rhythm_row`, `start`.
- `.tk-studio/budget-bands.yaml` -- the real band table (S/M/L); gains `followup_reviews_max` (S 1, M 1, L 2). `routing.toml` has no band table.
- `plugins/tk-studio/lib/jirabackend.py` -- `find_workflow_version` (no `expand` today), `workflow_transitions`, `update_workflow` (gains `replace=False`).
- `plugins/tk-studio/lib/plansync.py` -- `_recorded`, `_folder_steps`, `_number_steps`, `setup` (version read, folder step with `find_folders`), the `setup` subparser and dispatch.
- `plugins/tk-studio/lib/tests/test_tracking_setup.py` -- the fake: `/workflows/search`, `/workflows/update`, `direct-children`.
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.33 paragraph (order note goes right before `**0.1.33 (DW-170`); 0.1.32 Story 37.1 paragraph (`naming both files in written[]`); 0.1.34 header clause and Stories row (ends `Story 38.6 (Epic 38)`); 38.7's paragraph after 38.6's, before `## 8. Conformance`; the launch row and its pins in `test_driver_contract.py`.
- `apps/supervisor/src/hostleg.ts:15-19` (read-only) -- a non-slice re-run leg cuts detached; `closeout.ts:86` first leg on the run branch.
- Docs: `apps/supervisor/README.md` **Materialise** bullet; `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` step 2; `kb/bmad-base-patches.md` `## run-worktree-rollback`; the handoff top update (day-9d) at `handoff-phase1-loop-2026-10-09.md:5`.
- Epic 37 records: `spec-epic-37/SPEC.md` (plan's SPEC table), `spec-epic-37/.memlog.md`, 36-4 spec `:261`, 36-6 spec `:263`, 37-7 spec `:139`, `:202`, `:230`.
- The five CRLF `.md` files: plan Code Map §`.gitattributes`.

## Tasks & Acceptance

**Execution:** (plan Files 1-21; shapes by number)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- shape 2 (the 23 37.x fills); fill the eleven 38.1-38.6 closures in the same form (`by Story 38.N (thkennedy/tk-studio#<PR>…)`, PRs above); shape 4 (DW-110, DW-23/24); DW-168 `resolved 2026-11-09 by Story 38.7 (CAP-14 (b)/(c) recorded in the 36-5 spec's Consult Log 2026-11-07T21:07Z; CAP-16's live update carried by DW-182)`; DW-169 and DW-175 closed `by Story 38.7`; DW-182 status `open (narrowed: parts (2)/(3) fixed by Story 38.7; answered on TKSTUDIO-236, awaiting `DW-182: <letter>` and `tokens: set`; the live --verify-workflow is Tim's)` with its `decision:` line byte-unchanged; DW-145/152/156/158/163/181/186/188 byte-unchanged; one new open entry minted via `plansync.py deferred mint` per the Consult Log ruling -- AC1, AC2, AC3
- `plugins/tk-studio/lib/tests/test_plansync.py` -- shape 1 -- AC1
- `.gitattributes` + the five CRLF `.md` files -- shape 3 -- AC1
- `_bmad-output/specs/spec-epic-37/SPEC.md`, `.memlog.md`, 36-4 spec -- shape 5 -- AC2
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- shapes 6 and 15 -- AC2, AC3
- `plugins/tk-studio/lib/launch.py`, `tests/test_launch.py`, `.tk-studio/budget-bands.yaml` -- shapes 8-10 -- AC3
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`, `kb/bmad-base-patches.md`, `apps/supervisor/README.md` -- shapes 9 (doc parts) -- AC3
- `plugins/tk-studio/lib/jirabackend.py`, `plansync.py`, `tests/test_tracking_setup.py`, 36-6 spec `:263`, 37-7 spec `:139/:202/:230` -- shapes 11-13 -- AC3
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md` -- a new top update `## Update (2026-11-09): Story 38.7 — …` with the one list, each item by Jira task where one exists (TKSTUDIO-220 to 224; the fourth sweep's `max_runs` answered by TKSTUDIO-234; DW-178; DW-179; the pre-36.6 engagement jobs' rhythm; the TUA reachability proof; the attended engagement), plus the operator steps (`[limits.by_band]` on the box with the expected L mismatch until then; the live `--verify-workflow`; filling 38.7's own closures in the landing docs PR) and the detached re-run note -- AC3

**Acceptance Criteria:** AC1-AC3 above, as amended by the owner decisions. Operator steps are `unverifiable-here` asks in the Consult Log.

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 3, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` contract launch row still listed `max_followup_reviews` as `not_compared` beside the per-band note — row now lists only `session_timeout_min`, `max_tokens_per_session`; pin added (blind-hunter)
  - `[medium]` `[patch]` DW-182's status dropped part of its awaiting clause (owner decision: keep it) — full clause restored; the live `plansync setup` (DW-182, TKSTUDIO-236) added to the handoff's Tim's list (blind-hunter)
  - `[medium]` `[patch]` `--verify-workflow` checked the restore list for refused fields only after the removal posted — pre-flight `refused_transitions(original)` ends `blocked` with nothing posted (dry run included); two tests; contract clause amended per consult (blind-hunter)
  - `[low]` `[patch]` contract 0.1.34 paragraph and handoff said the in-loop form is allowed "for that branch's epic only", omitting shape 1's no-epic run branch (a sweep's) — both texts now name it; test logic unchanged (blind-hunter)
- deferred: per DEFERRAL DISCIPLINE (a) — check vs start divergence on the band-L cap (frontmatter `deferred`).
- rejected: (1) "nothing fills the in-loop form at merge; main red until the docs PR" — AC1's own design (the in-loop form until the close-out fills it); the handoff names the landing docs PR's fill and the epic queues the next run only after it merges. (2) "the cap write is never undone in a kept worktree" (both layers) — a kept worktree relaunches the same story (same band), and one story per run gives each story a fresh worktree. (3) "a stale recorded folder id is never re-created" (edge-case-hunter) — shape 12 pins a recorded folder as found; the live listing is refused on this site.

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 6: (high 0, medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` `verify_workflow`'s bound-key guard compared `--project-key` to `planning.jira.project_key` case-sensitively, so `tkstudio` passed against a bound `TKSTUDIO` (Jira keys resolve case-insensitively). Both keys are now stripped and upper-cased. Test `test_verify_workflow_a_case_variant_of_the_bound_key_is_refused`: blocked, exit 2, no call (blind-hunter).
  - `[low]` `[patch]` `_compare_per_band` listed `max_followup_reviews` under `not_compared` and still compared the other bands (a non-int by-band entry, or an absent global). Now any problem leaves the limit in `not_compared` only, matching the contract's 0.1.34 clause and `launch.py:50-51`. The tightened test asserts no `compared` or `budget_mismatch` entry on the limit (blind-hunter).
  - `[low]` `[patch]` `_STORY_CLOSURE_RE` was greedy, so a status naming a second `by Story` read the last epic. It is now lazy (the first `by Story` after `resolved` is the closing story). Test `test_the_first_by_story_after_resolved_is_the_closing_story` (edge-case-hunter).
  - `[low]` `[patch]` a `JiraError` after the removal POST was sent (e.g. a timeout on an applied update) ended `blocked` without the hand-restore v3 body. A `removal_posted` flag now names the body whenever the restore is unconfirmed. Two tests, after and before the removal (edge-case-hunter).
- rejected: (1) "`plan-counter.yaml` 208 and the marker `last minted DW-207` lag the ledger's DW-208" (blind-hunter). DW-208 is the orchestrator's working-tree harvest of this spec's deferral, not this story's change. Earlier engine harvests (c7501251, 781376e4) bumped the counter and marker in their own commit, and the ledger and its bookkeeping are the orchestrator's. This is noted as a residual risk. (2) "DW-208 should be fixed, not deferred" (blind-hunter): it was triaged in pass 1 and is filed and owned by the orchestrator. (3) "`update_workflow(..., [], ...)` posts no statuses" (blind-hunter): `statuses` is the workflow's own statuses ∪ `status_ids` (`jirabackend.py`, `update_workflow`), so it is never empty. (4) "the unguarded `next()` can raise `StopIteration`" (blind-hunter): `present` is filtered by `has_global_transition`, which is the same predicate the `next()` uses (`_is_type GLOBAL` and `_transition_target == target`), so a match always exists. (5) "the 36-6 ask was rewritten in place" (blind-hunter): AC3 names the edit ("the 36-6 ask's v3 read reads `expand=values.transitions`"), and each edit is cited "corrected by Story 38.7". (6) "AC1 says 24 statuses but 23 are filled" (blind-hunter): the ids AC1 enumerates come to 23, and all 23 are filled (the Verification grep gives 23). This is a miscount in the AC's prose, not a missing closure.

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 6: (high 0, medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` The operator step said to add `[limits.by_band]` "under `[limits]`". A header put directly below `[limits]` moves every following key into `limits.by_band`, so the engine silently runs on its defaults. The handoff step now says: append it as its own table after the last `[limits]` key (before `[verify]`), never directly below the header, and gives the reason. `kb/bmad-base-patches.md` and the README give no placement and are unchanged (blind-hunter).
  - `[medium]` `[patch]` `setup --project-key <SCRATCH>` without `--verify-workflow` fell through to a live setup on the bound project. It now ends `blocked`, exit 2, before any call or write, and the reason names the missing `--verify-workflow` (`setup_project_key_refusal`). The contract's 0.1.34 Story 38.7 setup clause names the refusal, with a pin. Test `test_project_key_without_verify_workflow_is_refused_before_any_call` covers plain, `--dry-run` and `--owner-account-id` (blind-hunter).
  - `[low]` `[patch]` `_set_limits_key` found the header only on the exact text `[limits]`, so `[limits]  # …` or `[ limits ]` got no cap written while `check` compared band L. The header now matches `_LIMITS_HEADER` (inner whitespace and a trailing comment allowed). Test `test_story_38_7_a_limits_header_with_a_comment_or_inner_spaces_gets_the_cap` (edge-case-hunter, blind-hunter).
- review input: the diff since `55fa1518` came to about 300 KB, so each layer got it as a file (`/tmp/rev387/review-diff.txt`), not inline. It was built with `--ignore-cr-at-eol`, excludes this spec, and shows the contract as `--word-diff=plain`.
- rejected:
  1. "the 36-5 spec `:321` still says (b)/(c) owed" (blind-hunter). That line is the 36-5 run's historical result. AC2 names the 36-4 `:261` line only, and the 36-5 Consult Log `:221` holds the record DW-168 closes on.
  2. "nothing fills the in-loop `by Story N.M` at merge" (blind-hunter). This repeats the pass-1 rejection: AC1's own design, filled by the landing docs PR the handoff names.
  3. "`start` ignores `followup_cap.applied` when the cap write fails" (blind-hunter). This is the check-vs-start divergence class already filed as DW-208, which the orchestrator owns. The header-match cause is patched above.
  4. "`plan-counter.yaml` and the marker lag DW-208" (blind-hunter). This repeats pass 2: the orchestrator's harvest bookkeeping, noted as a residual risk.
  5. "a kept worktree relaunch keeps a band-L cap for the next story" (edge-case-hunter). This repeats pass 1: a kept worktree relaunches the same story, and a one-story run gives each story a fresh worktree.
  6. "a stale recorded folder id is never re-created" (edge-case-hunter). This repeats pass 1: shape 12 pins a recorded folder as found.

## Design Notes

- **Detached re-run (Consult Log 14:30Z, ruling apply).** If this story's first host leg goes red, a detached re-run leg (`hostleg.ts:15`) is also red on its own `by Story 38.7` closures. The operator re-runs on the run branch or fills the PR first; nobody waives the test. The lib unittest gate is not run under a stripped env (`tools/verify_host.py:142-143`), so a later fix needs no `verify_host.py` edit.
- **Band cap path.** The engine reads one global cap and has no band notion; `launch.py start` writes the run worktree's policy copy only (shape 9), registered in `kb/bmad-base-patches.md` as a policy setting, not a patch. Until the operator adds `[limits.by_band]`, `check` reports a band-L mismatch by design.

## Verification

**Commands:** (from `plugins/tk-studio/lib` unless noted)
- `uv run python -m unittest discover tests` -- green
- `uv run python ../contracts/conformance/runner.py run` -- `ok: true`
- root: `git ls-files --eol -- '*.py' '*.ts' '*.md' | grep -v '^i/lf'` -- prints nothing
- root: `grep -c '^status: resolved .* by Story 37\.[0-9] (thkennedy/tk-studio#3[234][0-9]' _bmad-output/implementation-artifacts/deferred-work.md` -- 23
- root: `uv run --no-project python plugins/tk-studio/lib/plansync.py ledger-resolve --directory . --pr thkennedy/tk-studio#1 --ids DW-110 DW-168 DW-145 DW-181 --dry-run` -- DW-110 pending; others unchanged
- root: `uv run --no-project python plugins/tk-studio/lib/launch.py check --directory . --spec _bmad-output/specs/spec-epic-38` -- `budget.compared` names `max_followup_reviews` per band with `policy_key`

## Deviation Summary

### pass 1 (2026-11-09, implementer)

- planned: a folder recorded at `planning.confluence.folders.<name>` counts as found, reported `folder <Title> (recorded)` / actual: listing-first, recorded as fallback; `(recorded)` appears only when the listing lacks the folder or is refused (a recorded folder is never created; the listing is still called when all five are recorded) / why: keeps the existing rerun and paging tests' expectations and the listing's adoption path / may affect: none
- planned: `verify_workflow {…, update_status}`, refused before any call only for a missing or bound `--project-key` / actual: `update_status` is `"accepted"` or the refusal text (not an HTTP code); missing Jira env, an absent or team-managed project and an unselected workflow also end `blocked`; a dry run ends `complete` / why: `update_workflow` returns `(bool, detail)`, and the guards stop a crash before the update / may affect: none
- planned: `followup_cap` reasons "main checkout", "after_stories not 1", "no by-band entry for M" / actual: those plus "no band read for <story>", "already N in [limits]" (`applied: true`, no write) and an unreadable-policy reason / why: cases the spec does not cover, each named / may affect: none
- planned: `launch.py` changes limited to the compare, the cap write and `followup_cap` / actual: `run_rhythm_row`'s instance lookup moved into a shared `_rhythm_instance` helper / why: one source for `stop.after_stories` / may affect: none
- planned: the fake's `/workflows/search` answers 400 to any other `expand` / actual: 400 only to a different `expand` value; no `expand` still answers; the pin checks the recorded query is `values.transitions` / why: an absent `expand` is not what the site refused / may affect: none
- planned: `test_launch.py`'s `not_compared` test updated / actual: it expects `max_followup_reviews: "absent from policy"` (fixture bands carry `followup_reviews_max`, fixture policy omits the global) / why: the cap is now compared per band / may affect: none
- open note: `_bmad-output/specs/spec-epic-36/plans/36-6.md:55` still quotes `expand=statuses,transitions` (a planning file, not edited).

- pass 1b (matrix audit): `StoryClosurePrRuleTests` added in test_plansync.py with module-level helpers; DEVIATIONS: none.

DRIFT: AC3's follow-up-review entries "stay `open (owner's decision …)`" overtaken by TKSTUDIO-235 (all six closed by the owner) — left byte-unchanged per the owner's decision — affects: none
DRIFT: folder step is listing-first, recorded as fallback; `(recorded)` appears only when the listing lacks the folder or is refused — keeps the existing rerun/paging pins — affects: none
DRIFT: `verify_workflow.update_status` is "accepted" or the refusal text, with extra `blocked` guards (Jira env, project, workflow) — `update_workflow` returns (bool, detail) — affects: none
DRIFT: `followup_cap` carries extra named reasons (no band read, already N, unreadable policy) — cases the spec does not name — affects: none
DRIFT: `_rhythm_instance` helper shared by `run_rhythm_row` and the cap write — one source for `stop.after_stories` — affects: none
DRIFT: the fake answers 400 only to a different `expand`, not to an absent one — an absent expand is not what the site refused — affects: none
DRIFT: `not_compared` test now expects `max_followup_reviews: "absent from policy"` — the cap is compared per band — affects: none

### pass 2 (2026-11-09, review patches)

- planned: the refused-restore pre-flight runs before the removal POST / actual: it also runs before the dry-run return, so `--dry-run` ends `blocked` on such a list (nothing posted) / why: a dry run reports the refusal the live run would hit / may affect: none
- planned: touch only the four patch targets / actual: the contract's 0.1.34 Story 38.7 `--verify-workflow` clause gains "a restore the update would refuse (checked before anything is posted, the dry run included)" and a dry-run test is added (consult ruling) / why: the clause listed every `blocked` end / may affect: none

DRIFT: the `--verify-workflow` refused-restore pre-flight also ends a `--dry-run` `blocked` (nothing posted) — a dry run reports what the live run would hit — affects: none
DRIFT: the contract's 0.1.34 Story 38.7 `--verify-workflow` clause names the pre-flight refusal — the clause lists every `blocked` end — affects: none

### pass 3 (2026-11-09, follow-up review patches)

- Implementer deviation score 0, no DRIFT. All edits stay within the plan's Files: `launch.py`, `plansync.py`, `test_launch.py`, `test_tracking_setup.py`, `driver-contract.md`, `test_driver_contract.py` and the handoff.
- The Verification list's `ledger-resolve` command passes `--ids` space-separated, but the CLI takes a comma-separated list. It was run as `--ids DW-110,DW-168,DW-145,DW-181`, with the expected answer.

## Consult Log

- 2026-11-09T14:30Z — trigger: halt — question: shape 1's strict detached-HEAD rule reads this story's own `by Story 38.7` closures red on a detached re-run leg (hostleg.ts:15); implement as pinned, widen via TK_SUPERVISOR_HOST_LEG, or escalate? — ruling: apply — do: Implement shape 1 as pinned (detached strict, no TK_SUPERVISOR_HOST_LEG read); record in Design Notes and the handoff that a red first leg means a detached re-run is also red on 38.7's closures (re-run on the run branch or fill the PR first, never waive); add one open deferred-work entry "a detached host-leg re-run reads every in-loop `by Story N.M` closure red (hostleg.ts:15 vs SPEC CAP-19)", proposed fix: let the re-run leg name its epic, for a planner — rule candidate: Any ledger or gate rule that keys on the git branch also states how it treats a detached host-leg re-run (hostleg.ts:15), settled by the planner in the SPEC's design notes before dispatch. (observe.py record: ok)
- 2026-11-09 — operator ask (CAP-20, CAP-14 (b)/(c) of Epic 36, tier ask, `unverifiable-here`): **answered before this run** — the 36-5 spec's Consult Log `:221` (2026-11-07T21:07Z, run `q-run-epic-38-20261107T203050Z-966fd1`, Story 38.1) records (b) exactly one `hold` across the ticks and (c) pid 94972 live with `StartTime` equal to `detail.start`; DW-168 closes on that record. No new box step.
- 2026-11-09 — operator ask (CAP-21, R5 / DW-175, tier ask, `unverifiable-here`): on the box, add to the machine-local `.bmad-loop/policy.toml` (gitignored; the dev session never edits it) under `[limits]`: `[limits.by_band]` with `L = { max_followup_reviews = 2 }`. Until then `launch.py check` reports the band-L `budget_mismatch` (`max_followup_reviews 1 < band L followup_reviews_max 2`) and `start` refuses without `--allow-budget-mismatch`. Confirm with `uv run --no-project python plugins/tk-studio/lib/launch.py check --directory . --spec <spec folder>` (`budget.compared` L entry with `policy_key limits.by_band.L.max_followup_reviews`, no mismatch). Record under this spec § Consult Log.
- 2026-11-09T17:1xZ — operator step done (CAP-21, R5 / DW-175; the landing's attended session, after #372 merged): the box's machine-local `.bmad-loop/policy.toml` carries `[limits.by_band]` with `L = { max_followup_reviews = 2 }` as its own table after the last `[limits]` key (before `[verify]`). Confirmed on the served checkout at `4a23911d`: `uv run --no-project python plugins/tk-studio/lib/launch.py check --directory . --spec _bmad-output/specs/spec-epic-38` → `budget.compared` L entry `limit max_followup_reviews, policy 2, band_value 2, policy_key limits.by_band.L.max_followup_reviews`; S and M read `policy 1` from `limits.max_followup_reviews`; `budget_mismatch []`; `not_compared` only `session_timeout_min` and `max_tokens_per_session` (no band field). The check's own status is `blocked` (`bmad-loop is not on PATH`): the host runs no engine, the sandbox does. The expected band-L mismatch is gone; `start` needs no `--allow-budget-mismatch` for it.
- 2026-11-09 — operator ask (CAP-21, DW-182 part (1), tier ask, `unverifiable-here`, Tim's live call): on the box, once `DW-182: <letter>` and `tokens: set` are answered on TKSTUDIO-236, run `uv run --no-project python plugins/tk-studio/lib/plansync.py setup --directory . --verify-workflow --project-key <SCRATCH> --dry-run`, then without `--dry-run`; record the `verify_workflow {project_key, transition, removed, restored, update_status}` answer under this spec § Consult Log.
- 2026-11-09T14:54Z — trigger: deviation-gt-0 — question: accept the six pass-1 deviations (folder listing-first, update_status text and extra guards, extra followup_cap reasons, _rhythm_instance helper, fake 400 only on a different expand, not_compared expectation)? — ruling: accept-deviation score 1 — do: Keep all six as implemented, recorded in §Deviation Summary with score 1; leave the contract's 0.1.34 Story 38.7 paragraph unchanged; word deviation 1 as "listing-first, recorded as fallback; `(recorded)` appears only when the listing lacks the folder or is refused" — rule candidate: In plan shapes and contract clauses, a parenthesised list of reasons, labels or statuses is an open example set; an implementer who adds an entry consistent with the stated invariant scores it 1 and logs it without a consult. (observe.py record: ok)
- 2026-11-09T15:09Z — trigger: deviation-gt-0 — question: accept the review-patch pass deviations (the refused-restore pre-flight also ends `--dry-run` blocked; the contract's --verify-workflow clause not naming it)? — ruling: accept-deviation score 1 — do: (a) keep the pre-flight ahead of the dry-run return and add a fake-backed dry-run test (blocked, nothing posted, the refused transition named); (b) amend the 0.1.34 paragraph's clause to "no GLOBAL transition present, a restore the update would refuse (checked before anything is posted, the dry run included), or a failed restore, ends `blocked`"; record both as score 1 — rule candidate: A check that ends a write path `blocked` before anything is posted also runs under `--dry-run`; each such reason goes into the story's own contract paragraph in the same patch. (observe.py record: ok)

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:56Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-09T05:12:02Z | 2026-11-09T05:16:41Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-09T14:28:43Z | 2026-11-09T15:10:22Z | 8dc51129-4263-4cf2-bfd8-e73a68b0c1cd | claude-opus-5-5 | medium | 26350955 | 183986 | 13.9103 | completed |
| review | 1 | 2026-11-09T15:10:23Z | 2026-11-09T15:26:40Z | d3a65304-2a68-4d85-be2f-4a5eadd574e0 | claude-opus-5-5 | medium | 8157272 | 72848 | 5.3385 | completed |
| review | 2 | 2026-11-09T15:26:41Z | 2026-11-09T15:40:44Z | 21a0dbe5-78fe-4096-a12c-19c14c5ae60a | claude-opus-5-5 | medium | 11115754 | 74078 | 6.2590 | completed |
| gate | 1 | 2026-11-09T15:40:44Z | 2026-11-09T15:42:07Z | 8c97d24e-6a67-47e7-8301-5dbd3f1e7893 | claude-opus-5-5 | medium | 973605 | 7224 | 0.9366 | completed |
| host-leg | 1 | 2026-11-09T15:42:19Z | 2026-11-09T17:00:21Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-09T17:00:21Z | 2026-11-09T17:00:31Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-09T17:01:23Z | 2026-11-09T17:01:23Z | — | — | — | — | — | — | merged |



## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261109T142653Z-e4c3e2` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary (follow-up review pass 3, `review_loop_iteration` 0).** Both layers (band L) reviewed the full diff since `55fa1518`. Three patches were applied:
- The operator step now says where `[limits.by_band]` goes, and why.
- `setup --project-key` without `--verify-workflow` is refused before any call.
- The `[limits]` header match tolerates a trailing comment and inner spaces.

Nothing was deferred. Six findings were rejected, four of them repeats of earlier passes. The orchestrator owns the ledger entries, and none was touched.

**Files changed (this pass).**
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md`: operator step 1 says to append `[limits.by_band]` after the last `[limits]` key, never directly below the header, and why.
- `plugins/tk-studio/lib/plansync.py`: `setup_project_key_refusal()`; `main()` refuses `--project-key` without `--verify-workflow` (`blocked`, exit 2, no call).
- `plugins/tk-studio/lib/launch.py`: `_LIMITS_HEADER` regex used by `_set_limits_key`; docstring.
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.34 Story 38.7 setup clause names the `--project-key` refusal (additive).
- `plugins/tk-studio/lib/tests/test_tracking_setup.py`, `tests/test_launch.py`, `tests/test_driver_contract.py`: the refusal test (three variants), the header-variant cap test, and the contract pin.
- This spec: the triage log, the deviation note and this result.

**Review findings.**
- 3 patches applied: 0 high, 2 medium, 1 low.
- 0 deferred.
- 6 rejected.
- Follow-up review recommended: **true**. Patched: 0 high, 2 medium, 1 low; score 3×2 + 1×1 = 7, which is 5 or more.

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: 3109 tests OK (5 skipped). This session ran it after the implementer did.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, `failures: []`.
- `git ls-files --eol -- '*.py' '*.ts' '*.md' | grep -v '^i/lf'` prints nothing.
- The 37.x PR-fill grep gives 23.
- `ledger-resolve --dry-run` reports DW-110 pending and DW-168, DW-145 and DW-181 unchanged. It was run with comma-separated `--ids`.
- `launch.py check`: `budget.compared` has a `max_followup_reviews` entry for S, M and L, each with `policy_key`. `check` read `blocked` for the same causes outside the story as in earlier passes (this run's live engine, and the uncommitted tree).
- The implementer confirmed that each new test fails on the pre-patch code. Implementer deviation score: 0. No file outside the plan's Files was touched.

**Residual risks.**
- DW-208 (check vs start on the band-L cap) still covers `start` spawning when the cap write fails for other reasons (an unparseable policy, a failed re-read restore); `followup_cap.reason` names each.
- The pass-2 residual risks still hold:
  - The deferred-work counter and marker lag the ledger's DW-208.
  - DW-207 (detached re-run).
  - The box's `[limits.by_band] L` is unset, so `check` reports the band-L mismatch until the operator adds it.
  - The live `--verify-workflow` (Tim's call).

## Reconcile

- 2026-11-09 — score 1; reconcile not required.

Gate: Part A not-required; Part B epic complete: no next story (38-7 accepted, AC1 met, AC2 met, AC3 met-with-deviation; every stories.yaml entry has a spec; no open replan entry names an unstarted story)
