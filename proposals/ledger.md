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
| PROP-001 | Medium | Draft | Upstream bmad-method 6.10.0 installer, on --yes reinstall over an existing install, re-serializes list-valued module config options as JSON strings (e.g. | 1× observation from tim-Tim-PC (2026-07-27) ↔ ISS-001 | churn must be reverted or normalized after verify. | unspecified | obs:upstream-bmad-method-6.10.0-installer-yes-reinstall-98dd56 | 2026-07-27 | 2026-07-27 |
| PROP-002 | Low | Draft | ST-4.4 live verification emit | 1× observation from tim-Tim-PC (2026-07-27) |  | unspecified | obs:st-4.4-live-verification-emit-238ac3 | 2026-07-27 | 2026-07-27 |
| PROP-003 | Low | Draft | CLI JSON prints crash on cp1252 Windows consoles when planning titles carry non-ASCII (json.dumps ensure_ascii=False + no stdout reconfigure); | 1× observation from tim-Tim-PC (2026-08-06) | plansync/migrate fixed with sys.stdout.reconfigure(utf-8) in main() — same pattern should be swept across every lib/*.py and scripts/*.py CLI (AD-11 headless-clean) | lib/*.py, scripts/*.py | obs:cli-json-prints-crash-cp1252-windows-4b3cd5 | 2026-08-06 | 2026-08-06 |
| PROP-004 | Low | Draft | AD-13 drift-check plugin plane verifies catalog lockstep (repo plugin.json vs marketplace.json) but not harness loadability: on this machine the plugin was never installed into Claude Code (installed… | 1× observation from tim-Tim-PC (2026-08-06) | plugin plane should also probe harness-level installation/loadability. | tk-studio-connector | obs:ad-13-drift-check-plugin-plane-verifies-catalog-ff11aa | 2026-08-06 | 2026-08-06 |
| PROP-005 | Low | Draft | AD-11 headless discipline gap: driving tk-studio-detect via 'claude -p /tk-studio:tk-studio-detect' with default permissions, the skill's uv/python tool calls were denied ('requires approval'); | 1× observation from tim-Tim-PC (2026-08-06) | skill-instruction hardening + a denied-permissions case in the conformance suite. | tk-studio-detect | obs:ad-11-headless-discipline-gap-driving-tk-studio-detect-5ceb0d | 2026-08-06 | 2026-08-06 |
| PROP-006 | Medium | Draft | First conformance-through-connector run (driver contract section 8, ClaudeOS MCP connector as driver, 2026-08-06): 38 checks across 14 surfaces surfaced a skill-discipline gap - tk-studio-measure-pus… | 1× observation from tim-Tim-PC (2026-08-06) ↔ ISS-002 |  | tk-studio-measure-push | obs:first-conformance-through-connector-run-driver-contract-section-9f835b | 2026-08-06 | 2026-08-06 |
