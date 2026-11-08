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

## render-skill-staging-rename-retry (2026-10-31, not yet registered)

**Defect.** Hole 95, DW-110. The first render of a skill in a fresh run worktree can fail inside the sandbox with `[Errno 13] Permission denied` on `_publish`'s `os.rename(staging, destination)`. The sbx mount over a Windows folder refuses the rename for a moment.

**The change.** Five tries, 200 ms apart, on `PermissionError` (`EACCES`/`EPERM`), under the marker line `tk-studio base patch render-skill-staging-rename-retry`. A failed try that left the empty generation folder behind has it cleared before the next try (a POSIX rename replaces an empty directory, a Windows rename refuses it, WinError 183; 2026-10-31, the 36.3 host leg); a non-empty folder is another writer's generation and ends the retry. Both tracked copies carry it, edited identically: `_bmad/scripts/render_skill.py` and `apps/supervisor/_bmad/scripts/render_skill.py`.

**Registration is owed.** `base-patches/patches.json` has no entry for it yet. An entry needs a filed upstream issue URL, one defect to one issue, and none has been supplied. Until then:

- `tk install` does not re-apply the change, so a reinstall reverts it.
- `tk activate` does not report it.

To finish: file or locate the BMAD-METHOD issue, then add the second registry entry with `id: render-skill-staging-rename-retry`, `applies_to_core: ["6.11.0"]`, `find` the unpatched `os.rename(staging, destination)` / `except OSError:` region and `replace` the patched one. Never reuse `BMAD-METHOD#2718`: it is another defect's.

## render-skill-reread-fresh-destination (2026-11-07, not yet registered)

**Defect.** Hole 114, DW-180 (hole 65's view). After `_publish`'s staging rename lands, the sandbox can keep a stale view of the new generation across the sbx mount: five of the first 37.6 run's ten files read `-?????????` from inside the sandbox for 22 minutes while the host saw them complete. The dev session then halts on a snapshot the renderer itself reported published.

**The change.** After the rename lands (and after the race path's `_verify_existing`), `_verify_published` stats and re-reads every output and `manifest.json`, comparing bytes, under the marker line `tk-studio base patch render-skill-reread-fresh-destination`. On an `OSError` or a byte mismatch the generation is removed (`shutil.rmtree`; when that fails, it is renamed onto the fresh name `<generation>.stale-<pid>`, never onto an existing folder, WinError 183; when the view hides the destination itself, so the removal finds nothing there, the rename is skipped), the destination is made again, every output is written straight into it (`write_bytes`, the manifest last) and each is re-read once more. A second failure raises `RenderError("failed to verify <path> after a direct write: <error>")`, which the supervisor's render signature (Story 38.2, CAP-5) keys on. The generation path includes `renderer_sha256`, so the patch re-renders every skill once. Both tracked copies carry it, edited identically: `_bmad/scripts/render_skill.py` and `apps/supervisor/_bmad/scripts/render_skill.py` (`render_skill.py.bak` is no copy and is left alone). `test_basepatch.py RereadFreshDestinationTests` pins both branches.

**Registration is owed.** As for DW-110's patch above, `base-patches/patches.json` has no entry for it until a filed upstream issue URL exists (one defect to one issue). Until then `tk install` does not re-apply the change, so a reinstall reverts it, and `tk activate` does not report it. To finish: file or locate the BMAD-METHOD issue, then add the registry entry with `id: render-skill-reread-fresh-destination`, `applies_to_core: ["6.11.0"]`, `find` the unpatched end of `_publish`'s `try` block and `replace` the patched one. Never reuse another defect's issue.

## run-worktree-rollback (2026-11-06, a policy setting the engine already implements, not a registered patch)

**Defect.** Hole 106, DW-148. A dev session that hits the engine's clock (`session_timeout_min`) with its work uncommitted, under `[scm] rollback_on_failure = false`, pauses the run for a hand `git reset` (`rollback-manual-required`), and the pause discards the pending graceful stop (`stop-request-discarded`).

**The change.** No engine file is touched and nothing goes in `base-patches/patches.json`. The supervisor's `materialise` (`apps/supervisor/src/worktree.ts`) sets `rollback_on_failure = true` in the `[scm]` table of the run worktree's copy of `.bmad-loop/policy.toml`, right after copying it from the checkout. The edit touches the setting alone: the key's value is replaced inside `[scm]`, the key is added under the `[scm]` header when it is missing, or an `[scm]` table is appended when the policy has none, and every other byte is kept. A tmp file is renamed onto the copy, and the copy is re-read with `Bun.TOML.parse`. A copy that does not parse is restored, and the materialise is refused by name (`worktree policy`). Only a run's own worktree is written. A main checkout's policy keeps `false`: `pipeline.py`'s managed block and `launch.py`'s reconcile never write the setting, and a worktree materialised before 2026-11-06 is never upgraded.

**What the engine then does is its own rule.** The studio does not re-implement or filter any of it. With budget left, a failed attempt is retried; without, it is deferred. bmad-loop 0.9.1 then rolls the attempt back:

- The attempt's commits are parked on `attempt-preserve/*` refs.
- Its uncommitted tree is parked on `refs/attempt-preserve-dirty/*`, visible from the main checkout.
- `verify.py safe_rollback` resets to the attempt's baseline, `git reset --hard` to HEAD at the attempt's start, so stories landed earlier stay.
- The same step removes only the untracked files new since that baseline. Ignored files are excluded, `.bmad-loop/` and the BMAD artifact folders are kept, and `policy.toml` is restored.

A timeout no longer pauses, so the next item boundary honours the pending stop.

**Per project.** Every run worktree the supervisor cuts. To set the key by hand on a main checkout, read the engine's warning in its policy comment first.
