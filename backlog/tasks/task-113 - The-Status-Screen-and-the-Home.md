---
id: TASK-113
title: The Status Screen and the Home
status: To Do
assignee: []
created_date: '2026-10-19 17:32'
labels:
  - ST-113
milestone: "Studio Web v0: Office, Board, Status"
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the web to be what I land on, with a Status screen that shows what the read-only page shows,
So that one home serves every device and the old page stays as the fallback without JavaScript (§6.3)

**Acceptance Criteria:**

**Given** the web built and the account signed in
**When** `GET /` is requested with a session
**Then** the supervisor answers the web's `index.html` (the Office screen opens by default; the last screen is remembered per browser) and the read-only page moves to `GET /status`, linked from the web's Status screen and answered without JavaScript as today; with no session, `GET /` is the sign-in page; the bearer API and every `/jobs`, `/runs`, `/agents`, `/office` and `/board` route are unchanged

**Given** the Status screen
**When** it renders
**Then** it shows the queue's counts and live runs, the agents, the office section, the ledger's last events and the supervisor's version, each from the surfaces the web already reads (no new surface), and refreshes from the store rather than polling

**Given** the move of the home
**When** the story closes
**Then** the contract's §1 names `GET /status` as the read-only page's address and `GET /board` among the web surfaces (0.1.25, additive), the runbook §4 and the supervisor README say the web is the home and how to build it, and the status page's tests and the conformance suite's status drive follow the new address
<!-- SECTION:DESCRIPTION:END -->
