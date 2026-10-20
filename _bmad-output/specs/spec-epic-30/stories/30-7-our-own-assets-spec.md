---
title: 'Our Own Assets'
type: 'feature'
created: '2026-10-19'
status: 'done'
baseline_revision: '51d66bbef71592cee7273afc99ae98c2ffae547e'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-30/plans/30-7.md'
warnings: ['oversized']
deferred:
  - summary: >-
      office.json is compared byte-for-byte with LF output, but .gitattributes does not pin it to eol=lf, so a Windows checkout with core.autocrlf=true would make the reproducibility test and --check fail.
    evidence: |-
      .gitattributes:3,7 pin eol=lf only for measurements/*.jsonl and tools/installer/install.*. Story criterion (a): AC1 says the export is reproducible, checked by a test. A fix outside the plan's 17-entry Files list was ruled out by consult (Consult Log). Operator fix: add `apps/studio-web/public/sprites/office.json text eol=lf` to .gitattributes.
    location: >-
      .gitattributes
    severity: medium
---

# Our Own Assets

<intent-contract>

## Intent

**Problem:** The office still draws from Story 30.1's placeholder sheet (extended by 30.4 with a desk and eight shared state sets). The repository does not yet ship its own sprite sheet with a documented pipeline (D6).

**Approach:** The operator ruled option (a) in commit 51d66bb (replan-queue "operator — from 30-6", SPEC Open Question 1). The sources are loop-authored text pixel grids under `apps/studio-web/assets/`. `tools/sprites/export.py` exports them byte-reproducibly into `public/sprites/office.png` plus a Pixi spritesheet JSON atlas. The renderer builds per-role frame sets from the atlas by name. A missing (role, state) falls back to the role's `idle` with a console warning. The placeholder pipeline is deleted, and `kb/studio-web-assets.md` records the result. The change is web-only, with no supervisor or contract change (AD-2).

Story 30.7, verbatim (epics.md:2617-2631), the acceptance criteria to prove:
- **AC1:** **Given** the art tools on the PC (Adobe Creative Cloud or a tool with agentic or MCP support, the operator's choice named in the record) **When** the pipeline is built **Then** `apps/studio-web/assets/` holds the source files and `tools/sprites/` a script that exports the committed sheet `apps/studio-web/public/sprites/office.png` plus its JSON atlas (frame names `<role>.<state>.<n>`, 16 by 16 or 32 by 32 tiles, nearest-friendly, no anti-aliased edges), the export is reproducible (the same source gives the same bytes, checked by a test), and the sheet carries the floor, one desk, and every role of the registry in every office state of §7.3 with at least two frames per looping state
- **AC2:** **Given** the sheet **When** the Office screen uses it **Then** the placeholder sheet of Story 30.1 is deleted, the renderer's frame sets come from the atlas by name, and a missing frame for a (role, state) falls back to the role's `idle` frames with a console warning naming the gap; `kb/studio-web-assets.md` records the tool, the pipeline, the format and the credits (none owed: our own work)

## Boundaries & Constraints

**Always:**
- The operator's ruling (a) governs, verbatim:
  - the sources are text pixel grids under `apps/studio-web/assets/`: one file per sheet region, plus a palette file;
  - the tool of record is the exporter, named in `kb/studio-web-assets.md` together with the format;
  - the exporter **also packs PNG sources**, so an attended tool can re-source any region later without a pipeline change.
- `tools/sprites/export.py` is stdlib-only Python (zlib, struct, binascii, json), run via `uv run --no-project python`.
- The same sources give the same bytes:
  - a fixed deflate level and strategy, and filter 0 on every scanline;
  - RGBA8 with no ancillary chunks;
  - every alpha is 0 or 255;
  - a deterministic frame order: `floor.0`, `desk.0`, then `ROLES` × `OFFICE_STATES` × n;
  - the atlas uses sorted keys, fixed separators and a trailing newline.
- All art lives in `assets/`. The exporter holds no pixels of its own.
- The tile is 16×16, `TILE` stays 16, and `pickZoom` is unchanged.
- Every role in `apps/supervisor/src/registry.ts:19` `ROLES` × every state in `apps/studio-web/src/live/store.ts:19` `OFFICE_STATES` has ≥2 frames (all eight states loop).
- `loadSheet` stays the only non-test `Assets.load(` in `src`. Keep `placeDesks(world, sheet, agents, opts?)`, `setPose` and `deskSetKey`/`syncDesks` unchanged.
- The visible-loop pixel check in `scene.test.ts` is repointed at office.png and its atlas, never deleted.

**Block If:**
- The Files list in plans/30-7.md (17 entries) would grow. HALT `blocked`.
- The host (`verify_host.py`) and the sandbox disagree on the exported bytes. Record it and HALT. Never loosen the test to a pixel compare.

**Never:**
- No third-party pixels or reference packs (D6).
- No change under `apps/supervisor/`, `plugins/tk-studio/contracts/` or `personas.json`.
- No new web dependency.
- No `git push`, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reproducible export | committed `assets/` | two exports are byte-identical and equal the committed png+json; `--check` exits 0 | none |
| Stale outputs | the sources changed, outputs not re-exported | `--check` exits non-zero and names the differing file | message on stderr |
| Coverage gap in sources | a role/state has <2 frames, or a role/state/floor/desk is missing | the export fails, naming the gap | non-zero exit |
| Bad pixel | a grid char not in the palette, a wrong row width or height, or a palette alpha other than 0/255 | the export fails, naming file:line | non-zero exit |
| PNG source region | `assets/<region>.png` in place of its `.txt` (layout in Design Notes) | packed into the same atlas names, deterministically | a malformed PNG or a non-binary alpha fails, naming the file |
| Atlas parse | textures named `<role>.<state>.<n>`, `floor.0`, `desk.0` | `Sheet.roles[role][state]` ordered by n; `frames[state]` = the first ROLES role that has it; `character` = that role's `idle.0` | an unparseable name is ignored with a warning |
| Missing pose | the sheet has the role, not the state | `framesFor` returns the role's `idle` and warns once `<role>.<state>` through an injectable warn | a second call does not warn again |
| Unknown role | the role is absent from `sheet.roles` | the shared `frames[state]` | no warning |

</intent-contract>

## Code Map

- `apps/studio-web/src/renderer/scene.ts` -- `TILE` :13, `SHEET_URL = "sprites/placeholder.png"` :16, `STATE_FRAMES` :18, `Sheet` :20-26, pure `cutSheet` :54-60, `loadSheet` :63-68 (the one `Assets.load(`), `layoutScene` :100 (uses `sheet.floor`/`sheet.character`), `placeDesks` :137, `setPose` :171, `syncDesks` :193. Pixi v8: `Assets.load("sprites/office.json")` resolves a `Spritesheet`, whose `.textures` are keyed by frame name, with the png loaded via `meta.image`.
- `apps/studio-web/src/office/model.ts` -- `FrameSheet<F>{frames, roles?}` :9, `framesFor` :16 (today `roles?.[role]?.[s] ?? frames[s]`; an unknown state reads `offline`).
- `apps/studio-web/src/office/model.test.ts:13-30` -- the "prefers the role's set, else the shared set" case becomes the idle-fallback case.
- `apps/studio-web/src/renderer/scene.test.ts` -- :11 `cutSheet(new Texture().source)`; :14-31 eight sets; `decodeSheet()` :132-154 decodes placeholder.png (filter 0 assumed); :156-181 the visible-loop check per state.
- `apps/studio-web/scripts/make-placeholder.ts` -- the model for the exporter's PNG encoder (node:zlib, CRC32, filter 0). Delete it after porting.
- `apps/studio-web/src/office/OfficeScreen.tsx:181` -- `sheet = await loadSheet()`; touch only if `Sheet` typing needs it.
- `apps/studio-web/package.json:12` -- the `sprites` script. `vite.config.ts:9` -- a comment naming the placeholder. `README.md:10-17,61-62,139` -- placeholder mentions.
- `kb/studio-web-renderer-spike.md:10-12` -- the dated record; add a one-line "retired by 30.7" pointer only.
- `plugins/tk-studio/lib/tests/test_restructure_rehearse.py:23-26` -- the pattern for importing a `tools/` script from the lib suite via `sys.path`.

## Tasks & Acceptance

**Execution:**
- `apps/studio-web/assets/` -- author `palette.txt` and one text-grid file per region (floor, desk, each role) -- AC1 sources (ruling a).
- `tools/sprites/export.py` -- parse the grids (and PNG sources), validate coverage and pixels, and write `office.png` + `office.json`; `--check` compares without writing -- AC1 pipeline.
- `plugins/tk-studio/lib/tests/test_sprites_export.py` -- the matrix rows "Reproducible export" through "PNG source region". The test reads ROLES/OFFICE_STATES from the source files by regex and checks, by decoding the committed png, that every frame is 16×16 inside the sheet and alpha is in {0,255} -- AC1 is proven by a test.
- `apps/studio-web/public/sprites/office.png`, `office.json` -- exported outputs, committed.
- `apps/studio-web/public/sprites/placeholder.png`, `apps/studio-web/scripts/make-placeholder.ts` -- delete -- AC2.
- `apps/studio-web/package.json` -- `sprites` → `uv run --no-project python ../../tools/sprites/export.py`.
- `apps/studio-web/src/renderer/scene.ts` -- `SHEET_URL` → `sprites/office.json`. A pure `sheetFromAtlas(textures, warn?)` replaces `cutSheet`, and `Sheet` gains `roles` -- AC2 by name.
- `apps/studio-web/src/renderer/scene.test.ts` -- the atlas-parse matrix rows. `decodeSheet` and the visible-loop check move to office.png through office.json, per role × state.
- `apps/studio-web/src/office/model.ts` + `model.test.ts` -- the idle fallback, the warning text naming `<role>.<state>`, warn once per gap, and an unknown role -- AC2 fallback.
- `apps/studio-web/vite.config.ts` (comment), `README.md`, `kb/studio-web-renderer-spike.md` (pointer line) -- placeholder references retired.
- `kb/studio-web-assets.md` -- the tool of record (the exporter, per the operator's ruling (a) of 2026-10-19), the pipeline (assets → export.py → png + atlas → `loadSheet`), the format (grid, palette, PNG-source layout, atlas shape), and the credits: none owed, our own work -- AC2 record.

**Acceptance Criteria:**
- Given the committed tree, when `git ls-files apps/studio-web | grep -c placeholder` and `grep -rn placeholder apps/studio-web/src apps/studio-web/package.json` run, then they give 0 and no hits.
- Given the committed tree, when `grep -rn "Assets.load(" apps/studio-web/src | grep -v test` runs, then it gives exactly one hit, in scene.ts, loading `sprites/office.json`.

## Spec Change Log

## Review Triage Log

### 2026-10-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 1, medium 0, low 3)
- defer: 1 (high 0, medium 1, low 0)
- reject: 2 (high 0, medium 0, low 2)
- addressed_findings:
  - `[high]` `[patch]` office.png bytes depended on the zlib build (level 9; zlib-ng on Windows). The exporter now writes stored deflate blocks itself (0x78 0x01, ≤65535-byte blocks, adler32), re-exported; a new test pins the stored-block IDAT (consult ruling).
  - `[low]` `[patch]` framesFor's warning said "showing <role>.idle" when that role has no idle set. The text is now accurate, with a model.test.ts case.
  - `[low]` `[patch]` assets/palette.png passed the unknown-region check but was never read. It is now rejected, naming the file, with a test.
  - `[low]` `[patch]` export test: the coverage-gap case asserts a non-zero exit, and the stale --check asserts a non-zero exit and names both outputs.
- deferred (criterion (a), AC1 reproducibility): office.json has no eol=lf attribute. The fix is outside Files (consult: unverifiable-here host risk).
- rejected: a PNG role row ending at the first transparent tile (the layout the spec's Design Notes define); a role absent from the atlas gets the shared frames without a warning (the spec's I/O matrix row "Unknown role").

### 2026-10-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 3 (high 0, medium 1, low 2)
- addressed_findings:
  - `[low]` `[patch]` export.py let a non-UTF-8 region or palette file escape as an unhandled UnicodeDecodeError: a traceback with no file name, and exit 1, which collides with `--check`'s stale exit. `_read_source` now raises SpriteError `<path>:<line>: not UTF-8 text`, which exits 2. A test covers desk.txt and palette.txt.
- rejected: a role absent from the atlas draws the shared set without a warning (the I/O matrix row "Unknown role": no warning; rejected last pass too); `kb/index.md` not regenerated (outside the plan's 17 Files, which Block If forbids growing, and named by no criterion; already a recorded residual risk); office.json has no eol=lf attribute (a duplicate of this spec's existing deferral, ledger DW-34; not re-filed).

## Design Notes

**The grid format** (ruling a; the implementer may refine the details, which are recorded in the kb):
- `palette.txt` holds one `<char> <RRGGBBAA>` per line, with `.` = transparent.
- A region file holds `[<state>.<n>]` (or `[0]` for floor/desk) headers, each followed by 16 rows of 16 palette chars.
- A shared base plus per-state differences may be written as explicit frames. Keep the files reviewable.

**PNG source:**
- `assets/<region>.png` is used when present instead of `<region>.txt`.
- Floor and desk are one 16×16 tile.
- A role is a grid with rows = `OFFICE_STATES` in order and columns = n. A fully transparent tile ends a row.
- The exporter decodes all five PNG filter types (stdlib zlib).

**The atlas** is Pixi v8 hash form: `{"frames": {"<name>": {"frame": {"x","y","w","h"}, "rotated": false, "trimmed": false, "spriteSourceSize": {"x":0,"y":0,"w","h"}, "sourceSize": {"w","h"}}}, "meta": {"image": "office.png", "format": "RGBA8888", "size": {"w","h"}, "scale": "1"}}`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green, test_sprites_export included
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --no-project python tools/sprites/export.py && git diff --exit-code apps/studio-web/public/sprites/` -- expected: exit 0
- `rm -rf /tmp/v307 && mkdir -p /tmp/v307 && git ls-files -co --exclude-standard apps/studio-web | tar -cT - | tar -xC /tmp/v307 && cd /tmp/v307/apps/studio-web && bun run verify` -- expected: build + vitest green (the in-worktree gate is unverifiable-here: the sandbox refuses symlinks)
- the two grep checks in the Acceptance Criteria
- `uv run python tools/verify_host.py` -- the binding host leg; record it unverifiable-here if it cannot run in the sandbox

**Manual checks (if no CLI):**
- unverifiable-here: the attended look on desktop and iPad (crisp at DPR 1/2/3, every role's loops).

## Deviation Summary

None. No code was touched: the session halted at preflight on the plan's Block If.

### pass 1 (2026-10-20, implementer)

- planned: frames[state] is the first ROLES role that has it (ROLES = registry.ts:19) / actual: scene.ts exports a mirrored `ROLES` constant (same order; the web cannot import across apps); the exporter and the Python test read the real list by regex / why: no cross-app import / may affect: any later story adding a role (update both; the export test turns red first)
- planned: atlas-parse edge cases only / actual: `sheetFromAtlas` also gives a state no role has the shared `idle` set, and throws when floor.0, desk.0 or any idle frames are missing / why: AnimatedSprite cannot take an empty set; spec silent / may affect: none
- planned: `export.py [--check]`, RGBA PNG sources / actual: also hidden `--assets`/`--out` flags (tests), 8-bit RGB PNG read as opaque, an unknown region file fails the export; recorded in the kb / why: testability, stricter sources / may affect: none
- planned: tests per named check / actual: grouped in two classes (Committed, Sources); every named check covered / why: grouping only / may affect: none

DEVIATION SCORE: 1

DRIFT: scene.ts mirrors registry ROLES as a web constant — the web app cannot import apps/supervisor — affects: none
DRIFT: sheetFromAtlas fills a stateless gap with the shared idle set and throws on a missing floor/desk/idle — AnimatedSprite needs a non-empty set — affects: none
DRIFT: export.py gains --assets/--out flags, RGB PNG sources and unknown-region rejection — testability and stricter sources — affects: none
DRIFT: export test grouped into two classes — grouping only — affects: none

### pass 2 (2026-10-20, review patches)

- planned: png deflated with zlib at a fixed level and strategy (spec Always, plan "The png") / actual: the exporter writes the IDAT as stored deflate blocks itself; office.png is 131 KB instead of ~2 KB / why: zlib output differs between builds (zlib-ng on Windows); consult accept-deviation score 1 / may affect: none
- planned: a web ROLES mirror, membership pinned / actual: scene.test.ts also pins the order to the committed atlas's sheet order (consult) / why: frames[state] is the first ROLES role that has it / may affect: none

DEVIATION SCORE: 1

DRIFT: office.png IDAT is hand-written stored deflate blocks rather than zlib at a level — reproducible bytes across zlib builds (consult) — affects: none

## Consult Log

- 2026-10-19T23:54:41Z — trigger: halt — question: is there any recorded operator choice of the art tool (AC1 "the operator's choice named in the record"; SPEC Open Question 1; plans/30-7.md Block If) that lets 30-7 proceed, or must it HALT blocked? — ruling: escalate — do: HALT blocked on 30-7, naming the open replan-queue entry (replan-queue.md:200-205) and SPEC Open Question 1 as the blocker; ask the operator for one of plan 30-7's options (a) tool-neutral loop-authored, (b) an attended tool with PNG sources the operator commits, (c) a named agentic/MCP tool the engine sandbox can reach, recorded as a `ruling:` commit or a status change on that entry; write nothing under apps/studio-web/assets/ or tools/sprites/ until that ruling exists — rule candidate: when a story's plan has a Block If that points at an open `operator`-scope replan-queue entry, halt `blocked` at preflight without a consult unless that entry's Status reads "ruled" or a `ruling:` commit names the story. (observation recorded: ok)

- 2026-10-19T23:57:46Z — trigger: halt — question: the 30-7 spec reads ready-for-dev (an unblock after ruling 51d66bb) but holds no intent contract, ACs, tasks or verification; route to step-03, re-plan as draft, or halt? — ruling: apply — do: set status draft and take step-01's draft route to step-02 Plan (epics.md 30.7 + plans/30-7.md + option (a) ruling), keeping Deviation Summary and Consult Log append-only; the step-02 ready-for-development gate sets ready-for-dev, else HALT blocked 'spec failed ready-for-development standard'; the working-tree ready-for-dev came from an unblock, not planning — rule candidate: in step-01, a ready-for-dev/in-progress spec without Acceptance Criteria/Tasks is treated as draft; an unblock of a story halted before planning sets draft, never ready-for-dev.
- 2026-10-20T00:11:19Z — trigger: deviation-gt-0 — question: accept the implementer's four pass-1 deviations (web ROLES mirror; sheetFromAtlas idle fill/throws; export.py extra flags/RGB/unknown-region; grouped test classes) at score 1? — ruling: accept-deviation score 1 — do: accept all four at score 1; tighten scene.test.ts:35 to assert web ROLES equals the committed office.json role first-appearance order (after floor.0/desk.0), not only the sorted set; rerun bun verify and the lib suite, nothing else — rule candidate: a web mirror of a supervisor constant is score 1 with no consult when a web test pins its order and membership to a committed artifact that a Python test derives from the supervisor source by regex.
- 2026-10-20T00:15:22Z — trigger: high-severity-finding — question: the committed office.png (zlib level 9) and office.json (LF, no eol=lf attribute) may not reproduce byte-for-byte on the Windows host (zlib-ng, autocrlf); patch both (one outside Files), patch one, or leave to verify_host? — ruling: accept-deviation score 1 — do: write the IDAT zlib stream by hand (0x78 0x01, stored blocks ≤65535, BFINAL on last, big-endian adler32), keep raw-bytes assertions, re-export, DEFLATE comment 'stored blocks, implementation-independent'; do not touch .gitattributes — record F2 as an unverifiable-here host risk with the operator fix line `apps/studio-web/public/sprites/office.json text eol=lf`; if verify_host disagrees on bytes, HALT blocked per Block If, never normalise CRLF — rule candidate: plans committing byte-compared generated text list the .gitattributes eol=lf line in Files; byte-reproducible binaries use implementation-independent encoding, not a zlib level.


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review pass on the done Story 30.7 (operator ruling (a)): our own text-grid sprite sources exported by `tools/sprites/export.py` into the committed `office.png` and `office.json`, the renderer building frames from the atlas by name, the idle fallback with a warning, the placeholder retired, and the record in `kb/studio-web-assets.md`. Two layers ran (L band): blind-hunter and edge-case-hunter. One low patch was applied: the exporter now fails cleanly, exit 2 with the file and line named, on a non-UTF-8 source instead of a traceback.

**Files changed (this pass):**
- `tools/sprites/export.py`: `_read_source` decodes the text sources and raises a SpriteError naming `<path>:<line>` on non-UTF-8 bytes. `parse_palette` and `parse_grid` use it. Exported bytes are unchanged.
- `plugins/tk-studio/lib/tests/test_sprites_export.py`: `test_a_non_utf8_region_or_palette_fails_naming_the_file`, run on a temp copy of the assets.

**Review findings:** 1 patch applied (low), 0 deferred, 3 rejected (unknown-role silence is spec-defined; `kb/index.md` is outside Files; office.json eol duplicates the existing deferral DW-34). Follow-up review recommended: false. Patched: high 0, medium 0, low 1; score 3×0 + 1×1 = 1.

**Verification:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: 1434 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `uv run --no-project python tools/sprites/export.py && git diff --exit-code apps/studio-web/public/sprites/`: exit 0.
- Web: `bun run verify` in a /tmp/v307 copy: 8 files, 111 tests passed.
- `git ls-files apps/studio-web | grep -c placeholder`: 0. `grep -rn placeholder apps/studio-web/src apps/studio-web/package.json`: no hits. `Assets.load(` outside tests: one hit, `scene.ts:100`.
- The implementer's repro: 0xff appended to a copied `desk.txt` gives exit 2 with `desk.txt:20: not UTF-8 text`.
- unverifiable-here, for the operator to run: `uv run python tools/verify_host.py`, the binding host leg. If it disagrees on the exported bytes, the spec's Block If applies.

**Residual risks:**
- office.json eol on a Windows autocrlf checkout. This is ledger DW-34; operator fix: `apps/studio-web/public/sprites/office.json text eol=lf` in `.gitattributes`.
- `kb/index.md` does not list `studio-web-assets.md`. The fix is `uv run plugins/tk-studio/lib/kb.py index --directory .`, which is outside this story's Files.
- The attended look on desktop and iPad has not been checked.

## Reconcile

- 2026-10-20 — score 1; reconcile not required.
- Gate: Part A not-required; Part B epic complete: no next story (30-7 accepted)
