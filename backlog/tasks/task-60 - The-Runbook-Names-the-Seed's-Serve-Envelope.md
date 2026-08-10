---
id: TASK-60
title: "The Runbook Names the Seed's Serve Envelope"
status: Done
assignee: []
created_date: '2026-08-10 19:08'
updated_date: '2026-08-10 19:47'
labels:
  - ST-060
milestone: Three Small Truths from the Boundary Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator provisioning an offline machine,
I want the runbook's persistent path to state the proven serve split,
So that offline installs are planned on what a seeded session actually does, not on hedged pre-probe wording.

**Acceptance Criteria:**

**Given** the 2026-08-10 probe results recorded in the archive-install envelope kb
**When** the runbook's seed-mechanism section is read
**Then** it states the serve split plainly — a seeded session serves plugins on explicit `/plugin:skill` invocation only (zero network), never advertises them to the session, and the management verbs still do not read the seed — sufficient for driver-contract headless drives, insufficient for attended discovery, which needs `--plugin-dir` or a real install — and cross-links the envelope record for the probe evidence

**Given** the story's docs-only scope
**When** it lands
**Then** no code, schema, or contract file changes — the kb index regenerates only if frontmatter moved
<!-- SECTION:DESCRIPTION:END -->
