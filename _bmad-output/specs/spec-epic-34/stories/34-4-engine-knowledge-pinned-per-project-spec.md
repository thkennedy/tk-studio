---
title: 'Engine Knowledge, Pinned per Project'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_commit: 'a92ccfea853acce1fe2b960ab788dc3abad96935'
baseline_revision: 'a92ccfea853acce1fe2b960ab788dc3abad96935'
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-4.md'
warnings: [oversized]
deferred:
  - summary: >-
      The launch check's engine-gate clause cannot tell whether the engine sandbox was provisioned WITH_GODOT, so a gate in engine.verify_commands on a sandbox without Godot gets no warning.
    evidence: |-
      Edge/blind review of 34-4; consult 11:12:22Z ruled no change in this story: nothing in the tracked config records how the sandbox was provisioned, so the WITH_GODOT rule is text in the skill and the kb row only.
    location: >-
      plugins/tk-studio/lib/launch.py engine_gate_clause
    severity: low
  - summary: >-
      Once an operator confirms gds-engine-godot-4 into working_set.<role>, orchestrate.py routing shows it as kind unknown, status missing ("re-run onboarding or install it"), because inventory.py has no plugin-skill plane.
    evidence: |-
      Plan 34-4 Risks and the spec's Never rule ("Widen inventory.py/orchestrate.py routing (recorded as a deferral instead)") require this deferral; follow-up blind review found it unrecorded. Class (a): the routing display of AC1's confirmed skill. Display only: the skills mount does not depend on it.
    location: >-
      plugins/tk-studio/lib/orchestrate.py _resolve_routes; plugins/tk-studio/lib/inventory.py planes
    severity: low
---

<intent-contract>

## Intent

**Problem:** A dev session on a Godot game project works from model priors: it guesses APIs that changed, hand-edits serialised scenes, and runs a bare `godot` that does not exist on the box. Nothing in the studio pins the engine version per project or warns on a mismatch.

**Approach:** Ship the read-only engine-knowledge skill `gds-engine-godot-4` inside the tk-studio plugin with a stdlib deterministic core `lib/engine_pin.py check` (reads the project's pin, checks it against the skill's `pin.json` range). Onboarding's `recommend.py propose` suggests the skill, with evidence and any version warning, when detection is confident on `game-godot`; `record` writes it only on confirmation. The launch check's `verify commands` row states where the engine gate runs. Contract 0.1.29 is extended additively.

### Acceptance criteria (transcribed verbatim from epics.md, Story 34.4)

- **AC1** — **Given** the `game-godot` detect profile **When** `tk-studio-onboard` proposes a working set for a project it detects as Godot **Then** the proposal carries, with its evidence, the plugin-shipped engine skill `gds-engine-godot-4` (read-only knowledge: the pinned version read from `project.godot`'s `config/features` and `global.json`'s SDK, the headless flags, the C# and GoDotTest conventions, the rule that `.tscn` and `.tres` files are written only the way the editor writes them, the import-cache rule, the `$env:GODOT` rule on the box) and records it in `working_set.<role>` only on confirmation; a project whose pinned version falls outside the skill's supported range gets a warning, never a silent mismatch; `recommend.py`'s tests cover the suggestion and the version check
- **AC2** — **Given** a run on a game project **When** the launch materialises the worktree **Then** the engine skill reaches the dev session the way the studio's other skills do (the skills mount), and `engine.verify_commands` (33.5) carries the project's engine gate when the sandbox can run it and names the host leg (34.1) when it cannot; the roster row, the README row and the kb row exist; a `claude plugin eval` case checks the skill answers the three pinned facts
- **AC3** — **Given** GDS's own engine catalogue (`gds-game-architecture/engine-mcps.yaml`, upstream-owned, AD-1) **When** the skill is written **Then** it cites the catalogue and never forks it

## Boundaries & Constraints

**Always:**
- Follow `plans/34-4.md` §Settled shape 1-6 exactly (file layout, `pin.json` values, `engine_pin.py` reads/warnings/refusals/output, the proposal entry shape, the `verify commands` clause wording, the contract sentences). The plan's Files list is the boundary (23 entries).
- Stdlib-only Python via `uv run`; every headless surface ends with the AD-11 JSON status block; `intent` of the skill's block is `gds-engine-godot-4`; SKILL.md contains "If the deterministic core is unrunnable".
- `recommend.py` imports `engine_pin.read_pin`/`engine_pin.check` as pure functions; never spawns the core.
- Box rule wording: on the host, `& $env:GODOT ...` (absolute path to the console exe); a bare `godot` only in a sandbox provisioned `WITH_GODOT` (runbook §3, the Linux Godot).
- Contract stays 0.1.29 (no bump); additive only. Re-pinning the 34.3 test's stories-line assertion is a recorded DRIFT (score 1).
- The launch row never goes red for the engine-gate clause; read only the tracked `.tk-studio/config.yaml` (never `config.local.yaml` or the user tier).

**Block If:**
- Any gate rejects a non-`tk-studio-` skill folder and the only fix is renaming the skill or changing a gate outside Files.
- `claude plugin eval init --bare` produces a case whose expectations cannot name the three facts and `prompt.md` is rejected too.
- The `verify commands` row cannot carry the clause without a non-additive change to its status-block shape or a §2 field.
- The Files list must grow past the plan's list.

**Never:**
- Fork or copy entries of `.claude/skills/gds-game-architecture/engine-mcps.yaml` (cite it by path only); edit anything under `.claude/` or `_bmad/`.
- Widen `inventory.py`/`orchestrate.py` routing (recorded as a deferral instead).
- Add the missing README row for `tk-studio-playable-judge` (34.3 gap; note only).
- Bump plugin/gate versions, push, tag, or run the release motion; any TUA change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| In range | `config/features` `"4.7"`, `Godot.NET.Sdk` `4.7.2` | `pinned 4.7.2`, `in_range: true`, `warnings: []`, status `complete` | exit 0 |
| Out of range | features `"4.8"`, SDK `4.8.0` (or 4.6) | `in_range: false`, warning naming both values and file; proposal entry `warnings[]` + `notes` prefixed `gds-engine-godot-4: `; skill still proposed | exit 0 |
| Disagree | features `4.7`, SDK `4.8.1` | major.minor disagreement warning | exit 0 |
| Unreadable | no features version, no global.json | `pinned version unreadable` warning | exit 0 |
| No project.godot | empty dir | `blocked`, `no project.godot` | exit 2 |
| Unknown skill | `--skill nope` | `blocked`, `unknown skill` | exit 2 |
| Bad global.json | invalid JSON | `blocked`, `malformed global.json` | exit 2 |
| Ask outcome | detection not confident | no skill suggested | — |
| Gate placement | `verify.engine` equals a stripped `engine.verify_commands` entry / differs / absent with skill in a working set | `engine gate: sandbox (engine.verify_commands)` / `engine gate: host leg (verify.engine, Story 34.1)` / warning `engine gate: none (...)` | row status never red |

</intent-contract>

## Code Map

The full investigation is `plans/34-4.md` §Code Map (anchors re-checked at baseline `a92ccfe`). Key anchors:

- `plugins/tk-studio/lib/recommend.py` -- `_module_status` :68, `propose` :75 (`_add` :90, confident branch :102, unavailable note ~:117), `record` :175 (unchanged). Add the skill path; plugin root = `Path(__file__).resolve().parent.parent`.
- `plugins/tk-studio/lib/detect.py` -- docstring :21; candidate `suggests` :187; public candidate keys :217-218: add `suggests_skills` (default `[]`).
- `plugins/tk-studio/lib/launch.py` -- `VERIFY_CHECK` :120, `tracked_verify_commands` :364, `reconcile_verify_commands` :498, `check_block` :583, docstring :62-73. Use the same `miniyaml.load` of the tracked config for `verify.engine`.
- `plugins/tk-studio/skills/tk-studio-playable-judge/` -- newest peer skill (SKILL.md, customize.toml) to copy shape from.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- copy the `tk-studio-playable-judge` entry (~:201-227); drives: refusal on empty sandbox (`no project.godot`) and `status-block-fresh` with `intent: gds-engine-godot-4`. Runner rules: `contracts/conformance/runner.py:102-195`, `lib/tests/test_conformance.py:859-869, :915-919`.
- `apps/supervisor/src/conformance.ts` -- `SURFACE_CORES` :126-146 (34.3 row at :146); add `"gds-engine-godot-4": ["engine_pin.py"], // Story 34.4` + isDirectDrive test in `apps/supervisor/test/conformance.test.ts`.
- `plugins/tk-studio/.claude-plugin/released-roster.json` -- sorted `skills` list; enforced by `skills/tk-studio-activate/scripts/drift_check.py:154-193` and `lib/tests/test_release_roster.py:79-101`.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 history clause, stories row :6, §1 surface sentence :45, 0.1.29 note (before "Every other field, kind and route" ~:441), §2 row next to `tk-studio-playable-judge` ~:659. Test template `lib/tests/test_driver_contract.py` `test_0_1_29_story_34_3_playable_verify_leg` ~:2047; §2 rule :29-37.
- `.claude/skills/gds-game-architecture/engine-mcps.yaml` -- read-only upstream (AD-1); `godot:` block ~:136; cite, never copy any `repo:` value.
- `README.md` :182-243 per-skill tables; `kb/playable-verify-on-the-box.md:1-6` kb frontmatter shape; `uv run plugins/tk-studio/lib/kb.py index --directory .` regenerates `kb/index.md`.
- Box facts: `kb/agent-pc-setup-runbook.md` §2 (`$env:GODOT`, 4.7.2 mono console exe) and :689-693 (`WITH_GODOT`); headless import/GoDotTest per `kb/acceptance-record-34-1-engine-gate-on-tua.md`.
- Evals: `kb/offline-install-runbook.md:407-421`; `claude` is on PATH (`~/.local/bin/claude`); `bun` at `~/.bun/bin`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/skills/gds-engine-godot-4/{SKILL.md,customize.toml,pin.json}` -- create per Settled shape 1 (all listed sections; catalogue citation; status-block line; core-unrunnable sentence) -- AC1 knowledge, AC3.
- `plugins/tk-studio/lib/engine_pin.py` -- create per Settled shape 2 -- the core.
- `plugins/tk-studio/lib/tests/test_engine_pin.py` -- reads, range compare, every warning, every refusal, status block, eval-case presence + three facts, catalogue citation and no-fork check, skill folder inside plugin `skills/` -- I/O matrix.
- `plugins/tk-studio/skills/tk-studio-detect/profiles/game-godot.json`, `lib/detect.py`, `lib/tests/test_detect.py` -- `suggests_skills` pass-through and validity check -- Settled shape 3.
- `plugins/tk-studio/lib/recommend.py`, `lib/tests/test_recommend.py` -- skill suggestion, evidence, warnings, record-on-confirm only (tests listed in plan Files) -- AC1.
- `plugins/tk-studio/lib/launch.py`, `lib/tests/test_launch.py` -- engine-gate clause, three placements -- AC2 / Settled shape 4.
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md` -- step 2 note on engine skill + warning shown before confirm.
- `plugins/tk-studio/evals/gds-engine-godot-4-pinned-facts/` -- scaffold with `claude plugin eval init --bare` (else `prompt.md`) -- AC2 eval.
- roster, manifest, driver-contract, test_driver_contract (new `test_0_1_29_story_34_4_engine_skill`, re-pin 34.3 stories line), `SURFACE_CORES` + test, README row, `kb/engine-godot-4-pinned.md` + regenerated `kb/index.md` -- AC2 rows, AD-19.

**Acceptance Criteria:**
- Given a confident Godot project in range, when `recommend.py propose` runs, then the proposal carries `gds-engine-godot-4` (`kind: skill`, `status: installed`) with `detection:` and `engine-pin:` evidence and no warning; when out of range, the entry and `notes` carry the warning.
- Given a proposal, when `record` runs without the skill confirmed, then `working_set.<role>` does not contain it; when confirmed, it does.
- Given the plugin, when the gate runs, then the roster/drift check, conformance (`ok: true`) and the supervisor `SURFACE_CORES` test accept the `gds-engine-godot-4` surface.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 1: (high 0, medium 0, low 1)
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` engine-gate clause warned `none` for a gate kept only in `engine.verify_commands` (both layers) — added the non-warning `sandbox list only` branch per consult 11:12:22Z, with a test and the contract sentence.
  - `[low]` `[patch]` both-keys label `sandbox` hid that the host leg also runs `verify.engine` — renamed `sandbox and host leg (...)` in code, tests, contract, SKILL.md, kb.
  - `[medium]` `[patch]` eval prompt's `allowed_tools` excluded Bash while the skill requires running the core — allowed Bash and Write, prompt invites a scratch-folder check, eval test extended.
  - `[low]` `[patch]` non-numeric `Godot.NET.Sdk` was pinned, reported out of range and as a disagreement — now falls back to `config/features`, warns on the non-version SDK value, unreadable only when neither parses; tests added.
- deferred: no WITH_GODOT provisioning check behind the engine-gate clause (class a: AC2's "when the sandbox can run it"; nothing tracked records provisioning; consult 11:12:22Z).
- rejected: README "All 18 studio surfaces" count — pre-existing (the count was already stale at baseline with 21 skills), not this story's change; roster `version` unchanged — house rule forbids a version bump the criteria do not name.

### 2026-10-27 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` SKILL.md, kb/engine-godot-4-pinned.md and the driver-contract 0.1.29 sentence and §2 row still gave the old pin rule (`godot_net_sdk`, else `features_version`) and omitted the not-a-version `Godot.NET.Sdk` warning (blind) — all four texts now state the parse-gated rule and list the warning; additive, no contract bump.
  - `[low]` `[patch]` present `Godot.NET.Sdk` key with an empty, numeric, null or list value was treated as absent: silent fallback to `config/features` (edge) — `_read` carries a presence flag and the raw shown value; `check()` warns `<value> is not a version`; the `godot_net_sdk` field stays string-or-null per consult 11:28:44Z; tests added.
  - `[low]` `[patch]` dead duplicated `engine = doc.get("engine")` branch in `launch.py` `engine_gate_clause` (blind) — removed; no behaviour change.
  - `[low]` `[patch]` the orchestrator-routing deferral required by plan Risks and the spec's Never rule was never recorded (blind) — added to frontmatter `deferred` (class a).
- deferral discipline: story total 2 deferrals — WITH_GODOT provisioning (a), orchestrator routing display (a).

### 2026-10-27 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L, both ran). Review content was the diff from `baseline_revision` minus this spec and `deferred-work.md` (the loop's own records). The contract's ~48KB single-line rows were condensed to their changed word spans.
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[low]` `[patch]` `engine_pin._VERSION_RE` was a prefix match, so `Godot.NET.Sdk` `4.x`/`4abc`/`4-latest` were taken as the pin: no not-a-version warning and no `config/features` fallback (blind). Now a whole-string match; a SemVer suffix is allowed only after major.minor.patch; tests added. DRIFT, consult 11:43:56Z.
  - `[low]` `[patch]` a commented `global.json` (the .NET SDK accepts `//` and `/* */`) was refused `malformed global.json`, so the pin was never read (edge). Strict parse, then one string-aware comment-stripped retry; still refuses invalid JSON; tests added. DRIFT, consult 11:43:56Z.
  - `[low]` `[patch]` the `propose` refusal→`engine pin not checked: <reason>` path had no test and no onboard-skill mention (blind). Added a `test_recommend.py` case (proposed, evidence and warning carry it, not recorded) and one clause in `tk-studio-onboard/SKILL.md`.
  - `[low]` `[patch]` the `launch.engine_gate_clause` docstring claimed None for a project without the engine skill; the host-leg/both clauses do not depend on the working set (blind). Docstring corrected; no code change.
  - `[low]` `[patch]` the contract header's `Story / rulings` AD list omitted AD-1, which the new §1 sentence cites (blind). `AD-1` added; still 0.1.29.
- rejected:
  - README "18 studio surfaces" count: pre-existing and stale before this story (21 `tk-studio-*` skills at baseline).
  - No plugin version bump for the roster row: house rule, bumps are out of the loop's hands unless the criteria name one.
  - Contract 0.1.29 reused: 0.1.29 is unreleased (tag `tk-studio--v0.3.6` carries 0.1.28), and the spec pins "Contract stays 0.1.29 (no bump); additive only".
  - Evidence `supported 4.7..4.8` reads ambiguously: this is plan Settled shape 5's literal `supported <min>..<below>`, and an out-of-range pin always carries the explicit `..<` warning beside it.
  - "Not shipped" proposal note absent from the contract: `notes[]` is free text, and the contract enumerates no note strings (the peer module note is not listed either).
  - §1 "is a skill in X, and the skill Y" wording: noise, the meaning is unambiguous.

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: the 34.3 test's stories-line assertion `Story 34.1, Story 34.2, Story 34.3 (Epic 34)` / actual: re-pinned to `Story 34.1, Story 34.2, Story 34.3, Story 34.4 (Epic 34)` / why: adding 34.4 to the contract's stories row changes that line (expected by the spec) / may affect: 34-5
- planned: `engine_pin` output `{engine, features_version, godot_net_sdk, dotnet_sdk, pinned, supported, in_range, warnings[]}` / actual: same keys plus leading `ok: true` (`ok: false, error` on refusal), and `in_range: null` when the pin is unreadable / why: matches peer core `playable_judge.py`; an unreadable pin cannot be judged / may affect: none
- planned: `propose` takes warnings from `engine_pin.check` / actual: a refusal from `check` during `propose` (e.g. malformed `global.json`) becomes an `engine pin not checked: <reason>` warning on the entry and in `notes`; `propose` does not fail / why: spec silent; failing would block onboarding, a warning keeps the mismatch visible / may affect: none
- planned: eval case holds `case.yaml` or `prompt.md` / actual: `prompt.md` plus `graders/criteria.md` (the scaffold's own layout) / why: that is what `claude plugin eval init --bare` produces / may affect: none
- planned: `kb/index.md` regenerated by `kb.py index` / actual: regenerated, header line restored by hand to `tk-studio` / why: `kb.py` titles the index with the checkout folder name (`q-run-epic-34-…` in this worktree) / may affect: none

DEVIATION SCORE: 1

DRIFT: test_driver_contract 34.3 stories-line assertion re-pinned to include Story 34.4 — the contract's stories row gains 34.4 — affects: 34-5
DRIFT: engine_pin output adds `ok` and allows `in_range: null` — peer-core shape; unreadable pin cannot be range-judged — affects: none
DRIFT: propose turns an engine_pin refusal into an `engine pin not checked: <reason>` warning — spec silent; never block onboarding, never silent — affects: none
DRIFT: eval case is `prompt.md` + `graders/criteria.md` — the `claude plugin eval init --bare` scaffold layout — affects: none
DRIFT: kb/index.md header restored by hand after regeneration — kb.py names the index after the checkout folder — affects: none

### pass 2 (2026-10-27, implementer, review patches)

- planned: patch 4 changes `recommend.py`/`test_recommend.py` only if the proposal evidence changes / actual: `engine-pin: pinned <v> from <file>` now names the file the pin actually came from; new test `test_non_numeric_sdk_pins_from_project_godot` / why: with the non-numeric-SDK fallback, the old rule would have named `global.json` for a pin taken from `project.godot` / may affect: none
- planned: patch 3 changes the eval prompt only / actual: also changed the operator eval command in `kb/engine-godot-4-pinned.md` to `claude plugin eval plugins/tk-studio --trust-plugin --allow-tools Bash Write` / why: Bash and Write are gated tools that need an explicit operator grant / may affect: none
- (consult 11:12:22Z) the engine-gate clause gains `engine gate: sandbox list only (engine.verify_commands; not identified without verify.engine)` and the both-keys label is renamed `engine gate: sandbox and host leg (engine.verify_commands, verify.engine)`, against plan Settled shape 4 / why: AC2 names a gate in `engine.verify_commands` as the correct state; 34.1's host leg runs `verify.engine` whenever set / may affect: none

DEVIATION SCORE: 1

DRIFT: engine-gate clause adds a `sandbox list only` non-warning branch and renames the both-keys label to `sandbox and host leg` — Settled shape 4 misreported AC2's sandbox case and the label did not match what 34.1 runs (consult 11:12:22Z) — affects: none
DRIFT: proposal `engine-pin:` evidence names the actual source file of the pin — the non-numeric-SDK fallback made the old rule untrue — affects: none
DRIFT: operator eval command adds `--allow-tools Bash Write` — the eval must let the skill run its core — affects: none

### pass 3 (2026-10-27, implementer, follow-up review patches)

- planned: present-but-unusable `Godot.NET.Sdk` warns / actual: the `pinned version unreadable` warning reads `no Godot.NET.Sdk version in global.json` when the key is present (absent-key wording unchanged) / why: the old wording was untrue for a present key / may affect: none
- planned: warn on an unusable present value / actual: JSON `null` counts as present; the warning shows `repr` for strings (whitespace kept, e.g. `'   '`) and `json.dumps` otherwise; `godot_net_sdk` stays string-or-null (consult 11:28:44Z) / why: `null` is only distinguishable from absence by an explicit presence flag; a widened field type was ruled out / may affect: none

DEVIATION SCORE: 1

DRIFT: unreadable-pin warning says `no Godot.NET.Sdk version in global.json` when the key is present — the absent-key text was untrue for that case — affects: none
DRIFT: a present `null`/non-string/empty `Godot.NET.Sdk` warns with its raw shown value while `godot_net_sdk` stays string-or-null — never a silent fallback, and no widened output type (consult 11:28:44Z) — affects: none

### pass 4 (2026-10-27, implementer, follow-up review 2 patches)

- planned: refusal `malformed global.json` on a JSON error (Settled shape 3) / actual: strict parse first, then one retry with `//` and `/* */` comments stripped (string-aware); refused only if that still fails / why: the .NET SDK accepts commented global.json, and AC1 reads the pin from it / may affect: none
- planned: `Godot.NET.Sdk` pins when it parses as a dotted version / actual: the whole value must match; a SemVer `-pre`/`+build` suffix is accepted (and dropped) only after major.minor.patch / why: the prefix match took `4.x`/`4abc`/`4-latest` as the pin, against the contract's not-a-version warning / may affect: none

DEVIATION SCORE: 1

DRIFT: the `malformed global.json` refusal is narrower: `//` and `/* */` comments are stripped before it is raised — the .NET SDK accepts commented global.json, and refusing it meant the pin was never read during onboarding (consult 11:43:56Z) — affects: none
DRIFT: a `Godot.NET.Sdk` value must be a whole dotted version, with a SemVer `-pre`/`+build` suffix accepted only after major.minor.patch — a prefix match took `4.x`/`4abc` as the pin, skipping the contract's not-a-version warning (consult 11:43:56Z) — affects: none

## Consult Log

- 2026-10-27 11:09:15Z — trigger: deviation-gt-0 — question: accept the implementer's five deviations at score 1 (stories-line re-pin, engine_pin `ok`/`in_range: null`, propose refusal→warning, eval scaffold layout, kb/index header restore)? — ruling: accept-deviation score 1 — do: Record the five deviations as accepted at DEVIATION SCORE 1 and proceed to review. Make no code changes. — rule candidate: A deviation that only adds a CLI-envelope `ok`/`error` key, re-pins an earlier story's contract-stories-line assertion, or hand-restores a generated header to its HEAD bytes because of a worktree folder name scores 1 with no consult; file a deferred-work item for kb.py to take the index title from repo config instead of the folder name.

- 2026-10-27 11:12:22Z — trigger: review finding with two readings (AC2 vs plan Settled shape 4; engine-gate clause) — question: does a gate kept only in `engine.verify_commands` with no `verify.engine` keep the `engine gate: none` warning, and is the both-keys `sandbox` label right? — ruling: accept-deviation score 1 — do: (1) no `verify.engine` + skill in a working set + non-empty `engine.verify_commands` → non-warning clause `engine gate: sandbox list only (engine.verify_commands; not identified without verify.engine)`; `none` warning only for an empty/absent list; add a test; extend the contract sentence; record DRIFT against Settled shape 4. (2) rename the both-keys label to `engine gate: sandbox and host leg (engine.verify_commands, verify.engine)` in code, tests and contract; same DRIFT. (3) no WITH_GODOT check in this story; defer. — rule candidate: When a story's AC names a configuration as the correct state, the plan must give it a non-warning status line, and every status label must match what the published contract actually runs (cite the contract line in the plan).

- 2026-10-27 11:18:08Z — trigger: deviation-gt-0 (review-patch pass 2) — question: accept the recommend.py evidence-source fix and the eval `--allow-tools Bash Write` operator command? — ruling: accept-deviation score 1 — do: Keep both patches as applied; in the closeout add one deviation line for each and note the operator eval check runs with the kb's command (the spec's command plus a tool grant). — rule candidate: When a plugin eval case exercises a skill that runs a lib core, its prompt.md `allowed_tools` must include Bash, and the documented operator command is `claude plugin eval <folder> --trust-plugin --allow-tools Bash` (adding Write only if the case writes fixtures).

- 2026-10-27 11:28:44Z — trigger: deviation-gt-0 (follow-up review, patch round) — question: accept the present-but-unusable `Godot.NET.Sdk` fix's two deviations (unreadable-pin wording when the key is present; `null`/non-string present values warn and the raw value flows into the `godot_net_sdk` output field)? — ruling: accept-deviation score 1 — do: Accept DRIFT A as written and DRIFT B for the warning only (raw value shown `repr` for strings, `json.dumps` otherwise). Keep output field `godot_net_sdk` string-or-null (stripped non-empty string, else `None`); `_read` returns the raw/shown value beside `sdk_present` and the warning reads from that; never JSON-dump into the field (`_parse` would accept number `4.3` as a pin). Add tests for JSON number `4.3`, `null` and `""`: each warns, pins from `config/features`, `godot_net_sdk` is `None`. — rule candidate: The type of a printed core output field is frozen once the contract describes it: a fix may add warnings but never widen a field's type; carry the diagnostic in `warnings[]`.

- 2026-10-27 11:43:56Z — trigger: deviation-gt-0 (follow-up review 2, patch round) — question: accept the commented-global.json refusal narrowing and the whole-string `Godot.NET.Sdk` version match against Settled shape 3? — ruling: accept-deviation score 1 — do: Keep both patches in `engine_pin.py` as written and record D1/D2 at score 1, affects none. Pin each with tests: commented global.json (including `//` inside a string) reads the pin; an unterminated `/*` or invalid JSON still refuses; `4.x`/`4abc`/`4-latest` warn and fall back; `-beta.1`/`+build` are accepted. Leave the contract text, refusal names, fields and warnings unchanged (no bump). (All of these tests were already present.) — rule candidate: When a story names a refusal or warning for a toolchain-owned input format (global.json, project.godot, csproj), it triggers on what that toolchain rejects, not the strict-parser literal. Narrowing to that, or tightening a version parse to the contract's own wording, is score 1 with no consult while names, fields and texts are unchanged. — observe: recorded ok.

## Verification

**Commands (from `plugins/tk-studio/lib`):**
- `uv run python -m unittest discover tests` -- expected: OK
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run python -m unittest tests.test_engine_pin tests.test_recommend tests.test_detect tests.test_launch tests.test_driver_contract tests.test_conformance tests.test_release_roster tests.test_utf8_guard -v` -- expected: OK
- From `apps/supervisor` (PATH with `~/.bun/bin`): `bun test test/conformance.test.ts` then `bunx tsc --noEmit` -- expected: 0 fail, clean
- From repo root: `uv run plugins/tk-studio/lib/kb.py index --directory .` -- expected: no diff after commit

**Operator checks (`unverifiable-here`):**
- `claude plugin eval plugins/tk-studio --trust-plugin` on the box passes the pinned-facts case.
- On TUA, `uv run plugins/tk-studio/lib/recommend.py propose --directory <TUA>` carries `gds-engine-godot-4` with `pinned 4.7.2` and no warning.


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review of the shipped story. The read-only engine-knowledge skill `gds-engine-godot-4` and its core `lib/engine_pin.py check` read the Godot pin from `project.godot` `config/features` and `global.json` (`Godot.NET.Sdk`, `sdk.version`) and check it against `pin.json` (`4.7` up to `<4.8`, tested `4.7.2`). They warn, never silently, on:
- a pin out of range;
- a major.minor disagreement;
- a `Godot.NET.Sdk` value that is not a version;
- an unreadable pin.

`recommend.py propose` suggests the skill on confident `game-godot` detection and records it only on confirmation. The launch `verify commands` row reports where the engine gate runs. Contract 0.1.29 is extended additively.

This pass fixed five low findings:
- `Godot.NET.Sdk` must now be a whole version, so `4.x` and `4abc` warn and fall back instead of pinning.
- A commented `global.json`, which the .NET SDK accepts, is now read rather than refused.
- The onboard refusal-to-warning path now has a test and a mention in the onboard skill.
- The `engine_gate_clause` docstring now matches the code.
- AD-1 is added to the contract's rulings list.

**Files changed (this pass).**
- `plugins/tk-studio/lib/engine_pin.py`: whole-string `_VERSION_RE` with the suffix rule in `_parse`; `_strip_comments` and `_load_global_json` (strict parse, then a comment-stripped retry).
- `plugins/tk-studio/lib/tests/test_engine_pin.py`: tests for non-version SDK values, accepted SemVer suffixes, commented global.json, `//` inside strings, and refusal of malformed or unterminated files.
- `plugins/tk-studio/lib/tests/test_recommend.py`: a malformed global.json is still proposed with the `engine pin not checked` evidence and warning, and is not recorded.
- `plugins/tk-studio/lib/launch.py`: `engine_gate_clause` docstring corrected (no code change).
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md`: one clause on the `engine pin not checked: <reason>` warning.
- `plugins/tk-studio/contracts/driver-contract.md`: `AD-1` added to the header's `Story / rulings` AD list.
- This spec: the triage, deviation and consult entries, and this result.

The earlier passes' file set is in commits `5bd9a38` and `9e6e793`. `deferred-work.md` is committed exactly as the orchestrator left it, not edited.

**Review (follow-up pass 2).** Both layers ran (band L).
- Patches: 5 (high 0, medium 0, low 5).
- Deferred: 0.
- Rejected: 6 (reasons in the Review Triage Log).
- Consults: 1, `accept-deviation score 1`.
- Follow-up review recommended: true. Patched high 0, medium 0, low 5; score 3×0 + 1×5 = 5, which is 5 or more.

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: `Ran 2214 tests`, OK (skipped=2).
- From `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: True`, failures `[]`.
- From `apps/supervisor` (PATH with `~/.bun/bin`), `bun test test/conformance.test.ts`: 52 tests, 0 fail. `bunx tsc --noEmit`: exit 0.
- `kb.py index --directory .`: the only diff was the known worktree-folder header noise, restored to HEAD.

**unverifiable-here (operator, agent PC).**
1. `claude plugin eval plugins/tk-studio --trust-plugin --allow-tools Bash Write` passes the `gds-engine-godot-4-pinned-facts` case.
2. On TUA, `uv run plugins/tk-studio/lib/recommend.py propose --directory <TUA clone>` carries `gds-engine-godot-4` with `pinned 4.7.2` and no warning.
3. The skill reaches dev sessions once a plugin release carrying it is installed. The release motion is out of the loop's hands.

**Residual risks.**
- Recorded-skill routing shows `missing` until inventory gains a plugin-skill plane (deferred, DW-72).
- WITH_GODOT provisioning is unchecked (deferred).
- A pre-release SDK such as `4.7.0-beta.1` pins as `4.7.0`. A two-part version with a suffix (`4.7-beta`) is now a not-a-version warning.
- The comment stripper is hand-written. An unterminated block comment still refuses.
- `kb.py index` titles the index with the folder name.
- The README surface count ("18") is stale, and it has no `tk-studio-playable-judge` row (pre-existing gaps).

DRIFT: test_driver_contract 34.3 stories-line assertion re-pinned to include Story 34.4 — the contract's stories row gains 34.4 — affects: 34-5
DRIFT: engine_pin output adds `ok` and allows `in_range: null` — peer-core shape; an unreadable pin cannot be range-judged — affects: none
DRIFT: propose turns an engine_pin refusal into an `engine pin not checked: <reason>` warning — spec silent; never block onboarding, never silent — affects: none
DRIFT: eval case is `prompt.md` + `graders/criteria.md` — the `claude plugin eval init --bare` scaffold layout — affects: none
DRIFT: kb/index.md header restored by hand after regeneration — kb.py names the index after the checkout folder — affects: none
DRIFT: engine-gate clause adds a `sandbox list only` non-warning branch and renames the both-keys label to `sandbox and host leg` — Settled shape 4 misreported AC2's sandbox case (consult 11:12:22Z) — affects: none
DRIFT: proposal `engine-pin:` evidence names the actual source file of the pin — the non-numeric-SDK fallback made the old rule untrue — affects: none
DRIFT: operator eval command adds `--allow-tools Bash Write` — the eval must let the skill run its core — affects: none
DRIFT: unreadable-pin warning says `no Godot.NET.Sdk version in global.json` when the key is present — the absent-key text was untrue for that case — affects: none
DRIFT: a present `null`/non-string/empty `Godot.NET.Sdk` warns with its raw shown value while `godot_net_sdk` stays string-or-null — never a silent fallback, no widened output type (consult 11:28:44Z) — affects: none
DRIFT: the `malformed global.json` refusal is narrower: `//` and `/* */` comments are stripped before it is raised — the .NET SDK accepts commented global.json (consult 11:43:56Z) — affects: none
DRIFT: a `Godot.NET.Sdk` value must be a whole dotted version, with a SemVer suffix accepted only after major.minor.patch — a prefix match took `4.x`/`4abc` as the pin (consult 11:43:56Z) — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 34-5-one-engine-mcp-per-run-started-by-the-pin
