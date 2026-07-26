# tk-studio

Generalized role-aware orchestration layer on pure BMad.

Product brief: `_bmad-output/planning-artifacts/briefs/brief-tk-studio-2026-07-25/` in the ClaudeOS repo (pillars, rulings, O1 distribution decision).

## Reference material (local-only, not pushed)

`legacy-council/` holds a full working copy of the legacy council marketplace repo
(`LegacyStudios/claude-plugins`, main @ `d26a67f`) used as the design model
for tk-studio. It keeps its own `.git/` with complete history for local
reference, but the entire directory is gitignored here — tk-studio is a clean
repo, not a rehome of legacy-council.

Harvest targets inside it:

- `tools/vendor_bmad.py` — the BMad vendoring pipeline
- the commons issues ledger (`canonical/commons/issues-ledger.md`)
- the JSONL reconciliation queue

Note: the token-suffix leak flagged in the legacy-council eval
(`shared-memory/tk-agent-orchestrator/`) was scrubbed in this copy on
2026-07-26.
