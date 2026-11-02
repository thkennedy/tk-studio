---
title: 'One Id Source for the Ledger'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_revision: 'cfaf66e0732a026aa0add1f2c8206d94ba94ae4c'
deviation_score: 2
reconcile_verdict: adjust-stories
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-37/plans/37-1.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The contract's 0.1.32 paragraph does not describe the `deferred mint` answer when the marker write fails after the counter write.
    evidence: |-
      Meets (b), a contract surface left unpinned. mint_deferred answers blocked, exit 2, with written naming only the counter and a reason saying the ids are burned; the contract says the verb names both files in written[].
    location: >-
      plugins/tk-studio/contracts/driver-contract.md
    severity: low
---

<intent-contract>

## Intent

**Problem:** Deferred-work ids are minted from the ledger's highest `DW-N` on whichever branch writes, so the engine's harvest and the operator's hand-filed entries minted the same ids twice in Epic 36 (hole 107; DW-149), and a duplicate heading is silently first-wins in the parser. Epic 36 also left doubled and unfinished entries.

**Approach:** One `deferred-work` counter and one lib verb both writers go through, a named refusal in every studio parser so the gate goes red, the ledger and runbook put right, and the contract's 0.1.32 entry opened.

## Acceptance Criteria (verbatim, Story 37.1)

AC1. **Given** `deferred-work.md` and the two writers (the engine's `spec-deferrals-harvested` step in `.bmad-loop/plugins/studio-pipeline` and the operator's docs pass) **When** either files an entry **Then** the id comes from a `deferred-work` counter in `.tk-studio/plan-counter.yaml` (beside `epic`, `story`, `task`) through one lib verb (`plansync.py deferred mint --directory <root> [--count N]`, answering the ids and bumping the counter in the same write), the harvest reads the counter at the run's base and reserves its block (the counter bump lands in the story commit), the operator's `insert`/docs pass calls the same verb, and the migration seeds the counter from the ledger's highest heading on `main`

AC2. **Given** a ledger with a duplicate heading (two `### DW-N:` lines) **When** `plansync.py ledger-resolve`, the sweep's triage, `measurepush.py` or the conformance runner parses it **Then** the parse refuses by name (`LedgerDuplicateId` naming both lines) so the engine's gate and the host leg go red on it, never a silent last-wins; the lib suite pins the refusal; the contract (0.1.32, additive) names the counter, the verb and the refusal

AC3. **Given** the entries Epic 36 left: DW-135 (a duplicate of DW-133), DW-140 to DW-143 (duplicates of DW-136 to DW-139), DW-145 (no `status:` line), DW-154 (its text names the fix commits wrongly), and the "by this story's PR" numbers left as placeholders **When** this story's PR lands **Then** the duplicates read `status: resolved … duplicate of DW-N`, DW-145 carries its status line, DW-154's text and every placeholder number are corrected, the spec deferrals the retrospective's C8 lists are filed as entries, and the runbook's hole-107 row reads fixed

## Boundaries & Constraints

**Always:** Stdlib-only Python run via `uv run`; atomic writes (`_atomic_write`); the verb ends in the JSON status block; name `encoding="utf-8"` on every text-mode open, `read_text`, `write_text` and `subprocess` text call (AGENTS.md, DW-132; `e2e_text_encoding` fails the call site). `reconcile_gate.py` and its `apps/supervisor` mirror stay byte-identical. The plan's Files list is the boundary; any other file is a recorded deviation. Each AC is proven by a test or a command whose output shows it.

**Block If:** The plan's "Risks and open decisions" Block If lines (the hook cannot read a harvest without a veto; the pins refuse a second verify command; DW-145 or DW-154 cannot stay `open`/re-homed to 37.2). Report these rather than deciding.

**Never:** Edit the engine (bmad-loop), the stock `bmad-loop-sweep` skill (AD-4), `.bmad-loop/policy.toml`, `.bmad-loop/routing.toml`, `epics.md`, the canonical plan files, `stories.yaml`, or anything under `implementation-artifacts/supervision/`. Never `git push`, tag, open a PR, or run the release motion. Never veto a commit for the counter, and never renumber a harvested id. Do not decide the owner's items: DW-145 stays `open` (37.7 relabels it). Do not change `board.ts openFindings`, `measurepush.py` or `runner.py`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Seed | counter has no `deferred-work`; ledger's highest id is DW-164 | `deferred mint` answers `DW-165`; `next.deferred-work` = 166; `epic`/`story`/`task` kept; marker line reads `DW-165` | None expected |
| Seed from body text | a `DW-N` in body text above the highest heading | seed is that N + 1 (the engine's `next_seq` rule) | None expected |
| Block | `--count 3` | three consecutive ids, one counter write | None expected |
| Dry run | `--dry-run` | ids answered; counter and ledger bytes unchanged; `written` empty | None expected |
| Bad counter | `next.deferred-work` not an int >= 1 | refused, nothing written | `blocked`, exit 2 |
| Bad count | `--count 0` | refused, nothing written | `blocked`, exit 2 |
| Duplicate at mint | ledger has two `### DW-N:` | `LedgerDuplicateId`, nothing written | `blocked`, exit 2 |
| Duplicate at resolve | `ledger-resolve` over two `### DW-N:` | `LedgerDuplicateId: DW-N at lines a and b` | `blocked`, exit 2, no `retryable` |
| Duplicate at sweep | `launch.py sweep` over the same ledger | refused before any engine spawns, naming both lines | a refusal status block |
| Real ledger | the tracked `deferred-work.md` | parses with no duplicate; every entry has a status line; no `by this story's PR` remains | a planted duplicate fails the test |
| Harvest, hook | journal has `spec-deferrals-harvested`, or a heading above the counter | `pre_commit` hook sets `next.deferred-work` and the marker to the ledger's highest + 1; the bump is in the tree the commit squashes | never a veto |
| No harvest, hook | no journal event, no heading above the counter | no write, no veto output | None expected |
| Marker inert | marker line in the header | no studio parser reads it as an entry; the engine's `next_seq` mints above it (pinned in `test_dwledger.py`) | None expected |

</intent-contract>

## Code Map

The plan's `## Code Map` (`plans/37-1.md`) is the investigation: every path, line anchor, reuse point and the 48-placeholder story-to-PR map. Start from it and do not repeat the search. Anchors confirmed at planning:

- `plugins/tk-studio/lib/plansync.py:3287-3295` -- `_ledger_spans`, the first-wins `setdefault` to route through the parser
- `plugins/tk-studio/lib/plansync.py:255-279` -- `Minter`, which does not fit `DW-N`; add a sibling `mint_deferred`
- `plugins/tk-studio/lib/launch.py:1818-1834` -- the sweep preflight, where the triage refusal lands
- `.bmad-loop/plugins/studio-pipeline/reconcile_gate.py` -- the one `pre_commit` seam; `meter_hook.py:37` is the precedent for calling plansync
- `plugins/tk-studio/pipeline/verify-commands.toml:18` -- the engine gate's tracked list; `launch.py check` reconciles the gitignored policy from it at launch, so the policy is not edited here
- `plugins/tk-studio/contracts/driver-contract.md:5-6,770` and `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the 0.1.32 bump
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-135 :1062, DW-140-143 :1102-1132, DW-145 :1142, DW-154 :1213
- `_bmad-output/specs/spec-epic-36/RETROSPECTIVE.md:49,77` -- A5 and C8, the text of the entries to file
- `kb/agent-pc-setup-runbook.md:1661` -- the hole-107 row

## Tasks & Acceptance

**Execution** (each file's action is in the plan's `## Files` and `## Settled shape`; order by dependency):

- `plugins/tk-studio/lib/dwledger.py` -- create `parse_ledger`, `LedgerDuplicateId(Refusal)`, marker helpers -- the one parser (AC2)
- `plugins/tk-studio/lib/plansync.py` -- add `mint_deferred`, `deferred mint`, `_deferred_main`; route `_ledger_spans` through the parser; docstring -- the verb and the refusal (AC1, AC2)
- `plugins/tk-studio/lib/launch.py` -- sweep preflight refuses a duplicate -- the triage's refusal without forking the stock skill (AC2)
- `.bmad-loop/plugins/studio-pipeline/reconcile_gate.py`, `apps/supervisor/.bmad-loop/plugins/studio-pipeline/reconcile_gate.py` -- post-harvest counter and marker bump, byte-identical -- the bump lands in the story commit (AC1)
- `plugins/tk-studio/pipeline/verify-commands.toml` -- add `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_dwledger` -- the engine's gate goes red (AC2)
- `plugins/tk-studio/contracts/conformance/manifest.json`, `plugins/tk-studio/contracts/conformance/fixtures/ledger-duplicate/_bmad-output/implementation-artifacts/deferred-work.md` -- the `tk-studio-plan-sync` drive, `expect: refusal`, `marker: LedgerDuplicateId` -- the runner's half of AC2
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/skills/tk-studio-plan-sync/SKILL.md` -- 0.1.32 cell, clause, rulings row, paragraph before `## 8. Conformance`, the skill row, the verb -- AC2, AD-19
- `plugins/tk-studio/lib/tests/test_dwledger.py`, `test_plansync.py`, `test_launch.py`, `test_stage_log.py`, `test_conformance.py`, `test_driver_contract.py` -- cover every I/O matrix row; the nested-copy pin; 42 flips, 5 guard deletions, `test_0_1_32_story_37_1_one_id_source` -- the proofs
- `.tk-studio/plan-counter.yaml` -- seeded through the verb, never by hand -- the migration (AC1)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- marker line; DW-135, 140-143; DW-145; DW-154; 48 placeholders; C8 entries through `deferred mint --count 4`; DW-149 resolved -- AC3
- `kb/agent-pc-setup-runbook.md` -- append `; fixed (Story 37.1, DW-149): …` to the hole-107 row with the narrowed hand rule -- AC3

**Acceptance Criteria:** AC1, AC2 and AC3 above, plus:

- Given the repo after this story, when `plansync.py deferred mint --directory . --count 1 --dry-run` runs, then it answers the next id above every id the ledger holds and changes nothing.
- Given a planted duplicate heading in a copy of the real ledger, when the parser reads it, then the refusal names both line numbers.
- Given the ledger after this story, when grepped for `by this story's PR`, then there are no matches, and `DW-154`'s text names Story 37.2, `bcfa691` (#307) and `6d0a0cc` (#313), not Story 36.4 as its fix.

## Spec Change Log

## Review Triage Log

### 2026-11-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 4, low 2)
- defer: 0
- reject: 2 (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `deferred mint` answered `written: []` after the counter moved when the marker write failed; `written` now names the counter and the reason says the ids are burned, with a test.
  - `[medium]` `[patch]` `by this story's PR` now fails a test with no stated replacement; the contract, the plan-sync skill and the test's message name `by Story N.M`.
  - `[medium]` `[patch]` DW-149 read resolved outright; its status now records the remainder, the narrowed hand rule with the refusal as the catch after the merge.
  - `[medium]` `[patch]` The every-entry status test sat in the engine's gated module; moved to `test_plansync.py` per the consult ruling, with the placeholder test.
  - `[low]` `[patch]` The hook printed an advisory on a bad counter with no harvest; it now writes and prints nothing there, with a test.
  - `[low]` `[patch]` The hook's advisory misdescribed a counter ahead of the ledger; the line, docstring and contract now say the greater of the counter and the ledger's highest + 1.
- rejected:
  - The counter and marker lines conflict textually on a live hand mint: SPEC.md:123's assumption already states the collision at the counter file and the ledger, and the merge conflict is a louder catch than the refusal.
  - Nothing asserts the bump lands in the story commit: the installed engine fires `pre_commit` (engine.py:2787) before `finalize_commit`, which runs `git add -A` (verify.py:1745), and the harvest (engine.py:2244) precedes both. Read from the engine, not run end to end; recorded as a residual risk.

### 2026-11-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 3 (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` The 0.1.32 paragraph said a collision after a merge goes red on the host leg, but the leg runs on the run branch without merging `main`, so the colliding PR's own leg stays green; the paragraph now says the duplicate first goes red on the next leg or gate over a tree holding both copies, and the later id is renumbered there.
  - `[low]` `[patch]` The hook's rewrite of the counter and marker can conflict textually with a planning PR or hand mint on `main` with no id collided, and the contract gave no resolution; the paragraph now says to keep each key's higher value and the marker naming the higher id.
  - `[low]` `[patch]` AC1's "the bump lands in the story commit" was asserted only in a directory with no repository; `test_the_bump_lands_in_the_story_commit_of_a_real_repository` commits through `git add -A` and `test_the_real_counter_is_tracked_and_not_ignored` pins the real file. This narrows pass 1's rejected note; the engine's own ordering stays read, not run.
- rejected:
  - Counter and marker sit behind the harvested DW-169 (counter 169, marker DW-168): the harvest ran after the session's commit and the hook has not fired yet. `bump_counter` over a copy of the tree answers counter 170 and marker DW-169, and `deferred mint --dry-run` answers DW-170, so nothing can mint a taken id.
  - The engine's `_carry_harvested_deferrals` commits with no `pre_commit`: inert here, `.bmad-loop/policy.toml:112` is `isolation = "none"`.
  - Two concurrent `deferred mint` processes on one checkout can answer the same id: the verb is an operator's hand command, no criterion names concurrency, `Minter` takes no lock either, and `LedgerDuplicateId` catches the result.

### 2026-11-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 8 (high 0, medium 1, low 7)
- addressed_findings:
  - `[low]` `[patch]` The §2 row names `deferred mint` but the shipped suite never drove it (§8, AD-19); `manifest.json` now drives it over `fixtures/ledger-duplicate` with `expect: refusal`, `marker: LedgerDuplicateId`, and `test_shipped_deferred_mint_drive_refuses_by_name` pins exit 2, both line numbers and `status: blocked`.
- rejected:
  - Counter 169 and marker DW-168 sit behind the harvested DW-169: pass 2's rejection stands, the hook has not fired on this tree. `deferred mint --dry-run` answers DW-170 here, so no taken id can be minted.
  - DW-149 is resolved with no open entry for its remainder: the remainder is written in DW-149's status, the runbook's hole-107 row, the contract's hand rule and SPEC's assumption, which says the reservation is not in this epic. The invocation also forbids rewriting the entry.
  - The status and placeholder tests run only on the host leg: the 2026-11-02T21:44:33Z consult placed them there, and the question is not reopened.
  - The §2 row omits the verb's arguments and refusals: the row's implementation cell points at the verb, the 0.1.32 paragraph states its arguments, answer and refusals, and `ledger-resolve` is documented the same way.
  - The hook's plain line could hide a veto: `bus.py:104-117 _last_json` reads the last non-empty stdout line, and the bump prints before the gate, so a veto line stays last.
  - Two concurrent mints can answer one id: pass 2's rejection stands.
  - A `ledger-resolve` overlapping a mint could lose its flip to the marker write: `plansync.py` holds no lock on either verb, no criterion names concurrency, and the mint is an operator's hand command.
  - `### DW-7:` beside `### DW-07:` is not refused: neither writer pads an id, the engine and the verb both write `DW-<n>`, and the AC names two `### DW-N:` lines.

## Design Notes

SPEC.md's CAP-1, CAP-2 and CAP-3 design notes and the plan's `## Settled shape` bind the shapes: the marker line text, the verb's answer, the refusal's message, the contract bump's mechanics. `measurepush.py` and `runner.py` parse no ledger, so the AC's names resolve to the conformance drive and the gate command (design note, not a deviation).

**The duplicates' citation.** The design note's shape is `by thkennedy/tk-studio#<PR>`, but this story's own PR does not exist inside the loop (the loop touches no remote), and AC3 forbids a placeholder number. For entries this story closes (DW-135, 140-143, DW-149), write `status: resolved 2026-11-02 by Story 37.1 (duplicate of DW-N)` (DW-149 without the parenthesis). Report this as a deviation from the design note. Every other placeholder takes the merged PR from the plan's map; confirm the older numbers (#240, #258, #261) from `git log --merges` rather than trusting the map.

**C8's entries, four ids.** DW-131's Jira stage-log half (36-2 spec :187, :365); DW-64's remainder (36-3 spec :304); no gate runs `command-line.test.ts` (36-5 spec :323); one entry for the four operator proofs of A5, owned by 37.7. The entry shape is `### DW-N: title`, `origin:`, `source_spec:`, `location:`, `severity:`, `reason:`, `status: open`.

## Verification

**Commands:**

- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger` -- expected: green, the engine's two gate commands
- `uv run --no-project python plugins/tk-studio/lib/plansync.py deferred mint --directory . --count 1 --dry-run` -- expected: answers the next id, tree unchanged
- `uv run --no-project python plugins/tk-studio/lib/plansync.py ledger-resolve --directory . --ids DW-149` -- expected: parses the real ledger through `dwledger`, no refusal
- `grep -c "by this story's PR" _bmad-output/implementation-artifacts/deferred-work.md` -- expected: 0

## Deviation Summary

### pass 1

- planned: duplicates cite `by thkennedy/tk-studio#<PR>` (design note) / actual: `status: resolved 2026-11-02 by Story 37.1 (duplicate of DW-N)`, DW-149 without the parenthesis / why: the spec's Design Notes order it; the PR does not exist inside the loop / may affect: none
- planned: the verb answers `written: [<counter>]` with one write (SPEC CAP-1 note) / actual: `written` names the counter and the ledger, a separate atomic write each, and the answer adds `dry_run` / why: the marker is a second file and commit staging derives from `written[]`; the contract states this shape / may affect: none
- planned: the fixture is the ledger file only / actual: also `fixtures/ledger-duplicate/.tk-studio/config.yaml` / why: without it `find_project_root` climbs to the checkout and reads the real ledger / may affect: none
- planned: only DW-145 lacks a status line / actual: DW-27 also had none and gained `status: open` / why: the matrix and `test_every_entry_has_a_status_line` require one on every entry; a sweep's triage may now read it as open / may affect: none
- planned: 42 `**0.1.31**` pins flip / actual: 42 plus the `assertRegex` in `test_carries_its_own_semver_and_change_policy` / why: it pins the current version, outside the plan's count / may affect: none
- planned: verification runs `ledger-resolve --directory . --ids DW-149` / actual: `--pr` is required, so it ran with `--pr thkennedy/tk-studio#325 --dry-run`, answering `unchanged` with no refusal / why: making `--pr` optional would be an unrequested surface change / may affect: none
- planned: the hook follows the `meter_hook.py` precedent of calling plansync / actual: the bump is inline in `reconcile_gate.py`, pinned equal to `dwledger.with_marker` by test / why: no verb bumps to the ledger's highest, and adding one is a surface outside the AC / may affect: none
- planned: the mint takes ids from the counter / actual: it starts at `max(counter, ledger's highest + 1)`, and a project with no ledger is refused / why: the spec's acceptance line requires the next id above every id the ledger holds; the no-ledger case mirrors `ledger-resolve` / may affect: none
- planned: pin the engine's `next_seq` against the marker / actual: `test_dwledger.py` uses a local copy of the engine's rule / why: lib tests are stdlib-only and cannot import the engine, so upstream drift would not fail this test / may affect: none
- planned: the parser keeps the `### DW-N: ` heading regex (trailing space) / actual: it matches `### DW-N:` as the AC writes it / why: a doubled heading with no space must not slip past the refusal / may affect: none

DEVIATION SCORE: 2

DRIFT: duplicates cite `by Story 37.1`, not a PR number — the story's own PR does not exist inside the loop — affects: none
DRIFT: `deferred mint` `written` names counter and ledger, two atomic writes, plus `dry_run` — the marker is a second file — affects: none
DRIFT: fixture gains `.tk-studio/config.yaml`, a file outside Files — project-root resolution would otherwise read the real ledger — affects: none
DRIFT: DW-27 gains `status: open` — the every-entry status test requires it — affects: none
DRIFT: a 43rd version pin flipped — it pins the current version — affects: none
DRIFT: `ledger-resolve` verification needs `--pr` — the spec's command omitted a required flag — affects: none
DRIFT: the hook's bump is inline, not through plansync — no verb bumps to the ledger's highest — affects: none
DRIFT: mint starts at max(counter, ledger highest + 1); no ledger is refused — the acceptance line requires an id above every id held — affects: none
DRIFT: the `next_seq` pin is a local copy of the engine's rule — lib tests cannot import the engine — affects: none
DRIFT: the heading regex drops the trailing space — a doubled heading must not slip past — affects: none

## Consult Log
- 2026-11-02T21:44:33Z — trigger: deviation-gt-0, file-outside-files — question: accept the implementer's deviation set, and does the every-entry status test stay in the gated module? — ruling: accept-deviation score 2 — do: move test_every_entry_has_a_status_line and test_no_placeholder_pr_number_remains from test_dwledger.py RealLedgerTests to a new real-ledger class in test_plansync.py, leaving test_it_parses_with_no_duplicate, the planted-duplicate test and the gate command unchanged, then rerun the gate; record the move in the Deviation Summary and DRIFT, and reword DW-27 as a restored line (born status: open at 52960b4b), may-affect naming the sweep's triage; accept the rest as built — rule candidate: a module named in verify-commands.toml holds only tests for the failure its AC assigns to the engine gate; content checks on the real ledger run in a lib module reached only by discover.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-02T21:12:24Z | 2026-11-02T21:26:53Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-02T21:27:18Z | 2026-11-02T21:51:47Z | a9dcf86e-f847-4095-9d56-3d1cb1c041e1 | claude-opus-5-5 | medium | 6073112 | 136940 | 8.0492 | completed |
| review | 1 | 2026-11-02T21:51:47Z | 2026-11-02T22:03:21Z | d75217a8-203a-465d-ba45-26c01a7d9080 | claude-opus-5-5 | medium | 3376479 | 66134 | 4.3468 | completed |
| review | 2 | 2026-11-02T22:03:21Z | 2026-11-02T22:12:56Z | 4e56f9bb-551b-4581-a7f1-bdf7ae3c427d | claude-opus-5-5 | medium | 2672271 | 57103 | 3.9925 | completed |
| gate | 1 | 2026-11-02T22:12:57Z | 2026-11-02T22:16:35Z | ab3c309f-29db-4dad-a5dd-967ecfc655af | claude-opus-5-5 | medium | 1150344 | 23619 | 1.8528 | completed |

## Deviation Summary (continued)

### pass 2

- planned: the status and placeholder tests in `test_dwledger.py` / actual: moved to `RealLedgerContentTests` in `test_plansync.py` / why: consult ruling; the gate command catches only the duplicate AC2 names / may affect: none
- correction to pass 1's DW-27 entry, per the consult: DW-27 was born `status: open` at 52960b4b and a later edit lost the line, so `status: open` is a restored line, not a new one / may affect: the sweep's triage, which now reads DW-27 as open

DRIFT: status and placeholder tests live in `test_plansync.py`, not the gated module — consult ruling — affects: none
DRIFT: DW-27's `status: open` is a restored line — a later edit lost it — affects: the sweep's triage

### follow-up review

- no new deviation: both patches stay inside the plan's Files, and the score stays 2
- both review layers read the diff from a file rather than inline, because it is 348 KB; the spec and stage files were left out of it

### follow-up review 2

- no new deviation: the patch stays inside the plan's Files, and the score stays 2
- both review layers read the diff from a file again, because it is 352 KB; the spec and stage files were left out of it
- the invocation's order held: this pass changed no ledger entry, and the ledger and counter are as `4a22b329` left them

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-37-20261102T205725Z-f1285f` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Second follow-up review of Story 37.1. Both ledger writers take ids from one `deferred-work` counter, every studio parser refuses a duplicate heading by name, the Epic 36 ledger entries are put right, and the contract is at 0.1.32. This pass added the missing conformance drive for `deferred mint`.

**Files changed in this pass:**
- `plugins/tk-studio/contracts/conformance/manifest.json` -- the `deferred mint` duplicate drive
- `plugins/tk-studio/lib/tests/test_conformance.py` -- `test_shipped_deferred_mint_drive_refuses_by_name`

**Review findings:** 1 patched, 0 deferred, 8 rejected.

**Follow-up review recommendation:** false. Patched high 0, medium 0, low 1; score 3 x 0 + 1 x 1 = 1.

**Verification:**
- `uv run python -m unittest discover tests`: 2842 tests, OK, 4 skipped
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, 23 surfaces, no failures
- `tests.test_release_roster tests.test_dwledger`: 95 tests, OK
- `deferred mint --count 1 --dry-run`: answers DW-170, `written: []`
- `ledger-resolve --ids DW-149 --pr thkennedy/tk-studio#325 --dry-run`: `ok: true`, `complete`, no refusal
- `grep -c "by this story's PR"` on the ledger: 0
- `cmp` of the two `reconcile_gate.py` copies: identical

**Residual risks:**
- Until the engine's `pre_commit` fires, the tree reads counter 169 and marker DW-168 with DW-169 filed. This pass did not rerun the hook over a copy; pass 2 did, and the dry run above still answers above every held id.
- The engine's firing order is read from the engine, not run end to end.
- A collision is caught on the next leg or gate over a tree holding both copies, not on the colliding PR's own leg, and a hand mint on `main` during a live run can still collide. No open ledger entry tracks this remainder.
- The second gate command reaches the gitignored policy at the next `launch.py check`.
- The `next_seq` pin is a local copy of the engine's rule, so upstream drift would not fail it.
- Epic 37's CAP-18 lists DW-135 as closing by 37.6's PR, but it is resolved here.
- DW-169 stays `open`: the contract still does not describe the burned-ids answer. It was left to the orchestrator.

DRIFT: duplicates cite `by Story 37.1`, not a PR number — the story's own PR does not exist inside the loop — affects: none
DRIFT: `deferred mint` `written` names counter and ledger, two atomic writes, plus `dry_run` — the marker is a second file — affects: none
DRIFT: fixture gains `.tk-studio/config.yaml`, a file outside Files — project-root resolution would otherwise read the real ledger — affects: none
DRIFT: DW-27's `status: open` is a restored line — a later edit lost it — affects: the sweep's triage
DRIFT: a 43rd version pin flipped — it pins the current version — affects: none
DRIFT: `ledger-resolve` verification needs `--pr` — the spec's command omitted a required flag — affects: none
DRIFT: the hook's bump is inline, not through plansync — no verb bumps to the ledger's highest — affects: none
DRIFT: mint starts at max(counter, ledger highest + 1); no ledger is refused — the acceptance line requires an id above every id held — affects: none
DRIFT: the `next_seq` pin is a local copy of the engine's rule — lib tests cannot import the engine — affects: none
DRIFT: the heading regex drops the trailing space — a doubled heading must not slip past — affects: none
DRIFT: status and placeholder tests live in `test_plansync.py`, not the gated module — consult ruling — affects: none

## Reconcile

### 2026-11-02 — adjust-stories

- Score: 2
- Reasoning: Nine of the eleven DRIFT lines touch nothing later work relies on: the two-file `written[]`, the inline hook, the mint's floor and the regex are all stated in the 0.1.32 paragraph, and no later story was planned against them. The `by Story N.M` closure form is marked `affects: none` but does bind later work: `test_no_placeholder_pr_number_remains` now fails the old `by this story's PR` wording, and 37-2 to 37-6 each close ledger entries. A note absorbs that, as it does the moved ledger anchors, the hook's counter writes and DW-168's owner. DW-27's restored line (`affects: the sweep's triage`) reaches no story here: no story runs a sweep, and the entry stays the sweeps' (SPEC Non-goals).
- Affected: 37-2-the-windows-classes-out-of-the-host-leg — "`deferred-work.md`: DW-150 (:1181), DW-154 (:1213, re-homed here by 37.1), DW-155 (:1221) resolved."
- Affected: 37-3-a-timed-out-session-keeps-its-stop-and-its-records — "DW-148, DW-157, DW-161 resolved."
- Affected: 37-4-the-status-edges-and-the-rhythm-for-every-job — "DW-151, DW-159, DW-160 resolved."
- Affected: 37-5-the-sweeps-bugs-and-cost-lines-before-a-fourth-sweep — "DW-136 to DW-139, DW-144 resolved."
- Affected: 37-6-one-stop-path-and-the-gates-blind-spots — "DW-133, DW-162, DW-164 resolved (DW-135 already a duplicate)."
- Affected: 37-7-the-records-reconciled-and-the-proofs-captured — "DW-145 `:1142-1147` (37.1 gave it `status: open`)"
- Not a criterion change: 37.6's "DW-133 and DW-135 close by this PR" overlaps 37.1's own AC3 in `epics.md`, so no deviation caused it. Both are closed once 37.6 lands, and plan 37-6 already reads it so. If the operator wants the wording exact, that is a later `bmad-correct-course`.
- Invariant: none. AD-4 held (engine and stock skill untouched). DW-169 (low) records that the 0.1.32 paragraph omits the burned-ids answer; it is an unpinned failure path, not a contradiction, and stays open.

Gate: Part A adjust-stories; Part B story accepted, planned 37-2-the-windows-classes-out-of-the-host-leg
