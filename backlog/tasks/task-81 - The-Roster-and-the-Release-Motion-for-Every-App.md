---
id: TASK-81
title: The Roster and the Release Motion for Every App
status: To Do
assignee: []
created_date: '2026-10-14 19:41'
updated_date: '2026-10-14 20:00'
labels:
  - ST-081
milestone: One Installer Writes the Studio
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the maintainer,
I want one committed roster per channel naming the compatible set of app releases with checksums, and one release script that cuts any app by its prefix,
So that the installer has a single source of truth and no app ever owns the repository's "latest".

**Acceptance Criteria:**

**Given** `tools/installer/rosters/stable.json` and `latest.json`
**When** they are read
**Then** each carries `schema`, `channel`, `requires` (at least `claude-code` as a version floor), and `components`, where every component is optional per channel (an absent component means "not shipped in this channel", which the installer and `doctor` report, never an error); a present `plugin`, `supervisor`, `studio-web` or `cli` entry is `{tag, url, sha256}` with all three required, and `uv` and `bun` are `{version, sha256: {<platform target>: <hex>}}` with one digest per upstream platform asset (Windows x64 at minimum); a lib guard pins the shape, refuses a present entry with a missing or malformed digest by name, never accepts a placeholder or a fabricated value, and asserts the plugin entry agrees with `released-roster.json` and the plugin's `plugin.json` version (the existing gate ×3 becomes gate ×4); at the first cut the roster carries `plugin`, `uv` and `bun`, and `stable.json` equals `latest.json` (ruled 2026-10-14)

**Given** `tools/release_archive.py`
**When** it is run with `--app <plugin|supervisor|studio-web|cli>`
**Then** it builds the deterministic zip (or wheel, for `cli`) from that app's subtree at the `<prefix>--vX.Y.Z` tag, publishes it with `gh release create --latest=false`, re-downloads and verifies the digest, and records `{tag, url, sha256}` under the right roster component; the plugin's motion is unchanged in effect; `make_latest: false` is asserted by the lib suite against a fake `gh`

**Given** the supervisor repository, which has no tags today
**When** the story closes
**Then** the story provides the exact commands for the operator to cut `supervisor--v0.1.0` from its `main` and publish the asset (the script runs against that checkout until EP-31), the engine never cuts or pushes a tag on another repository, and the roster schema accepts a `supervisor` entry whose URL is on another repository, named in the entry's `source` field; the entry itself is added by the operator step once the asset exists, and the story does not wait for it (ruled 2026-10-14)

**Given** the lib suite and conformance
**When** the story closes
**Then** both are green, and the roster guard runs in the drift check's plugin plane (Story 25.3 wires the rest)
<!-- SECTION:DESCRIPTION:END -->
