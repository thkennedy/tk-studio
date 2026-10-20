---
id: TASK-118
title: Sync-Back on a Timer
status: To Do
assignee: []
created_date: '2026-10-20 00:35'
labels:
  - ST-118
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an agent working on a story,
I want the issue's status, its comments, its attachments as links and the owner's Confluence pages in local memory,
So that no agent queries Atlassian live for context (§6.8 c and e, D9).

**Acceptance Criteria:**

**Given** a project set up and the shipped job `atlassian-sync-back` (cron, every 10 minutes by default; `durable`)
**When** it runs
**Then** it pulls each tracked issue's status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`), its comments (append-only into `_bmad-output/tracking/<key>/comments.jsonl`: `{issue, author: owner | agent, body, mentions[], created, source: jira}`), its attachments as links, and every owner-authored Confluence page into `kb/confluence/<slug>.md` with a provenance header (read-only sources: a local edit is overwritten and reported); nothing local is promoted back; the run's record names counts and the newest comment seen

**Given** the sync-back
**When** it is tested
**Then** the lib suite covers the status mapping, the append-only comment log (a comment seen twice is written once), the attachment links, the page mirror and the overwrite report, with a fake REST; `tk-studio-activate`'s drift check gains a `tracking` plane that says when the last sync-back ran and whether the binding is reachable
<!-- SECTION:DESCRIPTION:END -->
