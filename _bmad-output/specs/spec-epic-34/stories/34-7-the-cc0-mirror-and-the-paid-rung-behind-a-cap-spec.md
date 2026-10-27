---
title: 'The CC0 Mirror and the Paid Rung Behind a Cap'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '6c5dbdddde5dba919b0dd91da173825ee6e62740'
deviation_score: 2
reconcile_verdict: adjust-stories
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-7.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The ladder has only its greybox rung (34.6). Nothing replaces a placeholder with a free CC0 kit asset from a box mirror, and nothing generates a mesh behind a credit cap the owner set on purpose. `facts_of` also ignores node transforms (DW-74), so the `facts` gate cannot judge third-party files.

**Approach:** Extend `plugins/tk-studio/lib/assets.py` with the verbs `mirror-index`, `match` and `generate`. Add two headless-Blender scripts, `lib/blender/normalise.py` and `lib/blender/render.py`, a visual gate (Workbench silhouette masks), a byte-preserving manifest write-back, a Meshy client seam, the user-variable key read, and the DW-74 fix in `facts_of`. The shape is exactly plans/34-7.md §Settled shape 1–10, which is normative and not restated here. Those rulings are also SPEC.md Design notes CAP-13 and CAP-14.

### Acceptance criteria (transcribed from epics.md Story 34.7, verbatim)

- **AC1** — **Given** a mirror under `C:\agent-work\assets\<kit>` (Kenney, Quaternius, Poly Haven; each with its licence file and the index the mirror script writes) **When** `assets.py match --directory <project>` runs **Then** every manifest entry on the `cc0` rung is matched by category and tags to a kit asset, normalised through headless Blender (scaled to the bounds, the origin per the rule, decimated to the triangle budget, exported as glTF) into the project's art path, passed through the `facts` gate and a visual gate (a Workbench render from the manifest's camera, compared with the greybox render for silhouette coverage and with a blank for emptiness), and the placeholder is kept until both gates pass; the kit, the licence tag and the source path land in the entry's provenance
- **AC2** — **Given** the `generated` rung **When** a manifest entry asks for it **Then** `assets.py generate` refuses unless the project's `budget-bands.yaml` carries an `assets.credit_cap` for the run and the generator's key exists as a User environment variable by name (`TK_ASSETS_MESHY_KEY`, never in a file), spends at most the cap, records every call and its cost in the ledger, and runs the same two gates; the rung is off by default and the runbook says how it is turned on
- **AC3** — **Given** the suites **When** they run **Then** the lib suite covers the matching, the normalisation argv, both gates and the cap refusals with fakes; nothing generates natively on the host (the Windows rule stands)

## Boundaries & Constraints

**Always:**
- plans/34-7.md §Settled shape 1–10 is the shape. Manifest keys stay additive and schema stays 1. The mirror root is `--mirror`, then `TK_ASSETS_MIRROR`, then `C:\agent-work\assets`. The index format, match scoring and tie-break, normalise spec keys, candidate path `<art_path>/.candidates/<name>.glb`, visual-gate thresholds 0.6/0.005 as named constants, refusal order, cap arithmetic, ledger payload and write-back rule are all fixed there.
- Bounds are glTF axes, Y up, mapped to Blender X, Z, Y as in greybox.
- Reuse `facts_of`, `gate`, `_publish_new`, `resolve_blender`, `run_blender`, the status-block idiom, and greybox.py's `_offset`/`select_export_options`/`export`.
- A greybox reference whose label is `stale` fails the entry with the 34.6 reason.
- `os.replace` over the placeholder happens only after both gates pass. A gate failure leaves the placeholder bytes untouched.
- Scripts are stdlib-only and run via `uv run` (NFR9). Writes are atomic. Every verb ends in a `complete | partial | blocked` status block; refusals exit 2.
- The key is read from `HKCU\Environment`, then the process env. It never appears in output, files, the ledger or argv (NFR5).
- The ledger is written only through `ledger.emit` (AD-12).
- Contract stays 0.1.29 and taxonomy stays v1, both additive.
- The plugin imports no driver, supervisor or installer (AD-2).

**Block If:**
- Closing DW-74 changes `check`'s verdict on any 34.6 fixture or test.
- A contract or taxonomy test needs a version bump to pass.
- Meshy cannot be called without the key landing in argv, a file or a log line.
- The work needs a file outside plans/34-7.md §Files (that list must not grow).

**Never:**
- Run real Blender, the network or a live generator in tests or the sandbox (fakes only).
- Generate natively on the host.
- Download kits (that is the operator step).
- Index `.blend` files (skip and count them instead).
- Wire the host leg (34.8).
- Extend `miniyaml.py`.
- Edit `epics.md`, `stories.yaml`, plan files, `.bmad-loop/*.toml` or `supervision/`.
- Push, tag, open a PR, run the release motion or bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| mirror-index | fixture kit with licence + `.glb`/`.blend` | deterministic `index.json` sorted by path, tags tokenised; `.blend` counted in `skipped` | no licence file → refusal exit 2 |
| match happy | cc0 entry, greybox placed (label `written`/`kept`), index hit, fake blender, both gates pass | candidate replaces placeholder; entry `status: accepted`, `licence: cc0`, `source: <kit>/<path>`; other manifest bytes identical | none |
| match no mirror | no `--mirror`, env unset, default absent | `complete`, every cc0 entry `skipped: no mirror` | none |
| match unmatched / no greybox | no same-category tag overlap / greybox `.glb` absent | `unmatched` placeholder kept / skipped `run greybox first` | not a failure |
| gate fails | facts out of bounds, coverage < 0.6, or fill < 0.005 | placeholder bytes unchanged; entry `status: candidate`, reasons listed | exit 1 |
| stale label | greybox label `stale` | entry fails with the 34.6 reason, no visual comparison | exit 1 |
| generate no cap | budget-bands lacks `assets.credit_cap` > 0 | refusal naming `assets.credit_cap`, no network, no write | exit 2 |
| generate no key | cap set, `TK_ASSETS_MESHY_KEY` absent | refusal naming the variable | exit 2 |
| cap exhausted | spent + per-task > cap | that entry and later ones `not-run: credit cap`; `partial` | exit 1 |
| generate calls | fake client, success and failure | one `asset-generation` ledger line per call (credits reported or estimated) | failed call recorded, entry failed |
| DW-74 | GLB with scaled/offset/instanced nodes | world bounds and per-instance triangle count | greybox output facts unchanged |
| unmappable manifest | manifest the reader cannot map line by line | refusal before any work | exit 2 |

</intent-contract>

## Code Map

plans/34-7.md §Code Map is the investigation. Its anchors were verified against HEAD `6c5dbdd` and are carried here.

- `plugins/tk-studio/lib/assets.py` (1104 lines)
  - `OPTIONAL_FIELDS`:114, `TOP_KEYS`:115. New optional keys go here.
  - `Refusal`:144.
  - `_scalar`:183 refuses flow lists. It must accept `[a, b]` of plain scalars for `tags`.
  - `_flow_map`:212 already reads `camera`.
  - `parse_manifest`:240, `validate`:328, `_validate_entry`:362.
  - `resolve_layout`:434, `load_manifest`:445, `asset_file`:456, `label_file`:461.
  - `_png_image`:586 decodes IHDR plus the inflated IDAT only. It needs un-filtering of types 0–4 and colour types 0/2/4/6 at 8 bit.
  - `read_glb`:658, `facts_of`:691 (DW-74), `gate`:739.
  - `with_block`:754, `_blocked`:760, `_publish_new`:764.
  - `resolve_blender`:848.
  - `blender_argv`:866 gains a script-path parameter.
  - `run_blender`:870, `_tail`:889.
  - `greybox`:897 (wall-clock pattern).
  - `_Parser`/`_emit`/`main`:1056–1104.
- `plugins/tk-studio/lib/blender/greybox.py`: `parse_spec`:81, `_offset`:183, `select_export_options`:260, `export`:316. Importable without bpy. The new scripts import these rather than copy them.
- `plugins/tk-studio/lib/tests/test_assets.py`: the `FakeBlender` idiom (`output=` override), temp projects and hand-built GLB fixtures.
- `plugins/tk-studio/lib/ledger.py` `emit`:201. Validates against `contracts/events/taxonomy.v1.json`. Precedents: `jobrun.py:128` and 34.3's `playable_verify_cost_usd`.
- `plugins/tk-studio/lib/quote.py` `BANDS_REL`:54 and `lib/launch.py:124`. These read `.tk-studio/budget-bands.yaml` with `miniyaml`.
- `tools/installer/cli/tk_studio_cli/apps.py:225–241`: the `HKCU\Environment` winreg read. Mirror it; do not import it.
- `plugins/tk-studio/contracts/driver-contract.md` `## Asset manifest (0.1.29, Story 34.6)`: the header :5 clause, the stories row :6 and the 0.1.29 note.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: template `test_0_1_29_story_34_6_asset_manifest`:2182. Stories-line re-pins at :2090, :2132, :2180.
- `plugins/tk-studio/contracts/conformance/e2e_asset_manifest.py`, `manifest.json`:149–151, `fixtures/asset-manifest/{valid,invalid}`.
- `kb/asset-ladder.md`, `kb/agent-pc-setup-runbook.md`:178–190, `README.md`:232.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/assets.py`
  - Reader and validation: `tags`, `prompt`, `camera`.
  - The verbs `mirror-index`, `match` and `generate`.
  - The PNG un-filter and alpha masks, and the visual gate.
  - The byte-preserving write-back.
  - `facts_of` node transforms (DW-74).
  - The Meshy `submit/poll/download` seam and the user-variable key read.
  - Rationale: §Settled shape 1–9.
- `plugins/tk-studio/lib/blender/normalise.py` (new): bpy normalisation (import, apply transforms, join, scale to bounds, origin, decimate, export). Pure helpers import without bpy. Rationale: §4.
- `plugins/tk-studio/lib/blender/render.py` (new): Workbench 128² orthographic transparent render framed on the bounds. Pure framing helpers. Rationale: §6.
- `plugins/tk-studio/lib/tests/test_assets_ladder.py` (new). Covers:
  - every matrix row
  - normalise and render argv plus spec JSON
  - write-back byte preservation
  - ledger lines through a fake store (`TK_STUDIO_HOME`)
  - a guard that no test reaches `urlopen` or a real `blender`
  - Rationale: AC3.
- `plugins/tk-studio/lib/tests/test_assets.py`: edit only if a 34.6 test pins the flow-list refusal or the optional-field set.
- `plugins/tk-studio/contracts/asset-manifest.schema.json`: `tags`, `prompt`, `camera`, and the `source` description.
- `plugins/tk-studio/contracts/events/taxonomy.v1.json`: `asset-generation` (emitter `lib/assets.py generate`).
- `plugins/tk-studio/contracts/driver-contract.md` plus `lib/tests/test_driver_contract.py`:
  - the 34.7 paragraph, header clause, stories row and 0.1.29 sentence
  - `test_0_1_29_story_34_7_asset_ladder`
  - the stories-line re-pins (planned DRIFT, score 1)
- `plugins/tk-studio/contracts/conformance/e2e_asset_manifest.py`, `manifest.json` note, and `fixtures/asset-manifest/` (a fixture kit and a `ladder/` manifest). New steps:
  - no cap → blocked naming `assets.credit_cap`
  - cap but no key → blocked naming `TK_ASSETS_MESHY_KEY`
  - no mirror → `complete` with skipped entries
  - `mirror-index` gives deterministic bytes
- `kb/asset-ladder.md`, `kb/agent-pc-setup-runbook.md`, `README.md`:
  - the mirror folder
  - `TK_ASSETS_MIRROR`
  - `TK_ASSETS_MESHY_KEY` as a User variable
  - `assets.credit_cap` turns the rung on
  - the visual-gate thresholds
  - one README sentence

**Acceptance Criteria:**
- Given a fixture mirror and a placed greybox, when `match` runs with a fake blender, then the cc0 entry's provenance holds kit, licence `cc0` and source path only after both gates pass.
- Given `generate` without a cap or a key, when it runs, then it refuses (exit 2) before any client call or write, and by default the rung is off.
- Given the suites, when the verify gate runs, then the lib suite and conformance are green, and no test reaches the network or a real Blender.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass

Both layers ran on claude-opus-5-5 at medium: blind-hunter and edge-case-hunter. The diff (3426 lines) was passed as a file path, `/tmp/review-34-7/diff.patch`, not inline. There were 16 raw findings, 13 after dedup. The high-severity finding went to a consult (ruling: apply).

- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 1, medium 3, low 5)
- defer: 0
- reject: 4 (low 4)
  - Kenney kits ship the same model as `.fbx` and `.glb`, and path order picks the `.fbx`. Plan §3 settles the tie-break (score, then kit, then path), and `normalise.py` imports `.fbx`, so this is not a defect.
  - `.candidates/` is not gitignored in the game repo. That is the game repo's hygiene, outside this story's criteria. The dot folder is plan §5.
  - The budget-bands schema has no `assets:` key. No validator exists for it; `quote.py:272` reads only `epics`.
  - The conformance no-key step tolerates a key held in HKCU. This deviation was already accepted by consult.
- addressed_findings:
  - `[high]` `[patch]` `generate` overshoots the cap when the reported charge exceeds the estimate, and charges <= 0 shrink `spent` (`assets.py:2187`, `:2201`, `:2119`). Fix per the consult ruling.
  - `[medium]` `[patch]` `alpha_mask` treats colour types 0 and 2 as fully opaque, so a render without alpha passes the visual gate trivially (`assets.py:1508`). A render without alpha is now a gate failure.
  - `[medium]` `[patch]` A failed `ledger.emit` for a paid call still ends `complete` (`assets.py:2207`, `_ladder_result`). A ledger error now makes the run `partial`.
  - `[medium]` `[patch]` `os.replace` over the placeholder runs before the manifest write-back (`assets.py:1825` vs `:1941`/`:2222`). Placement is now deferred until the write-back succeeds.
  - `[low]` `[patch]` The licence-file globs are case-sensitive and miss `LICENCE*` and `licence.md` (`assets.py:1249`, `:1324`). They now match case-insensitively and accept the `licence` spelling.
  - `[low]` `[patch]` `test_assets_ladder.py` `Base.setUp` pops env vars without restoring them. Now uses `mock.patch.dict`.
  - `[low]` `[patch]` A non-list node `children` raises `TypeError` in `_mesh_instances`. Now a malformed-GLB refusal.
  - `[low]` `[patch]` An absolute or `..` asset path in `index.json` escapes the kit (`load_mirror`, `match`). Now a refusal.
  - `[low]` `[patch]` `TK_ASSETS_MIRROR`, set as a User variable per the runbook, is not read from HKCU (`resolve_mirror`, `assets.py:1398`). Now read the same way as the key.

### 2026-10-27 — Review pass (follow-up, review_loop_iteration 0)
- review-input: the diff since `baseline_revision` (excluding `_bmad-output/`, 3829 lines) was handed to both layers as a file path (`/tmp/review-34-7/diff.patch`), not inlined: too large for a prompt
- layers: blind-hunter and edge-case-hunter (band L), claude-opus-5-5, medium; 12 raw findings (8 + 4), 12 after dedup
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 0
- reject: 8: (medium 6, low 2)
  - per-invocation cap (a relaunch under one run-id spends a second cap), raised by both layers: plans/34-7.md:90 rules the cap per `generate` invocation and :142 records this exact risk; the contract states 34.8 calls generate once per run
  - a failed submit is booked at the 20-credit estimate: plans/34-7.md:94 rules every call, failed included, at the reported charge else `MESHY_CREDITS_PER_TASK` with `estimated: true`
  - a charge above the estimate can overshoot the cap: settled by the 16:42Z consult; the one-call overshoot bound is in the contract
  - no retry on a transient poll error, and the paid download is lost when normalise fails: retry and keep-download are not named by AC2; spend stays bounded by the cap; the Meshy seam is an unproved residual already recorded
  - matcher accepts score 1 on a generic token: plans/34-7.md:67 fixes same-category, score >= 1, and the tie-break; the visual gate is the guard
  - `camera:`/`tags:`/`prompt:` with a null value read as absent: the reader's existing idiom for `source:`; harmless
- addressed_findings:
  - `[medium]` `[patch]` conformance `no-mirror` fails on a Windows box whose user holds `TK_ASSETS_MIRROR` in HKCU (user_env reads HKCU first): `held` tolerance added, inferred from `out["mirror"]` non-null under a missing-folder override, gated on `os.name == "nt"`, mirroring `no-key` (first route via importing `assets` rejected by consult 17:05Z; reworked)
  - `[medium]` `[patch]` `generate` kept making paid calls after a ledger line failed to write (AC2 "records every call"): every later entry is now `not-run: ledger unwritable`; contract 34.7 paragraph gains the clause; test `test_no_call_is_made_once_a_ledger_line_fails`
  - `[low]` `[patch]` `_scrub` was exercised by no test (NFR5): `FakeClient(error=)` plus `test_a_client_error_carrying_the_key_is_scrubbed`, which checks stdout, the row reason and the ledger
  - `[low]` `[patch]` re-running an entry already at `status: candidate` was untested (contract: placeholder | candidate): `test_a_candidate_whose_gates_fail_again_is_unmoved`, `test_a_candidate_whose_gates_pass_is_accepted`; no code change needed

### 2026-10-27 — Review pass (second follow-up, review_loop_iteration 0)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 2, low 3)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` `match_asset` compared raw entry tags with `tag_tokens` asset tags, so a schema-valid tag such as `street-lamp` or `barrel2` never matched. Entry tags are now tokenised first. The contract, kb and docstring now say "tag tokens", and a test was added (consult: accept-deviation score 2).
  - `[medium]` `[patch]` The visual gate's coverage `|C∩G|/|G|` measures how much of a box greybox a normalised non-box asset fills, so a thin asset (for example `lamp-post`) can stay `candidate`. The formula and constants are pinned by CAP-13 and plan §6 and were not changed. The kb now notes this, and the operator's box step measures a thin non-box asset beside the box asset so the threshold retune is informed.
  - `[low]` `[patch]` An `index.json` path with `\` was accepted, then failed `_yaml_string` at write-back. `kit_source` now refuses it at load as "not a posix path". A contract clause and a test were added (consult: accept-deviation score 2).
  - `[low]` `[patch]` The schema's `rung` description and kb :28 said "stands on". They now say "assigned to", as the contract does, with `status` saying which file is in place. The change is description-only.
  - `[low]` `[patch]` Stale 34.6 text was updated:
    - the kb reader paragraph and the module docstring now include flow lists, `camera` and `prompt`;
    - the kb's "All three" verbs line now says "All six";
    - the manifest example shows `tags`, `prompt` and `camera`;
    - the kb generated-rung paragraph now states the `not-run: ledger unwritable` rule.

## Design Notes

The cap is per `generate` invocation; 34.8 calls `generate` at most once per run. Record this in the contract paragraph. The thresholds are planner defaults, which the operator's box run may retune in the kb row.

## Verification

**Commands** (from `plugins/tk-studio/lib`):
- `uv run python -m unittest tests.test_assets tests.test_assets_ladder tests.test_ledger tests.test_driver_contract tests.test_release_roster` -- expected: OK.
- `uv run python -m unittest discover tests` -- expected: OK.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `grep -n "urlopen\|subprocess" tests/test_assets_ladder.py` -- expected: fakes and guards only.

**Manual checks (operator, unverifiable-here):**
1. Mirror one Kenney kit under `C:\agent-work\assets\kenney-<kit>` and run `assets.py mirror-index` on it.
2. On a TUA scratch clone with one cc0 entry, run `greybox` and then `match`.
3. Run `& $env:GODOT --headless --import`. `check` should be green.
4. Optional, only with a cap and the key set: make one `generate` call and read its ledger line back.
5. Record the result in `kb/asset-ladder.md`.

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: tag tokens split on `-`, `_`, space, `.`, camelCase / actual: split on any non-alphanumeric too / why: a name like `crate (1)` would otherwise yield a tag `(` / may affect: none
- planned: new Blender scripts import greybox's `parse_spec` / actual: normalise.py and render.py carry their own small `parse_spec`; import only `_offset` and `export` / why: greybox's `parse_spec` insists on greybox's spec keys / may affect: none
- planned: normalise order scale, origin, decimate / actual: decimate first, then scale and origin / why: decimation can shrink extents; fitting last keeps ±1 % exact / may affect: none
- planned: render framed from the entry's bounds / actual: camera looks at world origin, ortho scale 2× the bounds' diagonal / why: render spec keys carry no `origin`; this frame holds the box under any origin rule / may affect: none
- planned: `mirror-index --licence cc0`, licence copied into provenance / actual: `--licence` accepts only `cc0`; `match` considers only cc0 kits / why: keeps the cc0 rung CC0-only / may affect: none
- planned: no mirror → `skipped: no mirror` / actual: explicit `--mirror` naming a missing folder is a refusal (exit 2); `TK_ASSETS_MIRROR` naming a missing folder is skipped with a reason / why: an explicit wrong flag is a bad invocation / may affect: 34-8
- planned: facts gate then visual gate / actual: visual gate skipped when facts already failed; entry still `candidate` with reasons / why: saves Blender calls / may affect: none
- planned: (unruled) tool failures / actual: Blender/normalise failure → action `failed`, entry `status` unchanged / why: spec rules only on gate failures / may affect: 34-8
- planned: kb/asset-ladder.md record covers 34.7 / actual: body sections added; frontmatter title/description left as 34.6's / why: kb/index.md is generated from them and is outside Files / may affect: none
- planned: conformance no-key step blocked naming `TK_ASSETS_MESHY_KEY` / actual: on a Windows box whose user has the key in HKCU, the step accepts a refusal at a `--blender` naming no file (still no call) and says so / why: the drive cannot clear the registry for the child / may affect: none
- planned: contract wording / actual: 34.7 paragraph says "keep the rest of the file byte for byte" / why: two older contract tests forbid "every other byte" / may affect: none
- planned: stories-line re-pins (DRIFT, score 1) / actual: four assertions re-pinned to "…, Story 34.6, Story 34.7 (Epic 34)" / why: planned / may affect: 34-8

DEVIATION SCORE: 1

DRIFT: tag tokeniser splits on every non-alphanumeric — punctuation in kit filenames would become tags — affects: none
DRIFT: normalise.py/render.py carry their own parse_spec — greybox's parser pins greybox keys — affects: none
DRIFT: normalise decimates before fitting bounds — decimation shrinks extents and would break the ±1 % gate — affects: none
DRIFT: render frames on world origin at 2× bounds diagonal — render spec has no origin key — affects: none
DRIFT: mirror-index --licence accepts only cc0 — keeps the cc0 rung CC0-only — affects: none
DRIFT: a missing --mirror folder is a refusal; a missing TK_ASSETS_MIRROR folder is skipped — an explicit wrong flag is a bad invocation — affects: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path
DRIFT: visual gate skipped when facts gate fails — saves Blender calls; entry still candidate — affects: none
DRIFT: Blender/normalise failure leaves entry status unchanged (action failed) — spec rules only on gate failures — affects: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path
DRIFT: kb/asset-ladder.md frontmatter left as 34.6 — kb/index.md is generated from it and is outside Files — affects: none
DRIFT: conformance no-key step tolerates a registry-held key on Windows — the drive cannot clear HKCU for the child — affects: none
DRIFT: contract says "byte for byte" not "every other byte" — older contract tests forbid the phrase — affects: none
DRIFT: test_driver_contract stories-line assertions re-pinned for Story 34.7 — the stories row gains 34.7 — affects: none

Consult ruling (deviation-gt-0, 2026-10-27T16:32Z): accept all 12. (a) the missing-`--mirror` refusal and (b) a tool failure leaving `status` unchanged are scored 2. The other ten are scored 1. **For 34-8's planner:** call `match` without `--mirror` and let the env or default resolve. Treat exit 1 with action `failed` as a tool fault, not a gate verdict.

### pass 2 (2026-10-27, implementer, consult DO lines)

The two seams were pinned in the 34.7 paragraph of `driver-contract.md`, in `kb/asset-ladder.md`, and in three new assertions in `test_0_1_29_story_34_7_asset_ladder`. No code changed; the code already matched both seams.

- planned: state the two seams in the ruling's exact words / actual: same wording, joined with a semicolon or colon to fit the paragraph style / why: house style / may affect: none

DEVIATION SCORE: 0 (this pass)

### pass 3 (2026-10-27, implementer, review patches)

- planned: patch 4: the manifest and the files never disagree / actual: if the write-back fails, nothing is placed. If `os.replace` itself fails after a successful write-back, the row is `failed` with a reason, but the manifest (already `accepted`) is not rolled back / why: a manifest write and a file replace cannot be made atomic together / may affect: 34-8 (rare: `partial`, with the manifest saying `accepted` while the placeholder is still in place)
- planned: (unruled) the action of an accepted row whose write-back fails / actual: `failed`, with "not placed: the manifest was not rewritten" / why: `accepted` would be false, and `candidate` would imply a status write; this matches the tool-failure seam / may affect: 34-8

DEVIATION SCORE: 1 (this pass)

(The DRIFT for deviation (a) was withdrawn: consult rejected (a), and pass 4 adds the compensating write-back.)
DRIFT: an accepted row whose write-back fails ends `failed` ("not placed") — follows the tool-failure seam — affects: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path

### pass 4 (2026-10-27, implementer, consult ruling on the replace window)

- planned: a compensating `_write_back` / actual: new `_roll_back` rebuilds the manifest from the original text minus the failed rows' moves. It applies the same atomic write and changed-during-run guard. / why: `_write_back` cannot remove an inserted `source` line / may affect: none
- planned: compensate per row / actual: one compensating write after the replace loop / why: one atomic rewrite / may affect: none
- planned: — / actual: the manifest stays in `artifacts` even after a full rollback (the existing artifact rule) / why: unchanged rule / may affect: none

DEVIATION SCORE: 1 (this pass). These realise the consult's own DO lines. That is the same question already ruled on, so it was not re-consulted.

DRIFT: an accepted row whose write-back fails ends `failed` ("not placed"); a failed replace is rolled back by a compensating write — follows the tool-failure seam; pinned in the contract's 34.7 paragraph — affects: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path

### follow-up review pass (2026-10-27, implementer, review patches)

- The implementer reported `DRIFT: the e2e imports assets (Windows only) to reuse _hkcu_value`, score 1. The consult rejected it (`reject-deviation`), and it was reworked to an import-free inference from the verb's output. No deviation was accepted in this pass. The frontmatter `deviation_score` stays at 2, from the earlier passes.
- `driver-contract.md` gained one additive clause in the 34.7 paragraph (`not-run: ledger unwritable`). The contract version stays 0.1.29, and the file is in the plan's Files list.

### second follow-up review pass (2026-10-27, implementer, review patches)
Five patches, all inside the plan's Files: `assets.py`, `test_assets_ladder.py`, `asset-manifest.schema.json` (description only), `driver-contract.md`, `kb/asset-ladder.md`. `test_driver_contract.py` and conformance `manifest.json` needed no change. The implementer self-scored 1. The consult ruled `accept-deviation score 2`, so frontmatter `deviation_score` stays 2.
DRIFT: `match` scores `(tag tokens ∪ name tokens) ∩ asset tags` (entry tags are tokenised like the index's), and `kit_source` refuses an index path containing `\` — Settled shape 3 read literally leaves schema-valid hyphen/digit tags unable to match, and a backslash path breaks the write-back — affects: 34-8 (the changed contract sentences, driver-contract.md:1359-1361 and :1371-1376, are the seam the 34.8 plan must read)

## Consult Log

- 2026-10-27T16:32Z — trigger: deviation-gt-0 — question: accept 12 implementer deviations at score 1 or 2 (two name 34-8: the missing --mirror refusal, and tool failure leaving status unchanged)? — ruling: accept-deviation score 2 — do: accept all 12 ((a),(b) score 2, the rest 1); state both seams exactly in the contract's 34.7 paragraph and kb/asset-ladder.md; record for 34-8's planner: call match without --mirror, and treat exit 1 with action failed as a tool fault — rule candidate: when a plan line names a later story as consumer of a verb's exit code or end state, a deviation in that verb's refusal, exit code or status write-back is score 2 by default and must be written into the contract paragraph before verify
- 2026-10-27T16:42Z — trigger: high-severity-finding — question: generate can overshoot the cap when the reported charge exceeds the estimate; how to enforce "spends at most the cap"? — ruling: apply — do: (1) pre-check against max(estimate, highest reported charge); count only charges > 0, else fall back to the estimate; stop once spent >= cap; if spent > cap end partial naming the overshoot. (2) Add the one-call-overshoot sentence to the contract paragraph and the kb; add three tests (charge above estimate, charge <= 0, ratchet). (3) No extra cap >= estimate refusal; the pre-check already covers it — rule candidate: a spend cap enforced on a pre-call estimate uses max(estimate, highest observed charge), counts only positive charges, stops at spent >= cap, and states the single-call overshoot bound in the contract
- 2026-10-27T16:50Z — trigger: deviation-gt-0 — question: accept pass-3 deviations (a) a failed os.replace after a successful write-back leaves the manifest accepted over the placeholder, (b) an accepted row whose write-back fails ends failed? — ruling: reject-deviation — do: reject (a): on a replace failure, run a compensating write-back that restores the prior status/licence/source, keep the candidate, keep the row failed and the run partial, and add a test; accept (b) at score 2 and state it in the contract's 34.7 paragraph and the kb; fix the settle docstring and the pass-3 DRIFT lines — rule candidate: a status written before the move it describes must be rolled back by a compensating write when that move fails

- 2026-10-27T17:05Z — trigger: deviation-gt-0 — question: follow-up pass patch 1 — accept the e2e importing `assets` (Windows only) to reuse `_hkcu_value` for the no-mirror registry tolerance? — ruling: reject-deviation — do: (1) delete `_registry_mirror()` and its import; the e2e reaches assets.py only by subprocess (2) held = os.name == "nt" and out is not None and out.get("mirror") is not None and crate action in (skipped, unmatched); keep settled, named and the detail suffix (3) re-run the e2e on Linux and confirm no-mirror still asserts `named` — rule candidate: conformance e2e drives call plugin libs only as subprocesses and never import them; host-state tolerance (HKCU-held values) is inferred from the verb's JSON output, gated on os.name
- 2026-10-27T17:28Z — trigger: deviation-gt-0 — question: second follow-up pass. Accept the implementer's score-1 deviation (entry tags tokenised in `match_asset`; index paths with a backslash refused in `kit_source`; both contract sentences amended)? — ruling: accept-deviation score 2 — do: (1) keep both patches as written (2) record the deviation at score 2 and name driver-contract.md:1359-1361 and :1371-1376 as the seam the 34.8 plan must read (3) make sure test_assets_ladder.py covers a hyphen- or digit-bearing tag that matches and a backslash index path that is refused (both present: :440, :454) — rule candidate: a patch that edits a driver-contract.md sentence introduced or pinned by the current story scores at least 2, even when it refines the plan's own rule; a self-score of 1 is allowed only when no contract or schema text changes, descriptions excepted. (observe.py record: ok)
- 2026-10-27T20:1xZ — operator session (the box step, `unverifiable-here`): with no CC0 kit on the box, the mirror `C:\agent-work\assets\fixture-crate` is the conformance fixture kit plus a synthetic thin lamp post; `mirror-index` 2 assets; on the TUA scratch clone `match` accepted `storage-crate` in 10.1 s (coverage 1.0, fill 0.1428; placed, the manifest rewritten), `check` pass 3, Godot 4.7.2 import clean in 4 s; the thin `lamp-post` measured coverage 0.2841, fill 0.012 → `candidate` (the run `partial`), as the kb predicted; the thresholds were not retuned on two synthetic points: a collision-aware or per-entry floor is 34.8's planner's call. The record: `kb/asset-ladder.md` §The operator's box step for Story 34.7.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review pass on the 34.7 implementation (commits 5c1e625 and 79ff7c1). The spec arrived at `done`, with `review_loop_iteration` 0. Both layers reviewed the whole diff since `6c5dbdddde5dba919b0dd91da173825ee6e62740`. The pass applied five patches:
- `match` now tokenises entry tags, so a hyphenated or digit-bearing tag can match.
- An index path containing `\` is refused at load.
- The schema's `rung` description now says "assigned to", as the contract does.
- Stale 34.6 text in the kb and the docstring was updated.
- The kb has a note, and the operator's box step a new measurement, for the visual gate's coverage of non-box assets. The formula itself is pinned by CAP-13 and was not changed.

DRIFT: `match` scores `(tag tokens ∪ name tokens) ∩ asset tags` (entry tags are tokenised like the index's), and `kit_source` refuses an index path containing `\` — Settled shape 3 read literally leaves schema-valid hyphen/digit tags unable to match, and a backslash path breaks the write-back — affects: 34-8 (the changed contract sentences, driver-contract.md:1359-1361 and :1371-1376, are the seam the 34.8 plan must read)

**Files changed (this pass).**
- `plugins/tk-studio/lib/assets.py`:
  - `match_asset` tokenises entry tags;
  - `kit_source` refuses an index path containing `\`;
  - the module docstring's reader subset now includes flow lists, `camera` and `prompt`.
- `plugins/tk-studio/lib/tests/test_assets_ladder.py`: `test_index_paths_with_a_backslash_refuse_at_load` and `test_matching_tokenises_entry_tags_as_the_index_does`.
- `plugins/tk-studio/contracts/asset-manifest.schema.json`: the `rung` description only.
- `plugins/tk-studio/contracts/driver-contract.md`: the tag-token scoring sentence and the backslash index refusal clause. Both are additive.
- `kb/asset-ladder.md`:
  - the `rung` wording;
  - the reader paragraph;
  - the verbs count;
  - the example's new keys;
  - the tag-token scoring and the backslash refusal;
  - the ledger-unwritable rule;
  - the coverage note on non-box assets;
  - box step 4: measure a thin non-box asset.

**Review.** Both layers ran (blind-hunter and edge-case-hunter, opus-5-5, medium) and raised 5 findings.
- Patches applied: 5 (high 0, medium 2, low 3).
- Deferred: 0.
- Rejected: 0.

One consult ran (`deviation-gt-0`). It accepted the deviation at score 2, and `deviation_score` stays 2.

**Follow-up review recommended: true.** Score: 3×2 (medium) + 1×3 (low) = 9, which is at least 5. There were no high findings.

**Verification.** This session re-ran these from `plugins/tk-studio/lib` after the implementer pass:
- `uv run python -m unittest tests.test_assets tests.test_assets_ladder tests.test_ledger tests.test_driver_contract tests.test_release_roster`: 290 tests, OK.
- `uv run python -m unittest discover tests`: 2349 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, `failures: []`.
- `grep -n "urlopen\|subprocess" tests/test_assets_ladder.py`: only the docstring, the import, the guard, the guard test and the mocked `fake_urlopen`.

**unverifiable-here (operator, on the box).** The previous passes' operator steps still stand.

The kb's 34.7 box step 4 is new. Run `assets.py match --directory <TUA clone>` on a cc0 entry that is thin and not box-shaped, such as a lamp post. Record its coverage and fill in `kb/asset-ladder.md` beside the box asset's, then retune `VISUAL_COVERAGE_MIN` there if needed.

**Residual risks.**
- The visual gate's coverage formula is pinned by CAP-13 and plan §6. Thin or non-box assets may stay `candidate` at 0.6 until the operator retunes the threshold. For the `generated` rung, each re-run of a candidate entry spends again, within the per-invocation cap.
- The earlier residuals stand:
  - The Windows `held` branch of `no-mirror` has not run on Windows.
  - The cap is per invocation.
  - A transient Meshy poll error, or a normalise failure after a download, loses that paid asset.
  - Blender has never run `normalise.py` or `render.py`.
  - The Meshy endpoint and credit fields are unverified.
  - The thresholds are planner defaults.

## Reconcile

### 2026-10-27 — adjust-stories

- Score: 2
- Reasoning: Every deviation is additive. Each lands on the 34.7 paragraph of driver-contract.md, which this story introduced, so the contract version stays 0.1.29 and no AD, schema or recorded ruling is contradicted. One later story consumes the changed seams: 34.8's host leg runs `match` "when the mirror exists" and may call `generate`. Its acceptance criteria still hold, because no mirror ends `complete` with entries `skipped`. The exit-code and status semantics it must read changed, though, and notes in its `invoke_dev_with` can absorb that.
- Affected: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path — "the host leg runs ... the ladder's `check` and `greybox` (34.6; `match` when the mirror exists)" (it now has to pass no `--mirror`, treat exit 1 with action `failed` as a tool fault, and read the cap as per `generate` invocation)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 34-8-the-run-vertical-slice-job-and-the-engagements-game-path
