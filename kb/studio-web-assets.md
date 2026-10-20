---
title: Studio web assets — the office sprite sheet, its tool, pipeline, format and credits
description: Story 30.7's record. The office sheet is our own pixels — loop-authored text pixel grids in apps/studio-web/assets/, exported byte-reproducibly by tools/sprites/export.py to public/sprites/office.png plus a Pixi v8 spritesheet atlas, loaded by loadSheet and built per role by name. The tool of record (the operator's ruling (a) of 2026-10-19), the grid, palette and PNG-source formats, the atlas shape, the idle fallback, and the credits (none owed).
rank: 62
---

# Studio web assets (Story 30.7, 2026-10-19)

The office screen draws from our own sprite sheet (D6: no third-party pixels, no reference packs).
It replaced Story 30.1's placeholder sheet, which is deleted.

## The tool of record

**The exporter, `tools/sprites/export.py`, over loop-authored text pixel grids.** This is the
operator's ruling (a) of 2026-10-19 (commit 51d66bb, SPEC Open Question 1): the sources are text
pixel grids under `apps/studio-web/assets/`, one file per sheet region plus a palette file, written
by the loop; no Adobe CC, agentic or MCP art tool is involved. The exporter also packs PNG sources,
so an attended tool (Adobe CC, Aseprite or any other) can re-source any region later by committing
`<region>.png` beside or in place of `<region>.txt`, with no pipeline change.

## The pipeline

```
apps/studio-web/assets/*.txt|*.png
  -> tools/sprites/export.py          (stdlib Python: zlib, struct, binascii, json)
  -> apps/studio-web/public/sprites/office.png + office.json   (committed)
  -> loadSheet() in src/renderer/scene.ts   (Assets.load("sprites/office.json"), the one loader)
  -> sheetFromAtlas(textures)          (per-role frame sets by name)
  -> framesFor(sheet, role, state)     (src/office/model.ts; the idle fallback)
```

Commands (from the repository root; `bun run sprites` in `apps/studio-web` runs the first):

```bash
uv run --no-project python tools/sprites/export.py          # write office.png and office.json
uv run --no-project python tools/sprites/export.py --check  # exit 1 naming each stale output; writes nothing
```

The roles come from `apps/supervisor/src/registry.ts` `ROLES` and the states from
`apps/studio-web/src/live/store.ts` `OFFICE_STATES`, read by regex, so a new role or state fails the
export (naming the gap) until its frames exist. `plugins/tk-studio/lib/tests/test_sprites_export.py`
(the lib suite) proves the export reproducible against the committed bytes and the coverage; the
vitest `scene.test.ts` decodes office.png through the atlas and checks every role's every state loops
visibly in front of the desk. The web mirrors `ROLES` in `scene.ts` (never imported across apps).

## The format

**Palette** (`assets/palette.txt`): one `<char> <RRGGBBAA>` per line, an optional trailing `# note`;
`#` lines and blank lines are ignored. Every alpha is `00` or `ff` (no anti-aliased edges). `.` must
be defined and transparent. A char is defined once.

**Grid region** (`assets/<region>.txt`): `[<header>]` lines, each followed by exactly 16 rows of 16
palette chars (`#` lines and blank lines ignored). The regions are `floor` and `desk` (one frame,
`[0]`) and every registry role (`[<state>.<n>]`, `n` from 0, contiguous, at least two per state:
all eight office states loop). Each frame is written out in full; a role's file keeps one body and
varies it per state (the markers above the head and the pose pixels), so a review reads it as a diff.
An unknown region file, an unknown state, a duplicate header, a char not in the palette, a wrong
row width or row count fails the export naming `file:line`.

**PNG region** (`assets/<region>.png`, used instead of `<region>.txt` when present): 8-bit RGBA or
RGB, not interlaced, any of the five filter types; every alpha 0 or 255. Floor and desk are one
16x16 tile. A role is a grid with one 16-pixel row per office state in `OFFICE_STATES` order and one
16-pixel column per frame; a fully transparent tile ends a row. A malformed PNG or a non-binary alpha
fails naming the file.

**The sheet** (`public/sprites/office.png`): 16x16 tiles, 16 per row, in a fixed order: `floor.0`,
`desk.0`, then roles (registry order) x states (`OFFICE_STATES` order) x n. RGBA8, IHDR + one IDAT +
IEND (no ancillary chunks), filter 0 on every scanline. The IDAT zlib stream is written by the exporter
itself as stored (uncompressed) deflate blocks — header `78 01`, blocks of at most 65535 bytes, an
Adler-32 trailer — so no zlib build's compressor is involved (CPython on Windows ships zlib-ng, whose
compressed output differs): the same sources give the same bytes on every host.

**The atlas** (`public/sprites/office.json`): Pixi v8 spritesheet JSON, hash form —
`{"frames": {"<name>": {"frame": {"x","y","w","h"}, "rotated": false, "trimmed": false,
"spriteSourceSize": {"x":0,"y":0,"w","h"}, "sourceSize": {"w","h"}}}, "meta": {"image":
"office.png", "format": "RGBA8888", "size": {"w","h"}, "scale": "1"}}` — sorted keys, indent 1,
separators `,` / `: `, ASCII, a trailing newline. Frame names: `floor.0`, `desk.0`,
`<role>.<state>.<n>`.

**In the renderer.** `sheetFromAtlas` puts `<role>.<state>.<n>` into `roles[role][state]` ordered by
`n`; the shared `frames[state]` (for a role the sheet does not carry) is the first registry role
that has the state; the spike's lone `character` is that role's `idle.0`; a name that does not parse
is ignored with a console warning. `framesFor` answers a role's own set; when the sheet carries the
role but not the pose it answers the role's `idle` set and warns once per sheet and gap on the
console, naming `<role>.<state>`.

## The art

One body per role, told apart by hair, shirt and an accessory: orchestrator (black hair, purple
shirt, a headset), session (brown hair, blue shirt), implementer (navy cap, orange shirt), reviewer
(blonde hair, green shirt, glasses), consult (grey hair, teal shirt, a bow tie), advisor (white hair
and beard, maroon shirt), planner (ginger hair, pink shirt). The states, two frames each: offline
(eyes shut, a rising sleep mark), idle (a blink), thinking (growing thought dots), reading (a book's
page turns), typing (hands up in turn), running (motion lines and a stride), waiting-for-human (a
blinking yellow `!`), blocked (a blinking red cross). The desk stands half a tile low in front of
its character, so every loop changes a pixel the desk leaves visible.

## Credits

None owed: our own work. Every pixel is in this repository's `apps/studio-web/assets/`, authored by
the loop under the operator's ruling (a); no third-party pixels, packs or references were used.

## unverifiable-here

The attended look on the desktop and the iPad (crisp edges at device pixel ratio 1, 2 and 3, every
role's loops) is not yet done.
