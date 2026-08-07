# tk-studio

Generalized role-aware orchestration layer on pure BMad.

Product brief: [`_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/`](_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/) — migrated here from ClaudeOS with full history on 2026-07-26 (pillars, rulings, [O1 distribution decision](_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/o1-decision-2026-07-26.md)). The council doc lineage lives in [`_bmad-output/council/`](_bmad-output/council/).

## Reference material (local-only, not pushed)

`tk-council/` holds a full working copy of the TK council marketplace repo
(the pre-rename upstream `claude-plugins` repo, main @ `d26a67f`) used as the design model
for tk-studio. It keeps its own `.git/` with complete history for local
reference, but the entire directory is gitignored here — tk-studio is a clean
repo, not a rehome of tk-council.

Harvest targets inside it:

- `tools/vendor_bmad.py` — the BMad vendoring pipeline
- the commons issues ledger (`canonical/commons/issues-ledger.md`)
- the JSONL reconciliation queue

Note: the token-suffix leak flagged in the tk-council eval
(`shared-memory/tk-agent-orchestrator/`) was scrubbed in this copy on
2026-07-26.
