---
status: done
---

Gate for 28-1-the-rehearsal-is-a-script-with-a-report (run 20261016-204648-7e02).

- Part A: deviation_score 1 → `reconcile_verdict: not-required`.
- Part B: story accepted (AC1 met-with-deviation, AC2–AC4 met; 32 rehearse tests green here). Real rehearsal on the agent PC after 28.2 is unverifiable-here. Replan queue: no open entries. Planned 28-2 → `plans/28-2.md` (band L, oversize; halt note added to its `invoke_dev_with`). `bmad-loop validate`: manifest ok (dirty-tree line only).

Operator attention:
- Two SPEC.md settled-shape bullets pending (gate may not write SPEC.md); text in `plans/28-2.md` "Settled shape": CAP-5/CAP-8 drift-check JSON roots; CAP-7 nested pipeline copy via `tools/restructure/nest_pipeline.py` (settles SPEC Open Question 1).
- 28-2 plan readings to confirm: contract bump as `0.1.22 additive` (change policy) for the AC's "minor bump"; AC3's `../../plugins/tk-studio/contracts/...` prose pointer vs ADR §3 gate 5 sealed-plugin rule (read as not "consumption").
- 28-2 is ~20 files, past band L; consider bmad-correct-course if that is unacceptable.
- Stop the run after 28-2: 28-3 needs the merged tree (SPEC Open Question 2).
