---
title: 'The Drift Check and Conformance Read the Folder and the Roster'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
baseline_revision: 9812fabc7b0551d4009ba7d17124ce8a7d78a38f
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/SPEC.md'
warnings: ['oversized']
deferred:
  - summary: >-
      consolidate.py's drift-category fix text still names the retired marketplace flow ("tk install / /plugin marketplace update").
    evidence: |-
      plugins/tk-studio/lib/consolidate.py:246-247 builds the fix "run the guided fix on the affected machine (tk install / /plugin marketplace update)". Story 25-3 removed that flow from the drift check, SKILL.md, driver-contract §6 (pinned by test_driver_contract assertNotIn("/plugin marketplace update")) and amended AD-13 to the folder and the roster. Under AD-21 a marketplace copy is the `shadowed` condition, so evolve proposals built from drift-detection events give guidance that contradicts the plane's own fixes. The text pre-dates this story and the file is outside its Files boundary. Deferral criterion (b): an AD rule (AD-13 as amended) left contradicted by a shipped fix text.
    location: >-
      plugins/tk-studio/lib/consolidate.py:246
    severity: low
---

# The Drift Check and Conformance Read the Folder and the Roster

Story 25.3 (Canonical: ST-083). Authoritative text: `_bmad-output/planning-artifacts/epics.md` §"Story 25.3". No `plans/25-3.md` exists; the Code Map below is this session's investigation. Replan notes (25-1 and 25-2 reconcile, 2026-10-14) and the consult ruling of 2026-10-14 (Consult Log) are folded into Boundaries.

<intent-contract>

## Intent

**Problem:** The drift check's plugin plane judges loadability from the harness install record (`installed_plugins.json`) and the marketplace catalog, and conformance drives the repository tree. Once the plugin is an installer-written skills-dir folder (AD-21), both report the wrong thing.

**Approach:** The plugin plane reads the skills-dir folder's `plugin.json` and compares it with the configured channel's roster `plugin` entry (and with the in-repo catalog only in a developer checkout), naming one of four cases. The conformance runner gains `--from-archive <zip>`, which installs the built zip into a clean `CLAUDE_CONFIG_DIR` skills folder and drives from there. The contract (0.1.19) and the spine's AD-13 state the rule.

**Acceptance criteria (verbatim, epics.md §Story 25.3):**

- **AC1.** **Given** `drift_check.py`'s plugin plane **When** it runs on a machine with the skills-dir plugin **Then** it reads the folder's `plugin.json` version, compares it with the roster's `plugin` entry for the configured channel (and with the in-repo catalog only in a developer checkout), reports `ok`, `stale` (guidance: `tk-studio update`), `missing` (guidance: `tk-studio install`) or `shadowed` (a marketplace copy is installed; guidance names the uninstall), and never reads `installed_plugins.json` as the source of truth; the lib suite pins all four cases
- **AC2.** **Given** `contracts/conformance/` **When** the suite runs **Then** the harness-loadable assertion reads the skills-dir folder, and the runner can install the built zip into a clean `CLAUDE_CONFIG_DIR` skills folder before driving (`--from-archive <zip>`), so the suite cannot pass against the repository tree for the wrong reason
- **AC3.** **Given** the driver contract at 0.1.18 **When** the story lands **Then** §6 (drift-check invocation) states the folder-and-roster rule, the header reads 0.1.19 with an additive changelog clause, the spine's AD-13 wording "installed plugin version vs `marketplace.json`" is amended to the folder and the roster, and conformance is ok over every surface

## Boundaries & Constraints

**Always:**
- The folder is `<home>/skills/tk-studio/`, where `<home>` is `--claude-home`, else `CLAUDE_CONFIG_DIR`, else `~/.claude`. A live link or junction counts as the folder; a dangling link is `missing`. The installer's siblings `.tk-studio.new`, `.tk-studio.previous` and `.tk-studio.retired` are never the plugin. When the folder is absent and a sibling exists, the `missing` detail names the sibling found.
- Configured channel (consult ruling): `drift_check.py --channel {stable,latest}`, default `stable` (the installer's default). The roster is `<directory>/tools/installer/rosters/<channel>.json`, and the channel is that file's stem. With no roster in the project, the version comparison is reported "not checkable from this project" (ok), while `missing` and `shadowed` are still judged. No network call and no new persisted config.
- `stale`: the folder version differs from the roster `plugin` entry's tag version (`tk-studio--vX.Y.Z`), or in a developer checkout (`<directory>/.claude-plugin/marketplace.json` present) from the catalog's `tk-studio` entry. The fix is `tk-studio update`. A roster that has no `plugin` entry means "not shipped in this channel" and is not stale.
- `shadowed`: read exactly what `tools/installer/cli/tk_studio_cli/plugin_leg.py:432` `marketplace_cleanup` reads, and nothing more: user-scope `tk-studio@<m>` records in `plugins/installed_plugins.json` (excluding `@skills-dir`), and `enabledPlugins` `tk-studio@<m>` keys in `<home>/settings.json`. The guidance names each command: `claude plugin uninstall tk-studio@<m> --scope user`, plus `claude plugin marketplace remove tk-studio` when `known_marketplaces.json` or `extraKnownMarketplaces` names `tk-studio`. These records are read only to detect copies, never as the source of the version or of loadability.
- When several cases apply, precedence is `missing` > `shadowed` > `stale` > `ok`. The detail names every condition found.
- Plane output stays `{plane, status, detail, fix?}`, plus an additive `case` field: `ok|stale|missing|shadowed`. Status mapping: `ok`→`ok`, `stale`/`shadowed`→`drift`, `missing`→`missing`. An unreadable folder `plugin.json` or record file is `error`, naming the file.
- `_released_roster_check` and `_installer_roster_check` (gate ×4 on `latest.json`, shape on `stable.json`) stay folded in unchanged in behaviour. Every roster fixture passes `roster_problems`: six known names, schema 1, channel = stem, `>=X.Y.Z` floor, non-periodic 64-hex digests.
- Conformance (consult ruling): `runner.py run --from-archive <zip>` safe-extracts the zip into `<tmp>/config/skills/tk-studio/` and refuses absolute or `..` members by name. It sets `CLAUDE_CONFIG_DIR=<tmp>/config` in every drive's environment, and discovers surfaces, the manifest and drive scripts from that folder, not the repo tree. Harness drives run from a cwd outside the repo. A suite-level `harness-loadable` check reads `<tmp>/config/skills/tk-studio/.claude-plugin/plugin.json`: it must parse with name `tk-studio` and a version, and the folder's skills set must equal the surfaces discovered. A failure is a named failure in `failures[]`. The report gains a top-level `harness_loadable` field (`{state, folder?, version?}`). Without `--from-archive`, `state` is `"skipped: --from-archive not given"`, a loud named skip. A default run never falls back to the repo tree and reports harness-loadable as passed.
- House rules: stdlib only, `uv run`, read-only drift check, AD-11 JSON output, no network in tests.

**Block If:** none known; anything the story is silent on goes to the consult before a HALT.

**Never:** no changes under `tools/installer/` (the 25-2 CLI) or to the plugin version and gate files (`plugin.json`, `marketplace.json`, `released-roster.json`, rosters). Never edit `epics.md`, `stories.yaml` or `plan/`. No doctor work (25.5), no sandbox-store drift case (25.6), no README or kb rewrite (25.7). Never read `installed_plugins.json` for a version.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| ok | folder v1.0.0, `stable.json` plugin `tk-studio--v1.0.0`, no marketplace copy | status ok, case ok, detail names folder + channel |
| stale (roster) | folder v0.9.0, roster v1.0.0 | drift, case stale, fix contains `tk-studio update` |
| stale (catalog) | dev checkout catalog v1.0.0, folder v0.9.0, no roster | drift, case stale |
| missing | no folder | missing, case missing, fix contains `tk-studio install` |
| missing, sibling | only `.tk-studio.previous` present | missing, detail names `.tk-studio.previous` |
| dangling link | folder is a link to a deleted dir | missing |
| shadowed | folder ok + user-scope `tk-studio@tk-studio` record (or `enabledPlugins` key) | drift, case shadowed, fix names `claude plugin uninstall tk-studio@tk-studio --scope user` |
| record not truth | folder ok; `installed_plugins.json` holds `tk-studio@skills-dir` at another version | ok |
| channel | `--channel latest`, latest roster differs from stable | compared against `latest.json` |
| no roster | non-studio project, folder present | ok, "not checkable from this project" |
| unreadable | folder `plugin.json` invalid JSON | error naming the file |
| from-archive | zip of the plugin | drives run from the extracted folder with `CLAUDE_CONFIG_DIR` set; `harness_loadable.state` ok |
| unsafe zip | member `../x` | exit 2, `{ok:false, error}` naming the member |
| default run | no flag | `harness_loadable.state` = skipped, `ok` unaffected |

</intent-contract>

## Code Map

- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`:
  - `:1-33` module docstring (plugin plane description and usage line); update it.
  - `:60-62` `FIX_PLUGIN`, `FIX_HARNESS` (marketplace flows): replace with `tk-studio update`, `tk-studio install` and shadowed guidance.
  - `:120-190` `_harness_loadability` and `:509-552` `_directory_source_serves` read `installed_plugins.json` as truth: remove both, and replace them with a folder-and-roster sub-check.
  - `:424` `_installer_roster_check`: keep it, and fix its docstring note "Story 25.3 wires the configured channel".
  - `:555` `_STATUS_RANK`.
  - `:558-604` `check_plugin(directory, marketplace_path, claude_home)`: add `channel`; the catalog compare moves from the repo `plugin.json` to the folder version.
  - `:665-690` `main`: add `--channel`.
- `tools/installer/cli/tk_studio_cli/plugin_leg.py`, read-only reference:
  - `:29-38` names (`STAGING`, `PREVIOUS`, `RETIRED`, `SKILLS_DIR_SUFFIX`).
  - `:64` `config_dir`.
  - `:415-504` `_installed_records` and `marketplace_cleanup`, the exact read set for `shadowed`. Mirror it; never import it (the plugin is sealed).
- `plugins/tk-studio/skills/tk-studio-activate/SKILL.md:8-31`: the planes table's `plugin` row and its fix column.
- `plugins/tk-studio/contracts/conformance/runner.py`:
  - `:58` `PLUGIN_ROOT`.
  - `:72` `discover_surfaces`, `:81` `load_manifest`.
  - `:160-179` `_run_drive` uses `PLUGIN_ROOT / argv[0]`, `cwd=PLUGIN_ROOT` and an env built there: thread a plugin root and an env overlay through it.
  - `:303-338` `_run_harness_drive` (cwd at `:320-323`).
  - `:344-432` `run_suite`, whose report carries `harness_pass` to mirror.
  - `:437-465` `main`.
- `plugins/tk-studio/contracts/driver-contract.md`:
  - `:5` header: add 0.1.19 and an additive clause at the end of the history.
  - `:290-307` §6.
  - `:324-357` §8: document `--from-archive` and `harness_loadable`.
- `_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md:123`, AD-13 Rule: replace "installed plugin version vs `marketplace.json`" with the folder-and-roster wording. The existing "Amended 2026-10-14 by AD-21" sentence stays.
- Tests (from `plugins/tk-studio/lib`):
  - `tests/test_drift_check.py:34-266` `HarnessLoadabilityTestCase` pins the record as truth. Replace it with folder-plane tests, one per matrix row.
  - `tests/test_release_roster.py:328-355,860-885`: plane tests built on an `installed_plugins.json` fixture home. Move them to a folder fixture and keep their roster asserts.
  - `tests/test_conformance.py`: add from-archive and skip tests to `ConformanceHarnessTestCase`; `:489` real-plugin case.
  - `tests/test_driver_contract.py:106-113` pins `**0.1.18**` in the header. Make it check that the 0.1.18 clause survives, and add a 0.1.19 test (header, §6 rule, §8 flag).

## Tasks & Acceptance

**Execution (Files boundary — any other file is a deviation):**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: the folder/roster/shadowed sub-check, `case` field, `--channel`, new fixes; remove the record-as-truth probes (AC1).
- `plugins/tk-studio/skills/tk-studio-activate/SKILL.md`: the plugin row and its fixes (AC1).
- `plugins/tk-studio/contracts/conformance/runner.py`: `--from-archive`, the `harness-loadable` check, the `harness_loadable` report field (AC2).
- `plugins/tk-studio/contracts/driver-contract.md`: header 0.1.19 with its additive clause, the §6 rule (folder, roster, channel, four cases with fixes, `case` field, the record read only for shadowing), and §8 `--from-archive` (AC3).
- `_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md`: the AD-13 wording (AC3).
- `plugins/tk-studio/lib/tests/test_drift_check.py`, `tests/test_release_roster.py`, `tests/test_conformance.py`, `tests/test_driver_contract.py`: a test per matrix row, plus the contract pins (AC1–AC3).

**Acceptance Criteria:** AC1–AC3 above, each proven by a named test or a Verification command.

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- layers: blind-hunter, edge-case-hunter (band L: 9 files, ~1000 new lines); the diff was handed to both as a scratch file path
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 2, low 4)
- defer: 0
- reject: 1 (low 1): "the built zip is never the real release artifact" — the release zip is `git archive <tag>:plugins/tk-studio` normalised, the same subtree with members at the zip root that the tests and the Verification zip use; no AC-named behaviour differs
- addressed_findings:
  - `[medium]` `[patch]` the real-repo plane test ran on `stable`, which trails the gate after each cut (25-1 ruling), so it would turn main red at 25.7; it now runs on `latest` (gate ×4-bound)
  - `[medium]` `[patch]` `--from-archive --harness` ran `claude -p` in a config with no credentials; the operator's `.credentials.json` is now symlinked (never copied) into the archive config for harness drives, with a §8 sentence and an offline test
  - `[low]` `[patch]` §6's normative output line now shows `case?` (plugin plane only)
  - `[low]` `[patch]` the header's Story/rulings row names ST-083 and AD-21
  - `[low]` `[patch]` a non-directory at the folder path says "not a directory" instead of "dangling link" (still `missing`), with a test
  - `[low]` `[patch]` every archive open/extract failure (bad zip, encrypted, unsupported method, truncated) is a `ConformanceError`, so the run prints `{ok:false,error}` and exits 2 (AD-11), with a test

### 2026-10-14 — Review pass (follow-up review 1)
- layers: blind-hunter, edge-case-hunter (band L); the diff `9812fab..HEAD` (excluding this spec) was handed to both as a scratch file path
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 0
- reject: 2 (low 2): (1) "the default `stable` channel reports a false `stale` on the studio repo, and `tk-studio update` would replace a developer link": the default channel is the consult ruling (reading A), `stale` means "differs" per Boundaries, the risk is already a recorded residual, and how `update` treats a link is 25-2 installer behaviour; (2) "a folder `plugin.json` whose `name` is not `tk-studio` is reported ok": AC1 names only the version read, and the folder is written by the installer from the release zip
- addressed_findings:
  - `[medium]` `[patch]` the stale fix ignored the channel it checked (the installer's `update` defaults to `stable`). Off the default channel it now names `tk-studio update --channel <channel>`. Contract §6 and the SKILL.md row say so, with tests.
  - `[medium]` `[patch]` the plane's `case` could contradict its `status`: a guard drift gave `{drift, case ok}`, and a guard error kept a `case`. Now a plane whose status is `error` carries no `case`. §6 states that `case` is the folder-and-roster verdict alone, and that the release guards can raise `status` without changing `case`. Covered by a test and a contract pin.
  - `[medium]` `[patch]` under `--from-archive`, the status-block schema was still read from the repo tree. It is now read from the extracted folder, and a missing or malformed archive schema exits 2 with `{ok:false,error}` (no fallback). §8 says so, with tests.
  - `[low]` `[patch]` a wrapped (non-root-shaped) zip exited 2 before the loadability check ran. Harness-loadable now runs first and gives a named `harness-loadable` failure in `failures[]`, with no surfaces driven. §8 states this, including the new `harness_pass` state (consult), with tests.
  - `[low]` `[patch]` added the missing test for a folder with no `.claude-plugin/plugin.json` (`missing`).
  - `[low]` `[patch]` the developer catalog was read only when the folder version was known. It is now read whenever it is present, so an unreadable catalog is `error` with or without the folder, with a test.
  - `[low]` `[patch]` a catalog `tk-studio` entry with no string version reported `stale … vNone`. It is now an `error` naming the catalog, with a test.

### 2026-10-14 — Review pass (follow-up review 2)
- layers: blind-hunter, edge-case-hunter (band L); the diff `9812fab..5de6832` (excluding this spec) was handed to both as a scratch file path
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 1 (low 1): consolidate.py:246 drift fix text still names `/plugin marketplace update`. It pre-dates the story and is outside the Files boundary; criterion (b) applies because it contradicts amended AD-13. Recorded in frontmatter `deferred`.
- reject: 1 (low 1): "a `tk-studio@<m>` `enabledPlugins` key set to `false` is reported shadowed". Boundaries require mirroring exactly what `plugin_leg.py` `marketplace_cleanup` reads, and it counts every `enabledPlugins` key whatever its value.
- addressed_findings:
  - `[medium]` `[patch]` (both layers) a project that ships its own plugin marketplace (`.claude-plugin/marketplace.json` with no `tk-studio` entry) made the plugin plane `error` (exit 2, headless activation blocked), and since follow-up review 1 even with no folder. Such a catalog is no longer a tk-studio developer checkout: the comparison is skipped with a note. Malformed catalogs and a `tk-studio` entry with no string version stay `error`. Contract §6, the module docstring and the SKILL.md row now say so, with plane tests, a `main` exit-code test and a §6 pin (consult: score 2).
  - `[low]` `[patch]` the §6 shadowed rules had no test: the `marketplace remove` fix via `known_marketplaces.json`, and an unreadable `known_marketplaces.json` or `settings.json` making the plane `error` with the file named. Three tests were added. The code already conformed.

## Design Notes

- "Configured channel" and the roster source were an intent gap, settled by consult (Consult Log). The reasoning: the installer persists no channel, and a network roster read would contradict the manifest's `external_calls: false` for activate.
- `harness-loadable` is a suite-level check, because the runner has no per-surface assertion of that name. It follows the `harness_pass` precedent: a pass that did not run is named, never silent.

## Verification

**Commands** (lib commands from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_drift_check tests.test_release_roster tests.test_conformance tests.test_driver_contract` -- expected: OK.
- `uv run python -m unittest discover tests` -- expected: OK.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`, and `harness_loadable.state` names the skip.
- Build a zip of `plugins/tk-studio` into the scratchpad (python `zipfile`, members at the zip root), then run `uv run python ../contracts/conformance/runner.py run --from-archive <zip>` -- expected: `"ok": true`, `harness_loadable` ok, and the drives ran from the temp folder.
- From the repo root, `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory . --claude-home <scratch home with skills/tk-studio linked to plugins/tk-studio> --channel latest` -- expected: plugin plane `case: ok`. Against this sandbox's real home it reports `missing` (no folder), which is the truth here.

## Deviation Summary

### pass 1 (implementation, 2026-10-14)

- planned: the plane's `case` is one of ok|stale|missing|shadowed / actual: a folder sub-check ending `error` (unreadable folder `plugin.json`, record file or catalog) carries no `case`; the detail names every condition found / why: a failed read cannot be fully judged, so no verdict is implied / may affect: 25-5
- planned: (spec silent) a folder with no `.claude-plugin/plugin.json` / actual: reported `missing` with fix `tk-studio install` / why: such a folder does not load as a plugin / may affect: 25-5
- planned: the folder's skills set equals the surfaces discovered / actual: the skills set is every non-dot directory under `skills/`, the surfaces only those with a `SKILL.md` / why: like-for-like always matches; this fails a skill folder missing its `SKILL.md` / may affect: none
- planned: harness drive `settings` resolved beside `runner.py` / actual: resolved under `<plugin_root>/contracts/conformance/` (identical unless `--from-archive`) / why: settings come from the extracted folder, not the repo / may affect: none
- planned: `check_plugin` error text unchanged / actual: "installed plugin.json unreadable" became "plugin.json of this copy unreadable" / why: that file is the running copy, no longer the installed plugin / may affect: none

DEVIATION SCORE: 1 (consult ruling: deviations 1 and 2 scored 2 — a seam 25-5 reuses; frontmatter deviation_score 2)

DRIFT: an `error` folder sub-check carries no `case` field — a failed read cannot be judged — affects: 25-5
DRIFT: a folder without `.claude-plugin/plugin.json` is `missing` (fix `tk-studio install`) — the spec was silent and such a folder does not load — affects: 25-5
DRIFT: harness-loadable compares non-dot `skills/` directories with the discovered surfaces — like-for-like would never fail — affects: none
DRIFT: harness drive `settings` resolve under the driven plugin root — drives must come from the extracted folder — affects: none
DRIFT: `check_plugin` running-copy error text reworded — the file is no longer the installed plugin — affects: none

### pass 2 (follow-up review patches, 2026-10-14)

- planned: a harness-loadable failure is a named entry in `failures[]` / actual: an archive with a missing or malformed `contracts/status-block.schema.json` exits 2 with `{ok:false,error}`, the same as a missing archive manifest / why: the schema is something the runner discovers from the folder, not part of the harness-loadable check / may affect: none (consult: accepted, score 1)
- planned: (spec silent) the order of harness-loadable and surface driving / actual: a folder that fails harness-loadable stops the run with no surfaces driven, and `harness_pass.state` reads `not run: the skills-dir folder is not harness-loadable` (added to the §8 state list) / why: a non-root-shaped zip must give a named loadability failure rather than exit 2 / may affect: readers of the conformance report's `harness_pass.state` (consult: accepted, score 2)

DEVIATION SCORE: 2 (consult ruling on pass 2; frontmatter `deviation_score` stays 2)

DRIFT: under `--from-archive`, a missing or malformed archive status-block schema exits 2 with `{ok:false,error}`, not a `failures[]` entry — it matches the missing-manifest precedent — affects: none
DRIFT: a folder failing harness-loadable drives no surface; `harness_pass.state` gains `not run: the skills-dir folder is not harness-loadable` (driver-contract §8) — the loadability check must run before discovery — affects: none named (conformance report readers)

### pass 3 (follow-up review 2 patches, 2026-10-14)

- planned: a developer checkout is `<directory>/.claude-plugin/marketplace.json` present / actual: a catalog that is a JSON object with a `plugins` list but no `tk-studio` entry is another project's own marketplace, not a developer checkout. The catalog comparison is skipped with a note, never `error`. Malformed catalogs and a `tk-studio` entry with no string version stay `error` / why: any plugin-authoring project otherwise blocked activation with exit 2 and never saw the folder verdict / may affect: 25-5 (doctor's plugin check treats a foreign catalog as a note, never an error or fail) (consult: accepted, score 2)
- planned: the unreadable-catalog error text "unreadable or missing the tk-studio entry" / actual: "unreadable (<err> | no plugins list)" / why: a missing entry is no longer an error / may affect: none

DEVIATION SCORE: 2 (consult ruling on pass 3; frontmatter `deviation_score` stays 2)

DRIFT: a marketplace catalog without a `tk-studio` entry is not a developer checkout (comparison skipped with a note, never `error`); driver-contract §6 says so at 0.1.19 — a foreign marketplace blocked activation with exit 2 — affects: 25-5

## Consult Log

- 2026-10-14T21:34:09Z — trigger: halt (intent gap in planning) — question: which reading of "the roster's plugin entry for the configured channel" (A: `--channel` flag default stable, in-project roster, no network; B: network fetch; C: installer-persisted config), and is a named skip acceptable for harness-loadable without `--from-archive`? — ruling: apply — do: Q1 reading (A), with no roster reported as "not checkable from this project" (ok) while missing/shadowed are still judged; Q2 the proposed `--from-archive` design, with `harness_loadable: {state: "skipped: --from-archive not given"}` beside `harness_pass`; a default run never falls back to the repo tree and reports harness-loadable as passed — rule candidate: A read-only check that needs a release input (a roster or the built zip) reads it from the checked project or an explicit flag, never the network or the host install, and reports a named skip state when the input is absent, never a pass.
- 2026-10-14T21:42:20Z — trigger: deviation-gt-0 — question: accept the five implementation deviations (no `case` on error; plugin.json-less folder is missing; skills-set vs surfaces; settings under the driven root; error text) and at what score? — ruling: accept-deviation score 2 — do: in driver-contract §6 make the `missing` row read "no folder, a dangling link, or a folder with no `.claude-plugin/plugin.json`; the detail names an installer sibling found" and the error sentence read "An unreadable folder `plugin.json`, record file or developer marketplace catalog makes the plane `error`, naming the file (no `case`)"; record deviations 1 and 2 as score 2 carried to 25-5; keep 3–5 at score 1 — rule candidate: When an implementer's deviation changes how the plugin plane decides `case` or `error`, the same story updates driver-contract §6's case table and error sentence to match the code before review, scored 2 when a later story reuses the taxonomy.

- 2026-10-14T21:59:31Z — trigger: deviation-gt-0 (follow-up review patches) — question: accept the two patch deviations (A: archive with a missing or malformed status-block schema is exit 2 `{ok:false,error}`, not a `failures[]` entry; B: a folder failing harness-loadable stops the run with no surfaces driven) and at what score? — ruling: accept-deviation score 1 (A); accept-deviation score 2 (B) — do: keep A as written; keep B as written and add `not run: the skills-dir folder is not harness-loadable` to the `harness_pass` state list in driver-contract §8; add one test_conformance test asserting `harness_pass.state` and `surfaces == {}` when the harness-loadable gate fails — rule candidate: Any new value a story gives a state field in the conformance report (`harness_pass.state`, `harness_loadable.state`) must be added to that field's list in driver-contract §8 in the same story, and a deviation that adds one scores at least 2.

- 2026-10-14T22:10:23Z — trigger: deviation-gt-0 (follow-up review 2 patch) — question: accept narrowing "developer checkout" from "catalog present" to "catalog present with a `tk-studio` entry" (a foreign catalog skips the comparison with a note instead of `error`), and at what score? — ruling: accept-deviation score 2 — do: keep the patch as written (malformed catalogs and a `tk-studio` entry with no string version stay `error`, contract §6 stays 0.1.19); record it in the Deviation Summary as score 2 carried to 25-5 (doctor's plugin check treats a foreign catalog as a note, never an error or fail), frontmatter `deviation_score` stays 2; add one lib test that a foreign catalog leaves the plane not `error`, with the note, and an exit code other than 2 (unless already pinned) — rule candidate: A deviation that moves a condition between `error` and `ok`/note (or between `case` values) on a plane whose taxonomy a later story reuses is scored 2 by default; the same story updates its contract section and Deviation Summary, so no consult is needed.

## Auto Run Result

Status: done

**Summary:** This was follow-up review 2 of 25-3. Both layers ran over `9812fab..5de6832`, and two patches were applied:
- A project that ships its own plugin marketplace (a `.claude-plugin/marketplace.json` with no `tk-studio` entry) no longer counts as a tk-studio developer checkout. The plugin plane skips the catalog comparison with a note instead of going `error`, which had meant exit 2 and blocked activation. Malformed catalogs and a `tk-studio` entry with no string version stay `error`.
- The §6 shadowed-detection rules are now pinned by tests: the `marketplace remove` fix through `known_marketplaces.json`, and an unreadable `known_marketplaces.json` or `settings.json` making the plane `error` with the file named.

Driver contract stays 0.1.19. §6 now defines a developer checkout as a catalog present with a `tk-studio` entry.

**Files changed (this pass):**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: a foreign catalog skips the comparison with a note; the unreadable-catalog text is reworded; the docstring defines a developer checkout.
- `plugins/tk-studio/skills/tk-studio-activate/SKILL.md`: the plugin row says a catalog without `tk-studio` is skipped.
- `plugins/tk-studio/contracts/driver-contract.md`: §6 defines a developer checkout as present with a `tk-studio` entry, adds the foreign-catalog sentence, and lists the cases that stay `error`.
- `plugins/tk-studio/lib/tests/test_drift_check.py`: adds a `_write_foreign_catalog` helper and six tests: a foreign catalog with the folder (ok) and without it (missing); `main` with a foreign catalog (not `error`, exit ≠ 2); shadowed through `known_marketplaces.json`; an unreadable `known_marketplaces.json`; and an unreadable `settings.json`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: §6 pins for the developer-checkout definition and the skip sentence.

**Review:**
- Findings: 2 patches applied (high 0, medium 1, low 1), 1 deferred (consolidate.py drift fix text), 1 rejected, 0 bad_spec, 0 intent_gap.
- Consults: 1. A `deviation-gt-0` consult on the developer-checkout narrowing ruled accept at score 2, carried to 25-5. It is logged under `## Consult Log` and as an observation event.
- Follow-up review recommended: **false**. The score is 3×1 (medium) + 1×1 (low) = 4, which is below 5, and no patch was high severity.

**Verification (re-run by this session after all patches):**
- `uv run python -m unittest tests.test_drift_check tests.test_release_roster tests.test_conformance tests.test_driver_contract`: 187 OK.
- `uv run python -m unittest discover tests`: 944 OK, 1 skipped (the opt-in live `claude` probe).
- `runner.py run`: exit 0, `"ok": true`, `harness_loadable.state` = `skipped: --from-archive not given`, 18 surfaces, no failures.
- `runner.py run --from-archive <scratch zip of plugins/tk-studio, members at root>`: exit 0, `"ok": true`, `harness_loadable.state` ok at v0.2.16, 18 surfaces.
- `drift_check.py --directory <repo> --claude-home <scratch home linking the checkout>`: plugin plane `ok`/`case ok` on both `latest` and `stable`.

**Unverifiable here (operator):** unchanged.
- On TIM-PC-2, after `tk-studio install`: run `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory C:/GitHub/tk-studio` and expect `case: ok`.
- The spend-bearing live harness pass: from `plugins/tk-studio/lib`, run `uv run python ../contracts/conformance/runner.py run --harness --from-archive <tk-studio-0.2.16.zip>`.

**Residual risks:**
- In a developer checkout on the default `stable` channel, the plane reports `stale` whenever stable trails the gate. This is consult-ruled. Developers pass `--channel latest`.
- On Windows, dangling-junction detection is untested.
- A disabled `enabledPlugins` `tk-studio@<m>` key is reported `shadowed`, which mirrors the installer's cleanup read set.
- `consolidate.py`'s drift fix text still names the marketplace flow. It is deferred.
- 25-5's doctor must treat a foreign catalog as a note, never a fail.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio install (the installer writes the skills-dir plugin folder <home>/skills/tk-studio/); remove the marketplace copy shadowing the skills-dir folder: claude plugin uninstall tk-studio@tk-studio --scope user; claude plugin marketplace remove tk-studio; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: 9812fabc7b0551d4009ba7d17124ce8a7d78a38f (branch loop/epic-25); reviewed HEAD 5de6832fccf29266e067261b4514596e7b408dcf

DRIFT: a marketplace catalog without a `tk-studio` entry is not a developer checkout (comparison skipped with a note, never `error`); driver-contract §6 says so at 0.1.19 — a foreign marketplace blocked activation with exit 2 — affects: 25-5
