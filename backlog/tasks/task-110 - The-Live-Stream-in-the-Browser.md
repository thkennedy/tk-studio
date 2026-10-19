---
id: TASK-110
title: The Live Stream in the Browser
status: To Do
assignee: []
created_date: '2026-10-19 17:32'
labels:
  - ST-110
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator watching the office,
I want the web to hold one event stream per tab that survives sleeps and backgrounding,
So that what the office shows is what the supervisor knows, on desktop and on the iPad (§6.3).

**Acceptance Criteria:**

**Given** a signed-in tab
**When** the web mounts
**Then** it opens one `EventSource` on `GET /office/events` (Story 29.3's stream), applies the `event:snapshot` first and every `office.agent`, `office.progress` and `office.run` delta after it into one client store, and reconnects with `Last-Event-ID` after a drop so no delta is lost or applied twice (the store ignores an id at or below the last applied)

**Given** no event for 15 seconds, or the tab returning from the background (`visibilitychange` to visible)
**When** the watchdog fires
**Then** the stream is closed and reopened with the last id, the HUD shows "reconnecting" until the snapshot arrives, and the store's state is never cleared in between (iPad Safari backgrounds streams the way iOS does)

**Given** the store
**When** it is tested
**Then** vitest covers the snapshot, each delta kind, a duplicate delivery, a gap filled by a resume, and the watchdog's reopen, with a fake `EventSource`
<!-- SECTION:DESCRIPTION:END -->
