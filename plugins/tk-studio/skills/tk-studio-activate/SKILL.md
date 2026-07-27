---
name: tk-studio-activate
description: Studio activation front door — verifies the installed studio plugin and BMad base are healthy and current. Use when the user says "activate the studio", "tk activate", or "studio status". (v0 skeleton — reports plugin identity and pin; the full three-way drift check lands with ST-1.4.)
---

# tk-studio-activate (v0 skeleton)

Activation front door for the studio (AD-13). This v0 proves the plugin is
installed and resolvable machine-wide; the full three-way drift/health check
(installed `_bmad` vs `bmad.lock`, installed plugin vs `marketplace.json`,
store/junction health) arrives with ST-1.4.

## Behavior (both modes)

1. Run the info script — it must be addressed through the plugin root so it
   works from any install location:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/tk-studio-activate/scripts/plugin_info.py"
   ```

2. The script prints one JSON object: plugin root, plugin name/version, and the
   `bmad.lock` core pin. Treat a non-zero exit or malformed output as a failed
   activation step.

3. Report the result:
   - **Attended:** one short paragraph — plugin version, where it resolved
     from, the pinned BMad core version.
   - **Headless:** no prompts, no questions (AD-11). End the run with exactly
     one JSON status block:

     ```json
     {
       "status": "complete",
       "intent": "tk-studio-activate",
       "artifacts": [],
       "reason": null
     }
     ```

     On script failure use `"status": "blocked"` and put the failing step in
     `reason`. Never hang, never prompt.

## Rules

- Read-only: this skill mutates nothing, ever (AD-13).
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}` — never assume the plugin
  lives inside the current repo.
