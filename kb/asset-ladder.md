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
2. **cc0** (Story 34.7): a matched asset from a local mirror of CC0 kits, normalised through headless
   Blender to the same bounds, origin and budget.
3. **generated** (Story 34.7): a generator call, only when the owner paid for it on purpose (a credit cap).

`rung` is the rung the entry stands on; `status` is `placeholder` while the greybox is in place,
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
```

The file of an entry is derived, never declared: `<art_path>/<name>.glb`, where the art path is the
config's `assets.art_path` (default `art/greybox`; The Universe Awaits uses `art/world/greybox`, following
its `art/ART-BIBLE.md`). The default colours are `prop #8a8a8a`, `character #d98c3f`, `environment
#5b8c5a`, `vehicle #4a78b5`, `ui #c7b84a`, `fx #9a5bb5`; none is magenta, the judge's missing-texture
signal. The reader is `assets.py`'s own, narrow on purpose: exactly this subset (a list of mappings and
`{x:, y:, z:}` flow maps, which the studio's `miniyaml.py` refuses), and a refusal for anything else.

## The verbs

All three are `uv run plugins/tk-studio/lib/assets.py <verb>`, stdlib only, and end in the status block
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
