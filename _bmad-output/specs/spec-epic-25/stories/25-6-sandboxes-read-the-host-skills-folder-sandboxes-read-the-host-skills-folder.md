---
title: 'Sandboxes Read the Host Skills Folder'
type: 'feature'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_revision: '4014b3c67adc6bd81d5dcae05fe0f59d9c9fa909'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/plans/25-6.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every engine sandbox gets its own marketplace copy of the plugin: `provision-engine.sh` runs `claude plugin marketplace add`/`install`/`update` at user scope inside the microVM. AD-21 and the red team's rule 2 replace that with Docker Sandboxes' read-only skills mount of the host's `~/.claude/skills`.

**Approach:** Provisioning stops installing the plugin and instead verifies the mount (present, read-only, `tk-studio@skills-dir` loaded, no shadowing marketplace copy), failing loudly naming the mount. Runbook §3.5/§3.8 document `sbx create` with the read-only skills mount and the "sandbox store" drift case; the kb records the flag, the operator's recreate commands and the syscall measurement (operator-pending, SPEC ruling 4).

User story (verbatim): As the operator, I want every engine sandbox to consume the host's `~/.claude/skills` through Docker's read-only skills mount instead of installing the plugin per sandbox, So that one install serves the host and every microVM and the drift check covers both.

Acceptance criteria (verbatim, epics.md Story 25.6):

- **AC1.** **Given** `tools/sbx-engine/provision-engine.sh` **When** it provisions a sandbox **Then** it no longer installs the plugin at user scope inside the microVM; it verifies the mounted skills folder is present and read-only and that `tk-studio@skills-dir` loads inside the sandbox, and fails loudly naming the mount when it is absent
- **AC2.** **Given** runbook §3.8 and §3.5 **When** the story lands **Then** `sbx create` is documented with the skills mount set read-only, the per-sandbox plugin install is removed from the provisioning list, and the "sandbox store" drift case (the mounted folder differing from the host's) is named with its fix
- **AC3.** **Given** one existing sandbox on the box **When** the operator recreates it with the mount (exact commands provided; from PowerShell, with the daemon running) **Then** `tk activate` inside it is clean on four planes, a headless drive of one skill from inside it substitutes `${CLAUDE_PLUGIN_ROOT}` to the mounted path, and the per-sandbox syscall cost of the skills folder is measured once and recorded in the kb (the red team's "prove it on the box" item)

## Boundaries & Constraints

**Always:** Bash for the sbx-engine scripts (`set -u`, explicit `exit 1` on failure since there is no `-e`); every check failure prints one line naming `/home/agent/.claude/skills` (or the overridden `SKILLS_MOUNT`) and its fix, then exits non-zero. Paths overridable for tests (`SKILLS_MOUNT`, `PROC_MOUNTS`, `claude` resolved from PATH). Lib test is stdlib `unittest`, `skipUnless(shutil.which("bash"))`, no network. Touch only the five plan Files. Verify gate green.

**Block If:** documenting the "sandbox store" case would need a new drift-check case, field or plane, or any `skills_plane.py`/`drift_check.py` change (driver-contract §6 surface, AD-19); keeping the store current would need the installer to run `sbx` (25.2/25.4 surface) — instead record a DRIFT with `affects: 25-7` and document the manual `sbx skills import` fix; the check would need to *uninstall* a marketplace copy (AC1 says only "verifies").

**Never:** recreate, exec, `sbx reset` or otherwise touch a sandbox from this session; run any `sbx` command (could auto-start the daemon); run the full `provision-engine.sh` here (it reinstalls bmad-loop under the live engine); run `claude plugin uninstall` from the check; add an sbx call to the installer; edit README or install runbooks beyond §3.5, §3.8 and the new kb section (25-7 owns those); fabricate a version or measurement.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ok | mounts row for `SKILLS_MOUNT` with `ro`; `tk-studio/.claude-plugin/plugin.json` present; fake `claude plugin list` shows `tk-studio@skills-dir` `✔ loaded`, no `tk-studio@tk-studio` | exit 0, one ok line | — |
| absent mount | no `/proc/mounts` row targeting the path | exit ≠0, line names mount + `sbx create … <readonly flag>` fix | loud fail |
| rw mount | row present, options lack `ro` | exit ≠0, names mount, says read-write, fix = recreate read-only | loud fail |
| empty mount | ro row, no `tk-studio/.claude-plugin/plugin.json` | exit ≠0, names mount, fix = `tk-studio install` on the host (then `sbx skills import` if the store is a copy) | loud fail |
| not loaded | folder ok, list lacks `tk-studio@skills-dir` loaded | exit ≠0, names mount | loud fail |
| shadowed | list also shows `tk-studio@tk-studio` | exit ≠0, fix names `claude plugin uninstall tk-studio@tk-studio --scope user` (and `--scope project`); never runs it | loud fail |

</intent-contract>

## Code Map

- `tools/sbx-engine/provision-engine.sh` -- 108 lines; header l.2–7; `set -u` l.8; `step()` l.12; `step plugin` l.79–82 (marketplace add/install/update) to be replaced by `step skills-mount` calling the new check and exiting 1 on its failure; `claude-flags` l.84–95 and `store`/`resolve` l.97–104 stay (store runs from the studio checkout mount, not the skills folder).
- `tools/sbx-engine/check-skills-mount.sh` (new) -- order: mount point via `/proc/mounts` target match → `ro` in options → `tk-studio/.claude-plugin/plugin.json` exists → `claude plugin list` shows `tk-studio@skills-dir` with `✔ loaded` → no `tk-studio@tk-studio` copy. Probe output format: `kb/offline-install-runbook.md` l.219–224 (`❯ tk-studio@skills-dir` / `Status: ✔ loaded`).
- Observed here (claude-tk-studio, 2026-10-15): `/proc/mounts` row `host /home/agent/.claude/skills virtiofs ro,nosuid,nodev,relatime 0 0`; folder empty; `tk-studio@tk-studio` 0.2.16 present at user and project scope (old provisioning).
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py` -- READ-ONLY. `_claude_home` l.282 already reads `/home/agent/.claude` inside a sandbox; plugin plane `check_plugin` l.331; four planes bmad-base/plugin/store/vault. Sandbox store drift surfaces as plugin plane `stale` (or `missing` when empty) — document only.
- `plugins/tk-studio/lib/skills_plane.py` -- READ-ONLY; `FIX_*` l.27–31 wording reusable in fix lines.
- `kb/agent-pc-setup-runbook.md` -- §3.5 l.358–410 (add skills-mount note: experimental, mode set at creation only, never `sbx reset`); §3.8 l.506–628: `sbx create` l.521 gains the read-only skills flag; provisioning list l.527–538 drops "the tk-studio plugin at user scope" (l.538), gains "verifies the read-only skills mount"; provision command l.545; name "sandbox store" case + fix.
- `kb/offline-install-runbook.md` -- precedent §"Skills-dir plugin: the on-box probe (Story 25.2)" l.191–250; append §"Sandboxes read the host skills folder (Story 25.6)".
- Docker docs digest: `_bmad-output/planning-artifacts/research/studio-native-overlap-and-greenfield-2026-10-09/digests/C1-redteam-1.md` F2 — `--skills readonly|readwrite|off` at creation only; docs disagree on default; store at `%LOCALAPPDATA%\DockerSandboxes\sandboxes\state\agent-skills` filled by `sbx skills import` ("replaces the complete skill directory"); `sbx reset` clears it. Source https://docs.docker.com/ai/sandboxes/workflows/agent-skills/ (may be unreachable; then record the digest's flag, to be confirmed by `sbx create --help` on the box).

## Tasks & Acceptance

**Execution:**
- `tools/sbx-engine/check-skills-mount.sh` -- create the check per the I/O matrix, overridable via `SKILLS_MOUNT` (default `$HOME/.claude/skills`), `PROC_MOUNTS` (default `/proc/mounts`), `claude` on PATH -- AC1 verify-and-fail-loudly.
- `tools/sbx-engine/provision-engine.sh` -- remove l.79–82; add `step skills-mount` running the check from the script's own directory, `exit 1` on failure; update header comment -- AC1 no per-sandbox install.
- `plugins/tk-studio/lib/tests/test_sbx_skills_mount.py` -- drive the check with fake mounts file, temp folders, fake `claude` script on PATH for all six matrix rows; assert each failure exits non-zero and names the mount path; assert `provision-engine.sh` contains no `claude plugin install` / `marketplace add` and does invoke the check -- AC1 proof.
- `kb/agent-pc-setup-runbook.md` -- §3.5 and §3.8 edits per Code Map -- AC2.
- `kb/offline-install-runbook.md` -- append the 25.6 section: the flag as found (and source), the observed `/proc/mounts` row, live-mount vs copy as the docs say, the "sandbox store" case and fix, the operator recreate commands (PowerShell, `sbx daemon status` first, a sandbox with no run in flight, `tk-studio install` on host, `sbx rm` + `sbx create … --skills readonly …`, provision), the in-sandbox proof commands (`tk activate` four planes, headless `claude -p` skill drive printing `${CLAUDE_PLUGIN_ROOT}` = `/home/agent/.claude/skills/tk-studio`, syscall measurement e.g. `strace -c -f` of a `claude plugin list`), results `pending: operator` -- AC3 commands.

**Acceptance Criteria:**
- Given the lib suite, when `tests.test_sbx_skills_mount` runs, then all six matrix rows pass and the provision-script assertions hold (AC1).
- Given this engine sandbox, when `bash tools/sbx-engine/check-skills-mount.sh` runs, then it exits non-zero naming `/home/agent/.claude/skills` (empty mount) — the AC1 loud failure, output recorded.
- Given the runbook, when §3.5/§3.8 are read, then `sbx create` carries the read-only skills flag, the plugin install line is gone from the provisioning list, and "sandbox store" is named with its fix (AC2; `grep -n` evidence).
- Given AC3, when the story lands, then the kb holds the exact operator commands with results `pending: operator` (unverifiable-here).

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- layers: blind-hunter, edge-case-hunter (band M, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 2: (high 0, medium 0, low 2): `claude plugin list` skills-dir format "never observed" (it was observed in 25.2's on-box probe, `kb/offline-install-runbook.md` l.219–224, and the fixture matches it); AC3 evidence missing (an operator step by design, SPEC ruling 4)
- addressed_findings:
  - `[medium]` `[patch]` the shadow check ran after the loaded check, so a real shadowing copy got the validate fix and not the uninstall fix; it now runs first, with a new test for "copy listed, skills-dir not loaded"
  - `[medium]` `[patch]` `claude plugin list` ran in the provisioning cwd, so a project-scope copy went unseen and the check said ok; it now runs from `PROJECT_DIR` (provision passes `$PROJ`), with a test
  - `[low]` `[patch]` the empty-mount message said "empty or stale" and gave no `--force`; it now says "empty" and gives `sbx skills import --force`
  - `[low]` `[patch]` the leftover `tk-studio` marketplace registration was not cleaned up; the shadowed fix and both runbooks now add `claude plugin marketplace remove tk-studio`
  - `[low]` `[patch]` §3.8 now says project scope is the project checkout's tracked `.claude/settings.json`, so the removal is a change to commit
  - `[low]` `[patch]` the kb open points now include whether `sbx skills import` follows a Windows junction (`--link` mode)

### 2026-10-15 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band M, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 6: (high 0, medium 0, low 6): empty-store fix lacks a restart step (the matrix pins the fix wording; the restart is in the runbook's drift case); a leftover `tk-studio` marketplace with no installed copy passes (it loads nothing, so it shadows nothing); the drift check's `stale`/`missing` for a skills-dir install is "asserted, not shown" (it exists: `skills_plane.py` cases ok/stale/missing/shadowed, l.32–34); unverified `--skills` flag and import behaviour (AC3 is an operator step by design, SPEC ruling 4; kept as residual risk); the tk-studio sandbox runs the last-imported plugin (the documented "sandbox store" case, DRIFT affects 25-7); skills-dir entry loaded from a project `.claude/skills/tk-studio` instead of the mount (a scenario the story does not name; AC1 asks that `tk-studio@skills-dir` loads)
- addressed_findings:
  - `[medium]` `[patch]` the shadow check matched only `tk-studio@tk-studio`; driver-contract §6 counts any `tk-studio@<m>` but skills-dir. It now matches every copy, names one uninstall per copy, and adds `claude plugin marketplace remove tk-studio` only for the tk-studio copy (that message unchanged); tests for another and for two marketplaces
  - `[low]` `[patch]` a failing `claude plugin list` fell through to the "not loaded … validate" fix; it now fails with `cannot be checked: claude plugin list failed: <first line>`, with a test
  - `[low]` `[patch]` `provision-engine.sh` comments said the sandbox reads the host folder; they now say the mount is the shared store, a copy filled by `sbx skills import`
  - `[low]` `[patch]` §3.8's pre-create step said plain `sbx skills import`; now `--force`, matching the drift case and the FAIL line
  - `[low]` `[patch]` the garbled old-sandbox cleanup sentence in the §3.8 provisioning bullet is rewritten as clean prose, same content
  - `[low]` `[patch]` `test_check_never_uninstalls_or_calls_sbx` skipped whole message lines, so `fail "..."; sbx rm x` passed; it now strips quoted text, inspects `$(...)`/backtick bodies, checks every line, and self-checks against that sample

### 2026-10-15 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band M, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 5: (high 0, medium 0, low 5): tk-studio's tracked `.claude/settings.json` keeps a project-scope `tk-studio@tk-studio` entry (verified false: the tracked file has no tk-studio entry; this sandbox's project-scope copy is recorded in the sandbox home's `~/.claude/plugins/installed_plugins.json`); AC3 still open and the import behaviour unverified (an operator step by design, SPEC ruling 4; kept as residual risk); the import shares all host skills with every sandbox (not named by the ACs; the copy semantics are documented); the new test resolves `REPO_ROOT/tools/sbx-engine` with no skip (same precedent as `test_installer_apps.py`, `test_installer_live.py`; the gate runs from the repo); the plugin plane may not recognise `tk-studio@skills-dir` (it does: the drift check already names `/home/agent/.claude/skills/tk-studio` here)
- addressed_findings:
  - `[medium]` `[patch]` the loaded check passed on any `tk-studio@skills-dir` `✔ loaded` and ignored its `Path:`, so a project `.claude/skills/tk-studio` satisfied it while nothing loaded from the mount; it now requires `Path:` = `$MOUNT/tk-studio`, and a loaded entry from elsewhere (or with no `Path:` line) fails with its own line; test `test_skills_dir_loaded_from_another_path`. The previous pass rejected this as not named; the consult (below) rules it is AC1's own subject
  - `[low]` `[patch]` the shadow fix named `--scope user` and `--scope project` but not `--scope local`; it now names all three (pinned substrings unchanged), test and kb updated
  - `[low]` `[patch]` `claude plugin list` was unbounded, so a stall hung provisioning; it now runs under `timeout -k 5 $LIST_TIMEOUT` (default 120) when `timeout` is on PATH and fails with `cannot be checked: claude plugin list timed out after <n>s`; test `test_plugin_list_times_out`
  - `[low]` `[patch]` both runbooks said `tk activate` shows an empty store as `missing`, but with an empty store the activate skill is not loaded; they now say `check-skills-mount.sh` reports it first and the drift check runs from the studio checkout mount (`uv run /c/GitHub/tk-studio/plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory <project>`); case name and fix unchanged

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green, including `test_sbx_skills_mount`.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `bash tools/sbx-engine/check-skills-mount.sh; echo $?` -- expected: one failure line naming `/home/agent/.claude/skills`, exit ≠0.

## Deviation Summary

### pass 1 (2026-10-15, implementer)

- planned: the sandbox reads the host skills folder (live mount) / actual: Docker docs (https://docs.docker.com/ai/sandboxes/workflows/agent-skills/, fetched HTTP 200) say the sandbox skills store is a copy filled only by `sbx skills import`; a host `tk-studio install`/`update` reaches sandboxes only after a manual import, documented in both runbooks; no `sbx` call added to the installer / why: spec Block If prescribes recording this as a deviation for 25-7 rather than changing the installer / may affect: 25-7
- planned: kb headless drive prints `${CLAUDE_PLUGIN_ROOT}` = `/home/agent/.claude/skills/tk-studio` / actual: the kb command drives `/tk-studio:tk-studio-activate` and greps stream-json for the substituted `/home/agent/.claude/skills/tk-studio/skills/tk-studio-activate/scripts/drift_check.py` path / why: the mount is read-only, so 25.2's test-only probe skill cannot be added inside the sandbox / may affect: none
- planned: six matrix rows + provision-script assertions / actual: also a listed-but-not-loaded test and a never-uninstalls-or-calls-sbx test in the same file / why: pin the `✔ loaded` and never-uninstall rules directly / may affect: none

DEVIATION SCORE: 1

DRIFT: the sandbox skills store is a copy of the host folder filled by `sbx skills import`, not a live view; host install/update needs a manual import, documented, no installer change — Docker docs state it and the spec's Block If forbids adding sbx to the installer — affects: 25-7 (consult: score 2 — 25-7's rewrite of both runbooks must keep "after `tk-studio install`/`update` on the host, run `sbx skills import`")
DRIFT: the AC3 headless drive greps the substituted mounted path from `/tk-studio:tk-studio-activate` instead of a probe skill echoing `${CLAUDE_PLUGIN_ROOT}` — the read-only mount cannot take a probe skill — affects: none
DRIFT: two extra tests beyond the matrix (listed-not-loaded, never-uninstalls/never-sbx) — pin AC1 rules directly — affects: none

### pass 2 (2026-10-15, implementer: review patches)

- planned: run the listing from `${PROJECT_DIR:-$PWD}` with a plain subshell cd / actual: a missing PROJECT_DIR fails loudly with one line ("cannot be checked: PROJECT_DIR … is not a directory") / why: a failed cd would otherwise give an empty listing and the wrong fix / may affect: none
- planned: the shadowed fix names `--scope project` / actual: the wording is "(and --scope project, from the project)" / why: project scope is listed and uninstalled only from the project dir / may affect: none

DEVIATION SCORE: 1 (consult: accept-deviation score 1). Story deviation_score stays 2, the maximum across passes.

DRIFT: a missing PROJECT_DIR fails the check with its own loud line — a silent cd failure would give the wrong fix — affects: none
DRIFT: the shadowed fix wording adds ", from the project" to `--scope project` — project scope resolves only from the project dir — affects: none

### pass 3 (2026-10-15, implementer: follow-up review patches)

- planned: the shadowed row names `tk-studio@tk-studio` / actual: any `❯ tk-studio@<m>` but skills-dir counts, one uninstall per copy, the marketplace removal only for the tk-studio copy; the tk-studio message is byte-identical / why: driver-contract §6 defines `shadowed` as any marketplace copy / may affect: none
- planned: no failing-list case / actual: a non-zero `claude plugin list` fails with its own line / why: otherwise the check gives the validate fix for an auth or runtime error / may affect: none
- planned: — / actual: an extra two-marketplace test beyond the requested ones / why: pins the per-copy fix list / may affect: none

DEVIATION SCORE: 1 (consult: accept-deviation score 1). Story deviation_score stays 2, the maximum across passes.

DRIFT: the shadow check matches any `tk-studio@<m>` except skills-dir, following driver-contract §6; the tk-studio@tk-studio message is unchanged; a failing list is reported as its own cause — the matrix row named one instance of the contract's class — affects: none

### pass 4 (2026-10-15, implementer: follow-up review 2 patches)

- planned: the matrix's "not loaded" row asks only that `tk-studio@skills-dir` is listed `✔ loaded` / actual: the loaded entry counts only when its `Path:` is `$MOUNT/tk-studio`; a loaded entry from another path, or with no `Path:` line, fails with its own line; one matching entry among several passes / why: AC1 verifies the mounted folder loads, and AC3 needs `${CLAUDE_PLUGIN_ROOT}` on the mounted path / may affect: none
- planned: — / actual: `claude plugin list` bounded by `timeout` (`LIST_TIMEOUT`, default 120); 124/137 read as a timeout only when `timeout` ran / why: a stalled listing must fail loudly, not hang provisioning / may affect: none

DEVIATION SCORE: 1 (consult: accept-deviation score 1). Story deviation_score stays 2, the maximum across passes.

DRIFT: loaded check counts a tk-studio@skills-dir entry only when its Path: is $MOUNT/tk-studio; a loaded entry from another path, or with no Path: line, fails with its own line; one matching entry among several passes; 124/137 is read as a timeout only when timeout ran — affects: none

## Consult Log

- 2026-10-15T00:42Z — trigger: deviation-gt-0 — question: accept the three 25-6 deviations (store is a copy filled by `sbx skills import`; AC3 drive greps the substituted path; two extra tests), and at what score? — ruling: accept-deviation score 2 — do: Record the deviation summary at score 2; keep the copy-not-live DRIFT tagged `affects: 25-7` with a note that 25-7's rewrite of `kb/offline-install-runbook.md` and the agent-PC runbook must keep the step "after `tk-studio install`/`update` on the host, run `sbx skills import`"; accept deviations 2 and 3 as local (score 1, affects: none) with no code change; do not add an sbx call to the installer. — rule candidate: When a story's Block If prescribes recording a finding with `affects: <later story>`, score the deviation 2 by default (the named later story inherits the seam), with no consult needed unless the finding also breaks an AD or the story's own "so that".
- 2026-10-15T00:47Z — trigger: deviation-gt-0 (review patch pass) — question: accept the pass-2 deviations (loud PROJECT_DIR-not-a-directory guard; "--scope project, from the project" wording)? — ruling: accept-deviation score 1 — do: keep both deviations as written; optionally add a test for a non-directory PROJECT_DIR (not taken: optional); change no other file — rule candidate: a guard that turns a silent precondition failure into the spec's one-line loud fail, or wording that keeps every substring the I/O matrix pins, is a score-1 deviation and needs no consult.
- 2026-10-15T00:54Z — trigger: deviation-gt-0 (follow-up review patch pass) — question: accept widening the shadow check from the matrix's `tk-studio@tk-studio` to driver-contract §6's any `tk-studio@<m>` (tk-studio message unchanged), plus the failing-list line, and at what score? — ruling: accept-deviation score 1 — do: Keep the widened shadow check, the separate failure line for a failing `claude plugin list`, and the three new tests exactly as they are in the working tree; Add one line to the story's deviation log: "shadow check matches any `tk-studio@<m>` except skills-dir, following driver-contract §6. The tk-studio@tk-studio message is unchanged. A failing list is reported as its own cause. Affects: none." — rule candidate: When an I/O matrix row names one concrete instance of a class the driver contract defines more broadly, implement the contract's class and test the matrix instance word for word; widening this way scores 1 and needs no consult, as long as the instance's output is unchanged and nothing downstream parses it. (observation recorded)
- 2026-10-15T01:02Z — trigger: deviation-gt-0 (follow-up review 2 patch pass) — question: accept the loaded check's new `Path:` = `$MOUNT/tk-studio` requirement (a missing `Path:` line fails; one matching entry among several passes) and the timeout's 124/137 reading as a score-1 deviation? — ruling: accept-deviation score 1 — do: Keep patch 1 as it is in the working tree, including the hard requirement for a `Path:` line, plus choices (b) and (c); do not tolerate a missing Path: line; Add one line to the story's deviation log: "loaded check counts a tk-studio@skills-dir entry only when its Path: is $MOUNT/tk-studio; a loaded entry from another path, or with no Path: line, fails with its own line; one matching entry among several passes; 124/137 is read as a timeout only when timeout ran. Affects: none." — rule candidate: When a check tightens a matrix row so that only the AC's own subject counts (e.g. "loads" means "loads from the mount being verified"), and the tightened case fails closed with its own one-line message while the matrix's pinned lines stay unchanged, score it 1; no consult needed. (observation recorded)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio install (the installer writes the skills-dir plugin folder <home>/skills/tk-studio/); remove the marketplace copy shadowing the skills-dir folder: claude plugin uninstall tk-studio@tk-studio --scope user; claude plugin marketplace remove tk-studio; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This is the second follow-up review of the done story, re-entered at step 4. Engine sandboxes no longer install the plugin in each microVM. `provision-engine.sh` runs `step skills-mount`, which calls the verify-only `check-skills-mount.sh`. It checks, in order:
1. the `/proc/mounts` row;
2. `ro`;
3. the `tk-studio/.claude-plugin/plugin.json` folder;
4. that no marketplace copy `tk-studio@<m>` shadows the plugin (listed from the project dir, bounded by a timeout);
5. that `tk-studio@skills-dir` is `✔ loaded` with its `Path:` on the mount (new in this pass).

Each failure prints one line that names the mount and its fix, then exits 1. The runbooks (§3.5, §3.8, and the kb 25.6 section) document `sbx create --skills readonly`, drop the per-sandbox install, and name the "sandbox store" drift case with its fix.

**Files changed (this pass)**
- `tools/sbx-engine/check-skills-mount.sh`:
  - The loaded entry must be the mount's copy. A loaded entry from another path, or with no `Path:` line, fails with its own line.
  - The shadow fix also names `--scope local`.
  - `claude plugin list` is bounded by `timeout -k 5 $LIST_TIMEOUT` (default 120) and has its own timed-out line.
- `plugins/tk-studio/lib/tests/test_sbx_skills_mount.py`:
  - New tests: `test_skills_dir_loaded_from_another_path` and `test_plugin_list_times_out`.
  - `test_shadowed` now asserts `--scope local`.
  - `_run` takes extra env.
- `kb/offline-install-runbook.md`, 25.6 section:
  - Item 5 requires the `Path:`.
  - The fix names `--scope local`.
  - The failing-list sentence mentions the timeout.
  - The empty-store drift wording is fixed.
- `kb/agent-pc-setup-runbook.md`, the §3.8 "sandbox store" paragraph: an empty store is reported by the check first, and the drift check runs from the studio checkout mount.

**Acceptance**
- AC1: met. The lib tests pass, and the check run in this sandbox fails loudly (output below).
- AC2: met. See runbook §3.5 and §3.8.
- AC3: unverifiable here (operator step, SPEC ruling 4). From PowerShell on TIM-PC-2, with `sbx daemon status` running and a sandbox that has no run in flight:
  1. `tk-studio install`
  2. `sbx skills import --force`
  3. `sbx rm claude-<project>`
  4. `sbx create --skills readonly --name claude-<project> claude C:\GitHub\<project> C:\GitHub\tk-studio:ro`
  5. Provision the sandbox, then run the in-sandbox proof from `kb/offline-install-runbook.md` §"Operator step: recreate one sandbox with the mount (AC3)": the four-plane drift check, the headless `claude -p "/tk-studio:tk-studio-activate"` path grep, and the `strace` measurement.

  Results: `pending: operator`.

**Review findings (this pass):** 4 patches applied (1 medium, 3 low), 0 deferred, 5 rejected (reasons in the Review Triage Log). One consult (deviation-gt-0) ruled accept-deviation score 1.

**Follow-up review:** recommended (`followup_review_recommended: true`). Patched counts: high 0, medium 1, low 3. Score = 3×1 + 3 = 6, which is at least 5.

**Verification**
- `uv run python -m unittest discover tests` from `plugins/tk-studio/lib`: Ran 1140, OK (1 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bash tools/sbx-engine/check-skills-mount.sh` exits 1:
  `skills-mount FAIL: /home/agent/.claude/skills has no tk-studio/.claude-plugin/plugin.json (the shared store is empty): run tk-studio install on the host, then sbx skills import --force there (the store is a copy of the host folder, not a live view)`

**Residual risks**
- The `--skills` flag has not been checked against `sbx create --help` on the box.
- Three things about `sbx skills import` are unknown: whether it copies a plugin-shaped folder (no top-level `SKILL.md`), whether it follows a `--link` junction, and whether it copies `.tk-studio.previous`. If any of them goes the wrong way, every engine sandbox fails provisioning, and there is no per-sandbox fallback.
- The loaded check now requires the `Path:` line that Claude Code 2.1.300 prints. If a future CLI drops it, provisioning fails with its own line instead of passing.
- Sandboxes provisioned before this change, including this engine sandbox, fail the check until their marketplace copies and the `tk-studio` marketplace are removed by hand.
- After a host install or update, the operator must run `sbx skills import --force` by hand (DRIFT, affects 25-7).
- The `sbx skills import` copies every host skill into the shared store, so engine sandboxes also load the operator's other host skills.

DRIFT: the sandbox skills store is a copy of the host folder filled by `sbx skills import`, not a live view; a host install or update needs a manual import, which is documented, with no installer change — the Docker docs state it and the spec's Block If forbids adding sbx to the installer — affects: 25-7 (consult: score 2; 25-7's rewrite of both runbooks must keep "after `tk-studio install`/`update` on the host, run `sbx skills import`")
DRIFT: the AC3 headless drive greps the substituted mounted path from `/tk-studio:tk-studio-activate` instead of a probe skill echoing `${CLAUDE_PLUGIN_ROOT}` — the read-only mount cannot take a probe skill — affects: none
DRIFT: tests were added beyond the matrix (listed-not-loaded, shadowed-and-not-loaded, project-dir listing, never-uninstalls/never-sbx, other/two-marketplace shadow, failing list, loaded-from-another-path, list timeout) — they pin AC1 rules and the review patches directly — affects: none
DRIFT: a missing PROJECT_DIR fails the check with its own loud line — a silent cd failure would give the wrong fix — affects: none
DRIFT: the shadowed fix wording adds ", from the project" (and now `--scope local`) to `--scope project` — project and local scope resolve only from the project dir — affects: none
DRIFT: the shadow check matches any `tk-studio@<m>` except skills-dir, following driver-contract §6; the tk-studio@tk-studio message is unchanged; a failing list is reported as its own cause — the matrix row named one instance of the contract's class — affects: none
DRIFT: loaded check counts a tk-studio@skills-dir entry only when its Path: is $MOUNT/tk-studio; a loaded entry from another path, or with no Path: line, fails with its own line; one matching entry among several passes; 124/137 is read as a timeout only when timeout ran — affects: none

## Reconcile

### 2026-10-15 — adjust-stories

- Score: 2
- Reasoning: The one cross-story deviation is that the sandbox skills store is a copy filled by `sbx skills import`, not a live view. This was the outcome the spec's Block If anticipated: the story recorded it with `affects: 25-7`, documented the manual import in both runbooks, and added no sbx call to the installer. The mechanism AD-21 names (Docker's read-only skills mount, no per-sandbox install) is what landed, so no AD, contract or ruling is contradicted; red-team rule 2's "one install serves the host and every sandbox" now holds through install plus `sbx skills import --force`, which is a documented step, not a changed criterion. 25-7 rewrites both runbooks the step lives in, and its notes can absorb that. Every other DRIFT line is local (`affects: none`), and no later epic names 25.6, `provision-engine.sh` or the mount.
- Affected: 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in — "the offline runbook describes the skills-dir write from a downloaded zip" (the rewrite must keep 25.6's sections and the "after `tk-studio install`/`update` on the host, run `sbx skills import --force`" step)
- Invariant: none
- Gate: Part A adjust-stories; Part B story accepted, planned 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in
