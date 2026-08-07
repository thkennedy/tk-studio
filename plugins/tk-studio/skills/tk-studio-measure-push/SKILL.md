---
name: tk-studio-measure-push
description: Push the local measurement ledger into the shared repo as a membrane PR — feature branch, per-user-per-machine file, sanitization re-check pre-commit, review as the gate. Use when the user says "push my measurements", "tk measure push", or a job's invoke-skill directive names this skill.
---

# tk-studio-measure-push

The mover half of the measurement membrane (ST-7.1, AD-12): the local ledger
becomes `measurements/<user>-<machine>.jsonl` on the shared repo through
plain git governance. Review is the membrane — this skill **never pushes a
base branch and never merges anything**. It is a mover, not an emitter: it
appends no measurement event of its own; the events it moves were each
emitted by their one named emitter.

## Behavior (both modes)

1. **Check first** (read-only, no network):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/measurepush.py" check --directory <studio-repo-root>
   ```

   Reports unpushed-event count and the sanitization verdict. Zero unpushed
   is a first-class clean no-op, not an error.

2. **Push through the core** (never hand-drive git for this):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/lib/measurepush.py" push --directory <studio-repo-root>
   ```

   The core re-checks sanitization pre-commit (a credential-shaped finding
   blocks before any branch exists), lands only new ledger lines append-only
   on the stable branch `measurements/<user>-<machine>`, stages only this
   machine's file, pushes, and opens the PR — or recognizes the open one the
   push just updated (repeat pushes update the same PR, never a duplicate).

   A `dry_run` payload rides the core's own flag — `push --dry-run` — which
   walks every gate (studio-root check, dirty tree, sanitization) without
   landing a branch, commit, or PR. Never substitute a check-only summary
   for the push verb: the check step reports, only `push` enforces.

3. **Attended:** summarize what moved — event count, branch, PR URL — and
   surface a `committed-local` result (offline push) or `unavailable` PR
   step as the retry guidance the core returned.
   **Headless:** a `PushBlocked` refusal (exit 2 — wrong directory, dirty
   tree, sanitization finding) ends `blocked` with the core's error as
   `reason` — identically under `dry_run: true`: the core refusing a
   dry-run push is still a refusal, never downgraded to `complete`; a push
   or PR step that could not reach the remote ends `partial` (useful work
   landed: the local branch commit) — never a prompt (AD-11). End headless
   runs with the status block:

   ```json
   {"status": "complete", "intent": "tk-studio-measure-push", "artifacts": ["measurements/<user>-<machine>.jsonl"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never push a base branch, never merge, never close or approve the PR —
  review is the promotion gate (AD-12).
- Per-user-per-machine file only; another machine's file under
  `measurements/` is never staged, edited, or deleted.
- Append-only: a line already on the shared file is never rewritten or
  removed by a push.
- A sanitization finding is a hard stop, not a warning — fix the ledger,
  rerun; never hand-edit the finding away on the branch (NFR5).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
