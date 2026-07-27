---
id: TASK-17
title: Read-Only Project Detection
status: Done
assignee: []
created_date: '2026-07-27 03:35'
updated_date: '2026-07-27 06:30'
labels:
  - ST-017
milestone: The Studio Knows Your Project
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator onboarding a brownfield repo,
I want the studio to detect what the project is with evidence and a confidence floor,
So that recommendations are grounded and never silently guessed.

**Acceptance Criteria:**

**Given** a project root
**When** detection runs
**Then** weighted markers (files, manifests, VCS type) score candidate project types; below the confidence floor the result is "unknown — ask", never a guess (dps detector discipline)
**And** detection performs zero writes and lists the evidence behind every scored marker
<!-- SECTION:DESCRIPTION:END -->
