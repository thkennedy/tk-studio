---
title: 'Routing Legs Carry an Advisor and an Effort'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: 'a5a0600ce9e540296dcc5d54097a94f74e9ae518'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-26/plans/26-3.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 24.3's third arm (a cheaper main model with a stronger advisor) cannot be routed or priced: pipeline legs have no advisor field, subagent launches pass no explicit effort, and the meter has no `advisor` leg (the advisor fit note; PROP-045, PROP-052, PROP-058; Canonical ST-090).

**Approach:** Transcribed from epics.md §Story 26.3, verbatim in substance:

- **AC1.** Given `[pipeline.legs]` in the launch customization and a project's `.bmad-loop/routing.toml`, when a leg carries `advisor = "opus" | "fable" | "off"`, then `pipeline.py check|resolve|apply` validate it (default `off`; the pairing rule: the advisor must rank at or above the leg's model; a violation is a named refusal), `apply` writes it into `routing.current.json`, and the session leg's `claude -p` command carries `--advisor <model>` only when the leg's advisor is not `off`.
- **AC2.** Given the implementer and reviewer launches the session makes, when the routing is in force, then each launch passes `model`, `effort` and the advisor explicitly (the executor customization reads `routing.current.json`), and the dispatch note's consult triggers are stated as advisor instructions when an advisor is on ("consult the advisor on: verify-red, halt, deviation above 0, a high-severity finding, a tripwire, a file outside Files, and before declaring the story done"), with a Consult Log entry appended per advisor call so the audit trail survives.
- **AC3.** Given `lib/meter.py`, when a story's transcripts carry advisor usage, then the meter prices it as its own leg `advisor` from the price table (a missing price is a named refusal, never a guess) and the observation names it beside the other legs.
- **AC4.** Given the driver contract §5, when the story closes, then it documents the `advisor` field and the pairing rule (0.1.21, additive), the lib suite pins the validation, the command line and the pricing, and conformance is green; the shipped defaults stay `advisor = "off"` on every leg (AD-14: nothing changes until Epic 24.4 records a verdict).

## Boundaries & Constraints

**Always:**
- Follow the plan's **Settled shape 1–4** (`plans/26-3.md`) exactly: vocabulary `opus|fable|off`, missing = `off`; rank fable 3, opus (`claude-opus-5-5`, `claude-opus-5`) 2, every other model 1; `off` never ranked; refusal text `<where>.<leg>: advisor '<a>' ranks below model '<m>' (the advisor must rank at or above the leg's model)`; pairing checked per table, on the overlaid route in `resolve` (so `apply` inherits it), and in `check` on the defaults-only effective route (into `problems[]`); `--advisor <value>` verbatim; subagent legs (implementer, reviewers, consult) with no resolved effort inherit the session's, source `"inherited-session"`; advisor transcript rule via constant `ADVISOR_ITERATION = "advisor_message"`; the executor `Advisor:` first-line and Consult Log entry forms; the dispatch-note sentence.
- Driver contract stays at **0.1.21**: append one clause after the existing `0.1.21 (Epic 26)` clause in the header (l.5) — never reword it, never bump — and add the field to §5.1.
- Stdlib-only, atomic writes, AD-11 block, AD-2 (house rules). Shipped resource tables keep no effort on subagent legs (test_pipeline l.106–108 stands).
- Prove everything with temp projects and `--set`.

**Block If:**
- A criterion needs an edit to `epics.md`, `SPEC.md` or companions, `stories.yaml`, `.bmad-loop/routing.toml`, `.bmad-loop/policy.toml`, bmad-loop itself, or `/home/agent/.claude/skills/tk-studio`.
- A test can only pass by turning an advisor on for a shipped leg or for this project's routing.

**Never:**
- Change any shipped model/effort value; turn any shipped advisor on.
- Run `pipeline.py apply` without `--dry-run`, or `transcribe.py` without `--dry-run`, against this repo; rewrite existing `stories.yaml` entries.
- Touch `bmad-build-auto.toml` l.67's file-name sentence or the unread `consult_scope` (26-2 deferrals); the kb routing record; the consult subagent's behaviour (it coexists with the advisor).
- Append the CAP-10 design-notes bullet to SPEC.md (plan Risks).
- Change the "Spec file:" sentence of the transcribe.py dispatch note (pinned by test_planner_rules).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | no `advisor` anywhere | every leg resolves `advisor: "off"`; no `--advisor` in the policy block | none |
| Valid pairing | session `model=claude-opus-5-5`, `advisor=fable` | resolves; `[adapter.dev]` `extra_args` ends `"--advisor", "fable"` | none |
| Advisor without effort | engine-stage leg with advisor, no effort | `extra_args` emitted with `--advisor` only (plus permission mode) | none |
| Bad vocabulary | `advisor = "sonnet"` | named refusal listing allowed values | `check` problems / `resolve` exit 2 |
| Pairing violation (table) | `{model="claude-fable-5-1", advisor="opus"}` in one table | refusal with the `ranks below model` text | `check` problems / exit 2 |
| Pairing violation (overlay) | resource advisor `opus` + `--set session.model=claude-fable-5-1` | `resolve`/`apply` refuse | exit 2, `{ok:false,error}` |
| Effort inheritance | project routing gives subagent legs no effort | implementer/reviewers/consult `effort` = session's; source `inherited-session` | none |
| Advisor usage priced | transcript `usage.iterations[]` with `type:"advisor_message"`, own `model` | priced under `advisor` at that model's rates; executor leg excludes those tokens | none |
| Advisor model unpriced | advisor iteration model absent from prices | same named refusal as an unknown model | refusal, never zero |
| Advisor iteration without model | `advisor_message` with no string `model` | named refusal `advisor usage without a model` | refusal |
| No advisor usage | ordinary transcripts | `usd_by_leg` still names `advisor` at 0; `describe()` shows it | none |

</intent-contract>

## Code Map

The plan's Code Map (`plans/26-3.md`, investigated at `264c13c`) is the investigation; anchors re-confirmed at `a5a0600`:

- `plugins/tk-studio/lib/pipeline.py` -- `LEGS`/`STAGE_OF`/`FIELDS`/`MODELS`/`EFFORTS` l.70–77; `_validate_legs` l.132 (per-table validator used by `resource_defaults`, `validate_project`, `parse_sets`); `resolve` l.209 (overlay, then stage-model check — add post-overlay pairing + effort inheritance); `render_block` l.259 (`extra_args` l.267, only when effort set today); `current_payload` l.315 (copies leg dicts, so `advisor`/inherited `effort` flow through); `main`/`check` from l.377; docstring l.1–52.
- `plugins/tk-studio/skills/tk-studio-launch/customize.toml` -- `[pipeline.legs]` ~l.58–67 (add `advisor = "off"` to every leg); stale comment ~l.55–57 about subagent effort; leg comment block ~l.17–54.
- `plugins/tk-studio/lib/meter.py` -- `LEGS` l.50; `_rates` l.290; `_usage_records` l.295; `_premium`/`_server_tools` ~l.311–330; `price` l.333 (dedupe by `message.id`, unknown-model refusal ~l.386–402, `usd_by_leg` seeded from `LEGS` ~l.404); `describe` l.475.
- `plugins/tk-studio/lib/prices.json` -- opus and fable already priced; read-only.
- `_bmad/custom/bmad-build-auto.toml` -- ACTIVATION 3/4 l.41–48 (route models + fallback), 4/4 ~l.56 (`consult_triggers`), STUDIO MODEL ROUTING l.71, STUDIO CONSULT l.74, implementer handoff l.80, review layers l.103 and l.123.
- `.bmad-loop/plugins/studio-pipeline/transcribe.py` -- `entry()` ~l.125–146; routing sentence ("pass implementer.model and reviewers.model explicitly on every subagent launch").
- `plugins/tk-studio/contracts/driver-contract.md` -- header l.5 ends with the `0.1.21 (Epic 26)` clause; §5 l.235, §5.1 l.254.
- Tests: `tests/test_pipeline.py` (shipped shape l.90–111; `apply` current assertion ~l.221–241 must be updated, not loosened); `tests/test_meter.py` (inline JSONL fixtures; seam/supervise zero-leg precedent ~l.237–240); `tests/test_driver_contract.py` (l.175–200 pins `**0.1.21**` + the 26-1 anchor); `tests/test_planner_rules.py` (loads transcribe.py via importlib in `SpecFileNameTest`).
- Conformance `contracts/conformance/manifest.json` l.85–115 drives `pipeline.py resolve` and `apply --dry-run`; no new drive needed.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/pipeline.py` -- add `advisor` to `FIELDS`, `ADVISORS`, rank table; vocabulary + per-table pairing in `_validate_legs`; post-overlay pairing and subagent effort inheritance (`sources[leg]["effort"] = "inherited-session"`) in `resolve`; effective-defaults pairing in `check`; `--advisor <v>` in `render_block` for any engine-stage leg whose advisor is not `off` (emit `extra_args` when effort or advisor is present); docstring -- AC1, AC2 (explicit effort).
- `plugins/tk-studio/skills/tk-studio-launch/customize.toml` -- `advisor = "off"` on every leg; reword the subagent-effort comment; document `advisor` -- AC1, AC4.
- `plugins/tk-studio/lib/meter.py` -- `"advisor"` in `LEGS`; `ADVISOR_ITERATION` constant with the 24.3-confirms comment; price each advisor iteration under `advisor` at its own model; exclude from executor tally; join `missing` refusal; `advisor usage without a model` refusal -- AC3.
- `_bmad/custom/bmad-build-auto.toml` -- remember `model`, `effort`, `advisor` per subagent leg (fallback: effort = session's, advisor off); remember `session.advisor`; pass `model` and `effort` as Agent parameters and the `Advisor:` line as each launch prompt's first line; advisor mode + its Consult Log entry form in STUDIO CONSULT; extend l.80/103/123 -- AC2.
- `.bmad-loop/plugins/studio-pipeline/transcribe.py` -- routing sentence names `model`, `effort` and `advisor`; add the advisor sentence (Settled shape 4) -- AC2.
- `plugins/tk-studio/contracts/driver-contract.md` -- header clause appended after the 26-1 clause (still 0.1.21); §5.1 field, vocabulary, pairing rule, refusal text, `--advisor` placement, effort inheritance, the one-sentence "advisor on subagents is steering" note -- AC4.
- `plugins/tk-studio/lib/tests/test_pipeline.py`, `tests/test_meter.py`, `tests/test_driver_contract.py`, `tests/test_planner_rules.py` -- cover every I/O-matrix row, shipped `advisor = "off"` on every leg, `advisor` in `routing.current.json`, `--advisor` present/absent, the new contract clause and §5.1 sentence with version 0.1.21, the dispatch note's advisor sentence -- AC4.

**Acceptance Criteria:**
- Given this repo, when `uv run pipeline.py resolve --directory ../../.. --story 26-3 --set session.advisor=opus --set session.model=claude-fable-5-1` runs, then it exits 2 with an error containing `ranks below model`.
- Given this repo, when `uv run pipeline.py resolve --directory ../../.. --story 26-3` runs, then every leg shows `advisor: "off"` and implementer, reviewers and consult show `effort: "medium"` with source `inherited-session`.
- Given the shipped `customize.toml`, when the lib suite runs, then every leg's advisor is `"off"` and no model/effort value differs from before.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- layers: blind-hunter and edge-case-hunter both ran (band L). Each reviewer got the diff as a file path (`/tmp/rv263/diff.txt`, 904 lines) instead of inline text.
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 2, low 1)
- defer: 0
- reject: 1 (high 0, medium 0, low 1): an advisor on `seam`, `supervise` or `planner` is "accepted then dropped". Rejected because AC1 asks only that `apply` write the field into `routing.current.json`, which it does, and whatever launches those legs reads it there. No AC names a delivery path for those legs.
- addressed_findings:
  - `[medium]` `[patch]` A non-string `advisor` (for example `["opus"]`) raised `TypeError` in `_pairing_problems` instead of the named refusal. It is now guarded, and covered by `test_non_string_advisor_refuses_named_not_traceback`.
  - `[medium]` `[patch]` Advisor iterations priced cache writes at the 5m rate and skipped `_premium`, which is a guess that AC3 forbids. They now use the executor's split, `ttl_unknown` and premium refusal (blind-hunter and edge-case-hunter reported this twice; deduplicated). Covered by new meter tests.
  - `[low]` `[patch]` The contract's `Story / rulings` row now lists Story 26.3.

### 2026-10-15 — Review pass (follow-up)
- layers: blind-hunter and edge-case-hunter both ran (band L) on `claude-opus-5-5`, effort medium, advisor off. Each got the diff `a5a0600..HEAD` (the story spec excluded) as the file path `/tmp/rv263b/diff.txt` (884 lines), not inline.
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 5 (high 0, medium 0, low 5):
  - The dispatch note says to "pass" the advisor, which the Agent tool cannot take as a parameter, and it omits consult. Rejected: the routing sentence matches Settled shape 4, and the executor customization the session runs under defines the `Advisor:` first-line mechanism.
  - The session's advisor is not paired against the subagent legs' models. Rejected: AC1 pairs "the advisor" with "the leg's model", per leg. Per the fit note, the harness runs its own pairing check on the advisor that subagents inherit.
  - The meter assumes top-level `usage` excludes advisor tokens, which risks double billing. Rejected: Settled shape 2 states this placeholder rule on purpose ("top-level usage stays the executor's"), and Epic 24.3's first advisor transcript confirms it.
  - An unknown `usage.iterations[]` type prices silently at zero. Rejected: the type name is a documented one-constant placeholder. Refusing every other iteration type would refuse legitimate transcripts that carry `message`, `compaction` or `fallback_message` entries, and no AC names those.
  - An advisor iteration with no model and zero tokens should be skipped rather than refused. Rejected: Settled shape 2 makes a missing model a named refusal, "never zero".
- addressed_findings:
  - `[medium]` `[patch]` Advisor calls made by subagents never reached the Consult Log (AC2). STUDIO MODEL ROUTING (`_bmad/custom/bmad-build-auto.toml:71`) now has a subagent whose leg advisor is on report one `advisor call:` line per call. The session appends one Consult Log entry per reported call in the advisor entry form, and ADVISOR MODE (l.74) cross-references this.
  - `[low]` `[patch]` The `routing.current.json` fallback did not cover a file written before 26.3. ACTIVATION 3/4 (l.44) now says a leg field missing from that file means effort = the session's and advisor = `off`.

## Design Notes

The Agent tool has `model` and `effort` parameters but no advisor parameter, so a subagent leg's advisor reaches the subagent only as the prompt's first line (`Advisor: <value> — consult the advisor on: …` / `Advisor: off — do not call the advisor.`); the harness applies the session's configured advisor itself. The `advisor_message` iteration type is a named placeholder until Epic 24.3's first advisor transcript (one-constant fix then).

## Verification

**Commands (from `plugins/tk-studio/lib`):**
- `uv run python -m unittest discover tests` -- expected: green.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- the two `pipeline.py resolve` commands in Acceptance Criteria -- expected as stated.
- `uv run pipeline.py apply --directory ../../.. --story 26-3 --dry-run` -- expected: no `--advisor` in the rendered block.

## Deviation Summary

### pass 1 (2026-10-15, implementer)

- planned: update only the `apply` current-file assertion in `test_pipeline.py` (~l.221–241) / actual: also made `test_defaults_verb`, `test_tiers_per_leg_and_field` and `test_no_project_routing_is_the_resource_default_everywhere` exact for `advisor: "off"` and `inherited-session` effort sources (not loosened) / why: shipping `advisor = "off"` and inheriting effort in `resolve` necessarily change those exact-equality assertions / may affect: none
- planned: extend the implementer handoff (l.80) and the two review-layer instructions (l.103, l.123) / actual: also extended the consult launch sentence in STUDIO CONSULT (l.74) to pass `route.consult.effort` and the `Advisor:` first line / why: AC2's "each launch passes model, effort and the advisor"; STUDIO CONSULT is named in the plan's Files / may affect: none

DEVIATION SCORE: 1

DRIFT: three more exact test_pipeline assertions updated for `advisor`/inherited effort — the shipped `advisor = "off"` and effort inheritance change their expected dicts — affects: none
DRIFT: STUDIO CONSULT's consult launch also passes effort and the Advisor line — every launch the session makes is covered by AC2 — affects: none

Consult ruling (2026-10-15T20:36:20Z, `accept-deviation score 0`): both pass-1 entries are not a deviation (score 0): required by the planned change. The two DRIFT lines above are withdrawn; no DRIFT line carries to the Auto Run Result.

### pass 2 (2026-10-15, implementer, review patches)

- planned: the advisor-iteration fix reuses existing helpers / actual: the executor's inline cache-split, `ttl_unknown`, missing, premium, alias and tally steps moved into a private `_tokens(usage)` helper and a local `admit(leg, model, usage)` closure that both paths share; `_advisor_calls` now returns `(model, iteration_usage)` / why: the logic was inline in `price()`, so it had to move before it could be shared / may affect: none (private; executor output unchanged)

DEVIATION SCORE: 1 (consult 2026-10-15T20:40:44Z: accept-deviation score 1)

DRIFT: meter.price executor pricing logic moved into private `_tokens`/`admit` helpers that the advisor path shares — the review patch needed one shared pricing path, and the logic was inline in price() — affects: none

### pass 3 (2026-10-15, implementer, follow-up review patches)

- planned: two text patches in `_bmad/custom/bmad-build-auto.toml` (l.44 fallback, l.71 subagent advisor-call reporting, plus an l.74 cross-reference) / actual: the same, nothing else / why: n/a / may affect: none

DEVIATION SCORE: 0 (this pass; the story's `deviation_score` stays 1 from pass 2)

## Consult Log

- 2026-10-15T20:36:20Z — trigger: deviation-gt-0 — question: accept or reject the implementer's two score-1 entries (extra exact test_pipeline assertions; consult launch passing effort + Advisor line) — ruling: accept-deviation score 0 — do: Keep both sets of edits exactly as they are. Do not revert anything. / Record both entries in `## Deviation Summary` as "not a deviation (score 0): required by the planned change", and re-score the story's deviation as 0. — rule candidate: In the implementer handoff: a change to an in-Files test assertion or customization sentence that is a direct consequence of a planned behaviour change (e.g. exact-equality dicts gaining a newly shipped field), kept exact and not loosened, is not a deviation; score it 0 and do not report it.
- 2026-10-15T20:40:44Z — trigger: deviation-gt-0 — question: accept or reject the pass-2 refactor of meter.price into shared private `_tokens`/`admit` helpers for advisor pricing — ruling: accept-deviation score 1 — do: Keep the `_tokens` / `admit` extraction and the `(model, iteration_usage)` return shape of `_advisor_calls` as implemented. / Record the deviation at score 1 (local) in the story's deviation log and continue to review. — rule candidate: A refactor that only moves code into private helpers inside a file listed in Files, to carry out a review patch that says "reuse the existing logic", with the public output unchanged and tests and conformance green, is a score-1 deviation the session may self-accept without a consult.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Run type:** a follow-up review. The spec was supplied with `status: done` and `followup_review_recommended: true`, so step-01 sent it straight to step-04 with `review_loop_iteration` reset to 0.

**Summary of the implemented change** (the story itself is unchanged from the first run):
- Every routing leg takes an optional `advisor` (`opus | fable | off`, default `off`).
- `pipeline.py` validates the vocabulary and the pairing rule (rank fable 3, opus 2, any other model 1). It checks per table, on the overlaid route in `resolve`/`apply`, and on the effective defaults in `check`. A violation is a named refusal.
- `apply` writes `advisor` into `routing.current.json`. An engine-stage leg gets `--advisor <v>` only when its advisor is not `off`.
- Subagent legs take the session's effort, with source `inherited-session`.
- The executor customization passes `model` and `effort` as Agent parameters and puts an `Advisor:` line first in each prompt. The dispatch note names model, effort and advisor, and states the advisor triggers.
- `meter.py` prices `advisor_message` iterations under their own leg `advisor`. A missing price, or a missing model, is a named refusal.
- Contract §5.1 documents the field at 0.1.21. The shipped legs all stay `advisor = "off"`.

**Files changed in this pass:**
- `_bmad/custom/bmad-build-auto.toml`:
  - When a subagent's leg advisor is on, the subagent reports one `advisor call:` line per call, and the session logs a Consult Log entry for each (l.71, cross-referenced at l.74).
  - The `routing.current.json` fallback now treats a missing leg field as the session's effort and advisor `off` (l.44).

**Review findings (this pass):** 2 patches applied (medium 1, low 1), 0 deferred, 5 rejected (all low). No intent_gap or bad_spec. No consult trigger fired: the deviation score this pass was 0, there was no high-severity finding, verify stayed green, and every change was inside Files.

**Follow-up review recommended: false.** Patched counts: high 0, medium 1, low 1. Score 3×1 + 1×1 = 4, which is below 5.

**Verification** (from `plugins/tk-studio/lib`, run by this session after the patches):
- `uv run python -m unittest discover tests`: 1193 tests, `OK (skipped=1)`.
- `uv run python ../contracts/conformance/runner.py run`: `ok: True`, `failures: []`.
- `resolve --story 26-3 --set session.advisor=opus --set session.model=claude-fable-5-1`: exit 2, error `runtime.session: advisor 'opus' ranks below model 'claude-fable-5-1' (the advisor must rank at or above the leg's model)`.
- `resolve --story 26-3`: every leg has `advisor: "off"`. Implementer, reviewers and consult have `effort: "medium"` with source `inherited-session`.
- `apply --story 26-3 --dry-run`: 0 occurrences of `--advisor`.
- The implementer confirmed that the toml still parses (`tomllib`).

**Residual risks:**
- `advisor_message` is still a placeholder name, and so is the assumption that top-level usage excludes advisor tokens. Epic 24.3's first advisor transcript confirms or corrects both.
- An advisor set on `seam`, `supervise` or `planner` is written to `routing.current.json`, but nothing delivers it yet.
- The session's advisor is not paired against subagent models; the harness applies its own check.
- The SPEC.md CAP-10 design-notes bullet is still for the operator or the next planning pass.

## Reconcile

- 2026-10-15 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 26-4-the-meter-lands-on-the-host-and-does-not-draft-itself
