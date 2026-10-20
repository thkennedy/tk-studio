---
id: TASK-116
title: Project Setup From a Template
status: To Do
assignee: []
created_date: '2026-10-20 00:35'
labels:
  - ST-116
milestone: Tracking on Atlassian and the Inbox
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As the operator,
I want onboarding a project to create its Confluence space and its linked Jira project from a studio template,
So that every studio-managed project has the same folders, the same statuses and the same two users (§6.8 a).

**Acceptance Criteria:**

**Given** a registered project, the site's URL and the two tokens in the environment
**When** `tk-studio-onboard` is asked to set up tracking (a new optional step, refused with a named reason when the tokens are absent)
**Then** the planning adapter's Jira binding creates the Jira project from the template (key from the project id, issue types epic and story, the workflow with `To Do`, `In Progress`, `Blocked - Awaiting User`, `Block Resolved`, `Done`), the linked Confluence space with the folder structure for the design pages (brief, GDD, scope of work, decisions, records), the saved filter "Needs you" (`status = "Blocked - Awaiting User" ORDER BY priority DESC, updated ASC`), and records the keys and ids under `.tk-studio/config.yaml`'s planning binding; every step the API cannot do on the free plan (31.1's findings) is printed as an exact, numbered instruction for the owner and the run ends `partial` naming them, never `complete`

**Given** a project set up
**When** setup runs again
**Then** it is idempotent: existing space, project, statuses and filter are recognised by key and left as they are, and the result names what it found; `bun test`-free: the lib suite covers the template, the idempotence and the refusals with a fake Atlassian REST
<!-- SECTION:DESCRIPTION:END -->
