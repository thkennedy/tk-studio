---
name: tk-studio-detect
description: Read-only recommendation inputs — inventory the full resource universe (installed BMad modules/skills, known-but-uninstalled official modules, user-authored resources) and detect what a project is with evidence. Use when the user says "inventory resources", "tk detect", "what's installed", or as the input step of onboarding.
---

# tk-studio-detect

The read-only half of the Recommendation pillar (AD-17): what exists and what
this project is. Detection never writes and never silently guesses — its
outputs feed `tk-studio-onboard`, where recording happens only on explicit
confirmation.

## Verbs (both modes)

### inventory — the full resource universe (ST-4.1)

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/inventory.py" scan --directory <project-root>
```

Enumerates three planes into one structured JSON artifact on stdout, with
provenance (the file of record) per resource:

| Plane | Source of record | Entries |
| --- | --- | --- |
| Installed | `_bmad/_config/manifest.yaml` + `skill-manifest.csv` | modules + skills, versioned |
| Known-but-uninstalled | the plugin's `bmad.lock` module registry | official modules not installed here |
| User-authored | project `.claude/skills` (minus BMad-synced names), `.claude/agents`, `_bmad/custom/` | first-class recommendation path (AD-17) |

Notes surface anomalies (installed module missing from the registry, missing
manifests) without failing the scan; a project with no `_bmad/` still
inventories cleanly. Add `--out FILE` to also save the artifact (e.g. into a
run workspace) — without it the scan writes nothing anywhere.

## Report

- **Attended:** summarize counts per plane, list known-but-uninstalled
  modules and user-authored resources by name (those are the recommendation
  candidates), and surface every `notes` entry.
- **Headless:** no prompts (AD-11). End with the status block — `complete`
  on exit 0, `blocked` on exit 2 (bad project root / unreadable registry)
  with the error as `reason`:

  ```json
  {"status": "complete", "intent": "tk-studio-detect", "artifacts": [], "reason": null}
  ```

## Rules

- Read-only, always: zero writes to the project or the store unless the
  caller passes `--out` (their explicit destination choice).
- Provenance is per resource — a recommendation downstream must be able to
  cite the file its evidence came from.
- BMad-synced `.claude/skills` entries are attributed to their module, never
  double-counted as user-authored.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
