---
id: TASK-107
title: The Contract Names the Web as a Consumer and the Runbook Follows
status: Done
assignee: []
created_date: '2026-10-17 21:14'
updated_date: '2026-10-18 06:25'
labels:
  - ST-107
milestone: One Account, the Registry, the Projection
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As a driver author,
I want the driver contract to name the studio web as a consumer and the supervisor's new surfaces as supervisor surfaces,
So that AD-2 holds: the plugin publishes the contract, the supervisor owns the account, the registry and the projection (spec §6.1).

**Acceptance Criteria:**

**Given** `plugins/tk-studio/contracts/driver-contract.md`
**When** the story closes
**Then** a minor bump (the next after Story 28.6's) names the studio web among the consumers in §1 and documents, as supervisor surfaces consumed by the web and never plugin surfaces, the account (`POST /auth/account`, `POST /auth/signin`), the registry (`GET /agents`) and the projection (`GET /office`, `GET /office/events`, the three `office.*` event kinds and the eight states); nothing in the plugin's own surfaces changes; conformance is green and the lib suite is green

**Given** the operator's runbook and the supervisor's README
**When** the story closes
**Then** runbook §4.5 (the smoke test) signs in with the account and keeps the token path for `curl`; §4.2's table drops the OAuth rows and names nothing new that is a secret (the account record is the store's); §7's smoke table gains the `/agents` and `/office` answers; the README's API table and environment table match the code; `tk-studio doctor` is unchanged
<!-- SECTION:DESCRIPTION:END -->
