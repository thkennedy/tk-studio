---
id: TASK-143
title: The Asset Manifest and the Greybox Rung
status: Done
assignee: []
created_date: '2026-10-27 04:08'
updated_date: '2026-10-27 16:06'
labels:
  - ST-143
milestone: The Vertical-Slice Pack
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the loop,
I want every asset a slice needs declared in one manifest and the ladder's first rung (greybox) produced from it deterministically,
So that a slice is playable with placeholders before any art exists, and every later asset replaces a placeholder that passed the same gates.

**Acceptance Criteria:**

**Given** `assets/manifest.yaml` (its schema `plugins/tk-studio/contracts/asset-manifest.schema.json`: name, category, triangle budget, bounds in metres, origin rule, collision shape, licence tag, rung, status)
**When** `plugins/tk-studio/lib/assets.py check --directory <project>` runs
**Then** it validates the manifest and reports every entry's rung and status; `assets.py greybox --directory <project>` writes, for every entry without a file, a greybox mesh (primitives sized to the bounds, the origin per the rule, a flat material in the category's colour with the name baked into a label texture) as glTF under the project's art path (TUA: `art/world/greybox/`, following `art/ART-BIBLE.md`) through headless Blender on the host (`blender -b --python plugins/tk-studio/lib/blender/greybox.py`), deterministic (the same manifest gives the same bytes) and never touching an existing file; each verb ends in a status block (AD-11)

**Given** a produced mesh
**When** `assets.py facts <file>` runs
**Then** it reports the triangle count, the bounds, the origin, UV presence and the material count from the glTF itself (stdlib, no Blender), and `check` fails any entry whose facts break its budget or bounds (the `facts` gate); the lib suite covers the schema, the gate and the greybox verb with a fake `blender`; conformance adds the manifest check; the README and the kb name the ladder
<!-- SECTION:DESCRIPTION:END -->
