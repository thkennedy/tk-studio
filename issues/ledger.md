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
| ISS-001 | Medium | Mitigated | bmad-method 6.10.0 --yes reinstall produces no-op churn | Expected: reinstall at pin is a no-op. Actual: installer re-serializes list-valued module config options as JSON strings (primary_platform [a,b] becomes a quoted string) and rewrites all installed files with LF endings — large no-op git churn that must be reverted/normalized after every verify run. | 1× report from tim-Tim-PC (2026-08-06) | Teach tk-studio-base-update's verify step to auto-normalize the known churn classes (list re-serialization, LF rewrites) before diffing, and file the re-serialization defect upstream with bmad-method. Mitigated 2026-08-08: normalizer landed as EP-011/ST-043 (tk-studio PR #27, contract 0.1.10) with live verified-no-op re-affirmation (250 reverts, all five churn classes); upstream draft committed 60a2bf9, filing held (D4). | report:tk-studio-base-update | 2026-08-06 | 2026-08-06 |
| ISS-002 | Medium | Resolved | tk-studio-measure-push ended complete on a dry_run push the core refused | Expected: under dry_run against a non-studio-root directory the skill ends blocked, surfacing the core's push --dry-run refusal (contract §2 names 'not the studio repo root' as blocked). Actual: the skill ended complete, substituting a check-only summary for the core refusal. Surfaced by the first conformance-through-connector run (contract §8, 38 checks / 14 surfaces, 2026-08-06). | 1× report from tim-Tim-PC (2026-08-07) | Adopted 2026-08-06 (tk-studio a76aa89): SKILL.md pins dry_run to the core's own push --dry-run and a core refusal ends blocked even under dry_run; connector re-run confirms blocked with the marker named. Residual adopted 2026-08-06: the manifest's dry-run-refusal drive pre-existed (the core always refused); what the direct suite could not see was an unnamed refusal — the runner now requires a declared refusal marker to be named in the output, so a crash or unrelated error no longer passes as a clean refusal and the skill layer always has the named reason to surface as blocked. | report:tk-studio-measure-push | 2026-08-07 | 2026-08-07 |
