---
title: 'The Asset Manifest and the Greybox Rung'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'dfa1ab25c69c5ce43010b8c9fcfa5346dbe72f6b'
deviation_score: 2
reconcile_verdict: adjust-stories
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-6.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: [oversized]
deferred:
  - summary: >-
      assets.py facts reads bounds and triangles from POSITION accessor min/max and meshes only, ignoring node transforms and instancing.
    evidence: |-
      Edge and blind layers: a .glb with a scaled, offset or instanced node gets wrong bounds, origin and triangle facts, so the gate judges cc0 and generated rung files wrongly. Greybox output (identity transforms) is unaffected. Plan 34-6 §7 chose accessor min/max; deferral category (a), behaviour AC2 names (facts bounds from the glTF), needed before 34.7 gates third-party files.
    location: >-
      plugins/tk-studio/lib/assets.py (facts_of)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A slice has no single declaration of the assets it needs and no way to be playable before art exists; nothing produces placeholders, and nothing checks a mesh against its budget or bounds.

**Approach:** Ship `plugins/tk-studio/lib/assets.py` (`check | greybox | facts`, stdlib only) over a manifest whose schema is `plugins/tk-studio/contracts/asset-manifest.schema.json`, with the greybox rung produced by headless Blender through `plugins/tk-studio/lib/blender/greybox.py`; the shape, value sets, derived path, colour map, label texture, geometry, facts and Blender lookup are exactly plans/34-6.md §Settled shape 1–9 (normative, not restated here).

### Acceptance criteria (transcribed from epics.md Story 34.6, verbatim)

- **AC1** — **Given** `assets/manifest.yaml` (its schema `plugins/tk-studio/contracts/asset-manifest.schema.json`: name, category, triangle budget, bounds in metres, origin rule, collision shape, licence tag, rung, status) **When** `plugins/tk-studio/lib/assets.py check --directory <project>` runs **Then** it validates the manifest and reports every entry's rung and status; `assets.py greybox --directory <project>` writes, for every entry without a file, a greybox mesh (primitives sized to the bounds, the origin per the rule, a flat material in the category's colour with the name baked into a label texture) as glTF under the project's art path (TUA: `art/world/greybox/`, following `art/ART-BIBLE.md`) through headless Blender on the host (`blender -b --python plugins/tk-studio/lib/blender/greybox.py`), deterministic (the same manifest gives the same bytes) and never touching an existing file; each verb ends in a status block (AD-11)
- **AC2** — **Given** a produced mesh **When** `assets.py facts <file>` runs **Then** it reports the triangle count, the bounds, the origin, UV presence and the material count from the glTF itself (stdlib, no Blender), and `check` fails any entry whose facts break its budget or bounds (the `facts` gate); the lib suite covers the schema, the gate and the greybox verb with a fake `blender`; conformance adds the manifest check; the README and the kb name the ladder

## Boundaries & Constraints

**Always:** plans/34-6.md §Settled shape is the shape (manifest keys, closed value sets, `assets.manifest`/`assets.art_path` config keys with defaults `assets/manifest.yaml`/`art/greybox`, derived `<art_path>/<name>.glb`, `.glb` with fixed exporter options, default colour table in one source passed to Blender, stdlib 256×256 label PNG beside the output, primitive by collision, `BLENDER` else `blender` on PATH). Stdlib-only, `uv run` (NFR9); atomic writes; every verb ends in the JSON status block (AD-11), refusals exit 2 naming entry and field; `greybox` never overwrites an existing `.glb` or label; contract stays **0.1.29**, additive; credentials never touched (NFR5); plugin imports no driver (AD-2).

**Block If:** the settled shape and the story text disagree on something observable; a contract test requires a version bump to pass.

**Never:** run Blender in the sandbox or in tests (fake only); wire the host leg (34.8); CC0 / generated rungs, `match`, visual gate (34.7); a new skill or roster row; extending `miniyaml.py`; edits to `epics.md`, `stories.yaml`, plan files, `.bmad-loop/*.toml`, `supervision/`; push, tag, PR, release motion, version bumps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| check valid | fixture manifest, one `.glb` present in budget, one absent | ok; per-entry `rung`, `status`, `facts` or `missing` | none |
| check bad value | `category: monster` / `collision: cone` / dup name / `tri_budget: 8` / bad `#rrggbb` override | refusal naming entry + field | exit 2, status block `blocked` |
| check gate | present `.glb` over `tri_budget` or bounds off > 1 % | entry fails, verdict red | exit 1, status block names entry |
| no manifest | path absent | refusal naming the path | exit 2 |
| greybox | two entries, none on disk, fake `blender` | one call per entry, argv `<bin> -b --python <plugin>/lib/blender/greybox.py -- --spec <json>`; label PNG written | none |
| greybox existing | `.glb` already present | entry skipped, file bytes unchanged | none |
| no blender | `BLENDER` unset, none on PATH (or `BLENDER` names no file) | refusal naming `BLENDER` before any write | exit 2 |
| blender overrun / nonzero | fake hangs or exits 1 | killed at wall clock / entry reported failed | exit 1 |
| facts | hand-built cube `.glb` | 12 tris, bounds, `base-center`, `uv: true`, 1 material | malformed GLB → refusal exit 2 |

</intent-contract>

## Code Map

- `plans/34-6.md` (spec folder) -- §Settled shape 1–9 normative; §Files is the boundary.
- `plugins/tk-studio/lib/playable.py` -- sibling to mirror: `Refusal` + `resolve_godot` (:143) → `resolve_blender`; `run_engine`/`kill_tree` (:372–434) wall-clock + tree kill; `_write_atomic` (:469); `with_block`/`_emit`/`main` (:585–723) status-block idiom; `--godot` flag → `--blender`.
- `plugins/tk-studio/lib/tests/test_playable.py` -- fake-binary test idiom (`mock`, injected runner, temp projects).
- `plugins/tk-studio/lib/config.py` `resolve(key, project_root)` (:130) -- read `assets.manifest`, `assets.art_path`.
- `plugins/tk-studio/lib/miniyaml.py` -- REFUSES lists of mappings and flow mappings (doc :17–20); the manifest needs both, so `assets.py` carries its own narrow reader for exactly the manifest subset (top `schema`, `categories` map, `assets` list of mappings, `bounds: {x:, y:, z:}` flow map, scalars, comments) and refuses anything else.
- `plugins/tk-studio/contracts/status-block.schema.json` -- the block shape.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- surfaces are skill-keyed; runner fails an entry with no skill. Attach the drive to the `tk-studio-launch` surface beside `e2e_verify_commands.py` (:134–139) — `check` is an engine verify command.
- `plugins/tk-studio/contracts/conformance/e2e_engine_gate.py` -- e2e drive shape (one JSON `{ok, steps[]}`, stdlib, bounded).
- `plugins/tk-studio/contracts/driver-contract.md` -- :5 header (append `Story 34.6, additive: …` clause after 34.5's, before `) |`), :6 stories row (`Story 34.5, Story 34.6 (Epic 34)`), companion schemas row (add `asset-manifest.schema.json`), 0.1.29 note (one `Story 34.6 adds …` sentence before the second `Every other field, kind and route is unchanged.` :549), and a new `## Asset manifest (0.1.29, Story 34.6)` section placed after §7 and before `## 8. Conformance` (tests slice by that heading — keep it intact).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- template `test_0_1_29_story_34_5_engine_mcp` (:2133); stories-line assertions at :2090, :2131, :2179 re-pin to include Story 34.6 (planned DRIFT, score 1, as 34.4/34.5).
- `plugins/tk-studio/.claude-plugin/released-roster.json` -- no change (no new skill); `tests.test_release_roster` must stay green.
- `kb/agent-pc-setup-runbook.md` :178–190 -- Blender paragraph: add the `BLENDER` user variable (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`) and that `assets.py greybox` reads it.
- `kb/index.md` -- generated: run `uv run plugins/tk-studio/lib/kb.py index --directory .` after adding the kb page; never hand-edit.
- `README.md` :222–233 "Sessions and unattended work" -- add a paragraph naming the asset ladder and `assets.py`.
- `plugins/tk-studio/pipeline/verify-commands.toml` -- untouched (not in Files; conformance runs `check` inside the verify gate).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/contracts/asset-manifest.schema.json` -- new, draft 2020-12, schema 1, closed enums, `name` pattern `^[a-z0-9-]+$`, `tri_budget` integer > 0 (code refuses < 12, plan §6), bounds > 0, `categories` overrides `^#[0-9a-f]{6}$`, `additionalProperties: false` -- AC1.
- `plugins/tk-studio/lib/assets.py` -- new: manifest reader + validator (schema rules enforced in code, unique names), `check`, `greybox`, `facts`, label PNG writer (3×5 font, deterministic), GLB reader, Blender resolver/runner with `--wall` (default 600 s), `--directory`, `--manifest`, `--art-path`, `--blender` -- AC1, AC2.
- `plugins/tk-studio/lib/blender/greybox.py` -- new bpy script: parse args after `--`, reset to empty scene, build the primitive per collision sized to bounds, place origin, flat material with label image, reduce sphere/capsule segments to fit budget, export GLB with the fixed options; exits nonzero on error; guarded so importing it outside Blender fails clearly -- AC1.
- `plugins/tk-studio/lib/tests/test_assets.py` -- new: every I/O-matrix row; schema file ↔ code value sets agree; derived path; label PNG same bytes across two runs and valid PNG signature/IHDR; fake `blender` argv + spec JSON contents; existing file untouched (mtime and bytes); `facts` on a hand-built cube GLB; 1 % tolerance both sides -- AC1, AC2.
- `plugins/tk-studio/contracts/conformance/fixtures/asset-manifest/{valid,invalid}/` -- new: `assets/manifest.yaml` each (valid two entries; invalid one closed-set violation), a small in-budget `.glb` in valid's art path -- AC2.
- `plugins/tk-studio/contracts/conformance/e2e_asset_manifest.py` + `manifest.json` row under `tk-studio-launch` -- new drive: `check` on valid → ok, on invalid → refusal naming the field; prints `{ok, steps[]}` -- AC2.
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- 0.1.29 additive text per Code Map; new `test_0_1_29_story_34_6_asset_manifest`; three stories-line re-pins -- AC2 (AD-19).
- `kb/asset-ladder.md` (new, rank 65) + regenerated `kb/index.md`; `kb/agent-pc-setup-runbook.md`; `README.md` -- the ladder (greybox → cc0 → generated, a placeholder kept until its replacement passes the same gates), the verbs, the Blender version pin and `asset.generator` string, the determinism caveat, and the operator's box step -- AC2.

**Acceptance Criteria:**
- Given the fixture manifests, when the verify gate runs, then the lib suite and conformance are green with `test_assets` covering every matrix row.
- Given the box (unverifiable-here), when the operator runs `uv run plugins/tk-studio/lib/assets.py greybox --directory <TUA scratch clone>` with a two-entry manifest and imports with `godot --headless --import`, then the `.glb` files import and `check` reports them green; recorded in `kb/asset-ladder.md`.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 4, low 3)
- defer: 1 (medium 1)
- reject: 2 (low 2)
- addressed_findings:
  - `[high]` `[patch]` sphere/capsule extents 1–4 % short of bounds, so `check` failed greybox's own output (both layers) — axes stretched so extents equal bounds; tris ≤ budget; geometry tests across budgets 12–5000 incl. fixture barrel (consult: apply)
  - `[medium]` `[patch]` cube ±x and top/bottom faces sampled only the label's black border (blind) — per-face box projection into the label interior; tested
  - `[medium]` `[patch]` no test exercised real primitive geometry; FakeBlender always wrote a cube (blind) — pure helpers importable without bpy behind `geometry(spec)`; `GeometryTests` added
  - `[medium]` `[patch]` `export()` silently dropped pinned exporter options (blind) — `select_export_options` refuses an unknown core option (`export_format`, `export_yup`, `export_apply`), logs applied/dropped; tested
  - `[medium]` `[patch]` a stale existing label from an earlier run was embedded (edge) — after consult (reject of the keep-and-embed variant): a stale label fails its entry, no Blender call, no `.glb`, bytes unchanged; tested
  - `[low]` `[patch]` exists()-then-os.replace could overwrite a file created in between (edge) — hard-link publish with exclusive-create fallback; tested
  - `[low]` `[patch]` flat capsule (height ≤ width) produced zero-area faces (blind) — single equator ring; tested
  - `[low]` `[patch]` long names overflowed the label border (edge) — glyphs shrink to fit; names over 112 characters refused by `check` on `name`; tested
- rejected:
  - `check` does not gate `origin` — AC2 names budget and bounds as the gate; plan §7 the same
  - schema `tri_budget` > 0 vs `check` < 12 refusal — plan §1 and §6 rule exactly this split

### 2026-10-27 — Review pass (follow-up review)
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` `_publish_new` exclusive-create fallback wrote straight into the final name, so a failed write left a truncated `.glb`/label that later runs skip (blind, edge) — the partial file is unlinked and the error re-raised; never overwrites; tested
  - `[medium]` `[patch]` `mkdtemp` / `spec_path.write_text` OSError escaped `greybox` with no status block, AD-11 (blind) — temp failure is a blocked block (exit 2); a spec-write failure fails that entry and the run continues; tested
  - `[medium]` `[patch]` contract `## Asset manifest` left the greybox row shape and the stale-label behaviour unpinned, which 34.7/34.8 read (blind) — additive 0.1.29 text names the row fields and values, the stale-label rule and the `partial`/exit 1 run result
  - `[low]` `[patch]` an apostrophe in a plain value opened a quote and swallowed the trailing comment (blind) — a quote opens only where a value begins; tested
  - `[low]` `[patch]` box-projected labels read mirrored on two side faces (blind) — `face_uvs` flips `across` on +Y and -X so every side face reads left to right from outside (consult: accept-deviation score 1); tested
  - `[low]` `[patch]` an indentless `assets:` list (PyYAML's default dump) was refused (edge) — column-0 `- ` items under a bare top-level key read as its list; tested
  - `[low]` `[patch]` schema-valid name `-crate` refused by the reader (edge) — a leading `-` refuses only as a sequence indicator; tested

### 2026-10-27 — Review pass (follow-up review 2)
- review content: `git diff dfa1ab25c69c5ce43010b8c9fcfa5346dbe72f6b -- . ':(exclude)_bmad-output'` (the loop's own spec and the orchestrator-owned ledger excluded); both layers ran (M band)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 8 (medium 1, low 7)
- addressed_findings:
  - `[medium]` `[patch]` `greybox` hard-linked Blender's export into the art path without gating it, so an over-budget, off-bounds or malformed `.glb` was placed and then skipped as "file exists" by every later run (blind) — the temp output is run through `facts_of` + `gate` first; a red or unreadable export fails the entry (`gate: …`) and is not placed; the bytes published are the bytes gated; tests for both cases; kb and contract `## Asset manifest` gain one additive clause (0.1.29 unchanged)
  - `[low]` `[patch]` the stale-label check compared compressed PNG bytes, which differ between zlib builds (CPython 3.14 on Windows ships zlib-ng), so an identical label could read `stale` and fail its entry (edge) — `kept` vs `stale` is decided on the decoded image (`_png_image`: IHDR + decompressed IDAT); an undecodable label is `stale` without raising; `label_png` unchanged; tests for recompressed-same-pixels and five malformed labels; contract, kb and docstring wording aligned (same pixels on any machine, same bytes per zlib build)
- rejected:
  - `facts` ignores node transforms and instancing — already on the ledger as DW-74, not re-filed
  - `check` does not gate `origin` — AC2 names budget and bounds as the gate; plan §7; rejected in pass 1 as well
  - a changed category or colour after the `.glb` exists is not reported — AC1's rule is that greybox never touches an existing file; recolouring a placed asset is not behaviour the criteria name
  - orphaned `.glb`/label files in the art path are not reported — not named by the criteria
  - README calls greybox "deterministic" while the box proof is open — the README states AC1's own requirement; the kb carries the caveat as plan §Risks directs
  - schema `tri_budget` > 0 vs `check` < 12 and the 112-character name cap absent from the schema — plan §1/§6 and the 14:36Z consult (schema unchanged) rule this split
  - integral floats (`tri_budget: 500.0`) pass the schema's `integer` but `check` refuses them — stricter refusal, exit 2 naming the field; no misread
  - `-   name: x` (extra spaces after the dash) is refused by the manifest reader — the narrow reader refuses anything outside its subset loudly by design (Code Map); no misread

## Design Notes

- Exit codes: 0 ok, 1 gate red / Blender failure, 2 refusal (playable.py precedent). Status block `status`: `done` | `failed` | `blocked`.
- `check` report entry: `{name, rung, status, file, present, facts|null, verdict: pass|fail|missing, reasons[]}`; `missing` is not a failure (greybox not yet run).
- Blender `--spec` is a JSON file in a temp folder (removed after), keys exactly: `name, category, colour, bounds, origin, collision, tri_budget, label, output`.
- PLANNED DRIFT (score 1): the 34.3/34.4/34.5 stories-line assertions re-pinned for Story 34.6 — affects: none.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_assets tests.test_release_roster tests.test_driver_contract` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: status block `status` is `done | failed | blocked` (Design Notes) / actual: `complete | partial | blocked` / why: `contracts/status-block.schema.json` allows only those values, the conformance runner checks against it, and `playable.py` uses the same set / may affect: 34-8-run-vertical-slice
- planned: bounds axes not specified / actual: `bounds` are glTF axes, Y up (`y` is height); `greybox.py` maps them to Blender X, Z, Y; `facts` and the origin rule use the same convention / why: the gate and the origin labels need one fixed meaning / may affect: 34-7
- planned: spec `output` is the output path / actual: Blender writes into the temp folder, then `assets.py` moves it atomically to `<art_path>/<name>.glb` only if still absent / why: atomic writes; no half-written export in the art path / may affect: none
- planned: `kb/index.md` regenerated, never hand-edited / actual: after regenerating, line 1 restored to `# tk-studio — knowledge base` by hand / why: `kb.py` titles the index from the folder name, which in this worktree is the run id / may affect: none
- planned: stories-line assertions re-pinned for Story 34.6 / actual: done at the three sites / why: planned / may affect: none

DEVIATION SCORE: 1

DRIFT: status block values `complete | partial | blocked`, not the Design Notes' `done | failed | blocked` — status-block.schema.json pins the set — affects: 34-8-run-vertical-slice
DRIFT: manifest `bounds` read as glTF axes (Y up) and mapped to Blender X, Z, Y — the gate and origin rule need one axis convention — affects: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap
DRIFT: greybox exports to a temp folder and moves atomically into the art path — house rule: writes are atomic — affects: none
DRIFT: kb/index.md line 1 restored by hand after regeneration — kb.py titles the index from the worktree folder name — affects: none
DRIFT: test_driver_contract 34.3/34.4/34.5 stories-line assertions re-pinned for Story 34.6 — the stories row gains 34.6 — affects: none

Consult re-score (deviation-gt-0): #2 (axis convention) scored 2, affects 34-7; #1, #3, #4, #5 stay 1. Story deviation score 2. 34-7's `match` reads its axes from `driver-contract.md` `## Asset manifest` (bounds on glTF axes, Y up); 34-8 reads status values from `contracts/status-block.schema.json`.

### pass 2 (2026-10-27, implementer, review patches)

- planned: `greybox.py` guarded so importing it outside Blender fails clearly / actual: imports without Blender (pure geometry helpers, `bpy` imported inside `main()`); running it outside Blender still exits 2 / why: review patch 3 needs the helpers testable / may affect: none
- planned: label per plan §5 / actual: an existing label with different bytes is kept, not embedded; the fresh label from the temp folder is embedded; greybox rows gain `label_state` (`written | kept | stale`) / why: review patch 5 (never touch an existing file) / may affect: 34-7
- planned: two-line label, no length limit / actual: names over 112 characters are a `check` refusal on `name`; schema `name` pattern unchanged / why: review patch 8 / may affect: none
- planned: atomic replace publish / actual: hard-link publish (exclusive-create fallback) / why: review patch 6 / may affect: none

DEVIATION SCORE (pass 2): 1

DRIFT: greybox.py importable without Blender (bpy imported in main) — geometry helpers must be testable in the lib suite — affects: none
DRIFT: greybox rows gain `label_state` and a stale label is kept but not embedded — never touch an existing file while embedding the current colour — affects: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap
DRIFT: asset names over 112 characters refused by check — the 256 px label cannot fit them on two lines — affects: none
DRIFT: outputs published by hard link, not os.replace — closes the window where an existing file could be overwritten — affects: none

### pass 3 (2026-10-27, implementer, consult ruling on the stale label)

Pass 2's stale-label behaviour is superseded by the consult (reject-deviation): an existing `<name>.label.png` with different bytes fails the entry (`action: failed`, `label_state: stale`, reason names the path; no Blender call, no `.glb`, label bytes unchanged); the temp-embed path is removed. `label_state` stays on greybox rows (`written | kept | stale`).

- planned: `test_greybox_never_touches_an_existing_file` seeded a foreign-bytes label / actual: it seeds this manifest's own label bytes; still proves the existing label and `.glb` are untouched / why: foreign bytes are now a stale label that fails the entry / may affect: none

DEVIATION SCORE (pass 3): 0

DRIFT: a stale existing label fails its greybox entry (supersedes pass 2's keep-and-embed) — consult ruling: the on-disk label must equal the embedded one for 34.7's visual gate — affects: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap

### follow-up review pass (2026-10-27, implementer)

- planned: patch instruction "flip `across` on faces whose dominant normal is negative" / actual: `face_uvs` flips +Y and -X / why: for an outside viewer the right vector is (-n)×Z, so the literal rule would mirror the -Y front face; the property (every side face reads left to right from outside) is what the patch asks to test / may affect: none (score 1, consult accepted)

### follow-up review pass 2 (2026-10-27, implementer)

- No deviation. Patches stayed inside Files (`assets.py`, `test_assets.py`, `kb/asset-ladder.md`, `driver-contract.md`); the contract text is additive and the version stays 0.1.29.

DEVIATION SCORE (follow-up review pass 2): 0

## Consult Log

- 2026-10-27T14:25Z — trigger: deviation-gt-0 — question: accept the implementer's five deviations (status-block values, glTF Y-up bounds axes, temp-then-atomic export, kb index title restore, stories-line re-pins) and at what score — ruling: accept-deviation score 2 — do: keep all five as built, no code change; re-score #2 as 2 affecting 34-7, others 1, story score 2; name driver-contract.md `## Asset manifest` as 34-7's axis source and status-block.schema.json as 34-8's — rule candidate: when a spec's Design Notes list a status-block value set, the planner copies it from contracts/status-block.schema.json; any spatial manifest/contract field states its axis convention in the plan's Settled shape
- 2026-10-27T14:30Z — trigger: high-severity-finding — question: sphere/capsule greybox extents 1–4 % short of bounds so check fails greybox's own output; patch or bad_spec — ruling: apply — do: triage as patch; make exported min/max equal bounds exactly with tris ≤ budget (bounds, tolerance, schema unchanged); move pure geometry helpers outside the bpy guard and test extents == bounds and tris ≤ budget across budgets incl. fixture barrel; re-run suite and conformance, fix scores deviation 0 — rule candidate: when a story's generator output must pass the same story's gate, the plan's test list includes a generate-then-gate round trip across the parameter range, and generator geometry helpers stay importable without bpy
- 2026-10-27T14:36Z — trigger: deviation-gt-0 (pass 2) — question: accept pass-2 deviations, esp. a stale existing label kept while a fresh one is embedded (label_state: stale), and the 112-char name cap absent from the schema — ruling: reject-deviation (2 only) — do: on a stale label run no Blender for the entry, write no .glb, row action failed + label_state stale + reason naming the label path (operator removes it); drop the temp-embed path; add the "stale label → entry failed, no .glb, label bytes unchanged" case and test; keep (1), (3), (4) at score 1, schema unchanged, the 112-char cap recorded in the assets.py docstring and kb row; pass scores 1 — rule candidate: when a story writes a file a later story's gate compares against, a mismatch with an existing file fails the entry and the I/O matrix carries the "existing but different" row
- 2026-10-27T14:52Z — trigger: deviation-gt-0 (follow-up review pass) — question: accept `face_uvs` flipping +Y and -X instead of the patch wording's "negative dominant normal" faces — ruling: accept-deviation score 1 — do: keep face_uvs flipping +Y and -X and the left-to-right test; log the drift as score 1; no schema, contract or verb change — rule candidate: patch instructions about geometry or orientation state the property to test, not a sign formula; when the formula disagrees with the property the implementer applies the property and it is not a deviation
- 2026-10-27T15:48Z — operator session (the box step, `unverifiable-here`): `assets.py greybox` on the TUA scratch clone with a two-entry manifest under Blender 5.2.2 LTS (`BLENDER` user variable set), `written: 2` in 11.9 s, `check` `pass: 2` (12 and 400 triangles, bounds and origin exact), a second run into an empty art path the same bytes for all four files, Godot 4.7.2 headless import clean in 4.6 s; `asset.generator` `Khronos glTF Blender I/O v5.2.40`. The record: `kb/asset-ladder.md` §The operator's box step.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of the asset manifest and the greybox rung (`plugins/tk-studio/lib/assets.py` `check | greybox | facts`, `lib/blender/greybox.py`, schema `contracts/asset-manifest.schema.json`, contract 0.1.29 additive). It applied two patches:
- `greybox` now runs Blender's export through the `facts` gate before placing it. A red or unreadable export fails the entry and is not placed, so the next run can retry it.
- The stale-label check compares the decoded image instead of the compressed bytes, so a label written under another zlib build is no longer marked `stale` by mistake.

**Files changed (this pass).**
- `plugins/tk-studio/lib/assets.py`: the export is gated before `_publish_new`. New `_png_image` decoder; `kept` vs `stale` is decided on the decoded image. Module docstring updated to match.
- `plugins/tk-studio/lib/tests/test_assets.py`: four tests (57 in the module). An export failing the gate is not placed. An unreadable export is not placed. A label with the same pixels but other compression is kept. An unreadable label is stale and nothing raises. `FakeBlender` takes an optional `output=`.
- `plugins/tk-studio/contracts/driver-contract.md`: in `## Asset manifest`, a gate-failed export fails the entry and is not placed, and kept/stale is decided on the decoded image. Additive; the version stays 0.1.29.
- `kb/asset-ladder.md`: the gate-failure clause, stale meaning "other pixels", and determinism described as same pixels on any machine and same bytes under the same zlib build.
- `_bmad-output/specs/spec-epic-34/stories/34-6-the-asset-manifest-and-the-greybox-rung-spec.md`: this record.

**Review.** Both layers ran (blind hunter and edge case hunter, opus-5-5, medium), with 10 findings.
- Patches applied: 2 (high 0, medium 1, low 1).
- Deferred: 0. DW-74, node transforms in `facts`, is already on the ledger and was not re-filed.
- Rejected: 8, each with a reason in the Review Triage Log.
- Follow-up review: not recommended (`false`). Score 3×1 + 1×1 = 4 (under 5, no high).

**Verification.** This session ran the spec's commands after both implementer passes, from `plugins/tk-studio/lib`:
- `uv run python -m unittest tests.test_assets tests.test_release_roster tests.test_driver_contract`: 207 tests OK.
- `uv run python -m unittest discover tests`: 2285 tests OK, 2 skipped.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.

**unverifiable-here (operator, on the box).** This step is unchanged from the earlier runs.
1. Run `uv run plugins/tk-studio/lib/assets.py greybox --directory <TUA scratch clone>` with a two-entry manifest and `BLENDER` set.
2. Run `& $env:GODOT --headless --path <godot folder> --import`.
3. Run `assets.py check`. Expect green.
4. Capture a frame through 34.2's harness.
5. Record the result, the Blender version and the `asset.generator` string in `kb/asset-ladder.md`.
6. Check by eye that the labels on all four side faces read upright and unmirrored.

**Residual risks.**
- Blender has never run this code. The exporter option names, face winding, UV orientation as exported, and `.glb` byte determinism are all unproved.
- With the new gate, an exporter that drifts from the bounds by more than 1 % now fails its entry on the box instead of placing a bad file.
- TUA's `art/world/greybox` may sit outside its Godot project folder.
- `facts` ignores node transforms (DW-74, open).

DRIFT: status block values `complete | partial | blocked`, not the Design Notes' `done | failed | blocked` — status-block.schema.json pins the set — affects: 34-8-run-vertical-slice
DRIFT: manifest `bounds` read as glTF axes (Y up) and mapped to Blender X, Z, Y — the gate and origin rule need one axis convention — affects: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap
DRIFT: greybox exports to a temp folder and publishes into the art path by hard link — writes are atomic and never overwrite — affects: none
DRIFT: kb/index.md line 1 restored by hand after regeneration — kb.py titles the index from the worktree folder name — affects: none
DRIFT: test_driver_contract 34.3/34.4/34.5 stories-line assertions re-pinned for Story 34.6 — the stories row gains 34.6 — affects: none
DRIFT: greybox.py importable without Blender (bpy imported in main) — geometry helpers must be testable in the lib suite — affects: none
DRIFT: a stale existing label fails its greybox entry; greybox rows carry `label_state` — the on-disk label must equal the embedded one for 34.7's visual gate — affects: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap
DRIFT: asset names over 112 characters refused by check — the 256 px label cannot fit them on two lines — affects: none
DRIFT: face_uvs flips +Y and -X rather than the patch wording's "negative dominant normal" faces — the literal rule would mirror the -Y front face; consult accepted at score 1 — affects: none

## Reconcile

### 2026-10-27 — adjust-stories

- Score: 2
- Reasoning: Three drifts name later stories and all land on surfaces they read, but each is absorbable by a note: 34.7's `match` normalises kit assets "scaled to the bounds, the origin per the rule" and must use the bounds' glTF Y-up convention that 34.6 fixed (contract `## Asset manifest`); 34.7's visual gate compares against the greybox render, and a stale label now fails its greybox entry (`label_state`); 34.8's host leg runs `check` and `greybox` and reads their status blocks, whose values are `complete | partial | blocked` (status-block.schema.json), not the plan's `done | failed | blocked`. DW-74 (facts ignores node transforms) is open and the deferral itself says it is needed before 34.7 gates third-party files. No acceptance criterion of 34.7 or 34.8 changes; the contract stays 0.1.29, additive.
- Affected: 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap — "normalised through headless Blender (scaled to the bounds, the origin per the rule …) … passed through the `facts` gate and a visual gate" (axis convention, stale label, DW-74 now load-bearing)
- Affected: 34-8-the-run-vertical-slice-job-and-the-engagements-game-path — "the host leg runs … the ladder's `check` and `greybox` (34.6 …)" (status values `complete | partial | blocked`, exit 0/1/2)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap
