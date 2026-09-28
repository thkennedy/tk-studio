---
title: 'Contract 0.1.18 Names the Supervisor and Hermes'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: 'e75436a75cabeb3e3b13e3b3c59409488976401f'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The contract names no executing wrapper for a one-shot run started from the invoke-skill directive that `submit` returns, and gives no path for Hermes (which submits but never executes) to hand that directive to the supervisor.
    evidence: |-
      AC3 pins the wrapper as "whichever conformant driver executed its `wake` directive" (transcribed verbatim, so not extended here). But lib/jobrun.py submit() also creates the run and returns an invoke-skill directive for one-shot skill-target jobs (e.g. run-epic), and §4's KB-injection section says directives come from "submit/wake". Deferral class (b): a contract invariant left unpinned. Raised by both review layers.
    location: >-
      plugins/tk-studio/contracts/driver-contract.md §2 executing-wrapper paragraph and the §1 roster Hermes row
    severity: medium
  - summary: >-
      `job.schema.json` `run.fields` does not list `total_cost_usd`, although Story 20.1 records it in `run.json` and the 0.1.18 §4 `finish` row now tells drivers it is recorded there.
    evidence: |-
      grep finds no `total_cost_usd` in plugins/tk-studio/contracts/job.schema.json. The run fields list `reason`, `status_block`, `ended` and others, but not the cost. 20-1 (2d68213) added the field to run.json and jobrun.py without the schema, so this predates 20-2. AD-19 says a contract-surface change updates its schemas in the same story. Deferral class (b): a contract or schema invariant left unpinned. Raised by the edge-case-hunter layer in the follow-up review.
    location: >-
      plugins/tk-studio/contracts/job.schema.json run.fields
    severity: medium
---

# Contract 0.1.18 Names the Supervisor and Hermes

<intent-contract>

## Intent

As a driver author, I want the contract to name its conformant drivers and say that any of them may execute a run, so that the studio supervisor is a first-class consumer while the studio itself still grows no UI. (Epic 20, Plan Phase 1 scope item 8 and acceptance (d); canonical ST-062. Repo: tk-studio.)

**Problem:** ClaudeOS is retired as a driver, yet `driver-contract.md` (0.1.17) still names it as the consumer: in the Audience line, in §7 row 6, and in the other §7 rows that name it as the driver. The contract has no driver roster. §2 does not say who the executing wrapper is. §1 points to the wrong sections (the per-skill CLIs are said to be in §3 and the status block in §4). Story 20.1's `total_cost_usd` is not documented in the contract.

**Approach:** An additive 0.1.18 patch to `driver-contract.md`, with its structure pinned in `test_driver_contract.py`. The release motion that follows is the operator's.

**Acceptance Criteria (authoritative, verbatim from epics.md Story 20.2):**

1. **Given** `driver-contract.md` at 0.1.17 **When** the patch lands **Then** the header reads 0.1.18 with a changelog clause marking it additive; §7 row 6 names the studio supervisor (status page) and Hermes (front door) as the consumers that carry UI, in place of ClaudeOS, and still states the studio grows no UI; the Audience line and every other row that names ClaudeOS as the driver are updated
2. **Given** the contract **When** a driver author looks for who drives the studio **Then** a driver roster lists the studio supervisor (executing wrapper, status page), Hermes (front door that submits jobs to the supervisor and never executes a run), and direct invocation (a conforming driver per §1)
3. **Given** §2 **When** read **Then** it states that the executing wrapper for a run is whichever conformant driver executed its `wake` directive, and that `account` and `finish` are that wrapper's duty
4. **Given** §1 and §4 **When** read **Then** §1 points to §2 for per-skill CLIs and to §3 for the status block, and the §4 `finish` row documents the optional `total_cost_usd` from Story 20.1
5. **Given** the release gate **When** the story closes **Then** `runner.py run` is ok over every surface, the lib suite is green, the release motion (`tools/release_archive.py`) ships the plugin at its next patch version with the gate ×3 in lockstep and a verified archive, the scoped plugin update lands it on the agent PC, and `tk activate` is clean on all four planes

## Boundaries & Constraints

**Always:** The change is additive only: no verb, field or skill is removed or renamed. The changelog clause is appended to the version-history cell in the same style as 0.1.16 and 0.1.17 ("… — additive"). AD-2 holds: the contract names the supervisor and Hermes, and nothing in the plugin imports them. The contract still states that the studio grows no UI. The §4 `finish` row matches `lib/jobrun.py` as built: `--total-cost-usd`, a JSON/payload field `total_cost_usd` that is optional, non-negative and finite, absent when not given (never zero-filled), with an invalid value refused by name before anything is written (AD-3), and one `job-run` event per terminal transition (AD-12).

**Block If:** satisfying an AC would need a non-additive (breaking) shape change.

**Never:** Run the release motion: no gate ×3 bump (plugin.json, marketplace.json, released-roster.json), no `claude plugin tag`, no `tools/release_archive.py`, no push. AC5's release, agent-PC update and `tk activate` parts are `unverifiable-here` (see Design Notes). Never edit `lib/*.py` behaviour, the taxonomy, or skills. Never touch the ClaudeOS mentions outside `driver-contract.md` (`lib/launch.py`, `lib/knowledge.py`, and others): the story scopes the contract.

</intent-contract>

## Code Map

No plan file exists (`plans/20-2.md` absent), so this is the investigation:

- `plugins/tk-studio/contracts/driver-contract.md`
  - L5: the **Contract version** cell `**0.1.17** (…)`. Bump it to `**0.1.18**` and append the 0.1.18 clause after 0.1.17's, ending "— additive".
  - L6: the `Story / rulings` row. Optionally add ST-061/ST-062.
  - L7: the Audience row names "the ClaudeOS MCP connector" as the first consumer. Replace it.
  - L9–15: the intro paragraph ("until a connector exists").
  - §1 (L42–81): L61–63 "listed per skill in §3" becomes §2. L65 "status block** (§4)" becomes §3.
  - §2 (L83+): the table. The `tk-studio-job` row (L98) says "plus `account`/`finish` for the executing wrapper". Add the executing-wrapper statement to §2.
  - §4 (L151–190): the verb table has rows for `submit|status|resolve|cancel|wake` only, and no `finish` row. The run-finish capture bullet is at L182.
  - §7 (L285–297): the heading "ClaudeOS integration dossier coverage (A7)". Row 1 ("connector is a ClaudeOS plugin; tk-studio never imports ClaudeOS"), row 4 ("ClaudeOS mechanics to bridge… ClaudeOS as first driver"), row 5 ("ClaudeOS first driver") and row 6 ("ClaudeOS remains the multi-project UI") name ClaudeOS as the driver.
- `plugins/tk-studio/lib/jobrun.py` L38–47 (docstring CLI block) and `finish()` L516: read-only source of truth for the `finish` row's request shape: `--directory DIR --run-id RID --state STATE [--reason R] [--status-block JSON] [--total-cost-usd USD]`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` L63–85: `test_carries_its_own_semver_and_change_policy` asserts `\*\*0\.1\.17\*\*`, with the version-history comment above it. Update it to 0.1.18 and add one test per AC (1–4). Follow the pattern of the row tests (`next(line … startswith("| \`…\`"))`).
- `plugins/tk-studio/contracts/README.md` L12: "(0.1.17, own semver …)" becomes 0.1.18.
- `plugins/tk-studio/contracts/conformance/runner.py`: read-only; it pins no contract version.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/contracts/driver-contract.md`:
  - Bump the header to 0.1.18 and add the additive changelog clause. The clause names the driver roster, §2's executing wrapper, the §4 `finish` row with the optional `total_cost_usd`, the §1 cross-reference fixes, and ClaudeOS replaced by the supervisor and Hermes. (AC1)
  - Rewrite the Audience line: the drivers are the studio supervisor and Hermes, plus direct invocation. (AC1)
  - Rewrite §7 row 6: the studio supervisor (status page) and Hermes (front door) carry UI, and the studio grows no UI. (AC1)
  - Update rows 1, 4 and 5 so none names ClaudeOS as the driver. Remaining ClaudeOS mentions (for example the A7 dossier's historical name) must read as retired or historical. (AC1)
  - Add a `### Driver roster (0.1.18)` subsection in §1. It lists the three drivers with the roles AC2 gives them. (AC2)
  - Add a §2 statement: the executing wrapper for a run is whichever conformant driver executed its `wake` directive, and `account` and `finish` are that wrapper's duty. (AC3)
  - Fix §1's cross-references to §2 and §3. (AC4)
  - Add a `finish` row to the §4 verb table documenting the optional `total_cost_usd`. (AC4)
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- pin 0.1.18 in place of 0.1.17 and extend the version comment. Add tests:
  - AC1: the header carries 0.1.18 and "additive". Row 6 names the studio supervisor, status page, Hermes, front door and "grows no UI". The Audience row does not contain "ClaudeOS". No §7 row names ClaudeOS as the driver.
  - AC2: the roster names all three drivers with their roles, including "never executes a run".
  - AC3: §2's text contains the executing-wrapper statement with `wake`, `account` and `finish`.
  - AC4: §1 references §2 for CLIs and §3 for the status block, and no longer contains "(§4)" for the status block. The §4 `finish` row contains `total_cost_usd`.
- `plugins/tk-studio/contracts/README.md` -- change the version mention to 0.1.18.

**Acceptance Criteria:** AC1–AC4 are each proven by a test in `test_driver_contract.py` plus the green verify gate. For AC5, the verify gate proves `runner.py run` ok and the lib suite green. The rest of AC5 is `unverifiable-here`, and the operator's commands are recorded in the Auto Run Result.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter + edge-case-hunter (both ran: no `plans/20-2.md`, so no S band)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5)
- defer: 1 (high 0, medium 1, low 0)
- reject: 5 (high 0, medium 0, low 5)
  - rejected: §2's `tk-studio-job` row still parenthesises `account`/`finish`. The row already names them for the executing wrapper, and no AC covers it.
  - rejected: the intro's "direct headless invocation (§2)" reference. AC4 names only §1's two cross-references, and §2 is where the invocation surface lives.
  - rejected: §4's heading "Job model and scheduler verbs" does not fit `finish`. This is cosmetic, and the new row names itself the executing wrapper's verb.
  - rejected: no `account` row in §4. AC4 asks only for a `finish` row. The roster pointer that implied one was patched instead.
  - rejected: a repeat same-state `finish` re-emits `job-run`. This is pre-existing and already in 20-1's `deferred` ledger (job.py:570); not filed again.
- addressed_findings:
  - `[medium]` `[patch]` the §4 `finish` row's CLI omitted the required `--directory DIR`, so a driver copying it gets an argparse exit 2. The flag is added and the test pins it.
  - `[low]` `[patch]` the `finish` row now names the accepted `state` values (`job.TERMINAL_STATES`), the `reason` requirement for `partial`/`blocked`/`cancelled`, and emission on a terminal state, as the code enforces them.
  - `[low]` `[patch]` the roster's supervisor row said `account`/`finish` were documented in "(§2, §4)". It now reads "(§2; `finish` in §4)".
  - `[low]` `[patch]` the AC1 test is strengthened: every contract line naming ClaudeOS must mark it retired or historical.
  - `[low]` `[patch]` the AC4 test now pins "non-negative", "finite" and `--directory DIR` in the `finish` row.
  - `[low]` `[patch]` (found at the orchestrator's re-verify) unescaped `|` in the new `state` list split the `finish` table row. The pipes are escaped, and the test pins the row's column count to the `wake` row's.

### 2026-09-28 — Review pass (follow-up)
- layers: blind-hunter + edge-case-hunter (both ran: no `plans/20-2.md`, so no S band)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 1 (high 0, medium 1, low 0)
  - deferred: `job.schema.json` `run.fields` lacks `total_cost_usd`. This predates 20-2 (20-1 added the field without the schema). Class (b).
- reject: 8 (high 0, medium 0, low 8)
  - rejected: the `finish` row lists `cancelled` as a state while `cancel` ends a run `partial` with reason `cancelled`. These are two verbs, each documented as built (`jobrun.cancel` and `job.TERMINAL_STATES`).
  - rejected: §7 row 4's "no new verb" contradicts the `finish` row. The phrase means that capture adds no verb and rides `finish`, as the §4 run-finish capture note states.
  - rejected: the 0.1.18 changelog clause "understates" the `finish` row. The clause names the row, and the row carries the detail. Cosmetic.
  - rejected: there is no executing wrapper for runs not started by `wake`, and Hermes could reach `submit` itself (raised by both layers). Already DW-6 in the ledger; not filed again.
  - rejected: a repeat `finish` on a terminal run re-emits `job-run`. Already DW-5; not filed again.
  - rejected: the generic "connector" wording in the intro and elsewhere. It is the contract's word for any driver, not ClaudeOS-specific, and the intro now points to the roster. The mission-runner mentions from the same finding were patched.
  - rejected: the retired/historical test is vacuous on the header line. The header is the changelog line, which legitimately says "retired". This is a test nit with no AC behaviour at stake.
  - rejected: the `finish` result's `reason` is unmarked optional. As built, `finish()` always returns `reason` (null when none), so the row is accurate.
- addressed_findings:
  - `[low]` `[patch]` §7 row 3's "mission runner" is now marked "(named for the retired ClaudeOS mission runner, historical)", and the AC1 ClaudeOS test pins it.
  - `[low]` `[patch]` the §4 `wake` row's live "(the mission-runner "tick" maps here)" now reads "(the retired ClaudeOS mission-runner "tick" mapped here, historical)".
  - `[low]` `[patch]` the AC4 test looks up the `finish` and `wake` rows inside §4 (`## 4.` to `## 5.`), so it fails if the row leaves §4.

## Design Notes

- **The §4 `finish` row.** §4's verb table has no `finish` row today. The literal reading of AC4 is to add one: request `{run_id, state, reason?, status_block?, total_cost_usd?}` (CLI `jobrun.py finish`), the executing wrapper's terminal-transition verb.
- **Where the roster goes.** It sits in §1 because direct invocation is defined there.
- **AC5's operator motion.** Releases are operator commits on main (e.g. ca771c6). The loop never bumps, tags, publishes or pushes. The operator runs, after merge:
  1. Bump the gate ×3 to 0.2.16 (plugin.json, marketplace.json, released-roster.json) and commit it.
  2. `claude plugin tag`.
  3. `uv run tools/release_archive.py run`, then commit the roster archive record.
  4. Run the scoped plugin update on the agent PC.
  5. Run `tk activate` and confirm it is clean on all four planes.

## Verification

**Commands** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_driver_contract` -- expected: OK, new cases pass
- `uv run python -m unittest discover tests` -- expected: full lib suite green (the one known pre-existing Linux failure, `test_job.test_target_rules`, is deferred from 20-1)
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` over every surface

## Deviation Summary

### pass 1 (2026-09-28, implementer)

DEVIATIONS: none
DEVIATION SCORE: 0

### orchestrator verify (2026-09-28)

- planned: the full lib suite is green / actual: 744 tests, 1 failure, `test_job.JobTestCase.test_target_rules` / why: the known platform-dependent failure (a Windows-path assumption on Linux) carried in 20-1's `deferred`. `test_job.py` is untouched by this diff. The 20-1 consult ruling of 2026-09-28T09:02:24Z already settled this question: a failure that reproduces on the clean baseline, in a file outside Files, is a score-1 deviation that is deferred and does not block the gate. That ruling is applied here and the question is not consulted again / may affect: none

DEVIATION SCORE: 1 (the prior consult ruling is applied)

DRIFT: the full lib suite carries 1 pre-existing failure (test_job.test_target_rules). It is unchanged from baseline e75436a75cabeb3e3b13e3b3c59409488976401f, already deferred by 20-1, and covered by 20-1's consult ruling — affects: none

### pass 2 (2026-09-28, implementer, review patches)

- planned: state exactly which states make `finish` emit / actual: the row documents the CLI, which accepts only terminal states, so every CLI `finish` emits; the Python `finish()` also accepts `queued`/`running` without emitting, and the row does not describe that / why: the row is the CLI contract / may affect: none

DEVIATION SCORE: 0

### pass 3 (2026-09-28, implementer, pipe-escape patch)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 4 (2026-09-28, implementer, follow-up review patches)

DEVIATIONS: none
DEVIATION SCORE: 0

### orchestrator verify, follow-up (2026-09-28)

- The full lib suite gives the same result as in the first pass: 744 tests, 1 failure, the pre-existing `test_job.JobTestCase.test_target_rules` (DW-4). The 20-1 consult ruling is applied again and the question is not consulted twice / may affect: none

DEVIATION SCORE: 1 (unchanged; the prior consult ruling is applied)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was a follow-up review of the done 0.1.18 contract story (the prior pass recommended one). Both layers ran over the diff since baseline `e75436a75cabeb3e3b13e3b3c59409488976401f`. Three low patches landed, and they finish AC1's ClaudeOS sweep and tighten the AC4 test:
- §7 row 3's "mission runner" is marked as the retired ClaudeOS runner (historical).
- The §4 `wake` row's mission-runner "tick" note is marked retired and historical.
- The AC4 test pins the `finish` row inside §4.

The 0.1.18 content from the first pass stands: the header clause, Audience, the §1 driver roster, the §2 executing wrapper, the §1 cross-references, the §4 `finish` row with `total_cost_usd`, and §7 row 6.

**Files changed (this pass):**
- `plugins/tk-studio/contracts/driver-contract.md` -- §7 row 3 and the §4 `wake` row mark the ClaudeOS mission runner as retired and historical.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the AC4 test looks up the `finish` and `wake` rows within §4.

**Review:** 3 patches applied (low 3), 1 deferred (medium, class (b): `job.schema.json` lacks `total_cost_usd`, predating this story from 20-1), 8 rejected (2 of them already in the ledger as DW-5 and DW-6). Follow-up review: patched high 0, medium 0, low 3; score 3×0 + 1×3 = 3 < 5, so the follow-up is `false`.

**Verification** (from `plugins/tk-studio/lib`, re-run by the orchestrator after the implementer):
- `uv run python -m unittest tests.test_driver_contract`: 27 tests, OK.
- `uv run python -m unittest discover tests`: 744 tests, 1 failure. It is the pre-existing `test_job.JobTestCase.test_target_rules` (DW-4), unchanged from baseline and covered by 20-1's consult ruling.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true` over 18 surfaces.

**AC5, unverifiable here** (the loop never bumps, tags, publishes or pushes). The operator runs these after the epic branch merges:
1. Bump the gate ×3 0.2.15 → 0.2.16 (`plugins/tk-studio/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugins/tk-studio/.claude-plugin/released-roster.json`) and commit `release(plugin): 0.2.15 -> 0.2.16, lockstep gate x3 - contract 0.1.18`.
2. `claude plugin tag`.
3. `uv run tools/release_archive.py run`, then commit the roster archive record.
4. Run the scoped plugin update on the agent PC.
5. `tk activate`, and confirm it is clean on all four planes.

**Residual risks:**
- Open in the ledger: one-shot runs started from `submit` name no executing wrapper, and Hermes has no stated hand-off to the supervisor (DW-6). A repeat `finish` re-emits (DW-5).
- `job.schema.json` does not describe `run.json`'s `total_cost_usd` (deferred here).
- ClaudeOS still appears outside the contract (`lib/launch.py`, `lib/knowledge.py`, the `tk-studio-launch` SKILL.md), which is out of the story's scope. §2's heading still reads "(v0.1.16)".
- The orchestrator's uncommitted ledger harvest (`deferred-work.md`, DW-6) was already present when this session started. It was left untouched and uncommitted for the orchestrator, which owns the ledger, so the working copy is clean apart from that file.

DRIFT: the full lib suite carries 1 pre-existing failure (test_job.test_target_rules). It is unchanged from baseline e75436a75cabeb3e3b13e3b3c59409488976401f, already deferred by 20-1 (DW-4), and covered by 20-1's consult ruling — affects: none
