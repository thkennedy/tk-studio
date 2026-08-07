---
id: TASK-38
title: Promotion Gate — PR Membrane
status: To Do
assignee: []
created_date: '2026-08-07 04:34'
labels:
  - ST-038
milestone: Research Becomes Knowledge
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator,
I want promotions drafted from the routing doc into `kb/` on a branch with PR review as the gate,
So that only a human writes canonical knowledge (D3), through the studio's proven membrane (AD-12).

**Acceptance Criteria:**

**Given** the `tk-studio-knowledge` skill's promote-draft verb and a rendered routing doc
**When** promotion drafting runs
**Then** drafted `kb/` changes land on a feature branch as ordinary kb files (no new frontmatter keys; `scope:` stays reserved — AD-8) and a PR opens; nothing auto-applies

**Given** a promotion attempt without a routing doc
**When** the verb runs
**Then** it refuses as a named rejection (conformance refusal drive)

**Given** a merged promotion PR
**When** the event is emitted
**Then** exactly one `knowledge-promotion` taxonomy event lands in the ledger, sole emitter the promotion skill (D4), taxonomy extended in the same 1.7.0 bump
<!-- SECTION:DESCRIPTION:END -->
