---
name: tk-studio-knowledge
description: The knowledge promotion gate — draft reconciled corrections from the routing doc into ordinary kb/ files on a feature branch behind a membrane PR; review is the gate, nothing auto-applies. Use when the user says "promote the corrections", "tk promote", "draft the promotion", "promote-draft", or a job's invoke-skill directive names this skill.
---

# tk-studio-knowledge

The promotion gate of the Research→Knowledge Lifecycle port (ST-9.5; D3,
AD-12): corrections that reached the per-project reconciliation queue cross
to the project's canonical `kb/` ONLY as a drafted ordinary kb file on a
feature branch behind PR review. **Only a human writes canonical** — this
skill drafts and opens the PR; merging it is the human's act. It never
pushes a base branch, never merges, never closes or approves the PR.

## Behavior (both modes)

1. **Check first** (read-only, no network):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/promote.py" check --directory <project-root>
   ```

   Reports routing-doc presence, queue counts, the promoted baseline, and
   the unpromoted-correction count. Zero unpromoted is a first-class clean
   no-op, not an error.

2. **Draft through the core** (never hand-drive git for this):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/promote.py" draft --directory <project-root>
   ```

   The core refuses without a rendered routing doc (`reconcile.py route`
   renders it — the routing doc is the human's promotion-decision surface),
   drops corrections already recorded as drafted, sanitization-scans what
   would cross (NFR5), renders ONE new dated kb file (ordinary frontmatter
   — no new keys; `scope:` stays reserved, AD-8), regenerates `kb/index.md`
   (a foreign index is skipped, never clobbered), lands it on the stable
   branch `knowledge/<user>-<machine>`, pushes, and opens the membrane PR —
   or recognizes the open one the draft just updated (repeat drafts update
   the same PR, never a duplicate).

   A `dry_run` payload rides the core's own flag — `draft --dry-run` —
   which walks the data gates (routing doc, queue, promoted baseline,
   sanitization) without touching git. `no_pr` stops after the push;
   `redraft` ignores the promoted baseline and drafts every valid
   correction. Never substitute a check-only summary for the draft verb:
   the check step reports, only `draft` enforces.

3. **Attended:** summarize what was drafted — correction count, file,
   branch, PR URL — and remind the operator the drafted file is ordinary kb
   markdown they can edit on the branch before merging. Surface a
   `committed-local` result (offline push) or `unavailable` PR step as the
   retry guidance the core returned.
   **Headless:** a `PromoteBlocked` refusal (exit 2 — no routing doc, not a
   git work tree, dirty tree, sanitization finding) ends `blocked` with the
   core's error as `reason` — identically under `dry_run: true`: the core
   refusing a dry-run draft is still a refusal, never downgraded to
   `complete`; a push or PR step that could not reach the remote ends
   `partial` (useful work landed: the local branch commit) — never a prompt
   (AD-11). End headless runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-knowledge", "artifacts": ["kb/reconciliation-<date>.md"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never merge, never close or approve the PR, never push a base branch —
  review is the promotion gate (D3, AD-12).
- Nothing auto-applies: a draft writes ONE new dated kb file; existing kb
  content is never edited or deleted by a draft.
- Provisional knowledge (spine, seed, queue, routing doc, promotions
  record) stays in the per-user store (AD-3); only the drafted file
  crosses, through the PR.
- kb frontmatter gains nothing — `title`/`description` only; `scope:`
  stays reserved and unread (AD-8).
- A sanitization finding is a hard stop, not a warning — resolve the
  flagged correction, re-draft; never hand-edit the finding away on the
  branch (NFR5).
- Measurement (D4): the `knowledge-promotion` event — sole emitter this
  skill — lands with contract 1.7.0 (ST-9.6) alongside its taxonomy row;
  the ledger refuses un-rowed event types, so emission cannot precede the
  row. Until then a draft emits nothing (a mover, not an emitter, AD-12);
  the promotions record is the exactly-once baseline 9.6 reconciles.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
