---
name: tk-studio-install
description: Install the BMad base at the committed bmad.lock pin with the project's module set — non-interactive, deterministic, zero forks. Use when the user says "tk install", "install the base", or "install bmad at the pin".
---

# tk-studio-install

Installs the BMad base into a project at exactly the versions `bmad.lock` pins
(AD-1). The upstream installer does all the work — this skill only renders the
pinned invocation, verifies the result, and measures the outcome.

## Behavior (both modes)

1. Run the installer script through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/tk-studio-install/scripts/install_base.py" --directory <project-root>
   ```

   Optional: `--modules a,b,c` to install a subset of the lock's module set
   (the project's configured module set once project config exists, Epic 2);
   `--dry-run` to show the exact `npx` command without running it;
   `--no-normalize` to keep the upstream installer's output byte-for-byte.

2. The script is the whole flow: parse lock → run
   `npx bmad-method@<pin> install` non-interactively (`--yes`, per-module
   `--pin` flags, stdin closed) → verify `_bmad/_config/manifest.yaml` matches
   every pin → emit one `install-outcome` event (success, or failure with the
   failing step) → normalize the reinstall's no-op churn. Trust its JSON
   output; do not re-run the installer by hand.

   Normalization (EP-011 D2, shared with `tk-studio-base-update`) runs only
   after verify-at-pin passes, and only when the project root is a git
   top-level with `_bmad/` tracked. An untracked or ignored `_bmad/` has no
   committed tree to be a no-op against. It restores files upstream rewrote to something provably
   equivalent to the committed blob — line endings, list values re-serialized
   as JSON strings, manifest `lastUpdated` stamps, derivative
   `files-manifest.csv` hashes — and drops `*.bak` copies identical to the
   committed file. Anything already dirty before the run is left alone. The
   result's `normalized` object carries per-class counts and `remaining`:
   entries that still differ from HEAD because upstream changed them for real.

   Base patches (0.1.17) are re-applied before normalization: the studio's
   declared fixes to installer-owned files (`base-patches/patches.json`,
   `lib/basepatch.py`), each pinned to one upstream issue, the exact upstream
   text it replaces, and the core versions it was verified at. A reinstall
   therefore never silently reverts one. The result's `base_patches` lists
   each patch's state.

3. Report:
   - **Attended:** state the installed core/module versions, or on failure the
     failing step (`upstream-installer` vs `verify-at-pin`) and its detail.
     When `normalized.remaining` is 0 the install was a no-op against the
     committed tree — say so. When it is above 0, the installer wrote real
     changes at this pin: in the studio repo those land through
     `tk-studio-base-update` (a same-version re-affirmation), never a hand
     commit; in any other project they are the project's to review and
     commit. `normalized.skipped` names why normalization did not run.
     Name every base patch whose state is `stale` or `unverified-core` with
     its upstream issue: the upstream file changed or the core moved, so the
     patch was NOT applied and must be re-verified (retire it if the issue is
     fixed at the pin).
   - **Headless:** no prompts (AD-11). End with the status block — `complete`
     on exit 0; `blocked` with the failing step as `reason` otherwise:

     ```json
     {"status": "complete", "intent": "tk-studio-install", "artifacts": ["_bmad/"], "reason": null}
     ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Never edit anything under `_bmad/` — upstream owns that tree (NFR1); a bad
  install is fixed by rerunning at the pin, never by patching. Normalization
  is not an edit: it only restores committed bytes upstream itself wrote.
- Never bump a pin here — pin changes are `tk-studio-base-update`'s job alone.
- A long installer run is normal (npx cold cache); the script caps it with
  `--timeout` (default 900s) rather than hanging forever.
