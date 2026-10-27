---
title: The asset ladder — the manifest, the greybox rung and the facts gate (Story 34.6)
description: Story 34.6's record. How a slice declares its assets once in assets/manifest.yaml, how lib/assets.py check, greybox and facts work, the ladder (greybox, then cc0, then generated, a placeholder kept until its replacement passes the same gates), the Blender version pin and its asset.generator string, the determinism caveat, and the operator's box step on The Universe Awaits.
rank: 65
scope: project
---

# The asset ladder (Story 34.6)

Epic 34's Story 34.6 gives a slice one declaration of the assets it needs and a way to be playable before
any art exists. The manifest names every asset; the ladder's first rung, the greybox, makes each one exist
as a placeholder through headless Blender on the host; the `facts` gate checks every file against its
budget and bounds. The rulings behind the shape are the operator's plan
(`_bmad-output/specs/spec-epic-34/plans/34-6.md`, §Settled shape 1 to 9); the contract text is the driver
contract's `## Asset manifest (0.1.29, Story 34.6)` section.

## The ladder

An asset climbs three rungs, and a rung is only ever replaced by one that passes the same gates:

1. **greybox** (this story): a primitive sized to the bounds, the origin per the rule, a flat material in
   the category's colour with the name baked into a label texture. Always available, costs nothing.
2. **cc0** (Story 34.7, `match`): a matched asset from the box's mirror of CC0 kits, normalised through
   headless Blender to the same bounds, origin and budget.
3. **generated** (Story 34.7, `generate`): a Meshy text-to-3D call, only when the owner paid for it on
   purpose (a credit cap); off by default.

`rung` is the rung the entry is assigned to; `status` says which file is in place (a `rung: cc0` entry
with `status: placeholder` still stands on the greybox): `placeholder` while the greybox is in place,
`candidate` once a later rung produced a replacement that has not passed both gates (the `facts` gate here
and the visual gate of 34.7), `accepted` once it has. The placeholder stays in place until its
replacement passes; nothing is ever removed for a candidate that failed.

## The manifest

`assets/manifest.yaml` (the project config's `assets.manifest`), schema
`plugins/tk-studio/contracts/asset-manifest.schema.json`:

```yaml
schema: 1
categories:            # optional overrides of the default palette, "#rrggbb"
  prop: "#8a8a8a"
camera: {yaw: 45, pitch: 30}   # optional (34.7): the visual gate's view in degrees, pitch in [-89, 89]
assets:
  - name: crate-small  # [a-z0-9-]+, unique, the file stem
    category: prop     # prop | character | environment | vehicle | ui | fx
    tri_budget: 500    # an integer, at least 12 (a cube)
    bounds: {x: 0.5, y: 0.5, z: 0.5}   # metres, glTF axes: y is up
    origin: base-center   # base-center | center | base-min-corner
    collision: box        # none | box | capsule | sphere | mesh
    licence: greybox      # greybox | cc0 | cc-by | generated | proprietary
    rung: greybox         # greybox | cc0 | generated
    status: placeholder   # placeholder | candidate | accepted
    source: ""            # provenance for cc0 and generated; empty on greybox
    tags: [wooden, box]   # optional (34.7): match tags for the cc0 rung, each [a-z0-9-]+; default []
    prompt: "a small wooden crate"   # optional (34.7): read only on the generated rung
```

The file of an entry is derived, never declared: `<art_path>/<name>.glb`, where the art path is the
config's `assets.art_path` (default `art/greybox`; The Universe Awaits uses `art/world/greybox`, following
its `art/ART-BIBLE.md`). The default colours are `prop #8a8a8a`, `character #d98c3f`, `environment
#5b8c5a`, `vehicle #4a78b5`, `ui #c7b84a`, `fx #9a5bb5`; none is magenta, the judge's missing-texture
signal. The reader is `assets.py`'s own, narrow on purpose: exactly this subset (a list of mappings, the
`{x:, y:, z:}` and top-level `camera: {yaw:, pitch:}` flow maps, and `tags: [a, b]` flow lists of plain
scalars, which the studio's `miniyaml.py` refuses), and a refusal for anything else.

## The verbs

All six verbs (`check`, `greybox` and `facts` here; `mirror-index`, `match` and `generate` in the Story
34.7 sections below) are `uv run plugins/tk-studio/lib/assets.py <verb>`, stdlib only, and end in the status block
(`intent: assets`; exit 0 ok, 1 gate red or a Blender failure, 2 refusal):

- `check --directory <project>`: validates the manifest (a refusal names the entry and the field) and
  reports every entry's rung, status and facts. A present file failing its budget or a bound by more than
  1 % turns the run red; an absent file is `missing`, not a failure. `check` is an engine verify command:
  it needs no Blender and runs in the sandbox.
- `greybox --directory <project>`: runs on the host. For every entry whose `.glb` is absent it writes the
  label PNG `<art_path>/<name>.label.png` (256x256, the category colour, a 4 px black border, the name in
  a 3x5 font, two lines when long) and runs
  `<blender> -b --python plugins/tk-studio/lib/blender/greybox.py -- --spec <json>`, one call per asset.
  Blender is `--blender`, else `BLENDER`, else `blender` on PATH. It never overwrites an existing `.glb`
  or label. A label left by an earlier run with other pixels (a changed category or colour) is `stale`:
  Blender is not run for that entry, no `.glb` is written, the label stays as it is, and the entry fails
  naming the label the operator must remove first (PNG bytes are deterministic per zlib build, so the
  comparison is on the decoded image). A Blender output failing the `facts` gate (over budget, off
  bounds or unreadable) fails the entry and is not placed, so the next run tries again. `--wall` bounds the whole run (default 600 s). A name
  longer than the label's two lines (112 characters: two lines of 56 glyphs at scale 1) is a `check`
  refusal on `name`.
- `facts <file>`: reads the `.glb` itself (no Blender) and reports the triangles, the bounds, the origin,
  UV presence and the material count.

The greybox primitive follows `collision`: `box`, `none` and `mesh` give a cube (12 triangles; a greybox
never carries a mesh collider), `sphere` a UV sphere and `capsule` a capsule whose segments are reduced
until they fit `tri_budget`.

## The CC0 mirror and `match` (Story 34.7)

The mirror is a folder on the box, never project layout: `--mirror`, else the `TK_ASSETS_MIRROR` user
variable (read like the key: `HKCU\Environment`, then the process env, so a User variable set below is
seen without a new terminal), else `C:\agent-work\assets` when it exists. It holds one folder per kit (`kenney-<kit>`,
`quaternius-<kit>`, `polyhaven-<kit>`), each with the kit's licence file at the kit root (`LICENSE*` or `LICENCE*` in any case, or a
`*license*.txt` or `*licence*.txt`) and the `index.json` that
`uv run plugins/tk-studio/lib/assets.py mirror-index --kit <dir> --category <cat> [--licence cc0]` writes
(`{schema: 1, kit, licence, licence_file, assets: [{path, category, tags[]}]}`, sorted by path, the same
kit giving the same bytes). An index `path` that is absolute or has a `..` segment is a refusal naming
the kit and the path, as is one with a backslash (not a posix path: run `mirror-index` on the kit). The
`.glb`, `.gltf`, `.fbx` and `.obj` files are indexed; their tags are the
lowercase tokens of the path's folders and stem (camelCase split, digits dropped). `.blend` files are not
indexed, only counted in the result's `skipped`. A kit without a licence file is refused. Downloading the
kits is the operator's step; the engine never downloads.

```powershell
[Environment]::SetEnvironmentVariable("TK_ASSETS_MIRROR", "C:\agent-work\assets", "User")
uv run plugins/tk-studio/lib/assets.py mirror-index --kit C:\agent-work\assets\kenney-<kit> --category prop
```

`match --directory <project>` takes every entry with `rung: cc0` and `status: placeholder | candidate`.
An entry may carry `tags: [wooden, box]`; a kit asset of the same category scores the size of
`(tag tokens ∪ name tokens) ∩ asset tags`, at least 1 (each tag tokenised as the index's tags are:
`street-lamp` is `street` and `lamp`, `barrel2` is `barrel`), ties to the higher score, then the kit name, then the
path. No mirror: the run is `complete`, every cc0 entry `skipped: no mirror`. An explicit `--mirror` naming
a missing folder is a refusal (exit 2). A missing `TK_ASSETS_MIRROR` folder, or a missing default folder,
ends `complete` with each cc0 entry `skipped` and the reason given. No greybox `.glb`: skipped,
`run greybox first`. No match: `unmatched`, the placeholder kept (not a failure). A stale greybox label
fails the entry as `greybox` does.

## The gates and the placement (Story 34.7)

Both later rungs normalise the replacement through
`<blender> -b --python plugins/tk-studio/lib/blender/normalise.py -- --spec <json>` (import by extension,
every transform applied, one mesh, decimated to `tri_budget`, scaled to the bounds, the origin per the rule,
exported with greybox's options) to `<art_path>/.candidates/<name>.glb` (a dot folder, so Godot skips it).
The `facts` gate runs on it, then the visual gate: `lib/blender/render.py` renders the greybox and the
candidate with Workbench (flat, one colour, transparent film, 128x128, orthographic, the manifest's
`camera: {yaw, pitch}`, default `{yaw: 45, pitch: 30}`, framed on the entry's bounds) to
`.candidates/<name>.greybox.png` and `.candidates/<name>.render.png`.

| Visual gate | Threshold | Constant |
| --- | --- | --- |
| coverage: the share of the greybox's silhouette G the candidate's C covers (C ∩ G over G) | at least 0.25 (the planner's 0.6 until the box run below) | `VISUAL_COVERAGE_MIN` |
| fill: the candidate's silhouette over the 128² frame (not a blank render) | at least 0.005 | `VISUAL_FILL_MIN` |

The silhouettes are the renders' alpha > 0; a render without an alpha channel has none and fails the gate.

The coverage floor was retuned from the planner's 0.6 to 0.25 on the box (the record below: Kenney's lamp post,
bench and pine measure 0.38, 0.52 and 0.34 against their box greyboxes); the fill floor stays.
Since `normalise.py` scales every candidate to the entry's bounds, the coverage of a thin or non-box asset
(a lamp post, a chair, a tree) against a `collision: box` greybox is roughly its fill of that box, so
such an asset can sit well below 0.6 and stay `candidate`.

Only when both gates pass, and only after the manifest write-back lands, does the candidate replace
`<art_path>/<name>.glb` (`os.replace`); a write-back that fails leaves every placeholder untouched and
every candidate in `.candidates/` (those entries `failed`, the run `partial`).
An accepted row whose manifest write-back fails ends action `failed` with `not placed: the manifest was not rewritten`. A replace failure after the write-back rolls the entry's lines back: a compensating write-back returns its `status`, `licence` and `source` lines to their prior bytes (an inserted `source` line removed), the candidate stays in `.candidates/`, the row is `failed` and the run `partial`; a compensating write that fails is added to the row's reason.
Otherwise the entry
becomes `status: accepted` with `licence: cc0` and `source: <kit>/<path>` (or `licence: generated`,
`source: meshy:<task id>`). A failed gate keeps the placeholder's bytes, sets `status: candidate` and
lists the reasons. A Blender or normalise failure is action `failed`: the run ends `partial` (exit 1)
and the entry's `status` is left unchanged. The verbs rewrite only those `status`, `licence` and `source` lines; the rest of the
manifest keeps its bytes. `facts` reads node transforms (DW-74), so a kit file's scaled or instanced nodes
are judged in world space.

## The generated rung (Story 34.7): off until the owner turns it on

`generate --directory <project> --run-id <id>` takes every entry with `rung: generated` and `status:
placeholder | candidate`; the entry's `prompt` (default the name's words, the category, `low poly game
asset`) goes to Meshy's text-to-3D preview, the mesh is generated in the provider's cloud (nothing
generates on the host), downloaded, then normalised and gated as above. It is off by default. To turn it
on, the owner sets both:

1. the cap, in Meshy credits, in the project's `.tk-studio/budget-bands.yaml`:

   ```yaml
   assets:
     credit_cap: 100   # per generate invocation; the 34.8 host leg calls generate at most once per run
   ```

2. the key, as a User environment variable by name, never in a file:

   ```powershell
   [Environment]::SetEnvironmentVariable("TK_ASSETS_MESHY_KEY", "<the Meshy API key>", "User")
   ```

Without the cap `generate` refuses naming `assets.credit_cap`; without the key it refuses naming
`TK_ASSETS_MESHY_KEY`; both before any call or write. Before each call, when the credits spent plus the
per-task charge (`MESHY_CREDITS_PER_TASK`, 20) would pass the cap, that entry and every later one is
`not-run: credit cap`. Once a provider has reported a charge above the estimate, the check uses the highest
charge reported in the invocation instead; a reported charge counts only when it is a number > 0, else
the estimate is recorded with `estimated: true`. After a call leaves the credits spent at or over the cap,
every later entry is `not-run: credit cap`; the pre-check uses the estimate, so a call priced above the
estimate can overshoot by at most one call, and when it does the run ends `partial` with a reason naming the
overshoot. Every call, failed ones included, is one `asset-generation` line in the ledger
(`{run_id, asset, provider, task_id?, credits, estimated?, state, reason?}`); a line that does not land
ends the run `partial` naming the entry, and every later entry is `not-run: ledger unwritable`, with no
further call. The key never appears in output, a file, the ledger or argv.

## The Blender pin and determinism

The box runs **Blender 5.2** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, the runbook's
`BLENDER` user variable; 5.2.2 or newer, since 5.2.1's bundled NumPy broke headless glTF export). The
exporter runs with fixed options (GLB, no copyright, no extras, Y up, modifiers applied, no animation,
lights or cameras), and the `.glb` carries the exporter's generator string in `asset.generator`
(`Khronos glTF Blender I/O v<exporter version>`); that string is part of the version pin: a different
Blender writes a different string and may write different bytes.

Determinism is defined in two layers. The label PNG is the studio's own bytes: the same manifest gives
the same pixels on any machine, and the same PNG bytes under the same zlib build. The `.glb` is the same bytes for the same manifest under the same Blender
version; if the exporter turns out to vary bytes across runs (buffer padding, accessor order), the
promise narrows to the same `facts` and the same label PNG, and this record says so after the box run.

## The operator's box step (unverifiable in the sandbox)

The engine never runs Blender. The box proof is the operator session's step, asked through the story's
consult log:

```powershell
[Environment]::SetEnvironmentVariable("BLENDER", "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe", "User")
# a TUA scratch clone with a two-entry assets/manifest.yaml and assets.art_path: art/world/greybox
uv run plugins/tk-studio/lib/assets.py greybox --directory <TUA scratch clone>
& $env:GODOT --headless --path <the clone's Godot project folder> --import --quit
uv run plugins/tk-studio/lib/assets.py check --directory <TUA scratch clone>
```

Expected: two `.glb` files and two label PNGs under `art/world/greybox/`, Godot imports them without an
error, and `check` reports both entries `pass`. Record here: the Blender version line, the
`asset.generator` string, whether a second `greybox` into an empty art path gives the same `.glb` bytes,
and the `check` output.

Status: **run on the box on 2026-10-27 (15:4xZ) by the operator session, green.** The TUA scratch clone
`C:\agent-work\scratch\tua-playable` (branch `assets/greybox-trial`, nothing committed: the slice's manifest
is the vertical-slice epic's to write) carried a two-entry manifest, `dorm-desk` (prop, box, 1.2 × 0.75 × 0.6 m,
budget 500) and `student-stand-in` (character, capsule, 0.5 × 1.7 × 0.3 m, budget 400), with
`--art-path art/world/greybox`.

- Blender: `Blender 5.2.2 LTS (hash d13f752e3b9c built 2026-09-15 01:37:04)` through the `BLENDER` user
  variable (set on the box that day); `asset.generator` in both files: `Khronos glTF Blender I/O v5.2.40`.
- `check` before: `missing: 2`, status `complete`. `greybox`: `written: 2`, 11.9 s for the run (Blender 2.7 s
  per asset); the artifacts `dorm-desk.label.png` (721 bytes), `dorm-desk.glb` (2,896 bytes),
  `student-stand-in.label.png` (859 bytes), `student-stand-in.glb` (31,508 bytes).
- `check` after: `pass: 2`. `dorm-desk`: 12 triangles, bounds 1.2/0.75/0.6, min (−0.6, 0, −0.3), max
  (0.6, 0.75, 0.3), origin `base-center`, UV present, 1 material. `student-stand-in`: 400 triangles (the
  capsule's segments reduced to the budget exactly), bounds 0.5/1.7/0.3, min (−0.25, 0, −0.15), max
  (0.25, 1.7, 0.15), origin `base-center`, UV present, 1 material. `facts` on each file reports the same.
- Determinism, the strong layer holds: a second `greybox` into an empty art path (`art/world/greybox-2`)
  gave the same bytes for all four files (sha256 `df0cc519…` / `c569144e…` for the two `.glb`, `b86048c7…` /
  `5c7e0e01…` for the two labels), so under Blender 5.2.2 the `.glb` is the same bytes for the same manifest.
- Godot 4.7.2 Mono (`$env:GODOT`, `--headless --path game --import --quit`): both files imported in 4.6 s
  with no error; the importer wrote `<name>.glb.import` and extracted the embedded label as
  `<name>_<name>.png` (+ `.import`) beside each file, with the `.scn`/`.ctex` pairs under `.godot/imported/`.
  TUA's `art/world/greybox` sits outside the Godot project (`game/`), as `art/ART-BIBLE.md` wants for the
  working area: the trial copied the `.glb` files under `game/art/greybox-trial/` for the import and removed
  them after. A slice that loads greyboxes in the game promotes them into the content folder the E9 stories
  own (the manifest's `art_path` stays the working area), and the importer's sidecars land there — four
  files per asset.

## The operator's box step for Story 34.7 (unverifiable in the sandbox)

Asked through the story's consult log, as for 34.6:

1. Mirror one Kenney kit under `C:\agent-work\assets\kenney-<kit>` (with its licence file) and run
   `assets.py mirror-index` on it.
2. On a TUA scratch clone with one cc0 entry, run `assets.py greybox`, then `assets.py match`.
3. `& $env:GODOT --headless --import`, then `assets.py check`: green.
4. Run `match` on at least one non-box asset too (a thin one, such as a lamp post, against its
   `collision: box` greybox) and note its measured coverage and fill beside the box asset's, so the
   retune of the thresholds above is informed by both.
5. Optional, only with a cap and the key set: one `generate` call, its ledger line read back.
6. Record here: the kit, the match, the coverage and fill the gate measured for the box and the non-box
   asset (and any retuned threshold), the Godot import, and for the optional call the credits Meshy charged.

Status: **run on the box on 2026-10-27 (17:5xZ to 20:1xZ) by the operator session, with the fixture kit.** No
CC0 kit was on the box and a web download is Tim's call (downloading the kits is the operator's step), so the
mirror is `C:\agent-work\assets\fixture-crate`: the conformance fixture kit (`LICENSE.txt`,
`Models/crateWooden.glb`, 936 bytes) plus a synthetic thin lamp post built in Blender for step 4
(`Models/lampPost.glb`: a 0.1 m cylinder 2.8 m tall with a 0.3 m head, 56 triangles). `mirror-index --category prop`
indexed both (`assets: 2`; tags `crate`/`models`/`wooden` and `lamp`/`models`/`post`). `TK_ASSETS_MIRROR` stays
unset: the default folder resolved, which is how 34.8's host leg calls `match`.

- The box asset, `storage-crate` (prop, box 0.6 × 0.6 × 0.6 m, budget 500, tags `wooden`, `crate`, rung cc0), on
  the TUA scratch clone's trial manifest (`C:\agent-work\scratch\tua-playable`, branch `assets/greybox-trial`,
  nothing committed): `greybox` wrote it in 2.6 s; `match` accepted it in 10.1 s (normalise and the two renders,
  about 3.4 s each under Blender 5.2.2): the normalised candidate 12 triangles, bounds 0.6/0.6/0.6, min
  (−0.3, 0, −0.3), max (0.3, 0.6, 0.3), origin `base-center`, UV, 1 material; **coverage 1.0, fill 0.1428**; the
  placeholder replaced (1,868 bytes) and the manifest rewritten to `licence: cc0`, `status: accepted`,
  `source: fixture-crate/Models/crateWooden.glb` with every other line's bytes kept. `check` after: `pass: 3`
  (the two 34.6 entries and the crate). Godot 4.7.2 headless `--import` (the files copied under `game/` for the
  test, as in 34.6) reimported `storage-crate.glb` clean in 4 s.
- The non-box asset, `lamp-post` (prop, `collision: box` 0.4 × 3.0 × 0.4 m, budget 400, tags `lamp`, `post`):
  `match` found `lampPost.glb` (score 2), normalised it (56 triangles, the bounds exact) and the visual gate
  measured **coverage 0.2841, fill 0.012**: `candidate`, the placeholder's bytes kept, `status: candidate`, the
  run `partial` (exit 1). The thin post scaled into its box greybox covers about the share of the box its
  silhouette fills, as predicted above.
- **Re-measured on a real kit (20:4xZ, on Tim's OK to download one):** the Kenney Graveyard Kit 5.0 (CC0,
  `kenney_graveyard-kit_5.0.zip`, 3.6 MB from kenney.nl) mirrored as `C:\agent-work\assets\kenney-graveyard-kit`
  (`Models/` holds the 91 `.glb` of its `GLB format` folder, `License.txt` at the root; `mirror-index --category prop`:
  `assets: 91`), the synthetic lamp post removed from `fixture-crate`. Three entries on the trial manifest, each
  `collision: box` with the kit file's own proportions (normalise scales non-uniformly): `lamp-post` (0.4 × 2.4 ×
  0.9 m, tags `lightpost`, `single`) matched `Models/lightpost-single.glb` (score 2, 352 triangles); `chair`
  (0.8 × 0.5 × 0.45 m, tag `bench`) matched `Models/bench-damaged.glb` (score 1: the tie with `bench.glb` fell to the
  path order, 240 triangles); `tree` (1.2 × 2.3 × 1.35 m, tag `pine`) matched `Models/pine-crooked.glb` (score 1, the
  same tie rule, 336 triangles). `greybox` wrote the three in one run; `match` took 29 s for the three (normalise
  and two renders each) and the gate measured **lamp post coverage 0.3792, fill 0.0287; bench 0.5196, 0.067; pine
  0.3357, 0.0438** — every real asset `candidate` under the 0.6 floor, the renders correct (the box greybox framed,
  the asset inside it: a thin post, a bench with gaps, a conical tree). With the crate (1.0) and the synthetic pole
  (0.28) that is five points: coverage of a real asset scaled into its box greybox is its fill of that box, 0.3 to
  0.5 for ordinary props, so the floor is a mis-framed-or-wrong-shape check, not a shape-fidelity gate.
  **Retuned: `VISUAL_COVERAGE_MIN = 0.25`** (this record's PR; the tests, the contract and the table above follow),
  which accepts all five measured assets and still fails a blank or mis-framed render (`SMALL_RENDER` in the suite
  is 0.024). A per-entry override and a collision-aware rule stay open for the EP-34 retro if a slice needs them.
  Re-run under the retuned floor: the three accepted, placed, the manifest rewritten (`source:
  kenney-graveyard-kit/Models/<file>`), `check` pass 6 of 6, Godot 4.7.2 headless import clean.
- Step 5 (`generate`) was not run: no `assets.credit_cap` and no `TK_ASSETS_MESHY_KEY` on the box, by design.
