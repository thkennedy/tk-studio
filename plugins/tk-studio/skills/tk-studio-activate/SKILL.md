---
name: tk-studio-activate
description: Studio activation front door — health/drift check proving the BMad base, the studio plugin, the per-user store, and the vault window are current. Read-only, loud, guided fixes. Use when the user says "activate the studio", "tk activate", "studio status", or "check for drift".
---

# tk-studio-activate

Activation cross-checks four planes — base, plugin (the skills-dir folder
against the roster), store, vault (AD-13) — and reports; it never mutates
anything. Version skew is caught here, at the front door, instead of
debugged later as ghosts.

## Behavior (both modes)

1. Run the drift check through the plugin root:

   ```bash
   uv run "${CLAUDE_PLUGIN_ROOT}/skills/tk-studio-activate/scripts/drift_check.py" --directory <project-root>
   ```

   Add `--guided` only when running as part of guided onboarding — it
   additionally emits `onboarding-funnel` timing events per plane.

2. The script checks four planes and emits its own measurement events
   (`drift-detection` on clean or drift; `activation-failure` if a check step
   itself fails):

   | Plane | Compares | Guided fix on drift |
   | --- | --- | --- |
   | `bmad-base` | installed `_bmad/_config/manifest.yaml` vs `bmad.lock` pins | `tk install` |
   | `plugin` | the skills-dir folder `<home>/skills/tk-studio/`'s `plugin.json` vs the configured channel's roster `plugin` entry (`--channel`, default `stable`; `tools/installer/rosters/<channel>.json` in the project) and, in a developer checkout only, the marketplace catalog; `case` names `ok`, `stale`, `missing` or `shadowed` (a marketplace copy is installed). `installed_plugins.json` is read only to find marketplace copies, never for the version (AD-13, AD-21) | stale: `tk-studio update`; missing: `tk-studio install`; shadowed: `claude plugin uninstall tk-studio@<m> --scope user` (plus `claude plugin marketplace remove tk-studio` when the marketplace is known) |
   | `store` | `~/.tk-studio` skeleton + config keys | `uv run <plugin>/lib/store.py standup` |
   | `vault` | vault window links for this project (when registered) | `uv run <plugin>/lib/vault.py link --project-id <id>` |

   Exit codes: 0 clean, 1 drift found, 2 check-step error. The vault plane
   records its observed state in the registry entry (writer: activate) — the
   one sanctioned bookkeeping write; unconfigured is clean (the vault is a
   view, never a dependency), and links are never repaired here.

3. Report:
   - **Attended:** state each plane's status in one line each; on drift, give
     the exact fix commands from the `fixes` array and stop — the fix is the
     operator's move, never applied silently (NFR6).
   - **Headless:** no prompts (AD-11). End with the status block:
     `complete` on exit 0 or 1 (a drift *report* is a completed check —
     the drift itself goes in `reason`), `blocked` on exit 2 with the failing
     step as `reason`:

     ```json
     {"status": "complete", "intent": "tk-studio-activate", "artifacts": [], "reason": "drift: bmad-base — tea pinned v1.19.1, installed v1.20.0"}
     ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Read-only, always (AD-13). If a fix is needed, name it; never run it from
  this skill.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}` — never assume the plugin
  lives inside the current repo.
- `scripts/plugin_info.py` remains the lightweight identity probe (plugin
  root/version only) for callers that don't need the full check.
