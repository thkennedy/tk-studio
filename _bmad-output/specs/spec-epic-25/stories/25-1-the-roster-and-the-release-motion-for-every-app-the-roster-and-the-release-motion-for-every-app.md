---
title: 'The Roster and the Release Motion for Every App'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
baseline_revision: dd0e6778c495d88770f58e82e6bcca7c82e7a697
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/plans/25-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-25/SPEC.md'
warnings: ['oversized']
deferred: []
---

# The Roster and the Release Motion for Every App

Story 25.1 (Canonical: ST-081). Authoritative text: `_bmad-output/planning-artifacts/epics.md` §"Story 25.1" (amended 2026-10-14). Plan: [plans/25-1.md](../plans/25-1.md) (its Code Map is the investigation; the plan's "Acceptance Criteria" list predates the rulings — the criteria below and SPEC.md "Rulings on the open questions" items 1–3 supersede it).

<intent-contract>

## Intent

**Problem:** AD-21 needs one source of truth for which app releases go together, and the plugin-only `tools/release_archive.py` publishes without `--latest=false`, so the plugin owns the repository's "latest" and no other app can be cut.

**Approach:** Commit `tools/installer/rosters/{stable,latest}.json`, guard their shape with one pure validator shared by the lib suite and the drift check's plugin plane (gate ×3 → gate ×4), and generalise the release script to cut any app by its tag prefix, publish with `--latest=false`, verify the round trip and record the entry in the roster.

### Acceptance criteria (transcribed verbatim from the authoritative story)

- **AC1** — **Given** `tools/installer/rosters/stable.json` and `latest.json` **When** they are read **Then** each carries `schema`, `channel`, `requires` (at least `claude-code` as a version floor), and `components`, where every component is optional per channel (an absent component means "not shipped in this channel", which the installer and `doctor` report, never an error); a present `plugin`, `supervisor`, `studio-web` or `cli` entry is `{tag, url, sha256}` with all three required, and `uv` and `bun` are `{version, sha256: {<platform target>: <hex>}}` with one digest per upstream platform asset (Windows x64 at minimum); a lib guard pins the shape, refuses a present entry with a missing or malformed digest by name, never accepts a placeholder or a fabricated value, and asserts the plugin entry agrees with `released-roster.json` and the plugin's `plugin.json` version (the existing gate ×3 becomes gate ×4); at the first cut the roster carries `plugin`, `uv` and `bun`, and `stable.json` equals `latest.json` (ruled 2026-10-14)
- **AC2** — **Given** `tools/release_archive.py` **When** it is run with `--app <plugin|supervisor|studio-web|cli>` **Then** it builds the deterministic zip (or wheel, for `cli`) from that app's subtree at the `<prefix>--vX.Y.Z` tag, publishes it with `gh release create --latest=false`, re-downloads and verifies the digest, and records `{tag, url, sha256}` under the right roster component; the plugin's motion is unchanged in effect; `make_latest: false` is asserted by the lib suite against a fake `gh`
- **AC3** — **Given** the supervisor repository, which has no tags today **When** the story closes **Then** the story provides the exact commands for the operator to cut `supervisor--v0.1.0` from its `main` and publish the asset (the script runs against that checkout until EP-31), the engine never cuts or pushes a tag on another repository, and the roster schema accepts a `supervisor` entry whose URL is on another repository, named in the entry's `source` field; the entry itself is added by the operator step once the asset exists, and the story does not wait for it (ruled 2026-10-14)
- **AC4** — **Given** the lib suite and conformance **When** the story closes **Then** both are green, and the roster guard runs in the drift check's plugin plane (Story 25.3 wires the rest)

## Boundaries & Constraints

**Always:**
- Stdlib-only Python run via `uv run`; every file write (roster, `released-roster.json`) is atomic (temp file + replace).
- The guard is ONE pure function in `drift_check.py` (e.g. `roster_problems(roster, *, released_archive, plugin_version) -> list[str]`), each problem string naming the component and field; the lib tests and the plugin plane both call it.
- Sealing (AD-21): the plane reads the roster from `<directory>/tools/installer/rosters/stable.json` (the project directory argument), never relative to `PLUGIN_ROOT`.
- Digests for `uv` and `bun` are read from the upstream GitHub release (uv: the per-asset `.sha256` files; Bun: `SHASUMS256.txt`) of the newest non-prerelease release at implementation time; the asset URL each digest came from is recorded in `kb/offline-install-runbook.md`.
- `--app plugin` keeps the plugin motion byte-for-byte: asset `tk-studio-<v>.zip`, same `normalize_zip`, same `released-roster.json` `archive` write; the only additions are `--latest=false` and the roster component write.
- Lib tests make no network call and never mutate the real repository's files (module paths overridable, tempdir fixtures).

**Block If:**
- `uv run tools/release_archive.py run --app plugin --dry-run` prints a `sha256` different from `2abc4e4754862be6d56250ab582af1234acf8f7fd9937f8840dd41b7cd8b207a` (the plugin motion changed in effect) — HALT, never re-record.
- Upstream uv or Bun publishes no checksum for the Windows x64 asset — HALT, never compute or invent one.

**Never:**
- Never `git push`, tag, run `gh release create` for real, or run the release motion; never cut or push a tag on the supervisor repository.
- No placeholder or fabricated entry: no `supervisor`, `studio-web` or `cli` component in either roster at this cut.
- No plugin version bump (0.3.0 is Story 25.7); no driver-contract change.
- Do not build Story 25.3's channel configuration, skills-dir folder reading or stale/missing/shadowed cases, nor any installer/meta-CLI (25.2/25.4); no `stable` promotion command.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Real rosters | committed `stable.json`, `latest.json` | guard returns no problems; `components`/`requires`/`schema` equal across both; `channel` equals the file stem; plugin entry equals `released-roster.json` `archive` + tag `tk-studio--v0.2.16` | — |
| Absent component | roster with no `supervisor`/`studio-web`/`cli` | green | — |
| Missing top-level key | no `schema`, `channel`, `requires.claude-code`, or `components` | red, problem names the key | — |
| Present entry incomplete | `plugin`/`supervisor`/`studio-web`/`cli` missing `tag`, `url` or `sha256` | red, names component + field | — |
| Malformed digest | `sha256` not 64 lowercase hex, on any component incl. a `uv`/`bun` target | red, names component (+ target) | — |
| Placeholder | digest of one repeated hex char (`000…`), or a tag/url/version containing `TBD`, `placeholder`, `pending`, `<` or `>` | red, names component as placeholder | — |
| uv/bun shape | `sha256` not a non-empty map, or lacking `x86_64-pc-windows-msvc`, or `version` absent | red, names component | — |
| Tag/URL shape | tag not `<prefix>--vX.Y.Z` for its component (`tk-studio--v`, `supervisor--v`, `studio-web--v`, `cli--v`), or url not `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` naming that tag | red, names component | — |
| Foreign URL | entry whose URL repo differs from the `plugin` entry's URL repo | green only when `source == "<owner>/<repo>"` of its URL; `source` present but not matching its URL is red | — |
| Gate ×4 | plugin tag version ≠ `plugin.json` version, or url/sha256 ≠ `released-roster.json` `archive` | red, names `plugin` | — |
| Motion publish | fake `gh`, release absent | `gh release create` argv contains `--latest=false`; roster component written `{tag, url, sha256}` (+ `source` when foreign); `--app plugin` also writes `archive` | — |
| Motion mismatch | fake `gh` download bytes differ | `{"ok": false, "error": "...digest mismatch..."}`, exit 1 | nothing written to either roster |
| Motion missing tag/subtree | `<prefix>--v<version>` tag absent, or the app subtree absent at the tag | named failure before any `gh` call | nothing written |
| Plane, no roster | project dir without `tools/installer/rosters/stable.json` | sub-check ok, detail "no installer roster at … — roster not checkable from this project" | — |
| Plane, bad roster | malformed or out-of-gate roster | plane `drift`, fix names the release motion (`tools/release_archive.py run --app plugin`) | unreadable JSON is `error`, not a crash |

</intent-contract>

## Code Map

Full investigation: [plans/25-1.md](../plans/25-1.md) §Code Map. Anchors re-confirmed at baseline `9eef541`:

- `tools/release_archive.py:42-45` -- `REPO_ROOT`, `PLUGIN_SUBDIR`, `ROSTER`, `PLUGIN_MANIFEST` constants; make overridable for tests.
- `tools/release_archive.py:48` `_run` -- hard-codes `cwd=REPO_ROOT`; thread a cwd through for `--repo`.
- `tools/release_archive.py:56,61,69` `_fail`, `_sha256`, `normalize_zip` -- reuse unchanged.
- `tools/release_archive.py:100` `run(dry_run)` -- generalise via an app table `{app: (tag_prefix, subtree, kind)}`: plugin → `tk-studio--v`, `plugins/tk-studio`, zip; supervisor → `supervisor--v`, `.` (its own checkout via `--repo`), zip; studio-web → `studio-web--v`, `apps/studio-web/dist`, zip; cli → `cli--v`, `tools/installer/cli`, wheel (`git archive` the subtree to a tempdir, `uv build --wheel` with `SOURCE_DATE_EPOCH` = commit epoch). Plugin version from `plugin.json`; other apps take `--version`. New flags: `--app` (default `plugin`, keeping the existing `run [--dry-run]` invocation unchanged in effect), `--version`, `--repo` (default `REPO_ROOT`), `--channel latest|stable` (default `latest`). The roster write always targets this repo's `tools/installer/rosters/<channel>.json`, preserving other components; `source` is written when `gh repo view` in `--repo` differs from this repo's `nameWithOwner`.
- `tools/release_archive.py:196` `main` -- argparse.
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py:184` `_released_roster_check` -- the sub-check pattern to mirror; `:273` `_STATUS_RANK`; `:276` `check_plugin` -- fold a third sub-check `_installer_roster_check(directory, plugin_root, version)` in (detail + fix merge).
- `plugins/tk-studio/lib/tests/test_release_roster.py:63` `test_gate_files_are_in_three_way_lockstep` -- extend to four-way; `:126` `ArchiveRecordPinTestCase` pattern for shape pins; `:287` shows how to drive `check_plugin` with a fixture plugin root and fake `claude_home`; the file already imports `tools/release_archive.py` via `sys.path`.
- `plugins/tk-studio/lib/tests/test_drift_check.py` -- read-only check: its fixture project dirs lack `tools/installer/`, so they take the "not checkable" ok path; must stay green unmodified.
- `kb/offline-install-runbook.md:12,41,113` -- the `run` invocations; frontmatter unchanged (kb index needs no regeneration).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py` -- add pure `roster_problems(...)` per the matrix and `_installer_roster_check` folded into `check_plugin` -- AC1 guard + AC4 plane.
- `tools/installer/rosters/latest.json`, `tools/installer/rosters/stable.json` -- new; `schema: 1`, `channel` = file stem, `requires: {"claude-code": ">=2.1.224"}`, `components`: `plugin` (`tk-studio--v0.2.16`, url + sha256 from `released-roster.json`), `uv` and `bun` (newest upstream version; per-target digests read from upstream for at least `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`; Bun's `bun-windows-x64.zip`/`bun-linux-x64.zip`/`bun-darwin-aarch64.zip` keyed by those triples); identical except `channel` -- AC1.
- `tools/release_archive.py` -- generalise per Code Map; `--latest=false` on create; refuse to write a roster the guard rejects -- AC2/AC3.
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- gate ×4 real-repo test (both rosters, stable/latest equality); one test per matrix row; fake-`gh` motion tests (plugin path incl. `archive` write, a foreign `--repo` supervisor cut writing `source`, mismatch writes nothing, missing tag fails before `gh`); plane tests -- AC1/AC2/AC4.
- `kb/offline-install-runbook.md` -- `--app plugin` invocation; a "Release motion for every app" section with the AC3 operator commands verbatim (below) and the uv/Bun digest source URLs -- AC3.

**AC3 operator commands (write verbatim into the runbook):** in a `thkennedy/tk-studio-supervisor` checkout on an up-to-date `main`: `git tag supervisor--v0.1.0 && git push origin supervisor--v0.1.0`; then from this repository: `uv run tools/release_archive.py run --app supervisor --version 0.1.0 --repo <path-to-supervisor-checkout> --channel latest`, then copy the written `supervisor` entry into `stable.json` by PR. Unverifiable here: the engine records them and never runs them.

**Acceptance Criteria:** AC1–AC4 in the intent contract, each proven by a named test or a Verification command below.

## Spec Change Log

- 2026-10-14 (review pass 1, consult ruling 2026-10-14T20:13:37Z): finding — gate ×4 bound both rosters, so the first `latest`-only plugin cut (25.7) would turn the lib suite and the drift plane red against ruling 3 (stable trails by PR). Amended: gate ×4 binds `latest.json` only; `stable.json` (and its plugin entry) is shape-only; the drift plane reads `stable.json` for shape and `latest.json` for gate ×4; the stable==latest equality is first-cut evidence shown by a Verification command, not a test invariant. Known-bad state avoided: a release motion that leaves main red until promotion. KEEP: the pure `roster_problems` guard, its named problems, the fake-`gh` motion tests, the committed rosters and digests, the plugin dry-run digest. Story 25.3 wires the configured channel; 25.7 is the first cut where stable trails.

- 2026-10-14 (review pass 1, consult ruling 2026-10-14T20:17:56Z): the first-cut component set (`plugin`, `uv`, `bun`) is evidence, not an invariant: the test asserts `{plugin, uv, bun}` ⊆ latest components ⊆ the six known names, so the operator's later `supervisor` entry (AC3) keeps main green; the exact set is shown by a Verification command. KEEP: everything else from pass 2.

- 2026-10-14 (follow-up review pass 4, consult ruling 2026-10-14T20:36:40Z): finding: a roster with no `plugin` entry accepted a foreign `supervisor` entry with no `source` (both layers), which breaks AC3's "named in the entry's `source` field". Amended: Design Notes now say that in a roster with no `plugin` entry, `source` is required on every present app entry. Before, they said `source` was checked only "when present". The release motion records `source` when it cuts into such a roster. Known-bad state avoided: a plugin-less channel accepting a foreign entry that names no repository. KEEP: everything from passes 1–3.

## Review Triage Log

### 2026-10-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 3, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Gate ×4 bound both rosters, so the first `latest`-only plugin cut (25.7) would turn the lib suite and drift plane red against ruling 3 (both layers). Consult ruled option 1: gate ×4 binds `latest.json` only, `stable.json` is shape-only, and the stable==latest equality is evidence rather than an invariant. Patched in the guard callers, the plane, the release script and the tests. The implementer's follow-on point, that the exact first-cut component set would go red at the AC3 operator step, became a subset check by a later consult.
  - `[medium]` `[patch]` A missing `released-roster.json` archive was passed as `{}`, so the plane and the non-plugin motion reported a misleading "gate x4 broken" (blind-hunter). Now `None` skips the url/sha256 half; tests were added.
  - `[medium]` `[patch]` The `cli` wheel path was untested, and a wheel of another version could be recorded under `cli--vX.Y.Z` (both layers). Added a named refusal on a version mismatch before any `gh` call, plus fake-`gh` tests for the cli cut and the mismatch.
  - `[medium]` `[patch]` An existing release skipped `create`, so `--latest=false` was never applied (AD-21; edge-case-hunter). That path now runs `gh release edit <tag> --latest=false`, with a test.

### 2026-10-14 — Review pass (follow-up, review_loop_iteration 0)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 3, low 3)
- defer: 0
- reject: 4 (one-line reasons below)
- addressed_findings:
  - `[medium]` `[patch]` `--app plugin --channel stable` rewrote `released-roster.json` `archive` but recorded the plugin entry only into `stable.json`, leaving gate ×4 red on `latest.json` (both layers). Now refused before any `git`/`gh` call; the runbook states it; test `test_plugin_into_stable_is_refused_before_any_call`.
  - `[medium]` `[patch]` A roster whose `channel` differs from its file stem passed the plane and the motion (both layers; the matrix row "Real rosters" requires channel = stem). The plane now reports it as drift; the motion refuses before any `gh` call. `roster_problems` stays stem-agnostic. Tests `test_channel_not_its_file_stem_is_drift`, `test_roster_channel_not_its_stem_is_refused_before_gh`.
  - `[medium]` `[patch]` A non-UTF-8 roster raised `UnicodeDecodeError` instead of `error` (edge-case-hunter; the matrix says "unreadable JSON is `error`, not a crash"). Now caught in the plane's roster and released-roster reads and in the motion's `_read_json`. Tests `test_non_utf8_roster_is_error_not_a_crash`, `test_non_utf8_roster_fails_by_name_before_gh`.
  - `[low]` `[patch]` `schema` accepted JSON `true` and `1.0` (edge-case-hunter). Now it must be the integer 1; test `test_schema_must_be_the_integer_one`.
  - `[low]` `[patch]` The plane's ok-note claimed "plugin entry at the gate (gate x4)" with no `plugin` entry, or when the url/sha256 half was skipped (blind-hunter). The note is now accurate in all three cases, and the normal-case wording is unchanged. Test `test_ok_note_matches_what_gate_x4_checked`.
  - `[low]` `[patch]` `FIX_INSTALLER_ROSTER` sent a broken `stable.json` to a motion that writes only `latest.json` (blind-hunter). The fix still names the release motion, per the matrix, and adds that `stable.json` is repaired by a promotion PR. Test `test_bad_stable_fix_names_the_promotion_pr`.
- rejected:
  - `latest.json` with no `plugin` entry passes gate ×4: AC1 makes every component optional per channel. Only the misleading note was real, and it is patched above.
  - "No release owns latest" is not achievable / pre-existing releases keep the flag: AC2 names `--latest=false` on publish, which is met, and the runbook's operative claim (consumers resolve by tag, never `/releases/latest`) holds.
  - The plane compares the checkout's `latest.json` against the running plugin's record: this is the planned `_installer_roster_check(directory, plugin_root, version)` signature and mirrors the gate ×3 `_released_roster_check(PLUGIN_ROOT, …)`. A stale install is the harness plane's report.
  - The two-file record is not atomic as a pair, and two refusals plus the fake `_run` cwd are untested: each write is atomic per house rule. The refusals are pass-1 deviations rather than criteria, and the cwd is plumbing.

### 2026-10-14 — Review pass (follow-up 2, review_loop_iteration 0)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 0, low 6)
- defer: 0
- reject: 4 (reasons below)
- addressed_findings:
  - `[low]` `[patch]` The guard took repeating digests such as `"deadbeef"*8`, and a `uv`/`bun` map with one digest copied across targets, as real values (both layers; AC1 says it "never accepts a placeholder or a fabricated value"). `_digest_problem` now refuses any value made of a repeated 1–32-character unit, and the tool check refuses a digest that appears under two targets. The test fixtures now use `hashlib`-derived digests. Tests `test_periodic_digest_is_a_placeholder` and `test_duplicate_tool_target_digests_are_fabricated`.
  - `[low]` `[patch]` A placeholder platform-target key in the `uv`/`bun` map (`"<platform target>"`, `"TBD"`, `""`) was accepted (edge-case-hunter). It is now refused by name. Test `test_placeholder_platform_target_is_refused`.
  - `[low]` `[patch]` With no `plugin` entry, a foreign app entry passed without `source` (both layers; AC3). Now every app entry in a plugin-less roster must name `source`, and the motion records it (consult: score 2, seam). Tests `test_without_a_plugin_entry_every_app_entry_names_its_source` and `test_plugin_less_roster_cut_records_source`.
  - `[low]` `[patch]` The runbook's AC3 operator command tagged whatever HEAD was checked out, not `main` (blind-hunter). It now runs `git switch main && git pull --ff-only origin main` before the tag and push.
  - `[low]` `[patch]` No test checked that each app is archived from its own subtree at its tag (blind-hunter; AC2). Added `test_each_app_archives_its_subtree_at_its_tag`, covering all four apps. It is test-only, with no bug exposed; a mutation run shows it can fail.
  - `[low]` `[patch]` `--app plugin --repo <another checkout>` built and published from that checkout while gating against this repository's records (edge-case-hunter; AC2 "plugin's motion is unchanged in effect"). It is now refused by name before any call, dry run included. Test `test_plugin_from_another_checkout_is_refused_before_any_call`.
- rejected:
  - `studio-web` needs `apps/studio-web/dist` committed at its tag: AC2's behaviour holds. The motion archives the subtree at the tag and refuses by name when it is absent. The precondition is already a recorded residual risk.
  - The plane compares the checkout's `latest.json` against the running plugin's record: the same as the previous pass's rejection (the planned `_installer_roster_check` signature, mirroring gate ×3).
  - `released-roster.json` and `latest.json` are not written atomically as a pair: the same as the previous pass's rejection, since each write is atomic per house rule.
  - (deduplicated) The `source`-without-plugin and repeating-digest findings each came from both layers. Each is counted once above.

## Design Notes

- "`stable.json` equals `latest.json`" is read as equal in `schema`, `requires` and `components`; `channel` names each file's own channel, as AC1 requires every roster to carry it. The real-repo test asserts exactly that.
- The `plugin` entry's URL repository is the roster's home repository; this lets the pure guard decide "foreign" with no hard-coded owner. With no `plugin` entry the home cannot be established, so `source` is required on every present `supervisor`, `studio-web` or `cli` entry, and it must still match its URL.

## Verification

**Commands** (lib commands from `plugins/tk-studio/lib`, the rest from the repo root):
- `uv run python -m unittest tests.test_release_roster tests.test_drift_check` -- expected: OK.
- `uv run python -m unittest discover tests` -- expected: OK, full lib suite green.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`.
- `uv run tools/release_archive.py run --app plugin --dry-run` -- expected: `sha256` `2abc4e4754862be6d56250ab582af1234acf8f7fd9937f8840dd41b7cd8b207a`, no `gh` write.
- `uv run plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory .` -- expected: plugin plane `ok`, detail names the installer roster sub-check.
- `jq -c '.components|keys' tools/installer/rosters/stable.json tools/installer/rosters/latest.json` and `diff <(jq 'del(.channel)' tools/installer/rosters/latest.json) <(jq 'del(.channel)' tools/installer/rosters/stable.json)` -- expected (first-cut evidence, not an invariant): both `["bun","plugin","uv"]`, no diff.

## Deviation Summary

- 2026-10-14 (re-drive): the engine reset this file from `blocked` to `ready-for-dev` after the rulings, but it held no intent contract, tasks or verification, so this session re-planned it (step 02) from the amended story text before implementing. This is not a deviation from the story.

### pass 1 (2026-10-14, implementer)

- planned: `--app plugin` keeps the plugin motion byte-for-byte; the only additions are `--latest=false` and the roster write / actual: the plugin path also runs a read-only `git cat-file -t <tag>:<subtree>` and the guard before any `gh` call, and its JSON result gains `app`, `channel` (and `source` when foreign); zip bytes unchanged (dry-run sha256 `2abc4e47…207a`) / why: the matrix requires a named failure for a missing subtree before any `gh` call, and the task list requires refusing a roster the guard rejects / may affect: none
- planned: Code Map `supervisor` row uses subtree `.` via `--repo` / actual: `--app supervisor` without `--repo` is refused / why: never archive this repository's root as the supervisor before EP-31 / may affect: none
- planned: guard rules exactly as the I/O matrix lists / actual: guard also rejects unknown component names, `schema` ≠ 1, `channel` ∉ {stable, latest}, `requires.claude-code` not `>=X.Y.Z`, and a `uv`/`bun` `version` not `X.Y.Z`, each a named problem / why: accept the committed shape and nothing invented / may affect: 25-3, 25-4
- planned: extend `test_gate_files_are_in_three_way_lockstep` / actual: extended and renamed `test_gate_files_are_in_four_way_lockstep`; stable/latest equality in a separate `test_installer_rosters_pass_the_guard_and_agree` / why: the old name no longer described the test / may affect: none
- Implementer risk note (not a deviation): gate ×4 binds both rosters to the current `plugin.json` version, so when 25.7 cuts 0.3.0 the motion writes only `latest.json` and `stable.json` must be promoted in the same commit or the gate goes red.

- SEAM (consult ruling): deviation 3 is a seam 25-3 and 25-4 inherit: any roster they write or test against, fakes included, uses only the six components (plugin, supervisor, studio-web, cli, uv, bun), `schema: 1`, `channel` in {stable, latest}, a `>=X.Y.Z` `requires.claude-code` floor and `X.Y.Z` tool versions, or calls the guard knowing it rejects anything else. Deviation 3 is scored 2; deviations 1, 2 and 4 stay at 1.

DRIFT: plugin motion gains read-only pre-publish checks (subtree existence, guard) and `app`/`channel` result keys; zip bytes unchanged — required by the matrix's "named failure before any gh call" and the guard-refusal task — affects: none
DRIFT: `--app supervisor` requires `--repo` — prevents archiving this repo as the supervisor before EP-31 — affects: none
DRIFT: roster guard is stricter than the matrix (unknown component, schema≠1, channel, floor and tool-version formats) — keeps the guard from accepting invented shapes — affects: 25-3, 25-4
DRIFT: gate test renamed to four-way and equality test split out — name accuracy — affects: none

### pass 2 (2026-10-14, implementer, review patches)

- planned: with no archive record, skip the gate comparison / actual: only the url/sha256 comparison is skipped; the plugin tag is still checked against `plugin.json` / why: the tag check is not the misleading part; the record check reports the missing archive / may affect: none
- planned: remove the stable==latest equality test / actual: also renamed `test_installer_rosters_pass_the_guard_and_agree` → `test_installer_rosters_pass_the_guard`, and the plane's ok detail now names both rosters and per-channel components / why: the old name and detail described the removed invariant / may affect: 25-3
- planned: correct the runbook only where it said gate ×4 covers both rosters / actual: also added one-line notes on the `gh release edit --latest=false` demotion and the cli wheel version refusal / why: keep the runbook in step with the script / may affect: none
- Consult ruling (accept, score 1): the first-cut component set assertion becomes `{plugin, uv, bun}` ⊆ latest components ⊆ the six known names; the exact set is shown as Verification evidence.

DRIFT: missing archive record skips only the url/sha256 half of gate ×4 — the tag half stays checkable from plugin.json — affects: none
DRIFT: guard test renamed and plane ok-detail names both rosters with per-channel components — the old wording described the removed stable==latest invariant — affects: 25-3
DRIFT: runbook gained notes on release demotion and the cli wheel version refusal — keep the runbook in step with the script — affects: none

### pass 3 (2026-10-14, implementer, follow-up review patches)

- planned: check `roster["channel"] == channel` after the existing roster read / actual: the roster read, the components-object check and the stem check moved before the tag lookup in `run()`, skipped on `--dry-run`; dry-run output and sha256 unchanged / why: the old read ran after `gh repo view`, and the patch also required refusal before any `gh` call / may affect: none
- planned: catch `UnicodeDecodeError` at the plane's reads and `_read_json` / actual: the plugin motion's inline `released-roster.json` read also now goes through `_read_json`, with the same message / why: the same crash at another site in the plan's Files / may affect: none
- planned: refuse `--app plugin --channel stable` / actual: the refusal also covers `--dry-run`, and one runbook clause records it / why: P1 makes no dry-run exception, and the runbook implied the combination was allowed / may affect: none
- Consult ruling (accept, score 1; (c) and (d) score 0): frontmatter `deviation_score` stays 2.

DRIFT: the motion reads and checks the channel roster before the tag lookup (skipped on dry run) — the stem refusal must precede any `gh` call — affects: none
DRIFT: the plugin motion's `released-roster.json` read now goes through `_read_json` — the same non-UTF-8 crash as P3 — affects: none

### pass 4 (2026-10-14, implementer, follow-up review patches)

- planned: P6 tightens only the guard / actual: `tools/release_archive.py` also writes `source` (this repository's `nameWithOwner`) when it cuts a non-plugin app into a channel roster with no `plugin` entry / why: otherwise the new guard rule would refuse every own-repository cut into a plugin-less channel / may affect: 25-3, 25-4
- planned: P5 refuses `--app plugin` with a foreign `--repo` / actual: the refusal also covers `--dry-run`, and `--repo` set to this repository is still accepted / why: the patch said "before any `git`/`gh` call", with no dry-run exception / may affect: none
- SEAM (consult ruling 2026-10-14T20:36:40Z): the 25-3/25-4 seam gains one rule. A roster with no `plugin` entry requires `source` on every present `supervisor`/`studio-web`/`cli` entry. Scored 2 together with the guard change; frontmatter `deviation_score` stays 2.

DRIFT: in a roster with no `plugin` entry, every app entry requires `source`, and the motion records it — AC3's foreign entry must name its repository, and without a plugin entry there is no home to compare against — affects: 25-3, 25-4
DRIFT: `--app plugin` with a foreign `--repo` is refused, dry run included — keeps the plugin motion unchanged in effect — affects: none

## Consult Log

- 2026-10-14T19:57:30Z — trigger: halt — question: AC1 requires `supervisor`, `studio-web` and `cli` as `{tag, url, sha256}` and `uv`/`bun` as a single `{version, sha256}`, but only the plugin has a release and uv/bun ship one archive per platform; does the session pick a schema (pending marker / optional / deferred; per-platform map) or escalate? — ruling: escalate — do: HALT blocked before writing any spec or code. Hand the operator two questions. (1) Should the roster carry placeholders for the three unreleased components, carry them as optional entries, or leave them out until they ship? Whatever the answer, the guard must accept it. (2) Should the uv/bun `{version, sha256}` entry become a per-platform map, or should the roster pin one named platform? Re-drive 25.1 once the operator has ruled on both. — rule candidate: When a story's acceptance criteria require a schema entry for an artifact that won't exist until a later story or an operator action, the planner settles the schema (pending marker, optional entry or deferred entry, plus the per-platform digest shape) in the SPEC before launch instead of leaving it as a Block If.
- 2026-10-14T20:11:12Z — trigger: deviation-gt-0 — question: accept the four pass-1 deviations (plugin pre-publish checks, supervisor needs --repo, stricter roster guard, renamed gate test) at the self-scored 1? — ruling: accept-deviation score 2 — do: accept all four; set deviation_score 2; mark deviation 3 as a seam 25.3/25.4 inherit (six components, schema 1, channel stable/latest, >=X.Y.Z floor, X.Y.Z tool versions); change nothing else — rule candidate: When an implementer makes a shared validator or schema guard stricter than the story's I/O matrix, and later stories read the same artifact, score it 2 automatically and copy the added rules into the SPEC's seam notes. No consult is needed.
- 2026-10-14T20:13:37Z — trigger: high-severity-finding — question: gate ×4 binds both rosters (tests, pre-publish guard, drift plane on stable.json) but ruling 3 has the motion write `latest` only with stable trailing by PR, so the 25.7 cut goes red; which reading applies? — ruling: apply (option 1) — do: bind gate ×4 to `latest.json` only in test_release_roster.py, release_archive.py's pre-publish guard and drift_check.py's _installer_roster_check, reading `stable.json` for shape only; check stable's plugin entry for shape only (tag/url/64-hex), no comparison with the current gate and no permanent stable==latest guard (first-cut equality is evidence, not an invariant); record that 25.3 wires the configured channel and 25.7 is the first cut where stable trails — rule candidate: Release-lockstep guards (gate ×N) bind only the artifact the release motion writes, which here is the `latest` channel. Promoted or trailing channels get shape-only checks.
- 2026-10-14T20:17:56Z — trigger: deviation-gt-0 — question: accept pass-2 deviations (tag-only gate without archive, renamed test + plane detail, runbook notes) and how to treat the exact first-cut component-set test that goes red at the AC3 operator step? — ruling: accept-deviation score 1 — do: accept a–c, keep deviation_score as is; replace the exact-set assertion at test_release_roster.py:105-107 with {plugin,uv,bun} ⊆ components ⊆ six known names, add a Verification line printing both rosters' component sets as first-cut evidence; record in the Spec Change Log; change nothing else — rule candidate: When an AC says "at the first cut X holds" and a later AC or operator step is allowed to change X, the test asserts only what stays true (subset, guard-clean) and X is shown as Verification evidence. Never pin an exact snapshot.
- 2026-10-14T20:27:41Z — trigger: deviation-gt-0 — question: accept the pass-3 deviations (roster read moved before the tag lookup for P2b; `_read_json` at the plugin motion's released-roster read; P1 refusing on dry run; runbook clause) and at what score? — ruling: accept-deviation score 1 — do: accept (a) and (b) at score 1, (c) and (d) at score 0, leave frontmatter `deviation_score` at 2; record all four as `may affect: none` and log the ruling; change nothing else — rule candidate: When a review patch says both "do X at site S" and "before any `gh` call", and S comes after a `gh` call, move X earlier, keep the dry-run digest unchanged, and score it 1 with no consult. Applying the same fix to another site with the same defect, inside the plan's Files, is also scored 1 with no consult.
- 2026-10-14T20:36:40Z — trigger: deviation-gt-0 — question: accept the pass-4 deviation (the motion writes `source` when it cuts into a roster with no `plugin` entry, forced by P6's stricter guard rule) at the self-scored 1, at 2, or reject P6? — ruling: accept-deviation score 2 — do: keep P6 and the motion change, and leave `deviation_score` at 2; add the plugin-less `source` rule to the SEAM note and log the motion change as "may affect: 25-3, 25-4"; replace the Design Note sentence with "source is required" and record it in the Spec Change Log, changing nothing else — rule candidate: When a review patch tightens the shared roster guard and the motion must change to keep writing rosters the guard accepts, score both together at 2 and append the new rule to the SEAM note. No consult is needed.

## Auto Run Result

Status: done

**Summary:** This is the second follow-up review pass on 25.1 (`status: done`, `review_loop_iteration` 0), run because pass 3 recommended one. The story's implementation stands as summarised in earlier runs: per-channel installer rosters, the pure `roster_problems` guard in the plugin plane (gate ×4 on `latest.json`), and `tools/release_archive.py` cutting any app with `--latest=false` and a verified round trip. This pass hardened six more edges:
- Repeating digests, and one digest copied across targets, are now refused as fabricated.
- Placeholder platform-target keys are refused.
- In a roster with no `plugin` entry, every app entry must name `source`, and the motion writes it.
- The runbook's AC3 command now cuts the tag from an up-to-date `main`.
- A test pins each app's archived subtree at its tag.
- `--app plugin` from another checkout is refused.

**Files changed (this pass):**
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: `_digest_problem` refuses digests made of a repeated unit; the `uv`/`bun` check refuses duplicate and placeholder targets; a roster with no plugin entry requires `source`.
- `tools/release_archive.py`: refuses `--app plugin` with a foreign `--repo` before any call; records `source` when cutting into a roster with no plugin entry.
- `plugins/tk-studio/lib/tests/test_release_roster.py`: 7 new tests and the `_digest()` fixture helper. Non-repeating fixtures replace the periodic ones.
- `kb/offline-install-runbook.md`: the supervisor operator command now starts with `git switch main && git pull --ff-only origin main`.

**Review:** Both layers ran (band L).
- Findings: 6 patches applied (high 0, medium 0, low 6), 0 deferred, 4 rejected (reasons in the Review Triage Log), 0 bad_spec, 0 intent_gap.
- Consult: 1 (`deviation-gt-0`, accepted at score 2 as a 25-3/25-4 seam), logged under `## Consult Log` and as an observation event.
- Follow-up review recommended: **true**. The score is 3×0 + 1×6 = 6, which is at least 5. Every patch is low severity: an edge hardening on an already-green core.

**Verification:**
- `uv run python -m unittest tests.test_release_roster tests.test_drift_check`: OK, 93 tests (implementer), re-run OK by this session.
- `uv run python -m unittest discover tests`: 848 tests OK (re-run by this session).
- Conformance `runner.py run`: `"ok": true` (re-run by this session).
- `release_archive.py run --app plugin --dry-run`: sha256 `2abc4e4754862be6d56250ab582af1234acf8f7fd9937f8840dd41b7cd8b207a` (unchanged); `written: []`.
- `drift_check.py --directory .`: `result: clean`. Plugin plane detail unchanged; committed rosters still pass the tightened guard.
- First-cut evidence: both rosters' components are `["bun","plugin","uv"]`, and `jq 'del(.channel)'` shows no difference between them.

**Unverifiable here (operator):**
- AC3, the supervisor's first release. In a `thkennedy/tk-studio-supervisor` checkout, run `git switch main && git pull --ff-only origin main && git tag supervisor--v0.1.0 && git push origin supervisor--v0.1.0`. Then, from this repository, run `uv run tools/release_archive.py run --app supervisor --version 0.1.0 --repo <path-to-supervisor-checkout> --channel latest`, and copy the written `supervisor` entry into `stable.json` by PR. The engine cut and pushed no tag.

**Residual risks:**
- The `cli` wheel build is still exercised only against a fake `uv build`, because `tools/installer/cli` arrives in 25.4.
- `studio-web` needs `apps/studio-web/dist` committed at its tag. That belongs to a later epic.
- Releases published before this story keep their GitHub "latest" flag.
- 25.3 and 25.4 inherit the guard seam: pass 1's rules plus this pass's rule that a roster with no plugin entry needs `source`. The periodic-digest refusal also binds any fixtures they write.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: dd0e6778c495d88770f58e82e6bcca7c82e7a697 (branch loop/epic-25)

DRIFT: in a roster with no `plugin` entry, every app entry requires `source`, and the motion records it — AC3's foreign entry must name its repository, and without a plugin entry there is no home to compare against — affects: 25-3, 25-4
DRIFT: `--app plugin` with a foreign `--repo` is refused, dry run included — keeps the plugin motion unchanged in effect — affects: none
