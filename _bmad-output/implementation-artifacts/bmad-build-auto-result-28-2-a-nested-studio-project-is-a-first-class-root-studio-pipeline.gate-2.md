---
status: done
---

Gate for 28-2-a-nested-studio-project-is-a-first-class-root (run 20261016-204648-7e02).

- Part A: deviation_score 1 → `reconcile_verdict: not-required`.
- Part B: story accepted (AC1, AC2 met; AC3, AC4 met-with-deviation: transcribe.py rendered too, 0.1.22 patch-position bump). This gate re-ran lib suite 1313 OK (skipped=2) and conformance `ok: true`. Replan queue: no open entries. Planned 28-3 → `plans/28-3.md` (band L); a merged-tree precondition note was added to its `invoke_dev_with`. `bmad-loop validate`: manifest ok (dirty-tree line only).

Operator attention:
- The run already has a graceful stop request (2026-10-16T21:38), which is right: 28-3 needs the merged tree (attended merge PR). Its plan was investigated pre-merge, and it halts `blocked` if `apps/supervisor/` is absent.
- Pending SPEC.md settled-shape bullets (the gate may not write SPEC.md): the two from `plans/28-2.md`, plus the CAP-9 bullet in `plans/28-3.md` "Settled shape". The rosters' supervisor `source` can drop only through a new `supervisor--vX.Y.Z` cut from thkennedy/tk-studio, because the roster guard rejects a missing source while the URL is on the old repo.
- `tools/agent-pc/set-supervisor-env.ps1` hard-codes `C:\GitHub\tk-studio-supervisor` and throws when it is missing. CAP-14 keeps it unchanged, so keep the old clone on the box until 28.4 rules on it.
- Merge PR: write `apps/supervisor/.bmad-loop/plugins/studio-pipeline/` with `nest_pipeline.py --out`, or `test_the_real_nested_copy_equals_the_render` goes red on the merged tree.
