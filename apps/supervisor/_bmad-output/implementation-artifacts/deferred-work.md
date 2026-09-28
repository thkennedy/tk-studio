### DW-1: On POSIX a process timeout kills only the direct child, not the process tree, so a timed-out worker or `uv run jobrun.py` grandchild keeps running.
origin: spec-deferred 2ec671e458b6
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: src/server.ts:159-164
severity: medium
reason: src/server.ts killTree: only win32 uses `taskkill /T`; elsewhere `child.kill("SIGKILL")` hits the direct child, which is spawned without `detached`, so there is no process-group kill. The timeout error still says "process tree killed". Lifted as-is from ClaudeOS (Windows-first). On the agent PC (Windows) the tree kill works; a Linux/sbx tier would leave a worker running after `finish --state partial`. Deferral class (c): safety rule at risk.
status: open — routed to story 21-5 (its process-tree kill criterion owns the fix), 2026-09-28

### DW-2: Follow-up review still recommended for 21-1-the-lift-drives-the-studio-at-the-current-contract after the damping cap was spent
origin: review-budget-followup
source_spec: `21-1-the-lift-drives-the-studio-at-the-current-contract-the-lift-drives-the-studio-at-the-current-contract.md`
location: n/a
severity: low
reason: The follow-up-review damping cap (limits.max_followup_reviews = 1) was spent with the story finalized (status: done, verify green) while the review pass still recommended an independent follow-up. The work was committed by bmad-loop run 20260928-091135-2ce0; this entry preserves the lingering recommendation for a deliberate later review.
status: open
