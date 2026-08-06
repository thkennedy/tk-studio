# measurements/

Teammate measurement ledgers, arriving **only via PR** — the AD-12 membrane.

One file per user per machine: `<user>-<machine>.jsonl`, one JSON event per
line, matching the shipped taxonomy
(`plugins/tk-studio/contracts/events/taxonomy.v1.json`). Files land here
through `tk-studio-measure-push` (feature branch `measurements/<user>-<machine>`
→ PR → review), never by direct commit to a base branch. Pushes are
append-only and sanitization-re-checked pre-commit; review is the promotion
gate. Consolidation (`tk-studio-consolidate`) reads the merged files and
maintains `issues/ledger.md`.
