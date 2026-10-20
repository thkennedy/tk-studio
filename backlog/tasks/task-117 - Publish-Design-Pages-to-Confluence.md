---
id: TASK-117
title: "Publish: Design Pages to Confluence"
status: To Do
assignee: []
created_date: '2026-10-20 00:35'
labels:
  - ST-117
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the owner,
I want the brief, the GDD, the scope of work and the decisions published to the project's Confluence space, and epics and stories promoted to Jira as today,
So that the plan is readable from any device without the studio site (§6.8 b).

**Acceptance Criteria:**

**Given** the planning artifacts under `_bmad-output/planning-artifacts/` and the design folder
**When** `plansync.py sync` runs with the Jira binding (today's promote) and the new `publish` verb runs
**Then** each design page is created or updated in the space's folder by a stable title, with a provenance footer naming the source file and the commit, Markdown converted to Confluence storage format (headings, lists, tables, code, links; images attached), and unchanged pages are skipped by content hash; epics and stories promote as before, now with a link to their design pages; the plan stays canonical (AD-5): nothing from Confluence changes an entity field

**Given** the publish
**When** it is tested
**Then** the lib suite covers the conversion, the hashing, the idempotence and the provenance with a fake Confluence REST; the contract's §2 names `publish` (additive)
<!-- SECTION:DESCRIPTION:END -->
