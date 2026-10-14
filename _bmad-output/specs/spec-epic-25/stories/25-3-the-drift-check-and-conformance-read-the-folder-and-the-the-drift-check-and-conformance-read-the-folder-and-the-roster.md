---
title: 'The Drift Check and Conformance Read the Folder and the Roster'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
baseline_revision: 9812fabc7b0551d4009ba7d17124ce8a7d78a38f
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/SPEC.md'
warnings: ['oversized']
deferred: []
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

## Consult Log

- 2026-10-14T21:34:09Z — trigger: halt (intent gap in planning) — question: which reading of "the roster's plugin entry for the configured channel" (A: `--channel` flag default stable, in-project roster, no network; B: network fetch; C: installer-persisted config), and is a named skip acceptable for harness-loadable without `--from-archive`? — ruling: apply — do: Q1 reading (A), with no roster reported as "not checkable from this project" (ok) while missing/shadowed are still judged; Q2 the proposed `--from-archive` design, with `harness_loadable: {state: "skipped: --from-archive not given"}` beside `harness_pass`; a default run never falls back to the repo tree and reports harness-loadable as passed — rule candidate: A read-only check that needs a release input (a roster or the built zip) reads it from the checked project or an explicit flag, never the network or the host install, and reports a named skip state when the input is absent, never a pass.
- 2026-10-14T21:42:20Z — trigger: deviation-gt-0 — question: accept the five implementation deviations (no `case` on error; plugin.json-less folder is missing; skills-set vs surfaces; settings under the driven root; error text) and at what score? — ruling: accept-deviation score 2 — do: in driver-contract §6 make the `missing` row read "no folder, a dangling link, or a folder with no `.claude-plugin/plugin.json`; the detail names an installer sibling found" and the error sentence read "An unreadable folder `plugin.json`, record file or developer marketplace catalog makes the plane `error`, naming the file (no `case`)"; record deviations 1 and 2 as score 2 carried to 25-5; keep 3–5 at score 1 — rule candidate: When an implementer's deviation changes how the plugin plane decides `case` or `error`, the same story updates driver-contract §6's case table and error sentence to match the code before review, scored 2 when a later story reuses the taxonomy.

## Auto Run Result

Status: done

**Summary:** The plugin plane in `tk activate` now checks the skills-dir folder against the roster. It reads `<home>/skills/tk-studio/.claude-plugin/plugin.json` and compares that version with the `plugin` entry of `tools/installer/rosters/<channel>.json`, where `--channel` defaults to `stable`. In a developer checkout it also compares with the in-repo catalog. The result is one `case` (`ok`, `stale`, `missing` or `shadowed`), each with its fix (`tk-studio update`, `tk-studio install`, or the named `claude plugin uninstall …` and `marketplace remove` commands). Details:
- The installer's sibling folders are never treated as the plugin, and the `missing` detail names the sibling it found.
- `installed_plugins.json` and the `settings.json` keys are read only to detect a marketplace copy that shadows the folder, never for a version.
- The old probes that read the install record as the truth are gone.

The conformance runner gains `run --from-archive <zip>`. It safely extracts the zip into a clean `CLAUDE_CONFIG_DIR` skills folder and drives every surface from there. A suite-level `harness-loadable` check reads that folder, and the report gains a `harness_loadable` field. A run without the flag reports a loud named skip, never a pass. Driver contract 0.1.19 is additive: §6 states the folder-and-roster rule and its case table, and §8 covers `--from-archive`. The spine's AD-13 wording now names the folder and the roster.

**Files changed:**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: `_skills_dir_check` (folder, roster channel, catalog, shadowing); the `case` field; `--channel`; new fixes; the record-as-truth probes removed.
- `plugins/tk-studio/skills/tk-studio-activate/SKILL.md`: the plugin plane row and its fixes.
- `plugins/tk-studio/contracts/conformance/runner.py`: `--from-archive`, safe extraction, the `harness-loadable` check and report field, the drive plugin root and env overlay, and a credentials symlink for archive harness drives.
- `plugins/tk-studio/contracts/driver-contract.md`: header 0.1.19 with an additive clause; the rulings row; §6 rule, case table and `case?`; §8 `--from-archive` and `harness_loadable`.
- `_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md`: the AD-13 rule wording.
- `plugins/tk-studio/lib/tests/test_drift_check.py`: rewritten as one test per matrix row, plus precedence, env home, the real repo on `latest`, and `main --channel`.
- `plugins/tk-studio/lib/tests/test_release_roster.py`: two plane tests moved to a folder fixture.
- `plugins/tk-studio/lib/tests/test_conformance.py`: tests for from-archive, the skip, unsafe or unextractable zips, harness cwd and credentials, and the real plugin from its zip.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the 0.1.18 clause stays pinned, and 0.1.19 tests are added.

**Review:**
- Both layers ran. Findings: 6 patches applied (high 0, medium 2, low 4), 0 deferred, 1 rejected, 0 bad_spec, 0 intent_gap.
- Consults: 2 — `halt` (planning intent gap, ruled apply) and `deviation-gt-0` (accept-deviation, score 2). Both are logged under `## Consult Log` and as observation events.
- Follow-up review recommended: **true**. The score is 3×2 + 1×4 = 10, which is at least 5. No patch was high severity.

**Verification (re-run by this session after the patches):**
- `uv run python -m unittest discover tests`: 929 OK, 1 skipped (the opt-in live `claude` probe).
- Targeted suites before the patches: 169 OK.
- `runner.py run`: `"ok": true`, with `harness_loadable.state` = `skipped: --from-archive not given` and 18 surfaces.
- `runner.py run --from-archive <scratch zip of plugins/tk-studio>`: `"ok": true`, with `harness_loadable.state` ok at v0.2.16.
- `drift_check.py --directory . --claude-home <scratch home linking the checkout>`: plugin plane `ok`/`ok` on both `stable` and `latest`.
- Against this sandbox's real home: `missing`, plus a shadowing user-scope `tk-studio@tk-studio` copy. That is the truth on this box (no folder installed yet). The activation drift of future sessions will read `drift` until the operator runs `tk-studio install`.
- Matrix audit: every row has a test, and each one ran.

**Unverifiable here (operator):**
- On TIM-PC-2, after `tk-studio install`, run `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory C:/GitHub/tk-studio` and expect the plugin plane `case: ok`.
- The live harness pass from an archive: from `plugins/tk-studio/lib`, run `uv run python ../contracts/conformance/runner.py run --harness --from-archive <tk-studio-0.2.16.zip>`. It is spend-bearing.

**Residual risks:**
- On Windows, dangling-junction detection (`os.path.lexists`) is untested.
- In a developer checkout on the default `stable` channel, the plane reports `stale` whenever stable trails the gate. That is true against the configured channel; developers in link mode pass `--channel latest`.
- The root README still shows contract 0.1.13. That predates this story, and the README is 25.7's.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: 9812fabc7b0551d4009ba7d17124ce8a7d78a38f (branch loop/epic-25)

DRIFT: an `error` folder sub-check (unreadable folder `plugin.json`, record file or developer catalog) carries no `case` field; contract §6 says so — a failed read cannot be judged — affects: 25-5
DRIFT: a folder with no `.claude-plugin/plugin.json` is `missing` (fix `tk-studio install`); contract §6 says so — the spec was silent and such a folder does not load — affects: 25-5
DRIFT: the harness-loadable check compares non-dot `skills/` directories with the discovered surfaces — like-for-like would never fail — affects: none
DRIFT: harness drive `settings` resolve under the driven plugin root — drives come from the extracted folder — affects: none
DRIFT: `check_plugin`'s running-copy error text was reworded — the file is no longer the installed plugin — affects: none
