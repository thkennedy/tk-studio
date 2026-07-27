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
   `--dry-run` to show the exact `npx` command without running it.

2. The script is the whole flow: parse lock → run
   `npx bmad-method@<pin> install` non-interactively (`--yes`, per-module
   `--pin` flags, stdin closed) → verify `_bmad/_config/manifest.yaml` matches
   every pin → emit one `install-outcome` event (success, or failure with the
   failing step). Trust its JSON output; do not re-run the installer by hand.

3. Report:
   - **Attended:** state the installed core/module versions, or on failure the
     failing step (`upstream-installer` vs `verify-at-pin`) and its detail.
   - **Headless:** no prompts (AD-11). End with the status block — `complete`
     on exit 0; `blocked` with the failing step as `reason` otherwise:

     ```json
     {"status": "complete", "intent": "tk-studio-install", "artifacts": ["_bmad/"], "reason": null}
     ```

## Rules

- Never edit anything under `_bmad/` — upstream owns that tree (NFR1); a bad
  install is fixed by rerunning at the pin, never by patching.
- Never bump a pin here — pin changes are `tk-studio-base-update`'s job alone.
- A long installer run is normal (npx cold cache); the script caps it with
  `--timeout` (default 900s) rather than hanging forever.
