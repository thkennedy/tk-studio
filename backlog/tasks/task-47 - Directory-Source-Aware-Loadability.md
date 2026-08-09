---
id: TASK-47
title: Directory-Source-Aware Loadability
status: To Do
assignee: []
created_date: '2026-08-09 05:23'
labels:
  - ST-047
milestone: The Drift Check Tells the Truth
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator whose harness serves the plugin from a directory-source marketplace,
I want a dangling `installPath` to stop reporting as drift while every skill demonstrably loads,
So that the drift check does not cry wolf after each version bump until an install-flow run happens to repopulate the cache.

**Acceptance Criteria:**

**Given** a version-matched harness entry whose `installPath` does not exist on disk
**When** the marketplace source for the plugin is a local directory that carries the plugin at that same version
**Then** the plugin plane reports ok, its detail naming directory-source serving — and a genuinely evicted cache with no such source directory still reports drift (the probe's regression test reproduces the ST-045 record shape: v0.2.0 entry, unmaterialized cache path, source dir present)

**Given** the upstream half of PROP-017 (the v2 install record updated to a path never materialized)
**When** this story lands
**Then** no upstream filing occurs — reproduction past CLI 2.1.201 and the filing itself stay operator-gated (D4 posture), the studio-side fallback standing on its own
<!-- SECTION:DESCRIPTION:END -->
