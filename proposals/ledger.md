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
| PROP-001 | Medium | Adopted | Upstream bmad-method 6.10.0 installer, on --yes reinstall over an existing install, re-serializes list-valued module config options as JSON strings (primary_platform [a,b] becomes a quoted string) and rewrites installed files with LF endings — no-op git churn after every verify run. | 1× observation from tim-Tim-PC (2026-07-27) ↔ ISS-001 | Teach tk-studio-base-update's verify step to auto-normalize the known churn classes (list re-serialization, LF rewrites) before diffing, and file the re-serialization defect upstream with bmad-method. Implemented 2026-08-08 as EP-011 (ST-043): normalizer + step 4.5 in base_update.py (PR #27, contract 0.1.10), pin-bump PR #28 (tea v1.21.7, bmad-loop v0.9.1); acceptance = live same-version re-affirmation ended verified-no-op (250 reverts, all five classes, no branch/no PR). Upstream filing held at D4 — draft committed 60a2bf9. | tk-studio-base-update | obs:upstream-bmad-method-6.10.0-installer-yes-reinstall-98dd56 | 2026-07-27 | 2026-07-27 |
| PROP-002 | Low | Declined | ST-4.4 live verification emit | 1× observation from tim-Tim-PC (2026-07-27) |  | unspecified | obs:st-4.4-live-verification-emit-238ac3 | 2026-07-27 | 2026-07-27 |
| PROP-003 | Low | Adopted | CLI JSON prints crash on cp1252 Windows consoles when planning titles carry non-ASCII (json.dumps ensure_ascii=False + no stdout reconfigure); | 1× observation from tim-Tim-PC (2026-08-06) | plansync/migrate fixed with sys.stdout.reconfigure(utf-8) in main() — same pattern should be swept across every lib/*.py and scripts/*.py CLI (AD-11 headless-clean). Closed with evidence 2026-08-08 (D1: no new code) — the utf-8 sweep was already landed at 3ee9117 and is two-layer enforced by test_utf8_guard.py; no conformance elevation. | lib/*.py, scripts/*.py | obs:cli-json-prints-crash-cp1252-windows-4b3cd5 | 2026-08-06 | 2026-08-06 |
| PROP-004 | Low | Under-review | AD-13 drift-check plugin plane verifies catalog lockstep (repo plugin.json vs marketplace.json) but not harness loadability: on this machine the plugin was never installed into Claude Code (installed… | 1× observation from tim-Tim-PC (2026-08-06) | plugin plane should also probe harness-level installation/loadability. | tk-studio-connector | obs:ad-13-drift-check-plugin-plane-verifies-catalog-ff11aa | 2026-08-06 | 2026-08-06 |
| PROP-005 | Low | Under-review | AD-11 headless discipline gap: driving tk-studio-detect via 'claude -p /tk-studio:tk-studio-detect' with default permissions, the skill's uv/python tool calls were denied ('requires approval'); | 1× observation from tim-Tim-PC (2026-08-06) | skill-instruction hardening + a denied-permissions case in the conformance suite. | tk-studio-detect | obs:ad-11-headless-discipline-gap-driving-tk-studio-detect-5ceb0d | 2026-08-06 | 2026-08-06 |
| PROP-006 | Medium | Declined | First conformance-through-connector run (driver contract section 8, ClaudeOS MCP connector as driver, 2026-08-06): 38 checks across 14 surfaces surfaced a skill-discipline gap - tk-studio-measure-pus… | 1× observation from tim-Tim-PC (2026-08-06) ↔ ISS-002 | Declined 2026-08-08: superseded — the specific defect shipped fixed (ISS-002 Resolved, tk-studio a76aa89 + runner refusal-marker residual); the surviving general concern (headless posture hardening) rides PROP-005. | tk-studio-measure-push | obs:first-conformance-through-connector-run-driver-contract-section-9f835b | 2026-08-06 | 2026-08-06 |
