---
id: TASK-58
title: The Handoff Budget Measures What Lands
status: Done
assignee: []
created_date: '2026-08-10 19:08'
updated_date: '2026-08-10 19:47'
labels:
  - ST-058
milestone: Three Small Truths from the Boundary Loop
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator relying on the 16 KB handoff ceiling,
I want the enforced budget to measure the exact bytes the workspace write lands,
So that a handoff that passes the check is the handoff on disk — never a larger artifact wearing a smaller number.

**Acceptance Criteria:**

**Given** a handoff assembled by `write_handoff`
**When** the budget check sizes it
**Then** the measured size is the byte length of the serialization `_atomic_write_json` lands — `indent=2`, `ensure_ascii=False`, trailing newline — and the result's `bytes` equals the written `handoff.json`'s on-disk size exactly, multibyte content included

**Given** the ST-9.2 ruling
**When** the fix lands
**Then** `MAX_HANDOFF_BYTES` stays 16384 and the 16-delta cap is untouched — the budget does not grow, it tells the truth

**Given** the lib suite
**When** it runs
**Then** a case pins measured == on-disk bytes for a landed handoff carrying non-ASCII content, a case pins the refusal of a handoff whose compact form fits the budget but whose written form exceeds it (the skew shape itself), and the full suite is green
<!-- SECTION:DESCRIPTION:END -->
