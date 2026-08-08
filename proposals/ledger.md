# Proposals Ledger

The studio's living record of candidate changes drafted from observed toil —
derived from the merged measurement data in `measurements/` by
`tk-studio-evolve` (ST-040, AD-8/AD-12). Proposals are documents only (D1):
adoption and implementation stay human-initiated; an adopted proposal becomes
ordinary planned work.

## Discipline

- **Rows update in place, never delete.** Ids are stable `PROP-NNN`, assigned
  in order, never reused. A superseded proposal is Declined with an edit,
  never erased.
- **Ownership per column:** the drafter owns Evidence, Opened, and Updated —
  both stamps derive from evidence-event dates, never the wall clock — and
  writes Proposal, Candidate change, Affected surfaces, Impact, and Key at
  creation;
  it upgrades a Candidate change only while the cell still holds a value it
  wrote itself — a hand-edited candidate is never overwritten. Operators own
  Impact and Status after creation and may refine any prose column.
- **Key** is the machine cluster key — do not edit it; it is how a rerun
  finds the row to update in place.
- **Cross-links:** where a proposal's evidence twins an issues-ledger row
  (an observation and a report describing the same find), Evidence names the
  ISS id.

## Vocabulary

- **Impact:** High (evidence spans machines) | Medium (repeated evidence or
  an issues-ledger twin) | Low (a single observation).
- **Status:** Draft | Under-review | Adopted | Declined.

## Ledger

<!-- newest at bottom; never delete a row; update Status in place -->

| ID | Impact | Status | Proposal | Evidence | Candidate change | Affected surfaces | Key | Opened | Updated |
|----|--------|--------|----------|----------|------------------|-------------------|-----|--------|---------|
