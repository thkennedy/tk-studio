---
title: 'Doctor Says What Is Wrong'
type: 'feature'
created: '2026-10-14'
status: done
baseline_revision: b3d6e1784a6cd56db832cfb5d9f34da47c5d4cdd
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/plans/25-5.md'
warnings: ['oversized']
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** A fresh machine reaches a working studio only by reading runbook §7 by hand. The landed 25.4 `tk-studio doctor` reports only the plugin folder's mode and the supervisor/web slots: no roster comparison, no `/status` probe, no trust or smoke checks.

**Approach:** Extend the landed doctor (never a second one). A new `doctor.py` runs every check below and reports each as `{check, status: pass|fail|warn|skipped, detail, fix}`. `--json` prints one JSON object ending with the AD-11 status block, and a conformance drive covers it. Runbook §7 shrinks to "run `tk-studio doctor`" plus the rows the CLI cannot check.

Story text (ST-085, transcribed, authoritative):

- **AC1.** Given `tk-studio doctor`, when it runs, then it checks and reports, each with pass, fail and the fix:
  - Claude Code version against the roster floor;
  - the skills-dir plugin against the roster (Story 25.3's cases);
  - the per-user store;
  - `sbx daemon status` **only** (it never runs an sbx command that would auto-start the daemon);
  - folder trust (`hasTrustDialogAccepted`) for every root in the registry (holes 14 and 15);
  - long paths;
  - the PATH launcher;
  - the Tailscale certificate age against its 90-day life;
  - the supervisor's slot or checkout and whether `/status` answers;
  - and, when a Hermes home exists on the box, whether `auth.adopt_external_logins` is on (a warning that names the setting and the Claude-login risk).
- **AC2.** Given `--json`, when it runs headless, then the output is one JSON object and ends with the status block (AD-11); a conformance drive covers it.
- **AC3.** Given runbook §7, when the story lands, then its smoke table says "run `tk-studio doctor`" and keeps only the rows the CLI cannot check (RDP scope, the Startup shortcut's visible tab).

Replan rulings carried in (25-2, 25-3 and 25-4 reconciles, 2026-10-14):

- Report a leftover `.tk-studio.retired` or `.tk-studio.new` (the leg's `retired_left`), a leftover `<root>/tools/cli-update.cmd` or its log, stale `.previous` slots, and DW-12.
- Read `settings.json` and `.claude.json` for marketplace entries; never edit them.
- Report the plugin plane's results as they are:
  - `ok`;
  - `stale`, naming the channel;
  - `missing`, which includes a folder with no `.claude-plugin/plugin.json`;
  - `shadowed`;
  - `error`, which carries no case and is a failed read with its path.
- A foreign marketplace catalog is a note, never a failure. Driver-contract §6 at 0.1.19 is the reference.
- Fixes reuse the landed refusal names: `RosterInvalid` (roster level) and `RosterEntryInvalid` (entry level).

## Boundaries & Constraints

**Always:**
- The CLI wheel stays sealed: stdlib only, and nothing is imported from `plugins/`.
  - Shared code is a byte-identical copy in `plugins/tk-studio/lib/<x>.py` and in `tk_studio_cli/<x>.py`.
  - `test_installer_bootstrap.py` pins each copy, using the `SharedGuard` identity and stdlib-AST pattern.
- Doctor is read-only. It writes, deletes and renames nothing, not even a leftover `cli-update.cmd`; it never calls `remove_cli_helper` or any leg.
- The only processes doctor starts are `claude --version`, `sbx daemon status` and `git config --global --get core.longpaths`, all through `ctx.runner` and each bounded by a timeout.
- Doctor's only network call is the `/status` probe, through `ctx.probe` (`probe_url`/`default_probe`), plus the roster fetch when `--roster` is a URL or absent (landed behaviour).
- A missing `sbx` or `git` is `skipped`, never `fail`.
- A Windows-only check (LongPathsEnabled, the Startup shortcut, the HKCU store) reports `skipped` with detail `windows only` on other platforms.
- A roster component absent from the channel is reported as `skipped`, with detail "not shipped in <channel>", never as `fail` (SPEC ruling 1).
- The store check uses the drift check's store-plane pass criteria and detail wording (SPEC ruling 7): `store.check_store`, and `drift_check.check_store` plus `FIX_STORE`.
  - The CLI cannot import those modules, so a test pins the CLI's verdict to theirs on the same fixtures.
- The registry is read through a byte-identical `miniyaml.py` copy: `<store>/registry/projects.yaml`, `projects.<id>.root`. Never a second YAML parser.
- Every non-`pass` check carries a non-empty `fix`.
- Every other verb's JSON line and the status-block schema stay unchanged.
- Lib tests make no network call. They use the `_no_network` guard and the `FakeHost`/`FakeFetch`/`FakeStore`/`FakeClock` from `test_installer_apps.py`.

**Block If:**
- The Files list in `plans/25-5.md` would grow. Record the deviation and HALT; a `bmad-correct-course` split is the operator's call.
- Meeting AC2 would need a change to `status-block.schema.json` or to another verb's JSON line.
- Covering the CLI in conformance would need a non-additive change to driver-contract §8 or to the manifest's `surfaces` shape.
- Extracting the plugin plane changes any landed drift-check result, that is, a 25.3 test goes red.

**Never:**
- Never run any `sbx` verb other than `daemon status`.
- Never edit `settings.json` or `.claude.json`.
- Never let the CLI import `drift_check`.
- Never add a new leg status.
- Never bump plugin, roster or contract release versions beyond the additive contract clause.
- Never release, push or tag.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| claude-code check | `claude --version` prints `2.1.230 (Claude Code)`; the floor is `>=2.1.224` | `pass`, with both versions in the detail | Below the floor: `fail`, fix names the floor. Exe not found or unparseable output: `fail`. A roster refusal: `fail`, and the fix names the refusal (`RosterInvalid`/`RosterEntryInvalid`/fetch failure) |
| plugin check | the extracted plane against the roster's `plugin` version | Mapped: `ok`→`pass`; `stale` (names the channel), `missing`, `shadowed` and `error`→`fail`. The plane's `case`, `detail` and `fix` are carried verbatim | A foreign catalog is a note in the detail, never a `fail`. Roster has no `plugin`: `skipped`, not shipped |
| plugin leftovers | `<config>/skills/.tk-studio.retired` or `.tk-studio.new` exists | `warn`, naming the path and the fix | Absent: not reported, or `pass` |
| store check | Absent, partial, unreadable config, missing keys, or complete | The same verdict as the drift-check store plane: `ok` is `pass`, `missing`/`drift` is `fail` with `FIX_STORE` | — |
| sbx-daemon | The runner runs `sbx daemon status`, which exits 0 | `pass` | Non-zero exit: `fail`; the fix names starting the daemon through the sign-in task or `start.ps1`. Not found: `skipped` |
| folder-trust | One check entry per registry root (`folder-trust:<id>`) | `pass` when `.claude.json` `projects[<root>].hasTrustDialogAccepted` is true. Keys are matched by normalized path: slashes unified, case-folded on Windows | Unaccepted or absent: `fail`, fix "open Claude Code in <root> and accept the trust dialog". Empty registry: `skipped`. Unreadable registry or `.claude.json`: `fail`, naming the path |
| long-paths | Windows: HKLM `LongPathsEnabled` = 1 and git `core.longpaths` = true | `pass` | Either one off: `fail`, and the fix names it. Non-Windows: `skipped` |
| path-launcher | `<root>/bin/tk-studio(.exe)` exists and `<root>/bin` is on PATH (process PATH; on Windows also the HKCU `Path`) | `pass` | Otherwise `fail`; fix: rerun the bootstrap |
| tailscale-cert | `TK_SUPERVISOR_TLS_CERT`, read through `apps._var` | Pass when the age (notBefore, or file mtime when unparseable, against `ctx.clock`) is under 90 days | 90 days or older, or expired: `fail`; fix: restart the supervisor tab (`tailscale cert`). Unset: `skipped`. Set but missing file: `fail` |
| supervisor | A slot in `current.json`, or a source checkout (process-free `.lnk` read) | `pass` when the `/status` probe answers; the detail names the slot or checkout | No answer: `fail`, fix: start the Startup shortcut. Not installed: `fail`, fix `tk-studio install`. Not shipped: `skipped`. Stale `.previous` slots: `warn` |
| studio-web / DW-12 | `current.json` `studio-web.path` | `pass` when the path exists and is not a `.previous` path | A missing path or a `.previous` path: `fail`, naming the path (DW-12); fix `tk-studio update`. Not shipped: `skipped` |
| cli-update helper | `<root>/tools/cli-update.cmd` or `.log` exists | `warn`, naming the files (and the log tail) | Absent: not reported. Never deleted |
| hermes-logins | `%LOCALAPPDATA%\hermes` exists; `config.yaml` sets `auth.adopt_external_logins: true` | `warn`, naming the setting and the Claude-login risk; fix: set it `false` and run `hermes gateway restart` | Off or absent key: `pass`. Unreadable: `warn`, naming the path. No Hermes home: the check is not reported |
| --json | `tk-studio doctor --json --roster <path>` | stdout is exactly one JSON object; its last four keys are `status, intent, artifacts, reason` | Landed fields and `checks[]` come before them. `status` is `complete`. `reason` is null, or names every failing check. Exit 0 |
| human | `tk-studio doctor` | One `_lines` line per check (status, check, detail, fix), then the JSON line (landed `main` behaviour) | — |

</intent-contract>

## Code Map

The plan's Code Map (`plans/25-5.md`) is the investigation. Its anchors were spot-checked at HEAD 9968cde and hold. The key points:

**`tools/installer/cli/tk_studio_cli/main.py`**
- `build_parser` l.59–80: `doctor` gains the `roster` parent (`--roster`/`--channel`) and `--json`.
- `run` l.97: doctor branch at l.107–109.
- `main` l.153–173: prints `_lines`, then the JSON.

**`tools/installer/cli/tk_studio_cli/plugin_leg.py`**
- `doctor` l.611 (the landed fields; keep them).
- `load_roster` l.127, with the `Refusal` names at l.148/163.
- `config_dir` l.62, `claude_json_path` l.69, `folder_paths` l.78 (target, `STAGING` `.tk-studio.new`, `PREVIOUS`), `RETIRED` l.36.
- `project_entries` l.505, `_result` l.562.

**`tools/installer/cli/tk_studio_cli/apps.py`**
- `default_probe` l.188, `Ctx`/`make_ctx` l.246/263.
- `read_current` l.314, `_current_slot` l.346, `stale_slots` l.356.
- `source_checkout` l.516, `_hermes_pair` l.542 (the `%LOCALAPPDATA%\hermes` seam).
- `_var` l.693, `probe_url` l.701.
- `CLI_HELPER`/`CLI_HELPER_LOG` l.1164; `remove_cli_helper` deletes, so doctor must not call it.
- `_slot_report` l.1428, `supervisor_report` l.1435, `doctor_fields` l.1448.
- PATH launcher l.1293/1300.
- Add a read-only seam for the HKLM `LongPathsEnabled` value (`winreg`, injectable on `Ctx`).

**`tools/installer/cli/tk_studio_cli/roster_guard.py`**
- `_FLOOR` l.28; the roster's `requires.claude-code` is `>=2.1.224`.

**`plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`**
- `FIX_*` l.63–75 and `roster_guard` re-export l.176.
- `_CASE_ORDER` l.286, `_claude_home`/`_read_json_file`/`_is_ours`/`_marketplace_copies` l.289–354, `_roster_plugin_version` l.355, `_skills_dir_check` l.383–503.
- `check_store` l.544 (`FIX_STORE` wording).
- Extract the skills-dir plane into `skills_plane.py`, taking the roster plugin version and channel as parameters, then re-export it. Every landed drift-check result stays the same.

**`plugins/tk-studio/lib/store.py`**
- `STORE_DIRS`, `REQUIRED_CONFIG_KEYS`, `check_store` l.256.

**`plugins/tk-studio/lib/registry.py`**
- `registry_path` l.57, `list_projects` l.76.

**`plugins/tk-studio/lib/miniyaml.py`**
- stdlib only (`re`, `pathlib`); copy it byte-identical.

**Conformance (`plugins/tk-studio/contracts/conformance/`)**
- `runner.py`: `discover_surfaces` l.88 and `_run_drive` l.196.
- `manifest.json`: the `surfaces` map.
- `status-block.schema.json` lives in `plugins/tk-studio/contracts/` (`additionalProperties: false`).

**Runbook**
- `kb/agent-pc-setup-runbook.md` §7, l.869–885.

**Tests**
- `plugins/tk-studio/lib/tests/test_installer_apps.py`: `FakeHost` l.142/165, `FakeFetch` l.84, `FakeStore` l.96, `FakeClock` l.127, `setUp` l.248, `_no_network` l.279, `full_roster` l.358, `run_cli`/`main_out` l.376/385, `Doctor` l.1516.
- `test_installer_bootstrap.py` `SharedGuard` l.47–79.
- `test_installer_plugin_leg.py` doctor tests at l.324–345 and l.665 must stay green.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/skills_plane.py` and `tools/installer/cli/tk_studio_cli/skills_plane.py` (new, byte-identical): `_skills_dir_check` and its helpers, with the roster plugin version as a parameter. Stdlib only.
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: import and re-export from `skills_plane`. The behaviour stays the same and the 25.3 tests stay green.
- `tools/installer/cli/tk_studio_cli/miniyaml.py` (new, byte-identical copy): the registry and store config reads.
- `tools/installer/cli/tk_studio_cli/doctor.py` (new): every check in the matrix, the `checks[]` list, the `_lines`, and the reason roll-up.
- `tools/installer/cli/tk_studio_cli/apps.py` (small): the `/status` probe in `doctor_fields`, the HKLM long-paths seam, and any read-only helpers the checks need.
- `tools/installer/cli/tk_studio_cli/main.py`: the doctor options; `--json` suppresses `_lines`; key order puts `status, intent, artifacts, reason` last.
- `plugins/tk-studio/contracts/conformance/runner.py` and `manifest.json` (additive): one CLI doctor drive, in a section outside `surfaces`.
  - It runs `sys.executable -m tk_studio_cli doctor --json --roster <repo>/tools/installer/rosters/latest.json`. The CLI is located from the runner's repository checkout.
  - The drive isolates `TK_STUDIO_HOME`, `CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME`/`LOCALAPPDATA` and a PATH with no `claude`, `sbx` or `git`.
  - It asserts: exactly one JSON object; the last keys are the status-block keys; their projection validates against the schema.
  - When the checkout's CLI is absent, the drive is recorded as `not run` with a reason, not as a failure.
- `plugins/tk-studio/contracts/driver-contract.md`: an additive 0.1.20 header clause, and §8 names the CLI doctor drive. Only if §8 must name it.
- `kb/agent-pc-setup-runbook.md` §7: a "run `tk-studio doctor`" row plus the RDP-scope row (§5 firewall) and the Startup shortcut's visible-tab row (§4.3). The other rows go.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py` (new): every matrix row, the read-only invariant, a store-verdict parity test against `store.check_store`, the `--json` shape, and no network. `test_installer_bootstrap.py`: identity and stdlib tests for `skills_plane.py` and `miniyaml.py`.

**Acceptance Criteria:**
- Given a fake host with every check failing, when `tk-studio doctor` runs, then every AC1 check appears as `fail` (or `warn` for Hermes) with a non-empty `fix`. The runner saw only the three allowed commands. The file tree is byte-for-byte unchanged.
- Given `--json`, when `main` runs, then stdout parses as exactly one JSON object, its final keys are `status, intent, artifacts, reason`, and that projection validates against `status-block.schema.json`.
- Given `runner.py run`, when conformance runs, then the CLI doctor drive is listed and passes, and `ok: true`.
- Given runbook §7, when read, then the table is the doctor row plus the RDP-scope and Startup-shortcut rows.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 3, low 1)
- defer: 0
- reject: 3 (runbook rows dropped — AC3 names the only two rows kept; Hermes line-scan fallback — the matrix says unreadable warns, and a second parser is forbidden; store non-UTF-8 parity — the lib raises, so there is no verdict to match)
- addressed_findings:
  - `[medium]` `[patch]` hermes-logins read YAML-1.1 truthy strings (`True`/`yes`/`on`) as "absent (off)": now judged as PyYAML does, and an unclear value warns (doctor.py:559-575; tests `Hermes`)
  - `[medium]` `[patch]` the conformance CLI drive passed a crashed doctor: it now requires exit 0 and status `complete` (runner.py:383-387; `ConformanceDrive.test_a_crashed_doctor_fails_the_drive`)
  - `[medium]` `[patch]` the certificate's `notBefore` and expired branches were untested: `TailscaleCertPem` covers them with an embedded self-signed PEM
  - `[low]` `[patch]` §8 misdescribed the drive's `PYTHONPATH`, the `state` field and the Windows registry isolation: wording made accurate (driver-contract.md:437-452)

### 2026-10-15 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 2, low 4)
- defer: 0
- reject: 8, each for one of these reasons:
  - **Trust inherited from a parent folder:** the matrix pins an exact `projects[<root>]` key, and Claude Code's parent walk cannot be confirmed in the repo.
  - **No warning band before the certificate expires:** the matrix pins pass under 90 days and fail at 90 or more.
  - **Runbook rows dropped:** AC3 names the only two rows kept. This repeats the prior pass's rejection.
  - **miniyaml rejects a real Hermes config:** the matrix says an unreadable config warns, and the prior pass rejected a second parser.
  - **`HERMES_HOME` and `~/.hermes`:** the matrix names `%LOCALAPPDATA%\hermes`.
  - **`sbx daemon status` exits 0 while the daemon is stopped:** the matrix pins exit 0 as pass.
  - **A linked plugin folder reported as stale:** this is the landed 25.3 plane, carried verbatim per the matrix.
  - **A `.cmd` shim grandchild outliving the timeout:** this is the landed `apps.default_runner`, not this story's code.
- addressed_findings:
  - `[medium]` `[patch]` hermes-logins folded case and treated `y`/`n` as booleans, so `n`, `nO` and `oFF` passed as "off" although PyYAML hands Hermes a truthy string. Now only the exact YAML-1.1 spellings PyYAML resolves count as booleans; every other string warns (doctor.py:43-47, 598-611; `Hermes.test_only_pyyaml_exact_spellings_are_bools`).
  - `[medium]` `[patch]` path-launcher compared the raw HKCU `Path`, which is REG_EXPAND_SZ and left unexpanded, so `%LOCALAPPDATA%\tk-studio\bin` failed although install.ps1:159-160 treats it as present. `%NAME%` is now expanded from `ctx.env`, case-insensitively, on Windows (doctor.py:388-429; `PathLauncher.test_an_unexpanded_hkcu_entry_passes`, `test_an_unknown_reference_stays_unexpanded`).
  - `[low]` `[patch]` folder-trust: `.claude.json` keys that collide after normalization kept the last record. An accepted record now wins (doctor.py:277, 318-326; `FolderTrust.test_colliding_keys_prefer_the_accepted_record`).
  - `[low]` `[patch]` long-paths: git's `yes`, `on` and `1` true spellings for `core.longpaths` now pass (doctor.py:49, 374; `LongPathsWindows.test_git_boolean_true_spellings_pass`).
  - `[low]` `[patch]` §8 suite wiring had no test: `cli_drives` in the report, a failed drive in `failures[]` as `tk-studio-cli`, and `ok` false. `SuiteCliDrives` now pins it through `run_suite`.
  - `[low]` `[patch]` the supervisor's source-checkout matrix branch had no test. `SupervisorCheckout` now covers both the answering and the silent `/status` probe.

### 2026-10-15 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 5, each for one of these reasons:
  - **Runbook rows dropped (Godot, Blender, the sbx microVM, the Hermes gateway and so on):** AC3 names the only two rows kept. This repeats both earlier passes' rejection.
  - **miniyaml rejects a real Hermes config (flow collections):** the matrix says an unreadable config warns, and a second parser is forbidden. This repeats both earlier passes' rejection.
  - **`adopt_external_logins: 0` warns although PyYAML reads it as falsy:** a warn is the conservative outcome, and the matrix pins pass only for off or absent.
  - **`git config --global --get` misses a system-scope `core.longpaths`:** the Boundaries pin that exact command.
  - **No warning band before the certificate expires:** the matrix pins pass under 90 days. This repeats the first follow-up's rejection.
- addressed_findings:
  - `[medium]` `[patch]` hermes-logins: a quoted `"false"` or `'no'` passed as off. miniyaml strips the quotes, but PyYAML gives Hermes a truthy string. Both review layers found this; it was the first follow-up's recorded residual risk. Now a targeted raw-line read (`_hermes_value_quoted`, not a parser) sees the quote, and a quoted value can never be a bool: it warns "not clearly off" and names the quoted value (doctor.py:603-621, 626-647; `Hermes.test_quoted_value_is_a_string_never_a_bool`).
  - `[low]` `[patch]` hermes-logins: a BOM-prefixed `config.yaml` turned the first key into `﻿auth`, so an enabled setting read as absent and passed. The config is now read as `utf-8-sig` (doctor.py:592-595; `Hermes.test_bom_does_not_hide_the_auth_block`).

## Design Notes

- **Doctor's status.** Doctor's own status stays `complete` whatever the checks find; this matches the landed doctor, which reports a missing folder as `complete`. `reason` names the failing checks; the schema allows a string reason. Exit code is 1 only on `blocked` (usage errors and stray exceptions), as landed.
- **The plugin plane.** The extracted plane is fed the roster plugin version from `load_roster(...)["components"]["plugin"]["tag"]`. `marketplace_path=None` (the CLI is never in a developer checkout) and `claude_home=config_dir(env)`.
- **The `--json` shape:**
  ```json
  {"mode": "...", "folder": "...", "root": "...", "supervisor": {...}, "studio_web": {...},
   "checks": [{"check": "claude-code", "status": "pass", "detail": "2.1.230 >= 2.1.224", "fix": null}],
   "status": "complete", "intent": "tk-studio-cli-doctor", "artifacts": [], "reason": null}
  ```

## Verification

**Commands** (the verify gate runs from `plugins/tk-studio/lib`):
- `uv run python -m unittest discover tests`: expected green.
- `uv run python ../contracts/conformance/runner.py run`: expected `ok: true`, including the doctor drive.
- From the repo root, with `UV_PROJECT_ENVIRONMENT`, `CLAUDE_CONFIG_DIR`, `XDG_DATA_HOME` and `TK_STUDIO_HOME` in the scratchpad: `uv run --project tools/installer/cli tk-studio doctor --json --roster tools/installer/rosters/latest.json`. Expected: one JSON object ending with the status block. Then `rm -f tools/installer/cli/uv.lock`.

**Unverifiable here:** doctor on TIM-PC-2, covering live trust, LongPathsEnabled, `sbx daemon status`, the certificate and Hermes. The operator runs `tk-studio doctor` there.

## Deviation Summary

### pass 1 (2026-10-14, implementer)

- planned: the `/status` probe result in `doctor_fields`, inside `supervisor` / actual: a new top-level `probe` field (`{url, answers}` or null) / why: the landed `Doctor.test_doctor_reports_slots_read_only` asserts the exact `supervisor` dict / may affect: none
- planned: certificate age against `ctx.clock` / actual: new injectable wall clock `Ctx.now` (default `time.time`) through `make_ctx` and `run` / why: `ctx.clock` defaults to `time.monotonic`, not wall time / may affect: none
- planned: the three processes run through `ctx.runner` / actual: each runs only when `shutil.which` finds it on doctor's PATH; an env with no PATH finds nothing (`claude` fails not found, `sbx`/`git` skipped) / why: landed read-only doctor tests assert zero runner calls / may affect: none
- planned: claude check fails on a roster refusal / actual: it also skips running `claude --version` then; the plugin check fails with the folder detail plus the refusal / why: no floor to compare; keeps landed tests at zero runner calls / may affect: none
- planned: "not shipped in <channel>" and stale fix use `--channel` / actual: the loaded roster's own `channel` field / why: `--roster latest.json` with default `--channel stable` names the wrong channel / may affect: none
- planned: drive isolates TK_STUDIO_HOME, CLAUDE_CONFIG_DIR, XDG_DATA_HOME/LOCALAPPDATA, PATH / actual: also APPDATA, HOME, strips TK_SUPERVISOR_* and PYTHONPATH; report gains top-level `cli_drives` / why: keep the real shortcut and supervisor vars out of the drive / may affect: none
- planned: driver-contract 0.1.20 only if §8 must name the drive / actual: unchanged / why: runner section additive outside `surfaces`; `test_driver_contract.py` pins 0.1.19, a bump would grow Files / may affect: none
- planned: checks are `{check, status, detail, fix}` / actual: the plugin check also carries `case`; extra checks `plugin-leftovers`, `stale-slots`, `cli-update-helper`, `studio-web` / why: the matrix carries the case verbatim; the replan rulings name these reports / may affect: none
- implementer risk: landed `Entrypoint.test_python_m_doctor_prints_one_json_last_line` runs doctor without `--roster`, so it now attempts the default roster URL fetch and a real `claude --version`; the file is outside Files and was left alone.

DRIFT: doctor's `/status` probe is a top-level `probe` field, not inside `supervisor` — a landed test pins the supervisor dict — affects: none
DRIFT: `Ctx.now` wall-clock injectable added for certificate age — `ctx.clock` is monotonic — affects: none
DRIFT: doctor's three processes run only when found on its PATH (`shutil.which`) — landed read-only doctor tests assert zero runner calls — affects: none
DRIFT: a roster refusal also skips `claude --version` — no floor to compare — affects: none
DRIFT: doctor names the loaded roster's `channel`, not `--channel` — a path roster carries its own channel — affects: none
DRIFT: the CLI drive also isolates APPDATA/HOME and strips TK_SUPERVISOR_*/PYTHONPATH; the conformance report gains a top-level `cli_drives` field — keeps host state out of the drive — affects: none
DRIFT: driver-contract left at 0.1.19 (no §8 clause) — the runner section is additive outside `surfaces` and a bump would grow Files — affects: none
DRIFT: plugin check carries `case`; extra checks `plugin-leftovers`, `stale-slots`, `cli-update-helper`, `studio-web` — the matrix and replan rulings name them — affects: none

### pass 2 (2026-10-15, implementer)

- planned: the 0.1.20 change touches the version cell, its history and §8 / actual: also added `ST-085` to the contract's "Story / rulings" row / why: every earlier bump lists its story there / may affect: none
- pass 1's driver-contract deviation (left at 0.1.19) is resolved by this pass's 0.1.20 bump.

DRIFT: driver-contract "Story / rulings" row gains ST-085 — every earlier bump lists its story there — affects: none

## Consult Log

- 2026-10-15T00:00:09Z — trigger: deviation-gt-0 + file-outside-files — question: accept the implementer's eight pass-1 deviations (incl. driver-contract left at 0.1.19 despite a new top-level `cli_drives` conformance report field), and may the landed subprocess test test_installer_plugin_leg.py:1033-1042 (now fetches the default roster URL, breaching "Lib tests make no network call") be patched outside Files? — ruling: escalate — do: accept seven Part A deviations at score 1 (probe field, Ctx.now, shutil.which gate, refusal skips claude --version, roster channel, extra drive isolation, case + four extra checks); do not accept driver-contract left at 0.1.19 nor deferring Part B; HALT under Block If "Files would grow" and ask the operator whether Files may gain lib/tests/test_driver_contract.py (additive 0.1.20, §8 names manifest `cli_drives` and the report's `cli_drives`) and lib/tests/test_installer_plugin_leg.py (pass --roster <repo>/tools/installer/rosters/latest.json, PATH without claude, TK_STUDIO_HOME/LOCALAPPDATA/APPDATA/HOME in tmp); consult recommends growing Files by those two test files over a correct-course split — rule candidate: a story that changes the conformance runner's report or manifest shape lists driver-contract.md and test_driver_contract.py in Files; a story widening a CLI verb's network or process reach lists every landed subprocess test of that verb

- 2026-10-15T00:07:54Z — trigger: deviation-gt-0 — question: accept pass-2's ST-085 added to driver-contract's Story / rulings row beyond the planned 0.1.20 edits? — ruling: accept-deviation score 1 — do: keep the ST-085 entry at driver-contract.md:6; record the deviation at score 1 and carry on — rule candidate: a plan-allowed contract version bump also covers adding the bumping story to the contract's Story / rulings row

## Rulings received (2026-10-14)

The Block If (Files would grow) is ruled by the operator's delegate per the consult's recommendation: plans/25-5.md Files now includes `plugins/tk-studio/lib/tests/test_driver_contract.py` (the 0.1.20 pin) and `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py` (the one entrypoint test, `--roster` plus an isolated env). No split. Continue from pass 1: finish the two test edits, run the verify gate, then review.

## Remaining work (pass 2, per the ruling above)

Pass 1's code is already in the working tree (uncommitted, baseline b3d6e17); keep it and finish only this:
- `plugins/tk-studio/contracts/driver-contract.md`: additive **0.1.20** header clause (the version cell and its history), and §8 names the conformance manifest's `cli_drives` section and the report's top-level `cli_drives` field (the CLI doctor drive, `not run` with a reason when the checkout's CLI is absent).
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: pin 0.1.20 heading the header (the 0.1.19 clause survives in the history, as the 0.1.18→0.1.19 tests do), and assert §8 names `cli_drives`.
- `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py`, `Entrypoint.test_python_m_doctor_prints_one_json_last_line` only: pass `--roster <repo>/tools/installer/rosters/latest.json`, and an isolated env (PATH without `claude`/`sbx`/`git`; `TK_STUDIO_HOME`, `LOCALAPPDATA`, `APPDATA`, `HOME` in tmp; `TK_SUPERVISOR_*` stripped) so it makes no network call and starts no process.
- Then run the verify gate and the `## Verification` CLI command.


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio install (the installer writes the skills-dir plugin folder <home>/skills/tk-studio/); remove the marketplace copy shadowing the skills-dir folder: claude plugin uninstall tk-studio@tk-studio --scope user; claude plugin marketplace remove tk-studio; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of the landed story (commits 334c587 and a26b855), over the full diff since b3d6e17. The story is band L, so both review layers ran. Their findings dedupe to 7:
- 2 patched;
- 5 rejected, each one pinned by the intent contract or already rejected in an earlier pass.

Both patches harden the `hermes-logins` check:
- A quoted `"false"` (or `'no'`) now warns as "not clearly off" instead of passing. This closes the first follow-up's residual risk.
- A BOM-prefixed `config.yaml` no longer hides the `auth` block.

No contract surface changed. No consult trigger fired.

**Files changed (this pass):**
- `tools/installer/cli/tk_studio_cli/doctor.py`: `check_hermes` reads the file as `utf-8-sig`, and the new `_hermes_value_quoted` raw-line helper keeps a quoted value from being taken as a bool.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`: new `Hermes` tests for quoted values and the BOM.

**Review.** 2 patches applied (1 medium, 1 low); 0 deferred; 5 rejected (reasons in the triage log).

**Follow-up review:** not recommended. Patched findings were 0 high, 1 medium, 1 low. Score: 3 × 1 + 1 × 1 = 4, which is under 5.

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: 1123 tests OK, 1 skipped (the pre-existing live probe).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true` with 0 failures. `cli_drives` shows `cli-doctor-json` ok: "one JSON object, status block last (complete, exit 0)".
- `uv run --project tools/installer/cli tk-studio doctor --json --roster tools/installer/rosters/latest.json`, with an isolated scratch home: exit 0, one JSON object whose last keys are `status, intent, artifacts, reason`, status `complete`, 10 checks. `uv.lock` was removed afterwards.
- The implementer ran the new tests against the pre-patch `doctor.py`: 4 of 9 `Hermes` tests failed.

**Unverifiable here.** The live checks run only on TIM-PC-2: folder trust, LongPathsEnabled, the HKCU `Path` expansion, `sbx daemon status`, the certificate and Hermes. The operator runs `tk-studio doctor` there.

**Residual risks.**
- A quoted true spelling now warns as "not clearly off" rather than "is on". It is still a warning, but the wording is softer.
- `adopt_external_logins: 0` warns, although PyYAML would read it as falsy. This is conservative.
- miniyaml still cannot read flow collections, so on such a Hermes config the check warns "unreadable" and does not read the setting.
- On Windows the conformance drive still reads the real HKCU and HKLM. It asserts only shape and status.
- Certificate parsing uses the private `ssl._ssl._test_decode_cert`, with the file's modified date as the fallback.

DRIFT: none this pass (deviation score 0 for the patches; the story's frontmatter score of 1 from passes 1 and 2 stands).

## Reconcile

- 2026-10-15 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 25-6-sandboxes-read-the-host-skills-folder
