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

## Design Notes

- "`stable.json` equals `latest.json`" is read as equal in `schema`, `requires` and `components`; `channel` names each file's own channel, as AC1 requires every roster to carry it. The real-repo test asserts exactly that.
- The `plugin` entry's URL repository is the roster's home repository; this lets the pure guard decide "foreign" with no hard-coded owner. With no `plugin` entry, `source` (when present) must still match its URL.

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

## Consult Log

- 2026-10-14T19:57:30Z — trigger: halt — question: AC1 requires `supervisor`, `studio-web` and `cli` as `{tag, url, sha256}` and `uv`/`bun` as a single `{version, sha256}`, but only the plugin has a release and uv/bun ship one archive per platform; does the session pick a schema (pending marker / optional / deferred; per-platform map) or escalate? — ruling: escalate — do: HALT blocked before writing any spec or code. Hand the operator two questions. (1) Should the roster carry placeholders for the three unreleased components, carry them as optional entries, or leave them out until they ship? Whatever the answer, the guard must accept it. (2) Should the uv/bun `{version, sha256}` entry become a per-platform map, or should the roster pin one named platform? Re-drive 25.1 once the operator has ruled on both. — rule candidate: When a story's acceptance criteria require a schema entry for an artifact that won't exist until a later story or an operator action, the planner settles the schema (pending marker, optional entry or deferred entry, plus the per-platform digest shape) in the SPEC before launch instead of leaving it as a Block If.
- 2026-10-14T20:11:12Z — trigger: deviation-gt-0 — question: accept the four pass-1 deviations (plugin pre-publish checks, supervisor needs --repo, stricter roster guard, renamed gate test) at the self-scored 1? — ruling: accept-deviation score 2 — do: accept all four; set deviation_score 2; mark deviation 3 as a seam 25.3/25.4 inherit (six components, schema 1, channel stable/latest, >=X.Y.Z floor, X.Y.Z tool versions); change nothing else — rule candidate: When an implementer makes a shared validator or schema guard stricter than the story's I/O matrix, and later stories read the same artifact, score it 2 automatically and copy the added rules into the SPEC's seam notes. No consult is needed.
- 2026-10-14T20:13:37Z — trigger: high-severity-finding — question: gate ×4 binds both rosters (tests, pre-publish guard, drift plane on stable.json) but ruling 3 has the motion write `latest` only with stable trailing by PR, so the 25.7 cut goes red; which reading applies? — ruling: apply (option 1) — do: bind gate ×4 to `latest.json` only in test_release_roster.py, release_archive.py's pre-publish guard and drift_check.py's _installer_roster_check, reading `stable.json` for shape only; check stable's plugin entry for shape only (tag/url/64-hex), no comparison with the current gate and no permanent stable==latest guard (first-cut equality is evidence, not an invariant); record that 25.3 wires the configured channel and 25.7 is the first cut where stable trails — rule candidate: Release-lockstep guards (gate ×N) bind only the artifact the release motion writes, which here is the `latest` channel. Promoted or trailing channels get shape-only checks.
- 2026-10-14T20:17:56Z — trigger: deviation-gt-0 — question: accept pass-2 deviations (tag-only gate without archive, renamed test + plane detail, runbook notes) and how to treat the exact first-cut component-set test that goes red at the AC3 operator step? — ruling: accept-deviation score 1 — do: accept a–c, keep deviation_score as is; replace the exact-set assertion at test_release_roster.py:105-107 with {plugin,uv,bun} ⊆ components ⊆ six known names, add a Verification line printing both rosters' component sets as first-cut evidence; record in the Spec Change Log; change nothing else — rule candidate: When an AC says "at the first cut X holds" and a later AC or operator step is allowed to change X, the test asserts only what stays true (subset, guard-clean) and X is shown as Verification evidence. Never pin an exact snapshot.

## Auto Run Result

Status: done

**Summary:** Committed one installer roster per channel (`tools/installer/rosters/{stable,latest}.json`). Each carries `schema: 1`, `channel`, `requires.claude-code >=2.1.224`, and the first-cut components: `plugin` at 0.2.16 (the digest from `released-roster.json`), `uv` 0.13.1 and `bun` 1.4.3. The uv and Bun entries hold per-target digests for Windows x64, Linux x64 and macOS arm64, read from upstream; the session re-checked them against upstream. A pure `roster_problems` guard in `drift_check.py` covers the shape, digests, placeholders, tag prefixes, release URLs, `source` for foreign repositories and gate ×4, which binds `latest.json` only. The guard runs as a third sub-check of the drift check's plugin plane: stable is checked for shape, latest for shape plus gate ×4. `tools/release_archive.py` now cuts any app (`--app/--version/--repo/--channel`) by its `<prefix>--vX.Y.Z` tag. It builds a zip, or a wheel for cli, publishes with `--latest=false` (or demotes an existing release), re-verifies the download, and atomically records `{tag, url, sha256}` (plus `source` when foreign) in the roster. The plugin cut still writes `released-roster.json` `archive`, and its zip bytes are unchanged.

**Files changed:**
- `tools/installer/rosters/latest.json`, `tools/installer/rosters/stable.json`: new. The first-cut rosters, identical except `channel`.
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: `roster_problems` guard plus the `_installer_roster_check` plugin-plane sub-check. It reads the project directory, so the plugin stays sealed.
- `tools/release_archive.py`: an app table and the generalised motion. Adds `--latest=false` / demotion, the pre-publish guard, the wheel version check and atomic roster writes.
- `plugins/tk-studio/lib/tests/test_release_roster.py`: gate ×4 and real-roster tests, one guard test per matrix row, plane tests, and fake-`gh` motion tests (plugin, foreign supervisor, cli wheel, mismatch, missing tag/subtree, rejected roster, existing release).
- `kb/offline-install-runbook.md`: the `--app plugin` invocation and the "Release motion for every app" section. That section holds the AC3 operator commands and the uv/Bun digest source URLs.

**Review:** Both layers ran (band L). 4 patches applied (high 1, medium 3), 0 deferred, 0 rejected, 0 bad_spec, 0 intent_gap. There were 3 consults, logged under `## Consult Log` and as observation events. Follow-up review recommended: **true**, because a high-severity finding was patched (patched counts: high 1, medium 3, low 0; score 3×3+0 = 9).

**Verification:**
- `uv run python -m unittest tests.test_release_roster tests.test_drift_check`: OK.
- `uv run python -m unittest discover tests`: 833 tests OK.
- Conformance `runner.py run`: `ok: true`.
- `release_archive.py run --app plugin --dry-run`: sha256 `2abc4e4754862be6d56250ab582af1234acf8f7fd9937f8840dd41b7cd8b207a`, unchanged.
- `drift_check.py --directory .`: `result: clean`. The plugin plane detail names the installer roster sub-check, gate ×4 and both channels.
- First-cut evidence: both rosters' components are `["bun","plugin","uv"]`, and the rosters do not differ apart from `channel`.
- Matrix audit: every row is covered by a named test in `test_release_roster.py`, and all of them ran in the green suite. The real-roster equality is shown by the Verification command, per the consult.

**Unverifiable here (operator):**
- AC3, the supervisor's first release. In a `thkennedy/tk-studio-supervisor` checkout on an up-to-date `main`, run `git tag supervisor--v0.1.0 && git push origin supervisor--v0.1.0`. Then, from this repository, run `uv run tools/release_archive.py run --app supervisor --version 0.1.0 --repo <path-to-supervisor-checkout> --channel latest`, and promote the entry to `stable.json` by PR. The engine cut and pushed no tag.

**Residual risks:**
- The `cli` wheel build ran only against a fake `uv build`, because `tools/installer/cli` arrives in 25.4.
- `studio-web`'s subtree (`apps/studio-web/dist`) is build output and may not be committed at a tag. That is for a later epic.
- 25.3 inherits the stricter guard seam and the new plane detail wording.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: dd0e6778c495d88770f58e82e6bcca7c82e7a697 (branch loop/epic-25)

DRIFT: plugin motion gains read-only pre-publish checks (subtree existence, guard) and `app`/`channel` result keys; zip bytes unchanged — required by the matrix's "named failure before any gh call" and the guard-refusal task — affects: none
DRIFT: `--app supervisor` requires `--repo` — prevents archiving this repo as the supervisor before EP-31 — affects: none
DRIFT: roster guard is stricter than the matrix (unknown component, schema≠1, channel, floor and tool-version formats) — keeps the guard from accepting invented shapes (consult: score 2, a seam 25.3/25.4 inherit) — affects: 25-3, 25-4
DRIFT: gate test renamed to four-way and equality test split out — name accuracy — affects: none
DRIFT: missing archive record skips only the url/sha256 half of gate ×4 — the tag half stays checkable from plugin.json — affects: none
DRIFT: guard test renamed and plane ok-detail names both rosters with per-channel components — the old wording described the removed stable==latest invariant — affects: 25-3
DRIFT: runbook gained notes on release demotion and the cli wheel version refusal — keep the runbook in step with the script — affects: none
