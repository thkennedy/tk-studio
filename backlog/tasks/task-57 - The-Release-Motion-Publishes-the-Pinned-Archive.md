---
id: TASK-57
title: The Release Motion Publishes the Pinned Archive
status: Done
assignee: []
created_date: '2026-08-10 08:37'
updated_date: '2026-08-10 09:21'
labels:
  - ST-057
milestone: The Release Ships a Pinned Archive Backstop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator running the release motion,
I want the motion to tag, build, verify, publish, and record the archive backstop in one discipline,
So that every release ships a SHA-256-pinned offline artifact that cannot silently rot.

**Acceptance Criteria:**

**Given** a release at version X
**When** the motion runs
**Then** `claude plugin tag` mints `tk-studio--v<X>` validating plugin.json and marketplace lockstep, the release-archive tool (stdlib-only Python, gh for transport) builds the plugin-tree zip deterministically at the release commit via `git archive`, computes its SHA-256, uploads it as the tag's release asset, re-downloads the published asset, and verifies the digest matches before recording — a mismatch fails the motion loud

**Given** `released-roster.json` as the gate's third file
**When** the release records the backstop
**Then** the roster entry carries `archive: {url, sha256}` for the released version — the roster is the backstop manifest and no fourth gate file is minted

**Given** the lib suite
**When** it runs
**Then** the roster guard also pins the archive record — present for every recorded version at or beyond the discipline's 0.2.6 floor, `sha256` a 64-hex string, `url` naming the version's release tag — red on a missing or malformed record, and the full suite is green

**Given** an air-gapped or git-less machine
**When** the kb runbook is followed
**Then** it documents the sneakernet path end to end — authenticated asset download on a connected machine, out-of-band SHA-256 verification, consumption via seed-dir (persistent) or `--plugin-dir <zip>` (session) — with the marketplace archive-source entry named as the seam that activates on public hosting

**Given** the epic's changes land
**When** the release motion runs 0.2.5 → 0.2.6 through the new discipline
**Then** the first tagged release ships — tag, verified asset, roster archive record, gate ×3 in lockstep — the scoped plugin update lands the new version, and the four planes check clean
<!-- SECTION:DESCRIPTION:END -->
