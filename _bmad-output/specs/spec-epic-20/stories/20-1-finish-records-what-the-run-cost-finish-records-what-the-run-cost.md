---
title: 'Finish Records What the Run Cost'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '0c984107dcaf136f8a6049acf0ac39f281b99744'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
context:
  - '{project-root}/_bmad-output/specs/spec-epic-20/plans/20-1.md'
warnings: []
deferred:
  - summary: 'Pre-existing platform-dependent failure: test_job.JobTestCase.test_target_rules expects "C:/abs/path.py" refused as absolute; accepted on Linux'
    evidence: 'Reproduces on clean git archive of baseline 0c984107dcaf136f8a6049acf0ac39f281b99744; outside story Files (consult ruling 2026-09-28T09:02:24Z)'
    location: 'plugins/tk-studio/lib/tests/test_job.py:177'
    severity: low
  - summary: >-
      A repeat finish in the same terminal state overwrites run.json fields (now including total_cost_usd) and emits a second job-run event.
    evidence: |-
      job.update_run allows new_state == record state on a terminal run (job.py:570), and finish always calls _finalize_run, which emits. This behaviour predates this story for reason/status_block. It touches the AD-12 one-event-per-terminal-transition invariant (deferral class (b)). Raised by the edge-case-hunter review layer.
    location: >-
      plugins/tk-studio/lib/jobrun.py finish / plugins/tk-studio/lib/job.py:570
    severity: low
---

# Finish Records What the Run Cost

<intent-contract>

## Intent

As an operator measuring unattended runs, I want `finish` to accept the run's cost and the `job-run` event to carry it, so that every terminal run lands in the ledger with the dollars it spent. (Epic 20, Plan Phase 1 acceptance (d); canonical ST-061. Repo: tk-studio.)

**Problem:** Acceptance (d) asks for `total_cost_usd` on terminal runs, but today the taxonomy's `job-run` payload has no such field and `jobrun.py` records none.

**Approach:** `jobrun.py finish` takes an optional cost figure. When the figure is valid, it lands in `run.json` and in the one terminal `job-run` event as `total_cost_usd`. The taxonomy declares the field optional.

**Acceptance Criteria (authoritative, verbatim from epics.md Story 20.1):**

1. **Given** a run finished through `jobrun.py finish` with a cost figure **When** the terminal transition is recorded **Then** the `job-run` event payload carries `total_cost_usd` as a non-negative number, the run's `run.json` records the same figure, and there is still exactly one emitter and one event per terminal transition (AD-12)
2. **Given** a `finish` without a cost figure, as every driver sends today **When** it runs **Then** the behavior and the event are identical to 0.1.17: the field is absent, never zero-filled
3. **Given** a cost argument that is negative, non-numeric, or not finite **When** `finish` runs **Then** it refuses with a named error and records and emits nothing — never a guessed value (AD-3)
4. **Given** `contracts/events/taxonomy.v1.json` **When** the story lands **Then** `job-run.payload.total_cost_usd` is declared optional with a note naming its source (the worker's `--output-format json` result), and the lib suite pins the present, absent, and refused cases with the full suite green

## Boundaries & Constraints

**Always:** Stdlib-only Python run via `uv run` (NFR9). Atomic writes. Every headless surface ends with the JSON status block (AD-11), so a bad CLI cost exits 2 with `{"ok": false, "error": …}` JSON and never argparse's own usage text. Validate the cost before anything is written. Carry the field by key presence, so `0` is carried. AD-12 holds: one emitter and one `job-run` event per terminal transition. AD-2 holds.

**Block If:** the cost must be computed studio-side (for example, by parsing a worker transcript) rather than supplied to `finish`. `taxonomy_version` would have to change for the optional field to validate.

**Never:** Edit `driver-contract.md`, the §4 `finish` row, or any gate ×3 version. That text is Story 20.2's. Never zero-fill or guess a cost. Never refactor outside the plan's Files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Present | `finish` with cost `1.23` (API and CLI `--total-cost-usd 1.23`) | run.json `total_cost_usd == 1.23`; exactly one `job-run` event with payload `total_cost_usd == 1.23` | No error expected |
| Zero | cost `0` | carried as `0`/`0.0` in run.json and the payload, not dropped | No error expected |
| Absent | `finish` without cost | no `total_cost_usd` key in run.json or the payload; payload keys equal the 0.1.17 set | No error expected |
| Negative | `-0.01` | nothing recorded, no event; run state unchanged (non-terminal) | named `JobRunError` naming `total_cost_usd`; CLI exit 2, `ok: false` |
| Non-numeric | CLI `abc`; API bool `True` | as Negative | as Negative |
| Not finite | `nan`, `inf` | as Negative | as Negative |
| Taxonomy | `ledger.validate("job-run", {…, "total_cost_usd": 1.5})` / `"1.5"` | number passes / string raises | — |

</intent-contract>

## Code Map

See `plans/20-1.md` Code Map (the investigation). Summary:

- `plugins/tk-studio/lib/jobrun.py` -- `finish()` (~L493), where the new keyword is validated before `joblib.update_run`. `_emit_job_event()` (~L93), where the payload carries the field by key presence (the function swallows exceptions, so the taxonomy must declare the field). `main()` (~L515), where the `finish` subparser takes `--total-cost-usd` as a string validated by the module. The docstring's CLI block (~L45) lists the flag.
- `plugins/tk-studio/lib/job.py` `update_run()` -- read-only seam: it merges `changes`, and the field is not immutable.
- `plugins/tk-studio/lib/ledger.py` `validate()` -- read-only seam: it type-checks `number` and rejects bools, but does not check finiteness.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- `job-run.payload` gains the optional field.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- the tests, using the existing helpers `_declare`, `_skill_defn`, `_ledger_events` and `_cli`.
- `plugins/tk-studio/skills/tk-studio-job/SKILL.md` -- optional: one line naming the flag on the finish step.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jobrun.py` -- add an optional `total_cost_usd` to `finish()` and validate it (finite, non-negative, real number, not bool) before `update_run`, raising a named `JobRunError`. Add `--total-cost-usd` to the CLI, parsed as a string. Carry the field into the `job-run` payload by key presence. Update the docstring CLI block -- AC1–3.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- declare `job-run.payload.total_cost_usd` as `{"type": "number", "required": false, "note": …}`, with the note naming the worker's `--output-format json` result as the source. Leave `taxonomy_version` at 1 -- AC4.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- pin every I/O-matrix row: present (API, CLI, zero), absent, refused (negative, CLI non-numeric, nan, inf, bool, with state unchanged and no event), and taxonomy validation -- AC4.
- `plugins/tk-studio/skills/tk-studio-job/SKILL.md` -- (optional) one line: finish takes `--total-cost-usd` when the worker reports one.

**Acceptance Criteria:** the four ACs in the intent contract, each proven by a test in `test_jobrun.py` and the green verify gate.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter + edge-case-hunter (both ran: the plan says band S, but the diff touches 4 files, over the ≤3 limit)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 1 (high 0, medium 0, low 1)
- reject: 4 (high 0, medium 0, low 4)
  - rejected: the taxonomy does not enforce non-negativity. The ledger schema language has no minimum, so the story places validation in `finish` (AC3).
  - rejected: no contract version bump or changelog. That is Story 20.2's work, already recorded as a DRIFT.
  - rejected: the CLI's `float()` accepts `1_000` and surrounding whitespace. It still yields a real, finite number, so nothing is guessed.
  - rejected: the SKILL.md note does not name the JSON field or add the flag to its example. That doc line is optional and no AC covers it.
- addressed_findings:
  - `[low]` `[patch]` `_validate_cost` let `OverflowError` escape on huge ints (e.g. `10**400`). It now raises the named `JobRunError`, and the refusal test covers it.
  - `[low]` `[patch]` `-0.0` was recorded with its sign. It is now normalised to `0.0`, and a new test checks positive zero in run.json and the event.

## Deviation Summary

- NOTE: the spec file pre-existed as a `ready-for-dev` stub with no intent contract. This session transcribed the story's ACs verbatim from epics.md Story 20.1 and summarised plans/20-1.md into it before the implementation handoff, as the invocation instructs. This is not a deviation.

### pass 1 (2026-09-28, implementer)

- planned: gate AD-19 note says a contract-surface change also updates `driver-contract.md` / actual: `driver-contract.md`, the §4 `finish` row and the gate ×3 versions were not edited / why: the spec's Never clause and plan Risks assign that text to Story 20.2 / may affect: 20-2-contract-0-1-18-names-the-supervisor-and-hermes
- planned: full lib suite green / actual: 739 tests, 1 failure, `test_job.JobTestCase.test_target_rules`. It is pre-existing and platform-dependent: it reproduces on a clean `git archive` of the baseline, and `test_job.py` is outside Files / why: the file is outside the story's Files, so it was left untouched (consult ruling: accept, score 1) / may affect: none

DEVIATION SCORE: 1 (accepted by consult)

DRIFT: contract §4 finish row deferred to 20.2 per epic plan — the epic assigns the contract text and the version bump to Story 20.2, and this story's Never clause forbids editing driver-contract.md — affects: 20-2-contract-0-1-18-names-the-supervisor-and-hermes
DRIFT: the full lib suite carries 1 pre-existing failure (test_job.test_target_rules, Windows-path assumption on Linux) — it reproduces at baseline 0c984107, the file is outside Files, and it is filed in `deferred` — affects: none

## Consult Log

- 2026-09-28T09:02:24Z — trigger: verify-red + deviation-gt-0 — question: accept a pre-existing baseline failure (test_job.test_target_rules) and the contract-text deferral to 20.2? — ruling: accept-deviation score 1 — do: record the B2 DRIFT with the 0-1-18 key; record B1 as a pre-existing, platform-dependent failure, file it in deferred, leave test_job.py untouched, proceed to review; do not edit driver-contract.md or test_job.py — rule candidate: a failure reproducible on a clean baseline archive, in a file outside Files, is a score-1 deviation that is deferred and does not block the gate; a planned contract-text deferral to a named later story is score 1. (observe.py record: ok)

## Verification

**Commands** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_jobrun tests.test_ledger` -- expected: OK, new cases pass
- `uv run python -m unittest discover tests` -- expected: full lib suite OK
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` over every surface

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** `jobrun.py finish` takes an optional `total_cost_usd` (API keyword, CLI `--total-cost-usd`).
- **Recorded:** a valid cost lands in `run.json` and in the one terminal `job-run` event. It is carried by key presence, so `0` is kept.
- **Refused:** a negative, non-numeric, non-finite, bool or overflowing value gets a named `JobRunError` (CLI: exit 2 with JSON `ok: false`) before anything is written or emitted.
- **Absent:** with no cost, run.json and the event are exactly as in 0.1.17.
- **Taxonomy:** `job-run.payload.total_cost_usd` is declared as an optional number whose note names the worker's `--output-format json` result as the source. `taxonomy_version` stays at 1.

**Files changed:**
- `plugins/tk-studio/lib/jobrun.py` -- `_validate_cost`, the `finish()` keyword, the payload field, the `--total-cost-usd` CLI flag parsed as a string, and the docstring.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json` -- the optional `total_cost_usd` in the `job-run` payload.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- 8 tests: present (API, CLI, zero, -0.0), absent, refused (API and CLI, with no write and no event), and taxonomy validation.
- `plugins/tk-studio/skills/tk-studio-job/SKILL.md` -- one line on passing `--total-cost-usd` to `finish`.

**Review:** 2 patches applied (low), 1 deferred (low, pre-existing, AD-12 class (b)), 4 rejected. Follow-up review: patched high 0, medium 0, low 2; score 3×0 + 1×2 = 2 < 5, so the follow-up is `false`.

**Verification** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_jobrun tests.test_ledger`: 46 tests OK.
- `uv run python -m unittest discover tests`: 740 tests, 1 failure. The failure is the pre-existing `test_job.JobTestCase.test_target_rules`, a Windows-path assumption that fails on Linux; it reproduces at baseline 0c984107 and was accepted by consult and filed in `deferred`.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, 18 surfaces and 116 checks.

**Residual risks:** `_emit_job_event` swallows every exception, so if the taxonomy field were removed, events carrying a cost would disappear silently (the tests guard this). A repeat same-state `finish` re-emits (deferred). The contract §4 `finish` row does not name the flag until Story 20.2.

DRIFT: contract §4 finish row deferred to 20.2 per epic plan — the epic assigns the contract text and the version bump to Story 20.2, and this story's Never clause forbids editing driver-contract.md — affects: 20-2-contract-0-1-18-names-the-supervisor-and-hermes
DRIFT: the full lib suite carries 1 pre-existing failure (test_job.test_target_rules) — it reproduces at baseline 0c984107dcaf136f8a6049acf0ac39f281b99744, is platform-dependent and lies outside Files; accepted by consult at score 1 — affects: none
