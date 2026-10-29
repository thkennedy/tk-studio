---
title: 'DW-11 + DW-72: studio drift fix text and plugin-skill routing match the install model'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: '15d53fe460a634a823a65589c4c57e579c7bfd24'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context: []
warnings: ['multiple-goals']
deferred: []
---

<intent-contract>

## Intent

**Problem:** (DW-11) `consolidate.py:246-247` builds the single-machine drift fix candidate "run the guided fix on the affected machine (tk install / /plugin marketplace update)", naming the marketplace flow that Story 25-3 retired and AD-13 (amended) replaced with the skills-dir folder and the roster; under AD-21 a marketplace copy is the `shadowed` condition. (DW-72) `inventory.scan` has no plane for skills the tk-studio plugin itself ships, so `orchestrate._resolve_routes` (orchestrate.py:119-125) routes a confirmed `gds-engine-godot-4` as `kind: unknown, status: missing` with a "re-run onboarding or install it" note.

**Approach:** Rebuild the drift fix text from the folder-and-roster guided-fix constants the drift check already uses (`skills_plane.FIX_UPDATE` / `FIX_INSTALL` / `FIX_SHADOWED`). Add an additive `studio-plugin` plane to `inventory.scan` that reads `<plugin>/skills/*/SKILL.md`, so orchestrate routes shipped plugin skills as installed skills. Test both outputs.

## Boundaries & Constraints

**Always:** stdlib-only; `scan` stays a pure read; the new plane is additive — every resource, note, source and count the existing planes produce is unchanged (an existing name always wins: the plugin plane skips a name already in `resources`); the plugin skills directory is injectable via a keyword argument of `scan` defaulting to `PLUGIN_ROOT / "skills"` so tests are hermetic; a missing plugin skills dir degrades to `sources["plugin_skills"] = False`, never an error.

**Block If:** making the gate green requires changing `driver-contract.md`, a conformance schema, or `recommend.py` behaviour.

**Never:** edit `orchestrate.py` (the routing fix comes from the inventory); change `recommend.py`; reintroduce "marketplace update" or "tk install" wording into the consolidate drift fix; touch the deferred-work ledger, `epics.md`, plan files, routing/policy toml.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plugin skill confirmed | working set `developer: [gds-engine-godot-4]`, plugin ships `skills/gds-engine-godot-4/SKILL.md` | route `kind: skill`, `status: installed`, carries `path` + `description`; no "not in the inventory" note | none |
| Name collision | project `.claude/skills/X` or skill-manifest row `X` and plugin ships `X` | exactly one `X` resource, the pre-existing one (origin unchanged) | none |
| No plugin skills dir | injected dir absent | no plugin resources; `sources["plugin_skills"]` false | no exception |
| Single-machine drift event | one `drift-detection` event | fix candidate contains "guided fix" and the skills-dir folder-and-roster text; contains neither "/plugin marketplace update" nor "tk install" | none |
| Cross-machine drift | drift from two machines | still selects `DISTRIBUTION_FIX` (unchanged) | none |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/consolidate.py:242-249` -- `drift` branch of the fix-candidate builder; `fixes[0]` is the single-machine text to replace. `DISTRIBUTION_FIX` (line 56) stays. Imports at lines 33-41 (lib dir is on `sys.path` when run from `lib/`; sibling modules are imported plainly, e.g. `import bmadlock` in inventory.py).
- `plugins/tk-studio/lib/skills_plane.py:27-31` -- AD-13/AD-21 folder-and-roster fix constants `FIX_UPDATE`, `FIX_INSTALL`, `FIX_SHADOWED` (reuse; do not edit).
- `plugins/tk-studio/lib/inventory.py:147-317` -- `scan()`; planes in order: manifest modules, lock registry, skill-manifest CSV, `.claude/skills`, `.claude/agents`, `_bmad/custom`, then `counts`. `PLUGIN_ROOT` at line 41. Module docstring (lines 1-28) lists the planes — add the new one. `counts["skills_installed"]` currently counts `origin != "user-authored"`: it must exclude the new `studio-plugin` origin; add `counts["plugin_skills"]`.
- `plugins/tk-studio/lib/inventory.py:116` -- `read_frontmatter_summary(md_path)` reuse for name/description.
- `plugins/tk-studio/lib/orchestrate.py:101-140` -- `_resolve_routes`: `by_name.setdefault` first-wins; non-module resources get `path`, `description`, `routing`. Read-only; no edit needed.
- `plugins/tk-studio/lib/recommend.py:106-108,198-202` -- `_skill_status` (same `PLUGIN_ROOT/skills/<name>/SKILL.md` test) and the only inventory loop (user-authored only) — unaffected by a non-user-authored origin. Read-only.
- `plugins/tk-studio/lib/tests/test_inventory.py:206-218` -- shape/counts test; allowed kinds include `skill`. `test_orchestrate.py:144-170` -- missing / user-authored routing tests (pattern for the new test). `test_consolidate.py:150-170` -- drift fix test.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/inventory.py` -- add `plugin_skills_dir: Path | None = None` kwarg to `scan` (default `PLUGIN_ROOT / "skills"`); after the `_bmad/custom` plane, for each sorted `<dir>/<entry>/SKILL.md` whose name is not already a resource name, append `{kind: skill, name, status: installed, origin: studio-plugin, description, path, provenance}` (path relative to project root when inside it, else absolute posix; provenance `"tk-studio plugin skills/"`); set `sources["plugin_skills"]`; add `counts["plugin_skills"]`; exclude `studio-plugin` from `skills_installed`; update the docstring plane list -- DW-72.
- `plugins/tk-studio/lib/consolidate.py` -- replace the drift `fixes[0]` text with "run the guided fix on the affected machine (" + the skills_plane folder-and-roster fixes, e.g. `FIX_UPDATE`, `FIX_INSTALL`, `FIX_SHADOWED`) + ")" built from imported constants -- DW-11.
- `plugins/tk-studio/lib/tests/test_inventory.py` -- tests: plugin plane emits a shipped skill with origin `studio-plugin` (hermetic injected dir); collision keeps the existing resource; absent dir → source false, no error; existing counts unchanged.
- `plugins/tk-studio/lib/tests/test_orchestrate.py` -- test: confirmed `gds-engine-godot-4` (real shipped plugin skill, default dir) routes `kind: skill`, `status: installed`, no "not in the inventory" note.
- `plugins/tk-studio/lib/tests/test_consolidate.py` -- extend the drift test: single-machine fix contains `skills_plane.FIX_UPDATE` and not "/plugin marketplace update" / "tk install".

**Acceptance Criteria:**
- Given a working set confirming `gds-engine-godot-4`, when `orchestrate.resolve` runs, then its route is `kind: skill`, `status: installed` and no note says it is not in the inventory.
- Given a single-machine drift-detection event, when `consolidate` runs, then the fix candidate names the folder-and-roster guided fix and does not name the marketplace flow.
- Given the full lib suite and conformance runner, when run, then both are green.

## Spec Change Log

### 2026-10-29 — review pass 1 (patch, consult-accepted deviation)
- Trigger: edge-case-hunter — the joined `skills_plane` FIX_UPDATE/FIX_INSTALL/FIX_SHADOWED text (~311 chars) is truncated by `_cell` (200-char limit, consolidate.py:109), losing the AD-21 shadowed remedy; and the retired text was no longer recognised as tool-written, so old ledger rows would keep it forever.
- Amended (code, outside intent-contract): the single-machine drift fix is `DRIFT_FIX`, a 198-char condensed form of skills_plane.FIX_UPDATE/FIX_INSTALL/FIX_SHADOWED, because the joined constants do not fit the 200-char ledger cell; `LEGACY_DRIFT_FIX` is recognised (never emitted) so old rows upgrade. The Tasks line "built from imported constants" is superseded by this entry.
- Known-bad state avoided: a truncated fix candidate missing the shadowed remedy; a permanent retired-marketplace fix in existing ledgers.
- KEEP: the studio-plugin inventory plane and its tests unchanged; `_cell` limit and `skills_plane.py` untouched.

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 2, low 0)
- defer: 0
- reject: 12 (high 0, medium 0, low 12)
- addressed_findings:
  - `[medium]` `[patch]` consolidate.py drift fix truncated by `_cell` 200-char limit (shadowed remedy lost) — replaced with 198-char `DRIFT_FIX`; test asserts ≤200, no "…", all three remedies.
  - `[medium]` `[patch]` legacy tool-written drift fix not in `machine_fixes`, so old ledger rows never upgrade — added `LEGACY_DRIFT_FIX` to drift `machine_fixes`; two tests (single-machine and cross-machine upgrade).
- rejected (one line each): empty frontmatter `name` / unhandled iterdir errors / unnoted missing dir — same pattern as the existing planes, spec pins `sources` false with no note; cross-kind name collision and silent shadowing — spec's first-wins design, routing is name-keyed; default dir non-hermetic and orchestrate test on the real `gds-engine-godot-4` — intended, the criterion names the shipped skill; absolute path — specified; three remedies listed — covered by the patch; FIX_UPDATE-only assert — superseded by the patch's asserts; `skills_plane` import — removed by the patch; `counts.plugin_skills` undocumented — plumbing, no contract surface.

### 2026-10-29 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 10 (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` `DRIFT_FIX`'s literal `<home>/skills/tk-studio/` is parsed as an inline HTML tag in the rendered Markdown ledger (`issues/ledger.md`), hiding `<home>` — path wrapped in a code span (fix now exactly 200 chars, `_cell` leaves it whole); test asserts the backticked path.
- rejected (one line each): DRIFT_FIX hand-condensed from skills_plane — consult-accepted deviation, already a residual risk; missing plugin dir adds no note / silent name-collision skip / cross-kind collision — spec pins `sources` false and first-wins by name; empty frontmatter `name:` and unguarded `iterdir`/frontmatter read — same pattern as the existing planes, the plugin's shipped skills all carry names; orchestrate test reads the real plugin tree / default dir untested directly — intended, criterion 1 names the shipped `gds-engine-godot-4`; in-root relative-path branch untested and undocumented new keys/origin — plumbing, no contract surface; `counts.total` grows by `plugin_skills` (edge-case-hunter) — `total` is the all-planes aggregate, no consumer reads `counts` (grep over lib, skills, contracts), per-plane counts are asserted unchanged.

## Design Notes

The plugin plane runs last and dedups by name so it never displaces a manifest or user-authored resource (orchestrate and recommend behaviour for existing names is byte-stable). `studio-plugin` is a new origin rather than `bmad-official` so `skills_installed` keeps meaning "BMad-installed skills".

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary


### pass 1 (2026-10-29)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 2 (2026-10-29, review patches)

- planned: drift fix text built from imported skills_plane FIX_UPDATE/FIX_INSTALL/FIX_SHADOWED / actual: hand-condensed 198-char `DRIFT_FIX` constant in consolidate.py; skills_plane import dropped / why: the joined constants (~311 chars) cannot fit the 200-char `_cell` ledger cell / may affect: none (later edits to skills_plane fix wording need a matching manual edit to DRIFT_FIX)
- planned: test asserts the fix contains skills_plane.FIX_UPDATE / actual: phrase-level asserts plus ≤200 chars and no truncation marker / why: the full FIX_UPDATE text cannot appear in a fix that fits the cell / may affect: none
DEVIATION SCORE: 1

DRIFT: consolidate drift fix text is a condensed form of the skills_plane fix constants, not built from them — the 200-char ledger cell cannot hold the joined constants — affects: none
DRIFT: DW-11 test asserts the remedy phrases, not skills_plane.FIX_UPDATE verbatim — FIX_UPDATE cannot appear whole in a ≤200-char fix — affects: none

### pass 3 (2026-10-29, follow-up review patch)

DEVIATIONS: none (code-span backticks around the path inside the already-accepted `DRIFT_FIX`)
DEVIATION SCORE: 1 (unchanged from pass 2)

## Consult Log

- 2026-10-29T19:17:18Z — trigger: deviation-gt-0 — question: accept the condensed 198-char DRIFT_FIX (vs the spec task's constant-built text that _cell truncates at 200 chars)? — ruling: accept-deviation score 1 — do: Keep DRIFT_FIX, LEGACY_DRIFT_FIX and the phrase-level, ≤200-char and not-truncated asserts as patched. Record in the spec's change log that the fix text is a condensed form of skills_plane.FIX_UPDATE/FIX_INSTALL/FIX_SHADOWED, because the joined constants do not fit the 200-char ledger cell. Leave _cell's limit and skills_plane.py unchanged. — rule candidate: When a spec task says to put text into a bounded ledger or table cell, it must state the cell's character limit and whether the text may be condensed. (observe.py record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T174706Z-da84bd` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Follow-up review of DW-11 + DW-72 (baseline 15d53fe460a634a823a65589c4c57e579c7bfd24). DW-11: consolidate's single-machine drift fix is the AD-13 folder-and-roster guided fix, now with the skills-dir path in a code span so `<home>` stays visible in the rendered ledger; retired marketplace text still upgrades. DW-72: the additive `studio-plugin` inventory plane routes shipped plugin skills (`gds-engine-godot-4`) as `kind: skill, status: installed`. No change to the DW-72 half in this pass.

**Files changed (this pass):**
- `plugins/tk-studio/lib/consolidate.py` — `DRIFT_FIX` path wrapped in backticks (200 chars, fits `_cell` whole); comment notes why.
- `plugins/tk-studio/lib/tests/test_consolidate.py` — asserts the backticked path in the single-machine drift fix.

**Review:** blind-hunter + edge-case-hunter (both layers; no story plan, not S-band). Patches applied 1 (low 1); deferred 0; rejected 10. Follow-up review: false (patched high 0, medium 0, low 1 → score 1 < 5).

**Verification:** `uv run python -m unittest discover tests` (plugins/tk-studio/lib) — Ran 2555 tests, OK (skipped=4). `uv run python ../contracts/conformance/runner.py run` — `ok: true`.

**Residual risks:** `DRIFT_FIX` sits exactly at the 200-char cell bound; any wording addition must shorten elsewhere (the test's `len <= 200` and no-`…` asserts catch it). `DRIFT_FIX` still duplicates skills_plane wording by hand. `counts.total` from a default scan includes the plugin's shipped skills (no current consumer). `_bmad-output/implementation-artifacts/deferred-work.md` carries the orchestrator's uncommitted DW-11/DW-72 resolution edits; left untouched and uncommitted per the invocation's instruction, so the working copy is not clean on that one file only.

DRIFT: consolidate drift fix text is a condensed form of the skills_plane fix constants, not built from them — the 200-char ledger cell cannot hold the joined constants — affects: none
DRIFT: DW-11 test asserts the remedy phrases, not skills_plane.FIX_UPDATE verbatim — FIX_UPDATE cannot appear whole in a ≤200-char fix — affects: none

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Spec resolution: unit key `dw-studio-drift-and-routing-text` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run state.json), `spec-dw-11-dw-72-studio-drift-and-routing-text.md`.
- Part B note: this unit is a sweep DW bundle (DW-11, DW-72), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_orchestrate` (confirmed `gds-engine-godot-4` routes `skill`/`installed`); AC2 `test_consolidate` (folder-and-roster fix, no "/plugin marketplace update"); AC3 per the Auto Run Result (2555 OK, conformance `ok: true`), and this session's rerun of `tests.test_consolidate tests.test_orchestrate tests.test_inventory` (56 OK).
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met
