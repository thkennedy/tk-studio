---
id: TASK-43
title: Churn-Normalized Verify Step
status: To Do
assignee: []
created_date: '2026-08-08 04:22'
labels:
  - ST-043
milestone: Proposal Becomes Change
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
As an operator adopting upstream releases,
I want base-update's verify step to revert the known no-op churn classes before committing the install diff,
So that the integration PR shows only the genuine upstream diff (AD-1's reviewable motion) and a reinstall at pin proves itself a no-op.

**Acceptance Criteria:**

**Given** `base_update.py`'s install step completing over an existing install
**When** the verify step examines the working tree before the install-diff commit
**Then** files whose old and new content are equal after normalizing the named churn classes — line-endings-only rewrites, and list-valued config options re-serialized as JSON strings that parse back to the old list (`_bmad/**` config yaml only) — are reverted, per-class revert counts land in the result JSON, and any file carrying a real change stays fully untouched; unknown churn is never guessed at — it shows in the diff (D2)

**Given** a same-version re-affirmation run whose install diff is empty after normalization
**When** the motion completes
**Then** it ends complete reporting the verified no-op — no branch pushed, no PR opened (D3) — and driver-contract 0.1.10 lands the clarification sentence on the §2 base-update row (doc + README + `test_driver_contract.py` pin move together, the 0.1.8 precedent)

**Given** the normalizer's equivalence function
**When** the unit suite runs
**Then** `base_update.py`'s first unit tests cover endings-only reverted, re-serialization reverted, mixed real-change untouched, and unknown-churn untouched
**And** a live same-version re-affirmation run over this repo showing a churn-free outcome is the acceptance evidence
<!-- SECTION:DESCRIPTION:END -->
