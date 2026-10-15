---
title: 'The Planner Settles Schema Shape and the Spec File Name'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '2a217c7b25c8477c127d2c9fab960781b35ce972'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 0
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-26/plans/26-2.md'
warnings: [oversized]
deferred:
  - summary: >-
      `_bmad/custom/bmad-build-auto.toml:67` still tells the executor to name the spec `<entry id>-<slug of the title>.md`, contradicting the dispatch note's `stories/<id>-spec.md` (transcribe.py:141).
    evidence: |-
      The dispatch note sends the executor session to `_bmad/custom/bmad-build-auto.toml` for its project rules, and l.67 there keeps the doubled slug that hole 6 targets. The stock bmad-build-auto step-01 also derives `{story_id}-{slug}.md` under folder+id dispatch. Both names resolve by the `<id>-*.md` glob, so nothing breaks, but the shortening may never happen in practice. The story's intent-contract Never list forbids editing the toml (consult ruling `apply`, 2026-10-15). Fix: change the l.67 naming sentence only, keeping the glob and pending clauses. Owner: the next planner or the operator. Deferral criterion (a).
    location: >-
      _bmad/custom/bmad-build-auto.toml:67
    severity: medium
  - summary: >-
      The consult `scope` sentence added for AC1 reaches `routing.current.json` as `consult_scope`, but nothing reads it, so the consult never sees it.
    evidence: |-
      `pipeline.py:322` writes `consult_scope`. No other code or customization reads that key: `bmad-build-auto.toml` reads only `consult_triggers`. The consult subagent's prompt is `.bmad-loop/plugins/studio-pipeline/consult.md` followed by the question, and consult.md carries its own fixed scope list. So the schema-shape-as-planner-matter rule exists as text only. The wiring gap predates this story. Deferral criterion (a): this is the behaviour AC1's consult-scope clause names.
    location: >-
      plugins/tk-studio/lib/pipeline.py:322; .bmad-loop/plugins/studio-pipeline/consult.md
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Two planner holes (Story 26.2, ST-089). In hole 19, a story whose acceptance criteria need a schema entry, file or tag for an artifact that only a later story or an operator produces is left as a Block If or an open question. The dev session then halts on something the design documents already settle. In hole 6, the dispatch note `transcribe.py` writes asks for `stories/<id>-<slug of the title>.md`. The id already carries the slug, so the slug is repeated, and the 26-1 spec path is 189 characters long.

**Approach:** Add a settled-shape rule to task-planning.md: the planner records the shape in the SPEC's design notes, citing the constraining document. Extend the launch consult scope so that schema shape is a planner matter when the documents constrain it, and an operator ruling only when they do not. Change the dispatch note's name to `stories/<id>-spec.md`. Pin both rules with tests and a fixture, and name both in runbook §3.8.

**Acceptance criteria (verbatim, epics.md "### Story 26.2"):**

- **AC1:** **Given** `.bmad-loop/plugins/studio-pipeline/task-planning.md` and the SPEC the planner writes **When** a story's acceptance criteria require a schema entry, a file or a tag for an artifact that only a later story or an operator action produces **Then** the planner records the settled shape in the SPEC's design notes (an optional or deferred entry, a per-platform map, a named placeholder rule) citing the design document that constrains it, and never leaves it as a Block If or an open question; the consult scope text in the launch customization names schema shape as a planner matter when the design documents constrain it, and an operator ruling only when they do not
- **AC2:** **Given** the dispatch notes `transcribe.py` writes into `stories.yaml` **When** they name the executor spec file **Then** the name is `stories/<id>-spec.md` (the id already carries the title slug), the engine's glob `<id>-*.md` still resolves it, a bare `<id>.md` is still read as pending (hole 1 unchanged), and the longest resulting path on this box stays under 200 characters
- **AC3:** **Given** the lib suite **When** the story closes **Then** the transcription tests pin the new name, a planner-note fixture pins the settled-shape rule, and the runbook §3.8 names both

## Boundaries & Constraints

**Always:**
- Studio scripts and tests are stdlib-only and run via `uv run`. The lib suite makes no network call.
- Keep the dispatch note's glob clause and pending clause word for word. Only the file-name token changes.
- The existing consult `scope` text stays. Append one sentence to it.
- The settled-shape rule is stated once in task-planning.md §3.
- Use the plan's settled shape (plans/26-2.md "Settled shape" 1–5) as the ruling for format and wording.

**Block If:**
- Satisfying a criterion would need an edit to `epics.md`, `SPEC.md` or its companions, `stories.yaml`, bmad-loop itself, or the mounted `/home/agent/.claude/skills/tk-studio` copy.

**Never:**
- Rewrite the existing Epic 26 `stories.yaml` entries. They keep the old wording until the next transcription.
- Touch the driver contract. No contract surface is named, so there is no 0.1.21 append.
- Edit `_bmad/custom/bmad-build-auto.toml` or `kb/execution-pipeline-model-routing.md`.
- Run `transcribe.py` without `--dry-run` against this repo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New name | `entry(26, story, {})` | invoke_dev_with names `` `stories/<key>-spec.md` ``, keeps `` the glob `<key>-*.md` `` and `` a file named `<key>.md` is read as pending ``, and contains no `<slug of the title>` | none |
| Glob resolves | tmp `stories/` with `<key>-spec.md` and `<key>.md` | `glob("<key>-*.md")` matches only `<key>-spec.md` | none |
| Worst-case length | `REPO_ROOT` + `_bmad-output/specs/spec-epic-99/stories/` + 65-char key (60-char slug cap) + `-spec.md` | under 200 characters | none |

</intent-contract>

## Code Map

- `.bmad-loop/plugins/studio-pipeline/transcribe.py` -- `entry()` at l.125. The key at l.126 is `f"{epic}-{story['num']}-{slug(title)}"`, and `slug()` (l.48) caps the slug at 60 characters. The "Spec file:" sentence is at l.141–143: change only `` `stories/{key}-<slug of the title>.md` `` to `` `stories/{key}-spec.md` ``. Leave the docstring at l.12 alone. A `__main__` guard makes the module importable. `--dry-run` still raises when `stories.yaml` already has entries and prints keys only, so the manual check calls `entry()` in-process.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` -- §3 "Write the story plan" (l.66–104), with the template ending `## Risks and open decisions` / "phrased as a Block If" (l.100–101). §1 is the bootstrap (l.20–32).
- `plugins/tk-studio/skills/tk-studio-launch/customize.toml` -- `[pipeline.consult] scope` at l.82. `pipeline.py:322` copies it to `routing.current.json`, and `test_pipeline.py:111` asserts only that it is non-empty.
- `_bmad-output/specs/spec-epic-26/SPEC.md` `## Design notes (settled shape, planner, 2026-10-15)` (read-only) -- the precedent shape for the fixture.
- Engine (read-only): bmad-loop `stories.py resolve_story_spec` globs `stories/{sid}-*.md`. A bare `<id>.md` is pending. The sentinels `unresolved`/`ambiguous` do not collide with `spec`.
- `plugins/tk-studio/lib/tests/test_installer_live.py:26-27` -- the `REPO_ROOT` precedent (`parents[2]` is the plugin root, and `.parents[1]` of that is the repo root). Load transcribe.py with `importlib.util.spec_from_file_location`, and `skipUnless` the file exists.
- `kb/agent-pc-setup-runbook.md` §3.8 "Running an epic" (l.720–735), a numbered list with items 1–5.

## Tasks & Acceptance

**Execution:**
- `.bmad-loop/plugins/studio-pipeline/transcribe.py` -- change the "Spec file:" name to `` `stories/{key}-spec.md` `` -- AC2.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` -- add the settled-shape rule once in §3:
  - When it applies: an AC needs a schema entry, file or tag for an artifact that only a later story or an operator action produces.
  - What the planner does: it appends a bullet to `<spec_folder>/SPEC.md` `## Design notes (settled shape, planner, <date>)`, creating the section if absent. The bullet format is `<CAP or story> — <artifact>: <shape> — per <design document path[§]>`. The shape is one of `optional entry`, `deferred entry`, `per-platform map`, `named placeholder rule`. The plan's "Settled shape" carries the detail.
  - Never a Block If or an `open_questions[]` item.
  - It stays a Block If naming an operator ruling only when no design document constrains it.
  - Add the carve-out to the template's "Risks and open decisions" line: settled shapes are not Block Ifs.
  - This is a planner write, not a `bmad-spec` edit (AD-4).
  - Covers AC1.
- `plugins/tk-studio/skills/tk-studio-launch/customize.toml` -- append to `scope`: "Schema shape for an artifact a later story or an operator produces is a planner matter, settled in the SPEC's design notes, when the design documents constrain it; an operator ruling (`escalate`) only when they do not." -- AC1.
- `plugins/tk-studio/lib/tests/fixtures/planner-note/SPEC.md` (new) -- a minimal SPEC with a `## Design notes (settled shape, planner, <date>)` section. Each bullet uses one of the four shapes and cites a design document path. No bullet contains `Block If` or `open question`. -- AC3.
- `plugins/tk-studio/lib/tests/test_planner_rules.py` (new) -- covers AC2 and AC3:
  - (a) `entry()` names `stories/<key>-spec.md`, keeps the glob and pending clauses, and has no `<slug of the title>`.
  - (b) The glob resolves `<key>-spec.md` and not a bare `<key>.md`.
  - (c) The worst-case path is under 200 characters.
  - (d) The fixture's bullets satisfy the rule, and task-planning.md states it: the section heading, all four shapes, and the "never a Block If" text.
  - (e) The shipped consult `scope` names schema shape as a planner matter and an operator ruling otherwise.
- `kb/agent-pc-setup-runbook.md` -- one short item in §3.8 "Running an epic" covering AC3:
  - Spec files are `stories/<id>-spec.md`, because the id carries the slug and the path stays short for Windows.
  - The planner records settled shapes in the SPEC's design notes and never halts the dev on them.

**Acceptance Criteria:**
- Given the edited tree, when `uv run python -m unittest discover tests` runs from `plugins/tk-studio/lib`, then it is green and `test_planner_rules` runs without being skipped.
- Given the edited tree, when the conformance runner runs, then it prints `ok: true`.
- Given transcribe.py, when `grep -c "slug of the title>.md"` runs on it, then the count is 0.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- layers: blind-hunter and edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 1, low 4)
- defer: 0
- reject: 2: (low 2)
- addressed_findings:
  - `[medium]` `[patch]` task-planning.md: the rule pointed to a plan "Settled shape" section the template lacked. The template now has `## Settled shape` before `## Files`.
  - `[low]` `[patch]` task-planning.md: a later planning date could have opened a second dated design-notes section. Bullets now go under the existing section whatever its date, and it is created only when absent (merged with edge-case-hunter's identical finding).
  - `[low]` `[patch]` test_planner_rules.py: the bullet template (the AC1 citation) was unasserted. It is now asserted in §3, together with the template's `## Settled shape`.
  - `[low]` `[patch]` fixture SPEC.md: citations did not constrain their artifacts (AD-11, contract §8). The bullets were rewritten with real constraining anchors, and the test asserts each cited path exists and each § anchor text is in it.
  - `[low]` `[patch]` test_planner_rules.py: the worst case used a 59-character slug. It now uses exactly 60 characters (key 66 = `99-99-` + 60) and asserts the path is under 200. The I/O matrix's "65-char key" was an arithmetic slip; the test covers the longer, true worst case.
- rejected:
  - edge-case-hunter: "a constrained shape that fits none of the four shapes has no outcome". This is the plan's settled-shape ruling 1 ("one of" the four, as AC1 lists them); the fallback for an unconstrained shape is already a Block If. No AC-named behaviour changes.
  - edge-case-hunter: "a 3-digit epic or a longer Windows root". AC2 bounds "on this box". Epics here are 2-digit, and the 66-character key case gives 135 characters.

### 2026-10-15 — Review pass (follow-up)
- layers: blind-hunter and edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 2: (high 0, medium 2, low 0)
- reject: 4: (low 4)
- addressed_findings:
  - `[low]` `[patch]` task-planning.md: the template's Risks placeholder said "settled shapes (below)", but `## Settled shape` sits above it. It now names `the ## Settled shape section`, and the test assertion follows.
  - `[low]` `[patch]` fixture SPEC.md: the supervisor-tag bullet named story 27-2, which has no criterion for a release tag. The operator-cut `supervisor--v0.1.0` belongs to Story 25.1 (epics.md:1883). The bullet now names 25-1 and cites `epics.md §Story 25.1: …`.
- deferred:
  - blind-hunter: `_bmad/custom/bmad-build-auto.toml:67` still names `<entry id>-<slug of the title>.md`, contradicting the dispatch note. This was first triaged as an intent_gap, because the fix is a file the intent's Never list forbids, which fired the `halt` consult. The consult ruled `apply`: AC2's surface is the dispatch note, which is met, so it is deferred under (a). See the Consult Log.
  - blind-hunter: `consult_scope` has no consumer, and the consult's prompt (consult.md) carries its own scope. This is a pre-existing wiring gap that affects the behaviour AC1 names, so it is deferred under (a).
- rejected:
  - edge-case-hunter: "a duplicate or contradictory bullet for the same artifact on a re-plan". This is speculative, AC1 names no dedup behaviour, and the rule already appends under one section.
  - edge-case-hunter: "a §4 validate failure leaves the appended design-notes bullet". A settled shape is a fact about the design documents, valid whatever the manifest's state. Not AC-named.
  - edge-case-hunter: "two design documents constrain the same artifact differently". The existing consult scope covers a contradiction between pinned facts. Not AC-named.
  - edge-case-hunter: "a consult meets a constrained shape the planner left unsettled, with no verdict". consult.md's `apply`/`escalate` rulings define the outcome. The reachability half is the deferred `consult_scope` item.

## Design Notes

The dispatch note is the single statement of the file name: task-planning.md gains no file-name text. This story's own spec still uses the old long name, because its `stories.yaml` entry predates the change.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green, `test_planner_rules` not skipped.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `grep -c "slug of the title>.md" .bmad-loop/plugins/studio-pipeline/transcribe.py` -- expected: 0.
- `uv run --no-project python -c` importing transcribe.py and printing `entry(26, {...}, {})[1]` for story 26.2 -- expected: names `stories/26-2-the-planner-settles-schema-shape-and-the-spec-file-name-spec.md`.

## Deviation Summary

### pass 1 (2026-10-15)

DEVIATIONS: none
DEVIATION SCORE: 0


## Consult Log

- 2026-10-15T20:21:23Z — trigger: halt — question: the dispatch note's `stories/<id>-spec.md` (transcribe.py:141) contradicts `_bmad/custom/bmad-build-auto.toml:67` (`<entry id>-<slug of the title>.md`), and the intent-contract Never list forbids editing the toml; the options were to keep done and defer, to accept a deviation and edit l.67, or to escalate — ruling: apply — do: do not HALT; read AC2 literally (its surface is the dispatch note, which transcribe.py:141 meets), so the story stays done with no code change and the toml is untouched; file one deferred item under criterion (a) for the l.67 naming sentence, owned by the next planner or the operator — rule candidate: when a story changes wording that the dispatch note shares with `_bmad/custom/bmad-build-auto.toml` (the spec file name, the glob, the verify gate), the planner greps the toml for that wording and puts every match in the plan's Files, never in the Never list.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A follow-up review pass on Story 26.2, which closes holes 19 and 6. The implementation from 14e6fb0 stands:
- **Settled-shape rule:** stated once in task-planning.md §3. The planner appends a `<CAP or story> — <artifact>: <shape> — per <doc[§]>` bullet to the SPEC's `## Design notes (settled shape, planner, <date>)`, using one of four shapes. It is never a Block If or an open question unless no design document constrains the shape.
- **Consult scope:** the launch consult `scope` names schema shape as a planner matter when the documents constrain it, and an operator ruling (`escalate`) only when they do not.
- **Spec file name:** the dispatch note names `stories/<id>-spec.md`.

This pass fixed two low findings and deferred two medium ones.

**Files changed (this pass):**
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`: the Risks placeholder now names "the `## Settled shape` section" instead of "(below)".
- `plugins/tk-studio/lib/tests/test_planner_rules.py`: the assertion follows the new placeholder text.
- `plugins/tk-studio/lib/tests/fixtures/planner-note/SPEC.md`: the supervisor-tag bullet names 25-1 and cites epics.md §Story 25.1.

**Files changed (whole story, since 2a217c7):** `transcribe.py`, `task-planning.md`, `tk-studio-launch/customize.toml`, `test_planner_rules.py` (new), `fixtures/planner-note/SPEC.md` (new) and `kb/agent-pc-setup-runbook.md` §3.8 item 6.

**Review:** blind-hunter and edge-case-hunter both ran (band L).
- Patches applied: 2 (low 2).
- Deferred: 2 (medium 2), both under criterion (a).
- Rejected: 4 (low 4).
- One consult (trigger `halt`, ruling `apply`) avoided an intent-gap HALT on the bmad-build-auto.toml:67 naming contradiction.
- Follow-up review recommended: false (patched high 0, medium 0, low 2; score 3×0 + 1×2 = 2, under 5).

**Verification:**
- `uv run python -m unittest discover tests`: 1173 tests, OK (1 skipped, the opt-in live probe). `test_planner_rules` ran 6 of 6 and passed, none skipped.
- `runner.py run`: exit 0, `ok: true`, `failures: []`.
- `grep -c "slug of the title>.md" transcribe.py`: 0.

**Residual risks:**
- In practice, executors may keep writing the doubled-slug name. `_bmad/custom/bmad-build-auto.toml:67` and stock step-01 still derive it. This is deferred, and both names resolve by the glob.
- The consult `scope` sentence is not read by the consult (no `consult_scope` consumer). This is deferred.
- The settled-shape rule is LLM-executed planner text, proven by text and fixture rather than by a planner run.

## Reconcile

- 2026-10-15 — score 0; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 26-3-routing-legs-carry-an-advisor-and-an-effort
