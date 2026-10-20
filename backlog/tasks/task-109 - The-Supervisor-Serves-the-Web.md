---
id: TASK-109
title: The Supervisor Serves the Web
status: Done
assignee: []
created_date: '2026-10-19 17:32'
updated_date: '2026-10-19 19:32'
labels:
  - ST-109
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the supervisor to serve the built web on its own origin behind the session cookie,
So that the web needs no second server and no second sign-in (§6.3, D7).

**Acceptance Criteria:**

**Given** `apps/studio-web/dist` present beside the supervisor (built by the release motion's `--app studio-web`, or by hand from the checkout)
**When** a signed-in browser requests `GET /app` or any path under it
**Then** the supervisor serves the file from `dist` with the right content type, or `index.html` for a path with no file (the single-page fallback), never a path outside `dist` (`..` and absolute paths answer 404), and every answer carries the session's cache headers; a request with no session answers the sign-in page of Story 29.1 with a return to the requested path; `GET /` keeps serving the read-only page until Story 30.6 moves the home

**Given** no `dist` beside the supervisor
**When** `GET /app` is requested
**Then** the answer is 503 `WebNotBuilt` naming the build command, and the read-only page's header says the web is not built; `bun test` covers the directory route, the fallback, the traversal refusal and the missing build

**Given** the release motion
**When** `tools/release_archive.py run --app studio-web --version X.Y.Z` runs
**Then** it builds `dist` from the tag, zips it, publishes and records it under the roster's `studio-web` component as the other apps are, and the installer's supervisor slot unpacks it beside the supervisor; the runbook §4 gains the web's row
<!-- SECTION:DESCRIPTION:END -->
