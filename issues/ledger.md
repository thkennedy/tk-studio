# Issues Ledger

The studio's living defect record — consolidated from the merged measurement
data in `measurements/` by `tk-studio-consolidate` (ST-7.2, AD-12), leading to
specific fixes (the O1 revision channel).

## Discipline

- **Rows update in place, never delete.** Ids are stable `ISS-NNN`, assigned
  in order, never reused. A superseded finding is corrected with an edit,
  never erased.
- **Ownership per column:** the consolidator owns Evidence and Updated, and
  writes Issue, Expected vs Actual, Fix candidate, and Key at creation; it
  upgrades a Fix candidate only while the cell still holds a value it wrote
  itself — a hand-edited candidate is never overwritten. Operators own Sev
  and Status after creation and may refine any prose column.
- **Key** is the machine cluster key — do not edit it; it is how a rerun
  finds the row to update in place.

## Vocabulary

- **Severity:** High (breaks an invariant or blocks work) | Medium (degrades
  work, has a workaround) | Low (annoyance / cosmetic).
- **Status:** Open | Mitigated (worked around, root cause lingers) | Resolved
  | Wontfix.

## Ledger

<!-- newest at bottom; never delete a row; update Status in place -->

| ID | Sev | Status | Issue | Expected vs Actual | Evidence | Fix candidate | Key | Opened | Updated |
|----|-----|--------|-------|--------------------|----------|---------------|-----|--------|---------|
