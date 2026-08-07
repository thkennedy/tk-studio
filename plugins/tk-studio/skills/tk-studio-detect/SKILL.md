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

### detect — what this project is, with evidence (ST-4.2)

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/lib/detect.py" scan --directory <project-root>
```

Scores candidate project types against the shipped profile registry
(`profiles/*.json` in this skill: weighted `file_glob` / `dir_exists` /
`file_content` / `vcs` markers, per-profile confidence floor). The result
lists every candidate ranked, with the concrete evidence — marker text,
weight, and the file/dir that matched — behind every point scored, plus the
project's VCS type.

Outcomes (tk-council detector discipline — never a silent guess):

| Outcome | Meaning | Downstream move |
| --- | --- | --- |
| `confident` | floor met AND clear margin over the runner-up | propose `top_candidate` |
| `ambiguous — ask` | scored, but floor/margin unmet | show ranked candidates, ask the human |
| `unknown — ask` | nothing scored past the floor | ask the human what the project is |

`top_candidate` on an ask outcome is the best lead to *name in the question*,
never an answer to act on. Profiles carry `suggests` (module names) as data
for the recommendation step — detect never acts on them.

## Report

- **Attended:** summarize counts per plane, list known-but-uninstalled
  modules and user-authored resources by name (those are the recommendation
  candidates), and surface every `notes` entry.
- **Headless:** no prompts (AD-11). End with the status block — `complete`
  only on exit 0 **with a decided outcome** (`confident`); an `ask` outcome
  (`ambiguous`/`unknown` — the core exits 0, the ask is in-band) is a
  refusal to guess and ends `blocked` with the ask named in `reason`
  (contract §1: ambiguity ends the run blocked, never a downgrade to
  complete — ISS-002 posture); `blocked` on exit 2 (bad project root /
  unreadable registry) with the error as `reason`:

  ```json
  {"status": "blocked", "intent": "tk-studio-detect", "artifacts": [], "reason": "unknown — ask: nothing scored past the floor; candidates ranked in the scan output"}
  ```

If the deterministic core is unrunnable — a tool call denied by permissions, `uv`/python unavailable — end `blocked` with the status block naming the unrunnable core as `reason`: never a question, never a headless run that ends without the block (AD-11).

## Rules

- Read-only, always: zero writes to the project or the store unless the
  caller passes `--out` (their explicit destination choice).
- Provenance is per resource — a recommendation downstream must be able to
  cite the file its evidence came from.
- BMad-synced `.claude/skills` entries are attributed to their module, never
  double-counted as user-authored.
- All paths resolve through `${CLAUDE_PLUGIN_ROOT}`.
