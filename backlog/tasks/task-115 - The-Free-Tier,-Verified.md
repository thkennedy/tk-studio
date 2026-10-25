---
id: TASK-115
title: The Free Tier, Verified
status: Done
assignee: []
created_date: '2026-10-20 00:35'
updated_date: '2026-10-24 17:53'
labels:
  - ST-115
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want the free plans' limits checked before anything is built on them,
So that the project template, the statuses and the sync-back are designed against what Jira and Confluence Free actually allow (§6.8 "verify before building", decisions Appendix C).

**Acceptance Criteria:**

**Given** an Atlassian site on the free plans with the owner seat and the agent user seat (created by Tim, attended; the story names the exact steps and the two API tokens' environment variables, never the values)
**When** the research runs (the `tk-studio-research` surface, a digest to disk)
**Then** `kb/atlassian-free-tier.md` records, with the source and the date: whether a Free Jira project allows the two custom statuses and a workflow transition between them; the project-permission model available (who can transition, comment, attach); the REST API's rate limits and the token's scope; Confluence Free's space, page and attachment limits; and whether the Rovo MCP server adds anything the REST API with an API token does not (the adapter uses REST today); each finding ends in "fits", "fits with a workaround (named)" or "does not fit", and a "does not fit" on the statuses or the API halts the epic with the alternative named

**Given** the record
**When** the story closes
**Then** `decisions.md` Appendix C's open questions are answered by reference to it, and the stories below carry the workarounds it names (a story-level note, never a silent change)
<!-- SECTION:DESCRIPTION:END -->
