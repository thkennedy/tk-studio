---
title: BMad base patches — studio-managed fixes to installer-owned files
description: Why the studio patches an installer-owned BMad file, how tk install re-applies the patch and tk activate reports it, and when to retire it. Covers the render_skill.py duplicate-key patch (BMAD-METHOD#2718), which lets gds and bmm (every game project) run bmad-build and bmad-loop.
rank: 25
---

# BMad base patches

AD-1 says zero forks: the BMad base is the upstream installer's output at the
`bmad.lock` pin. A **base patch** is the one sanctioned exception. It exists
for an upstream defect that stops the studio from working at the pin. Each
patch is declared in `plugins/tk-studio/base-patches/patches.json` and applied
by `lib/basepatch.py`. It is never hand-edited into a project.

Rules that keep a patch from turning into a fork:

- **One defect, one filed upstream issue.** The fix is the smallest one that
  works.
- **Pinned in two ways:** to the exact upstream text it replaces (`find`), and
  to the core versions it was verified at (`applies_to_core`).
- **`tk install` re-applies it after every install**, before churn
  normalization. A reinstall can never silently revert it, and a tree
  committed with the patch in place stays clean.
- **`tk activate` reports problems as bmad-base drift:** a patch that is
  missing (`pending`), `stale` (the upstream text changed), or
  `unverified-core` (the core moved but the defect text is still there).
- **Nothing is patched blind.** A `stale` or `unverified-core` patch leaves the
  file untouched.

## Retiring or re-pinning a patch

A base update (`tk-studio-base-update`) is the checkpoint. After it runs:

- **`stale`:** upstream changed the file. Check the issue. If it is fixed at
  the new pin, delete the patch from the registry.
- **`unverified-core`:** the defect is still there at the new core. Re-verify
  the fix, then add the version to `applies_to_core`.

The tk-studio tracking issue named in the registry keeps the check on the
calendar between base updates.

## render-skill-identical-duplicates (2026-09-28)

**Defect.** Upstream issue:
[BMAD-METHOD#2718](https://github.com/bmad-code-org/BMAD-METHOD/issues/2718),
filed 2026-08-12. `_bmad/scripts/render_skill.py` resolves a short config
token (`{{.planning_artifacts}}`) by searching the whole merged config. It
HALTs when the key appears under more than one module, even when every value
is identical. bmm and gds both declare `planning_artifacts` and
`implementation_artifacts`. The effect in any bmm + gds project, which means
every game project:

- `bmad-build` and `bmad-build-auto` cannot render.
- Every bmad-loop dev session escalates at step 0.

**Verified 2026-09-28:**

- Reproduced on tk-studio at core 6.11.0.
- The renderer on BMAD main has the same rule.
- gds v0.7.2 still declares both keys.
- A config overlay cannot delete a key.

**Fix.** Treat a multi-module key as ambiguous only when the values differ.
The Universe Awaits has run this rule as a local patch since 2026-09-09.

**Per project.** gds's artifact paths must equal bmm's. In tk-studio,
`_bmad/custom/config.toml` pins them. The Universe Awaits' install answers
already match.
