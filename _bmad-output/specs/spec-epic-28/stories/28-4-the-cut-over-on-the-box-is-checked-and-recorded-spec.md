---
title: 'The Cut-Over on the Box Is Checked and Recorded'
type: 'feature'
created: '2026-10-17'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: '4a3ab1a04c294b2d55588e9395ef793afcf7e39f'
baseline_revision: '4a3ab1a04c294b2d55588e9395ef793afcf7e39f'
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** After the merge, `tk-studio doctor` cannot see the cut-over. `apps.source_checkout` only accepts a Startup-shortcut working directory that holds `.git` itself. `C:\GitHub\tk-studio\apps\supervisor` holds none, so doctor reports the supervisor `not installed`, and `tk-studio update` would install a slot over the shortcut. Doctor also checks neither the nested root, its registry agreement, its own folder trust nor the shortcut's `start.ps1` target. Separately, the record (runbook §3.8/§4, the handoff, AD-21, the observation ledger) still points forward to this story.

**Approach:** Teach the CLI to recognise a shortcut working directory inside a git checkout and to read the shortcut's Arguments from the `.lnk`. Add four read-only, Windows-only doctor checks, pinned with fakes in the lib suite. Then complete the record. Every operator or box step is `unverifiable-here`, with its exact command.

### Acceptance criteria (verbatim, epics.md Story 28.4)

- **AC1. Given** the Startup shortcut retargeted to `C:\GitHub\tk-studio\apps\supervisor\start.ps1` by Tim and `bun install --frozen-lockfile` run in `apps/supervisor` **When** `tk-studio doctor` runs on the agent PC **Then** it reports the supervisor's root as the nested root, the registry root in agreement, folder trust for the nested root (trust has no inheritance; runbook §4.1), and the Startup shortcut's target (read from the `.lnk`), each `ok` or named; the checks are pinned with fakes in the lib suite and run for real on the box by the attended session
- **AC2. Given** the supervisor started from the console from its new root **When** the smoke test runs (`curl /status` from another device; one queued job to a guarded end) **Then** both pass and the results are recorded in the PR; `TK_STUDIO_ROOT`, `TK_SUPERVISOR_*` and `set-supervisor-env.ps1` are unchanged
- **AC3. Given** the record **When** the story closes **Then** runbook §3.8 and §4 describe the one-repository layout and sandbox; the handoff names the cut-over date and the archive; the spine's AD-21 carries a "done" note with the date; the observation ledger has every hole found during rehearsal; and `thkennedy/tk-studio-supervisor` is archived by Tim (`gh repo archive`), never deleted

## Boundaries & Constraints

**Always:**
- The CLI stays stdlib-only and sealed: it imports nothing from `plugins/tk-studio`.
- Doctor stays read-only. It starts no new process: the `.lnk` is parsed in Python, and the git top-level is found by walking up for `.git`, never by `git rev-parse`. The existing `ALLOWED` command set and call counts hold.
- Every non-`pass` check carries a `fix`. The status words stay `pass|fail|warn|skipped`; "ok" in AC1 means `pass`.
- The four new checks are reported on Windows only. Off Windows they are absent (not `skipped`), so `AllPassing`'s check set is unchanged.
- `TK_STUDIO_ROOT` keeps meaning the outer root.
- Ledger writes go only through `plugins/tk-studio/lib/observe.py record` (AD-12).

**Block If:** satisfying AC1 needs a driver-contract or conformance-schema change; a check would need a process, a network call or a write; the record needs a fact the repository does not hold (beyond the cut-over date settled in Design Notes).

**Never:**
- Edit `tools/agent-pc/set-supervisor-env.ps1`, `apps/supervisor/**`, `epics.md`, `plan/`, `stories.yaml`, the rosters, or `measurements/*.jsonl` (they arrive only by `tk-studio-measure-push` PR).
- Push, tag, archive, or touch a remote.
- Write the archive as already done: it is Tim's step, pending.
- Rename or remove existing doctor checks.

## I/O & Edge-Case Matrix

Fixture: outer `T/GitHub/tk-studio` (holds `.git` and `.tk-studio/config.yaml`), nested `T/GitHub/tk-studio/apps/supervisor` (holds `.tk-studio/config.yaml` with `project_id: supervisor`, and `start.ps1`). The shortcut is `tk-studio supervisor.lnk` under `APPDATA`. Its WorkingDirectory is the nested root, and its Arguments are `-w studio nt --title supervisor pwsh -NoExit -File <nested>\start.ps1`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Cut-over healthy | fixture; registry `supervisor` root = nested; nested trusted | `supervisor` mode `source checkout` with checkout = nested root; `supervisor-root`, `supervisor-registry`, `supervisor-trust`, `startup-shortcut` all `pass`, each detail naming its path | — |
| Old layout | working dir is the old clone, which holds its own `.git` | `supervisor-root` fails, naming it a repository of its own (the pre-cut-over layout) | fix: retarget to runbook §4.3's target |
| Registry disagrees | entry missing, or its root differs (case and slash folded) | `supervisor-registry` fails, naming both roots | fix: `uv run <plugin>/lib/registry.py amend --project-id supervisor --writer activate --root <nested>`; doctor never edits |
| Parent trusted only | outer root trusted, nested root not | `supervisor-trust` fails: trust has no inheritance (§4.1) | fix: open `claude` in the nested root and accept |
| Bad target | Arguments name no `-File …start.ps1`, a different folder's `start.ps1`, or a missing file | `startup-shortcut` fails, naming what the `.lnk` holds | fix: §4.3 target line |
| No shortcut | `.lnk` absent/unreadable, or `APPDATA` unset | `startup-shortcut` fails, naming the path; root checks absent | fix: make the §4.3 shortcut |
| Slot box | shortcut targets `<data root>/supervisor/<v>/start.ps1` | `startup-shortcut` passes; root checks absent; supervisor stays a slot | — |
| Update on the nested root | `tk-studio update` with the cut-over fixture | the supervisor leg is `reported` (source checkout); no slot is installed and the shortcut is not rewritten | — |

</intent-contract>

## Code Map

- `tools/installer/cli/tk_studio_cli/apps.py`:
  - `read_lnk_working_dir` `:496-525` parses MS-SHLLINK StringData. Generalise it to return the strings: NAME 0x04, RELATIVE_PATH 0x08, WORKING_DIR 0x10, ARGUMENTS 0x20, in that order. Keep `read_lnk_working_dir` as a thin wrapper.
  - `shortcut_path` `:528`.
  - `source_checkout` `:537-555` must accept `.git` in the folder **or any ancestor**, still excluding `_is_under(folder, ctx.root / SUPERVISOR)`. `_is_under` is at `:385`.
  - `supervisor_report` `:1456` and `doctor_fields` `:1469` feed doctor. `update` uses `source_checkout` at `:870` and `:1375`, so the fix also protects the update path.
  - The shortcut shape both writers produce: `write_shortcut` `:682-712` (TargetPath wt.exe, Arguments `… pwsh -NoExit -File "<slot>\start.ps1"`, WorkingDirectory). `set-supervisor-env.ps1:127-129` writes the same shape, unquoted.
- `tools/installer/cli/tk_studio_cli/doctor.py`:
  - `_check` `:62`, `store_root` `:177`.
  - `check_folder_trust` `:282-347` holds the registry read (miniyaml, `projects.<id>.root`), the `.claude.json` read (`plugin_leg.claude_json_path`, `_read_json`), `_norm` `:272` and `_accepted` `:277`. Reuse them; factor out a helper if needed.
  - `check_supervisor` `:492`. `run_doctor`'s check list is at `:665-680`; insert the new checks after `check_supervisor`.
  - `FIX_START` `:58`. Update the module docstring's read-only and process list if needed.
- `tools/installer/cli/tk_studio_cli/miniyaml.py`: the parser for the nested `.tk-studio/config.yaml` (`project_id`). When `project_id` is absent, fall back to the folder basename (AD-20 default).
- `plugins/tk-studio/lib/tests/test_installer_apps.py`:
  - `lnk_bytes` `:67` gains an `arguments=` kwarg (flag 0x20, written after the working dir).
  - The update/source-checkout tests are near `:1439` and `:1508`. Add the nested-root update row there.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`:
  - `DoctorCase` `:71`, with helpers `registry` `:135` and `trust` `:148`.
  - `AllFailing` `:161` (Windows; its reason list is computed). `AllPassing` `:221` (non-Windows; exact check set).
  - `SupervisorCheckout` `:738` is the pattern for a new `CutOver` class covering every matrix row.
- `kb/agent-pc-setup-runbook.md`:
  - §3.8 `:590-660`: one sandbox, one mount, already written by 28.3.
  - §4.1 `:953-955`: "keep the old clone for now".
  - §4.2 `:1016-1026`: "until Story 28.4 rules on the old clone".
  - §4.3 `:1044-1045`.
  - §4.5 `:1079`: the smoke test.
  - §7 `:1222-1236`: doctor's check list.
- `_bmad-output/planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md` AD-21 `:167-171`. Append the done note to the Rule bullet's end, or add a new bullet.
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md`: rolling handoff. New `## Update` sections go at the top, after the title (pattern at `:5`).
- Rehearsal holes, with their evidence. None is in the tracked ledgers (`measurements/tim-Tim-PC-2.jsonl` ends at hole 26, 2026-10-16T20:39):
  - Runs 1-3 failed on the stale no-tags/no-signatures premise (DW-23, `01e7ac9`).
  - Hole 28: the Windows nearest-root rule took the default store (DW-24, `01e7ac9`).
  - Hole 29: the rehearsal test module was skipped whole on Windows (`01e7ac9`).
  - The missing ADR §5 step 3 fix-up: verify_host was red in the merged clone (`5fdaa52`).
  - Hole 31: the notifier was live under the rehearsal's `bun test` (`77bd03b`).
  - The win32 bun test timeout (`7251f42`, supervisor PR #11).
  - The rehearsal report is `_bmad-output/implementation-artifacts/restructure-rehearsal-2026-10-16.md`.

## Tasks & Acceptance

**Execution:**
- `tools/installer/cli/tk_studio_cli/apps.py`: add the StringData reader that returns the Arguments, and the ancestor `.git` rule in `source_checkout`. (AC1; matrix "Update on the nested root".)
- `tools/installer/cli/tk_studio_cli/doctor.py`: add `supervisor-root`, `supervisor-registry`, `supervisor-trust` and `startup-shortcut`, as in the matrix. (AC1.)
- `plugins/tk-studio/lib/tests/test_installer_apps.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py`: pin every matrix row with fakes. `AllFailing` and `AllPassing` stay green. (AC1.)
- `kb/agent-pc-setup-runbook.md`, edits to existing text:
  - §4.1/§4.2/§4.3: replace the "until Story 28.4" forward references with the standing state. `set-supervisor-env.ps1` is unchanged by the cut-over. The local `C:\GitHub\tk-studio-supervisor` folder stays for it: archiving on GitHub removes nothing locally. Keep retargeting the shortcut after a run, or use `-NoShortcut`.
  - §3.8: one line naming the cut-over date.
  (AC3, AC2's "unchanged".)
- `kb/agent-pc-setup-runbook.md`, new text:
  - §4.5: the post-cut-over smoke test (`curl /status` from another device; one queued job to a guarded end; record both in the PR).
  - §7: the four new doctor checks in the check list.
  (AC2, AC1.)
- `ARCHITECTURE-SPINE.md`: AD-21 gains a done note dated 2026-10-16. It says the supervisor moved into `apps/supervisor` (PR #118, merge `4c3ee36e96e5c846b28c3298f6f43103977d7958`, Epic 28), and that `thkennedy/tk-studio-supervisor` is archived by Tim with `gh repo archive`, never deleted. `apps/studio-web` (EP-30) is untouched by the note. (AC3.)
- `handoff-phase1-loop-2026-10-09.md`: a top `## Update` section naming the cut-over date 2026-10-16 (PR #118), the archive as Tim's pending `gh repo archive thkennedy/tk-studio-supervisor` (never deleted; the PR discussions stay there), and the attended steps. (AC3.)
- Ledger, not a file: run `uv run plugins/tk-studio/lib/observe.py record --source other --project tk-studio --description "Rehearsal hole (Epic 28 cut-over record, Story 28.4): <hole>; fix: <where it landed>" --evidence "<commit or DW id>"` once per rehearsal hole in the Code Map. (AC3.)

**Acceptance Criteria:**
- Given the lib suite, when `test_installer_doctor` and `test_installer_apps` run, then every matrix row passes with fakes, and doctor starts only the processes in `ALLOWED`.
- Given the change, when `git diff 4a3ab1a -- tools/agent-pc/set-supervisor-env.ps1 apps/supervisor` runs, then it is empty.
- Given the ledger, when it is grepped for `Rehearsal hole (Epic 28`, then there is one event per hole in the Code Map list.
- Given the runbook, when it is grepped for `Story 28.4 rules` or `for now: the §4.2`, then nothing matches.

## Spec Change Log

## Review Triage Log

### 2026-10-17 — Review pass
- note: both layers ran (band L: 7 files, ~560 lines); the diff was handed to the reviewers as a scratchpad file path (826 lines, including the six ledger events).
- intent_gap: 0
- bad_spec: 0
- patch: 11 (high 0, medium 4, low 7)
- defer: 0
- reject: 1 (low 1)
- note: rejected: the unreachable "in no git checkout" branch, and the claim that absent root checks are "neither ok nor named" (blind hunter and edge-case hunter, deduplicated). The matrix rows "No shortcut" and "Slot box" make them absent by design, and the `supervisor` check names the state.
- addressed_findings:
  - `[medium]` `[patch]` AD-21's done note stated the archive as done. Reworded as Tim's pending `gh repo archive` step.
  - `[medium]` `[patch]` `startup-shortcut` failed when the roster ships no supervisor. It is now `skipped` with the supervisor's reason.
  - `[medium]` `[patch]` On the old layout, the registry and trust checks pointed their fixes at the old clone. They are now `skipped` until `supervisor-root` passes.
  - `[medium]` `[patch]` `supervisor-root` passed any checkout subfolder. It now needs its own `.tk-studio/config.yaml`, and a missing `start.ps1` is named.
  - `[low]` `[patch]` The shortcut fix now follows the supervisor mode.
  - `[low]` `[patch]` A working directory at the repository top level is worded as such, not as "pre-cut-over".
  - `[low]` `[patch]` `source_checkout`'s ancestor case needs the folder's own studio config.
  - `[low]` `[patch]` A relative or `%VAR%` working directory is expanded, or rejected when still not absolute.
  - `[low]` `[patch]` A relative `-File` target resolves against the working directory.
  - `[low]` `[patch]` Runbook §4.3's sentence was made accurate, and §7 aligned with it.
  - `[low]` `[patch]` The PR for the smoke-test record is named (`loop/epic-28`).

### 2026-10-17 — Review pass (follow-up)
- note: follow-up review; both layers ran (band L). The diff since `4a3ab1a` (spec excluded, the six ledger events appended) was handed to the reviewers as a scratchpad file path (1100 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 1, low 5)
- defer: 0
- reject: 3 (low 3)
- note: rejected: (1) the shortcut fixes name `C:\GitHub\tk-studio\apps\supervisor` rather than the detected checkout. The matrix pins "runbook §4.3's target" for these fixes, and on the old layout the detected folder is the wrong one. (2) A relative `-File` target passes, yet `wt nt` may start the tab in its profile's folder. The previous pass ruled that a relative target resolves against Start in. Both writers emit absolute paths, and Windows Terminal's start folder depends on the profile, which cannot be checked here. (3) A `wt -d` start folder is not compared. No writer and no matrix shape uses `-d`.
- addressed_findings:
  - `[medium]` `[patch]` On a box that is not a source checkout, `startup-shortcut` passed a stale slot that still exists, or a loose folder holding a `start.ps1`. Its target must now be the current slot; otherwise it fails, naming what the `.lnk` runs and the current slot.
  - `[low]` `[patch]` `source_checkout` skipped the Design Notes clause that the git top must hold `.tk-studio/config.yaml`. The clause is added and pinned (`test_the_git_top_needs_a_studio_config_too`).
  - `[low]` `[patch]` An unquoted `-File` path with a space matched lazily and passed. The unquoted form can no longer span whitespace, and the check fails asking for quotes.
  - `[low]` `[patch]` The healthy cut-over test now asserts that the cut-over checks add no process call: the host calls equal those of the same box with no shortcut. This covers the boundary's "call counts hold".
  - `[low]` `[patch]` Runbook §4.5 step 4 and the handoff gave no command for queueing a job. They now name `bun src/cli.ts run studio-health --directory C:\GitHub\tk-studio` (from `apps\supervisor`) or `POST /jobs` with the bearer header.
  - `[low]` `[patch]` The runbook §4.5 and handoff `/status` call now also give the https form for when the TLS variables are set.

### 2026-10-17 — Review pass (second follow-up)
- note: follow-up review; both layers ran (band L). The diff since `4a3ab1a` (spec excluded) was handed to the reviewers as a scratchpad file path (1176 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 1, low 0)
- defer: 0
- reject: 4 (low 4)
- note: rejected: (1) `supervisor-root` and `supervisor-registry` accept any nested studio project, not only `supervisor`. The Code Map reads the id from the nested `.tk-studio/config.yaml` with the basename fallback (AD-20), and no other nested project ships a `start.ps1`. (2) A relative `-File` target may not run from Start in under `wt nt`, and (3) the source-checkout fixes name the fixed §4.3 target. Both were ruled on in the previous pass, and nothing new was raised. (4) A `.` or `..` segment in a shortcut path gives a false `fail`. No writer emits one, and the result is still a named failure with the §4.3 fix.
- addressed_findings:
  - `[medium]` `[patch]` The real old clone `C:\GitHub\tk-studio-supervisor` also holds `.tk-studio/config.yaml` (onboarded in `383a799`). So matrix row "Old layout" reported "repository top level", never "repository of its own"/"pre-cut-over". A `.git` folder holding `start.ps1` is now named as the pre-cut-over old clone, with or without the config. It is pinned by `test_old_onboarded_clone_fails_naming_its_own_repository`, which was red before the patch.

## Design Notes

- Cut-over date: 2026-10-16. The epic narrative names the cut-over as the "once for real, through protected `main`" motion (ADR §5). That is the merge of PR #118, `4c3ee36` at 2026-10-16T21:47:55-05:00. The box steps (shortcut retarget, doctor run, archive) are attended or operator steps that follow it.
- Nested detection uses a filesystem walk, never `git rev-parse` (the doctor starts no new process). The working directory is nested when it holds no `.git`, a proper ancestor does, and that ancestor holds `.tk-studio/config.yaml`.
- `unverifiable-here` (operator or attended). Record each verbatim in the Auto Run Result:
  - AC1 on the box: retarget the shortcut, `cd C:\GitHub\tk-studio\apps\supervisor; bun install --frozen-lockfile`, then `tk-studio doctor`.
  - AC2: `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/status` from another device, plus one queued job to a guarded end, both recorded in the PR.
  - AC3: `gh repo archive thkennedy/tk-studio-supervisor`, and `tk-studio-measure-push` for the ledger.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_installer_doctor tests.test_installer_apps -v`: the new `CutOver` cases pass.
- `git diff 4a3ab1a --stat -- tools/agent-pc/set-supervisor-env.ps1 apps/supervisor`: empty.
- `grep -c "Rehearsal hole (Epic 28" ~/.tk-studio/measurements/*.jsonl`: one per hole.

## Deviation Summary

### pass 1 (2026-10-17, implementer)

- planned: the missing-entry and differing-root registry rows both carry the fix `registry.py amend --project-id supervisor --writer activate --root <nested>` / actual: the differing-root row uses `amend`; the missing-entry row (and an absent registry file) uses `registry.py register --directory <nested> --writer activate --project-id supervisor` / why: `amend` refuses an id that is not registered ("project '<id>' is not registered"), so the planned fix would fail for a missing entry / may affect: none
- planned: `check_folder_trust`'s registry and `.claude.json` reads reused, a helper factored out "if needed" / actual: two helpers `_read_projects` and `_trusted_roots` (plus `_registry_path`); `check_folder_trust` rewritten to call them with identical output / why: the cut-over checks need the same reads; the existing FolderTrust tests pass unchanged / may affect: none

DRIFT: the missing-entry registry fix names `registry.py register`, not `amend` — `amend` refuses an unregistered id — affects: none
DRIFT: `check_folder_trust`'s reads factored into `_read_projects`/`_trusted_roots`/`_registry_path` — shared with the cut-over checks, output unchanged — affects: none

### pass 2 (2026-10-17, implementer, review patches)

- planned: the slot-box shortcut fix says `tk-studio update` rewrites the shortcut / actual: it says update rewrites it "when it installs a slot", plus a by-hand §4.3 line pointed at the current slot / why: update writes the shortcut only on a slot install / may affect: none
- planned: a checkout subfolder fails `supervisor-root` / actual: through doctor, the tightened `source_checkout` makes it no source checkout (the root checks are absent and the `supervisor` check names it); the `supervisor-root` rule is pinned by a direct call / why: patches 5 and 7 overlap / may affect: none
- planned: `%NAME%` expansion in `source_checkout` / actual: also in `startup-shortcut`'s working directory and `-File` target / why: one expanded path for the resolution and the comparison / may affect: none
- planned: fix runbook §4.3's sentence / actual: also §7's doctor paragraph / why: §7 stays true after the new skipped states / may affect: none

DRIFT: the slot-box shortcut fix is conditional on a slot install — update writes the shortcut only then — affects: none
DRIFT: a checkout subfolder is no source checkout (root checks absent, `supervisor` names it) rather than a failed `supervisor-root` — the tightened `source_checkout` overlaps the root rule — affects: none
DRIFT: `%NAME%` also expanded in `startup-shortcut` — the resolution and the comparison see one path — affects: none
DRIFT: runbook §7 updated with §4.3 — keeps the check list true — affects: none

### pass 3 (2026-10-17, implementer, follow-up review patches)

- deviations: none

## Consult Log

- 2026-10-17T03:54Z — trigger: deviation-gt-0 — question: accept the implementer's two score-1 deviations (registry fix split into amend/register; check_folder_trust reads factored into helpers)? — ruling: accept-deviation score 1 — do: keep both deviations as recorded; keep amend for a differing root and register for a missing entry or absent registry; leave the FolderTrust tests unedited — rule candidate: When an I/O-matrix fix names a registry.py verb, the planner checks the verb's preconditions (amend needs an existing id; register for a missing entry).
- 2026-10-17T04:05Z — trigger: deviation-gt-0 (review-patch pass) — question: accept the four score-1 deviations of the patch pass (conditional slot fix; subfolder no source checkout; %NAME% in startup-shortcut; runbook §7)? — ruling: accept-deviation score 1 — do: keep all four as applied and record each at score 1; keep the direct check_supervisor_root pin and the full-doctor test; add no matrix row for the subfolder — rule candidate: When a matrix row's fix names an installer verb, the planner checks the condition under which that verb writes and states it in the row.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Second follow-up review of the Story 28.4 change. The scope is unchanged:
- Four Windows-only, read-only doctor checks for the cut-over.
- The CLI treats a nested studio project inside a studio checkout as the supervisor's source checkout.
- The record is complete: runbook, AD-21, handoff, and six ledger holes.

This pass applied one patch. The real old clone holds `.tk-studio/config.yaml`, so `supervisor-root` named it "repository top level" rather than the pre-cut-over layout. It now names the matrix's "Old layout" wording.

**Files changed (this pass):**
- `tools/installer/cli/tk_studio_cli/doctor.py`: `check_supervisor_root` names a `.git` folder holding `start.ps1` as a repository of its own, the pre-cut-over old clone, whether or not it holds a studio config.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`: `test_old_onboarded_clone_fails_naming_its_own_repository`, with an old-clone fixture holding `.git`, `start.ps1` and `.tk-studio/config.yaml`.

**Review findings:** 1 patch applied (high 0, medium 1, low 0), 0 deferred, 4 rejected.

**Follow-up review recommendation:** false. One medium patch scores 3×1 + 1×0 = 3 (< 5), and none was high.

**Verification:**
- Lib suite: 1363 tests OK (1 skipped).
- Conformance: `ok: true`.
- `git diff 4a3ab1a --stat -- tools/agent-pc/set-supervisor-env.ps1 apps/supervisor` is empty.
- The ledger grep for `Rehearsal hole (Epic 28` counts 6.
- The runbook grep for `Story 28.4 rules|for now: the §4.2` is empty.
- The implementer confirmed the new test fails against the pre-patch `doctor.py`.

**unverifiable-here (operator or attended):**
- AC1 on the box:
  1. Retarget the Startup shortcut to `wt.exe -w studio nt --title supervisor pwsh -NoExit -File C:\GitHub\tk-studio\apps\supervisor\start.ps1`, with Start in `C:\GitHub\tk-studio\apps\supervisor`.
  2. Run `cd C:\GitHub\tk-studio\apps\supervisor; bun install --frozen-lockfile`, then `tk-studio doctor`.
  3. Expect `supervisor-root`, `supervisor-registry`, `supervisor-trust` and `startup-shortcut` to pass.
  4. If the registry disagrees, run `uv run C:\GitHub\tk-studio\plugins\tk-studio\lib\registry.py amend --project-id supervisor --writer activate --root C:\GitHub\tk-studio\apps\supervisor`.
- AC2:
  1. Start the supervisor from the console in its new root.
  2. From another device, run `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/status`, or `https://<TLS_NAME>:8787/status` when TLS is set.
  3. Queue one job to a guarded end: from `apps\supervisor`, run `bun src/cli.ts run studio-health --directory C:\GitHub\tk-studio`, or `POST /jobs`.
  4. Record both results in the Epic 28 loop PR (branch `loop/epic-28`).
- AC3:
  1. Tim runs `gh repo archive thkennedy/tk-studio-supervisor`. Never delete the repository.
  2. Run `tk-studio-measure-push` to bring the sandbox ledger's rehearsal-hole events into `measurements/` by PR.

**Residual risks:**
- The `.lnk` parser, the `-File` resolution and the slot comparison have run only against fake `.lnk` bytes and fixture slots. The real test is the attended doctor run on the box.
- A relative `-File` target still resolves against Start in, as the earlier pass ruled. If Windows Terminal starts the tab in its profile's folder, such a shortcut passes doctor but fails at sign-in. Both writers emit absolute paths.
- Shortcut paths are compared without resolving `.` or `..`. A hand-made shortcut that uses them fails with a named fix, even though it points at the right file.
- The ledger events are append-only and live in the sandbox store until pushed. Consolidation may see duplicates if the host ledger already holds some of these holes.

DRIFT: the missing-entry registry fix names `registry.py register`, not `amend` — `amend` refuses an unregistered id — affects: none
DRIFT: `check_folder_trust`'s reads factored into `_read_projects`/`_trusted_roots`/`_registry_path` — shared with the cut-over checks, output unchanged — affects: none
DRIFT: the slot-box shortcut fix is conditional on a slot install — update writes the shortcut only then — affects: none
DRIFT: a checkout subfolder is no source checkout rather than a failed `supervisor-root` — the tightened `source_checkout` overlaps the root rule — affects: none
DRIFT: `%NAME%` also expanded in `startup-shortcut` — the resolution and the comparison see one path — affects: none
DRIFT: runbook §7 updated with §4.3 — keeps the check list true — affects: none

## Reconcile

- 2026-10-17 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 28-5-one-checkout-lock-for-a-nested-project-and-its-repository
