---
name: tk-studio-base-update
description: Adopt a new upstream BMad release as one reviewable motion — bump the bmad.lock pin, rerun the upstream installer, open the integration PR. Use when the user says "base update", "bump bmad", "update the base", or "adopt the new BMad release".
---

# tk-studio-base-update

The only writer of `bmad.lock` pins (AD-1). The team adopts upstream changes
in lockstep through a reviewable integration PR — never a fork, never an
unreviewed mutation of `main`.

## Behavior (both modes)

1. Determine the target: a new core version (`--core 6.11.0`) and/or module
   pins (`--pin tea=v1.20.0`, repeatable). Attended, if the operator hasn't
   named a version, look up the latest upstream release and confirm the target
   with them first. Headless requires the target in the payload — a missing
   target is `blocked`, never a guess (AD-11).

2. Run the whole motion through the plugin root, from the **studio repo** root
   (this skill operates on the repo that owns `bmad.lock`):

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/tk-studio-base-update/scripts/base_update.py" \
     --core <version> [--pin MODULE=TAG ...] --directory <studio-repo-root>
   ```

   The script: preflight (clean tree) → isolated `base-update/*` branch → lock
   bump commit → pinned non-interactive reinstall with verify (emits
   `install-outcome`) → sha sync + install-diff commit → push + `gh pr create`.
   `--dry-run` previews; `--no-pr` stops after the local commits.

3. On success, attended: optionally enrich the PR description with a summary
   of the upstream release notes (`gh pr edit`). Nothing merges automatically —
   say so and stop; review is the membrane (AD-12).

4. On installer failure the script has already restored the tree, returned to
   the starting branch, and left the bump branch for inspection —
   `install-outcome: failure` was emitted. Report the failing step; end
   headless runs `blocked`:

   ```json
   {"status": "blocked", "intent": "tk-studio-base-update", "artifacts": [], "reason": "install-at-new-pin failed: <detail>; branch base-update/... left for inspection"}
   ```

   On success:

   ```json
   {"status": "complete", "intent": "tk-studio-base-update", "artifacts": ["bmad.lock", "<pr-url>"], "reason": null}
   ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never edit `_bmad/` by hand and never bump pins outside this motion (NFR1).
- Never merge the PR from this skill; the integration PR is for human review.
- A same-version run (`--core` equal to the current pin) is a legitimate
  re-affirmation of the motion, not an error.
