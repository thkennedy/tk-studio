---
title: 'The Bootstrap and the Meta-CLI'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_revision: '6079bbcdcded8a894a034b6b9f7e287d2c559cc3'
review_loop_iteration: 0
deviation_score: 2
reconcile_verdict: adjust-stories
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md'
warnings: [oversized]
deferred:
  - summary: >-
      A studio-web update while the supervisor leg is `reported` (source checkout) or `skipped` renames the live studio-web slot aside with nothing restarted, so a running supervisor may serve a renamed path.
    evidence: |-
      apply_slots computes restart = live_sup only when the supervisor leg is `unchanged`; for `reported`/`skipped` restart is None, must_start is False, and swap() still renames the old web slot to .<version>.previous. Consult 2026-10-14 ruled a `reported` studio_web status out of scope for a review patch (AC3 is supervisor-only, spec Design Notes; a new leg status needs a planned I/O-matrix entry). Deferral rule (a): behaviour AC2 names (the supervisor serves the studio-web slot). Reader: 25-5.
    location: >-
      tools/installer/cli/tk_studio_cli/apps.py apply_slots / run_legs
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Story 25.4 (ST-084), as a newcomer: "I want one command that installs a small self-updating CLI, and that CLI to install and update the three apps from the roster, So that I never clone a repository or hand-edit an environment to run the studio." Today only the meta-CLI's plugin leg exists (25.2). There is no bootstrap script, no supervisor leg, no studio-web leg and no `status` verb.

**Approach:** Add `tools/installer/install.ps1` and `install.sh`. Extend the landed `tools/installer/cli/tk_studio_cli` package with the supervisor, studio-web and cli legs and the `status` verb, and add source-checkout reporting to `update` and `doctor`. Every roster read goes through the one guard, which moves into a stdlib module shipped byte-identical in the plugin lib and in the wheel (consult ruling, see Consult Log).

**Acceptance criteria (verbatim, epics.md Story 25.4):**
- AC1. **Given** `tools/installer/install.ps1` and `install.sh` **When** either runs **Then** it installs the pinned `uv` unmanaged into the studio's tools folder (version and SHA-256 embedded in the script), verifies the meta-CLI wheel's digest, runs `uv tool install` from that wheel, puts only the studio's `bin` directory on the user PATH, turns on long paths for git, never clones, and the README publishes each script's SHA-256 with a download-verify-run alternative.
- AC2. **Given** the meta-CLI `tk-studio` (stdlib Python, shipped as a wheel on its own `cli--vX.Y.Z` tag) **When** `install`, `update` or `status` runs **Then** the supervisor leg downloads the release zip by tag, verifies it, unpacks it into `%LOCALAPPDATA%\tk-studio\supervisor\<version>\` (or the platform equivalent), runs `bun install --frozen-lockfile` with the roster's pinned Bun, and writes the User environment and the Startup shortcut through the logic lifted from `tools/agent-pc/set-supervisor-env.ps1` (token and session secret generated once and kept). It then points `current.json` at the slot. The studio-web leg unpacks the bundle into its own slot, which the supervisor serves. `update` stops the service tab first, renames the old slot aside, verifies the new one starts, and deletes the old slot on the next successful start. `status` prints each component's installed and roster versions.
- AC3. **Given** a machine where the supervisor runs from a git checkout (the dev box) **When** `update` or `doctor` runs **Then** it recognises "source checkout" mode, reports instead of replacing, and names the checkout.
- AC4. **Given** the lib suite **When** it runs **Then** every verb is exercised against a fake roster, a fake release host and a fake `claude`, including the digest-mismatch, the stale-slot and the source-checkout cases, and no network call is made in tests.

## Boundaries & Constraints

**Always:**
- Extend the landed package. Keep its `Refusal` names, its `<Name>: <detail>` reasons, exit codes 0/1/2, the `--help` JSON line, `default_runner(args, env)` and the plugin leg's top-level result fields, so the 25.2 tests stay green.
- Each verb ends with one AD-11 JSON line.
- The CLI stays stdlib-only and imports nothing under `plugins/`.
- Every roster is validated by `roster_guard.roster_problems`. A non-empty result refuses `RosterInvalid` naming the problems. Every fake roster in the tests passes the guard.
- An absent component means "not shipped in this channel". That leg reports it and changes nothing.
- For `uv` and `bun`, select the running platform's key from the `sha256` map. A missing key refuses `PlatformNotPinned` and names the target.
- Honour `source` on foreign entries: download from the entry's `url` and report its `source`.
- SHA-256 is checked before anything is extracted or installed. A mismatch refuses `DigestMismatch` and changes nothing.
- Writes are atomic: temp then rename, or stage then swap.
- Slot root, per AD-15 and SPEC ruling 6:
  - Windows: `%LOCALAPPDATA%\tk-studio`
  - Linux: `$XDG_DATA_HOME/tk-studio` (default `~/.local/share/tk-studio`)
  - macOS: `~/Library/Application Support/tk-studio`
  - The root is resolved from the `env` mapping and an injectable platform, never hard-coded.
- The token, the session secret and any other credential never appear in output, events or tracked files (NFR5).
- Tests make no network call. They inject fetch, runner, probe and platform, and every path lives under a temp dir.
- Sandbox verification runs with `UV_PROJECT_ENVIRONMENT` outside the mount. No `uv.lock` is committed.

**Block If:**
- Making the verify gate pass would need a change to a driver-contract surface or schema.
- Making the verify gate pass would need a change to a 25.1–25.3 refusal name or result field that a landed test pins.

**Never:**
- Clone a repository.
- Resolve `/releases/latest`.
- Fabricate or placeholder a digest. The roster gets no `cli` or `supervisor` entry in this story, because adding one needs the operator's release.
- Run the release motion, push, tag or bump `pyproject.toml`.
- Pattern-kill processes by name. Stopping targets only processes whose command line contains the current slot's path.
- Carry the `-WithTls` / Tailscale certificate fetch into the CLI.
- Add a second CLI or a second roster parser.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| fresh install | roster has `supervisor`, `studio-web`, `bun`; no slots | bun unpacked to `tools/bun-<v>/`; supervisor slot unpacked; `bun install --frozen-lockfile` run there; env and shortcut written (Windows); `current.json` names both slots; started and `/status` answered | none |
| same version | `current.json` already at the roster's versions | leg `unchanged`; nothing stopped or renamed | none |
| update | old slot running, roster newer | stop the old slot's processes → probe goes quiet → new slot unpacked and installed → old slot renamed `.<old>.previous` → `current.json` moved → start → `/status` answers | probe still answering after stop → `ServiceStillRunning`, nothing renamed or repointed |
| stale slot | a `.<v>.previous` slot was left by an earlier update | deleted after this run's successful start; listed in `deleted_stale` | delete fails → `partial`, and the reason names the path |
| start fails | new slot never answers `/status` within the timeout | `SupervisorStartFailed`; the old slot is kept aside and named in the reason | blocked |
| digest mismatch | zip, wheel or bun archive bytes ≠ roster sha | `DigestMismatch` naming the component; no slot, folder or `current.json` change | blocked |
| platform not pinned | `bun.sha256` lacks the running target | `PlatformNotPinned: components.bun.sha256 has no <target>` | blocked |
| not shipped | roster lacks `supervisor` / `studio-web` / `cli` | `"not shipped in this channel"` for that leg | none |
| source checkout | Startup shortcut's working dir holds `.git` outside the slot root | `update`: supervisor leg `{mode: "source checkout", checkout: <path>}`, nothing replaced; `doctor` reports the same | none |
| secrets kept | `TK_SUPERVISOR_TOKEN` / `_SESSION_SECRET` / `_NTFY_URL` already set | kept, reported as `kept` (names only) | none |
| status | any state | one line per component (`plugin`, `supervisor`, `studio-web`, `cli`, `uv`, `bun`): installed vs roster (`not shipped` / `not installed` / `source checkout <path>`); JSON `components: {name: {installed, roster}}` | an unreadable roster blocks |

</intent-contract>

## Code Map

- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py:180-360`: the installer roster guard. It covers the constants `ROSTER_SCHEMA` … `_PLACEHOLDER_WORDS`, plus `_is_placeholder_text`, `_digest_problem`, `_url_repo`, `roster_problems` (`:214`), `_release_entry_problems` and `_tool_entry_problems`. It is pure and uses only `re`. Per the consult, move it verbatim into `plugins/tk-studio/lib/roster_guard.py`. drift_check imports it through its existing `sys.path` lib insert (`:55`) and re-exports the names, so that `drift_check.roster_problems` (called by `tools/release_archive.py:156` and by tests) still works.
- `tools/installer/cli/tk_studio_cli/plugin_leg.py`:
  - `:49` `Refusal`.
  - `:64-84` config paths.
  - `:86` `default_fetch` (https/file only).
  - `:93` `default_runner(args, env)`.
  - `:114` `load_roster`: validate through the guard here.
  - `:133-166` `plugin_entry_problems` / `check_plugin_entry`: the narrow second parser; reduce it to the guard.
  - `:326` `_unsafe_member`: reuse for every zip.
  - `:341` `write_from_zip`: the download → sha → zip-check → stage → swap pattern to mirror.
  - `:568` `run_leg`.
  - `:611` `doctor` (minimal; extend).
- `tools/installer/cli/tk_studio_cli/main.py:21,41-63`: `VERBS`, `build_parser` and `run`. Add `status`. `install` and `update` run the legs in order (see Design Notes).
- `tools/agent-pc/set-supervisor-env.ps1:56-137`: the logic to lift.
  - Variables: TK_STUDIO_ROOT, TK_SUPERVISOR_DB/BIND/TOKEN/SESSION_SECRET/TRANSCRIPT_BACKUP/WORK/NOTIFY/TELEGRAM_TOKEN/TELEGRAM_CHAT/NTFY_URL.
  - Keep-existing applies to TOKEN (32 bytes), SESSION_SECRET (48 bytes) and NTFY_URL (base64 / `tk-supervisor-<24 hex>`).
  - Folders sit under `C:\agent-work`.
  - The shortcut is `tk-studio supervisor.lnk` in Startup: `wt.exe -w studio nt --title supervisor pwsh -NoExit -File <dir>\start.ps1`, with the working dir set to `<dir>`.
  - The port defaults to 8787 and `/status` is the smoke probe.
- `tools/installer/rosters/latest.json`: the real roster today has `plugin`, `uv` 0.13.1 and `bun` 1.4.3, with no `cli`, `supervisor` or `studio-web`. Upstream asset names come from `kb/offline-install-runbook.md:180-190`:
  - uv: `uv-<triple>.zip` (Windows) or `.tar.gz`.
  - bun: `bun-windows-x64.zip`, `bun-linux-x64.zip` or `bun-darwin-aarch64.zip`, from `github.com/oven-sh/bun/releases/download/bun-v<v>/`.
- `tools/release_archive.py:74,168`: `cli` is built as a wheel from the `tools/installer/cli` subtree alone, which is why the guard needs a copy in the package. Read-only.
- `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py:22-80`: the harness to mirror. It covers the `sys.path` import of `CLI_ROOT`, `FakeFetch`, the fake runner and `roster_for`.
- `README.md:51-75`: "Quick start / 1. Install the plugin". Add a short bootstrap subsection here; the full install-section rewrite belongs to 25.7.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/roster_guard.py` (new) and `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`: move the guard verbatim and re-export it. The behaviour stays unchanged.
- `tools/installer/cli/tk_studio_cli/roster_guard.py` (new): a byte-identical copy.
- `tools/installer/cli/tk_studio_cli/plugin_leg.py`: `load_roster` runs the guard, and the narrow parser goes. Shared helpers (fetch and verify, safe unzip, data root) may move to a new module in the package.
- `tools/installer/cli/tk_studio_cli/apps.py` (new; the name is free): the supervisor, studio-web, bun and cli legs, the slots and `current.json`, the lifted env and shortcut logic, stop/start/probe, and source-checkout detection. Runner, probe, platform and env are all injectable.
- `tools/installer/cli/tk_studio_cli/main.py`: add the `status` verb and wire the legs into `install`, `update` and `doctor`. Update the docstring.
- `tools/installer/install.ps1` and `tools/installer/install.sh` (new): the bootstrap (see Design Notes).
- `README.md`: a "Bootstrap (one command)" subsection containing the one-liner, each script's SHA-256 and a download → `Get-FileHash` / `sha256sum -c` → run alternative.
- `.gitattributes`: pin `tools/installer/install.*` to `eol=lf`, so that the published SHA matches the served bytes. This is only needed if checkout would rewrite them.
- `plugins/tk-studio/lib/tests/test_installer_apps.py` (new): every verb (`install`, `update`, `doctor`, `status`) and every matrix row, against a fake roster (passing the guard), a fake release host and a fake `claude`/runner. The tests also check that the plugin leg still runs inside `install`, and that a socket guard proves there is no network.
- `plugins/tk-studio/lib/tests/test_installer_bootstrap.py` (new). It asserts that:
  - the two `roster_guard.py` copies are byte-identical;
  - both copies import only the stdlib;
  - each script's embedded uv version and SHA equal the roster's `uv` entry for its targets;
  - neither script contains `git clone`, `/releases/latest` or a PATH entry other than `<root>/bin`;
  - each script sets `core.longpaths`;
  - each script verifies the wheel's sha before `uv tool install`;
  - the README's published SHA-256 for each script equals `sha256(file bytes)`;
  - `bash -n install.sh` passes.

**Acceptance Criteria:**
- Given the lib suite, when `uv run python -m unittest discover tests` runs from `plugins/tk-studio/lib`, then it is green, with the new tests covering AC1–AC4 and the matrix.
- Given conformance, when `uv run python ../contracts/conformance/runner.py run` runs, then the result is `ok: true`.
- Given `uv run --project tools/installer/cli tk-studio status` in the sandbox, with `UV_PROJECT_ENVIRONMENT`, `CLAUDE_CONFIG_DIR` and `XDG_DATA_HOME` in the scratchpad and `--roster tools/installer/rosters/latest.json`, when it runs, then it prints one line per component and ends with a `complete` JSON line in which `supervisor`, `studio-web` and `cli` read `not shipped`.

## Consult Log

- 2026-10-14T22:17:23Z — trigger: halt — question: the 25-1 replan pins one roster guard (no second parser) but the wheel is built from tools/installer/cli alone and imports nothing from the plugin — which option? — ruling: apply (option 2) — do: move the guard's pure code into stdlib-only plugins/tk-studio/lib/roster_guard.py imported by drift_check; ship a byte-identical tk_studio_cli/roster_guard.py the CLI reads every roster through (narrow parser replaced); pin whole-file identity, stdlib-only imports, and every fake roster passing the guard with lib tests — rule candidate: code shared by the plugin and the sealed CLI wheel lives as a stdlib-only module in plugins/tk-studio/lib/ with a byte-identical copy in tk_studio_cli/, pinned by an identity test and a stdlib-imports test

- 2026-10-14T22:37:33Z — trigger: deviation-gt-0, file-outside-files — question: accept the implementer's 12 deviations (refusal split, stdlib .lnk read, --link plugin-only, install honours source checkout, test_installer_plugin_leg.py label)? — ruling: accept-deviation score 2 — do: keep all 12 as implemented; carry the RosterInvalid/RosterEntryInvalid split and the process-free .lnk source-checkout read into 25-5's replan (doctor reuses both); note in 25-7's replan that install --link runs only the plugin leg — rule candidate: when a spec's Always names a refusal or field a landed earlier-story test pins differently, the landed name wins (Block If outranks Always); record a score-2 drift, no consult

- 2026-10-14T22:54:12Z — trigger: deviation-gt-0 — question: accept the review-patch pass deviations (no top-level ps1 param block, ~/.bash_login, web rolled back on failed start, new leg statuses `restarted`/`scheduled` and per-leg `stale`, detached Windows helper replacing the .tk-studio.old rename, ps1 verified statically)? — ruling: accept-deviation score 2 — do: accept all six and name the new statuses, per-leg stale lists and `<root>/tools/cli-update.cmd` for 25-5/25-7; the helper installs only the verified local wheel and the next run reports and deletes a leftover helper; carry the install.ps1 live check as an open operator verification — rule candidate: a spec naming a self-update or slot-swap mechanism lists the allowed leg statuses as a closed set in its I/O matrix

- 2026-10-14T23:03:38Z — trigger: high-severity-finding — question: the Windows self-update helper is launched through the capturing runner (inherits pipes, deadlocks against the pid wait, installs into the locked env) — patch now or defer; and is a studio-web `reported` status under an unrestartable supervisor in scope? — ruling: apply — do: patch now (option 1): an injectable `spawn_detached` on Ctx (Windows: Popen with DEVNULL stdio, close_fds, DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP, never waits); `schedule_cli_install` launches only through it; keep `default_runner`, helper, log, `scheduled` and result keys; pin the launch path in tests; the studio-web patch is out of scope — no `reported` status on `studio_web`, file it as deferral (a) naming 25-5 — rule candidate: any code path that launches a process meant to outlive the CLI goes through a dedicated non-capturing detached spawner, never the capturing runner, and a test asserts which injectable the launch used

- 2026-10-14T23:14:03Z — trigger: deviation-gt-0 — question: accept the follow-up patch pass's four deviations (fixed TK_SUPERVISOR_* name list plus `WindowsUserEnv.names()`, a POSIX branch and ValueError catch in the detached spawner, `ServiceStillRunning` naming every answering URL, `studio_web` kept with no `status` on a refusal)? — ruling: accept-deviation score 2 — do: accept all four, 1-3 at score 1, 4 at score 2 (blocked-result shape 25-5 reads); record the DRIFT "on a `blocked` verb, a leg dict (`supervisor`, `studio_web`) with no `status` key means planned, not applied; its plan fields are present and the verb's `reason` carries the refusal"; change no code, the verify gate stands — rule candidate: a spec whose verbs can end `blocked` states in its I/O matrix which leg keys a blocked result carries and what a leg with no `status` means

## Deviation Summary

### pass 1 (2026-10-14, implementer)

- planned: any guard problem refuses `RosterInvalid` / actual: component-entry problems refuse `RosterEntryInvalid`, roster-level problems `RosterInvalid` / why: a landed 25.2 test pins `RosterEntryInvalid` (Block If) / may affect: 25-5
- planned: touch only named files / actual: one subtest key in `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py` reworded ("url: names tag") / why: the old wording was the removed narrow parser's; the guard words it differently / may affect: none
- planned: read the Startup shortcut's working dir via the runner / actual: stdlib `.lnk` parse from `%APPDATA%\...\Startup` / why: read-only doctor/status start no process (keeps the 25.2 "doctor makes no calls" test green on Windows) / may affect: 25-5
- planned: source-checkout on `update` and `doctor` / actual: `install` honours it too, replacing nothing / why: `install` on the dev box would otherwise rewrite its shortcut and slots / may affect: none
- planned: `install` runs every leg / actual: `install --link` links the plugin only; other legs `skipped` / why: landed 25.2 link tests use an empty fetcher / may affect: 25-5, 25-7
- planned: unspecified / actual: `supervisor` present but `bun` absent gives `bun: not shipped`, supervisor `skipped`, verb `complete` / why: a landed 25.2 test pins `complete` for that roster / may affect: none
- planned: old slot deleted on the next successful start / actual: earlier `.previous` slots (supervisor and studio-web) are deleted only after this run's supervisor start, else listed under `supervisor.stale` / why: timing for a web-only run was unspecified / may affect: none
- planned: folders under `C:\agent-work` / actual: existing `TK_SUPERVISOR_WORK` reused, else `<SystemDrive>\agent-work` / why: keeps the operator's value; testable under a temp dir / may affect: none
- planned: `bun install --frozen-lockfile` in the slot / actual: adds `--cwd <slot>` / why: runner `(args, env)` has no cwd / may affect: none
- planned: shortcut args exactly as the script / actual: `start.ps1` path quoted / why: `%LOCALAPPDATA%` may contain spaces / may affect: none
- planned: reuse `plugin_leg.default_runner` / actual: `apps.default_runner` with a 900 s timeout / why: `bun install` and `uv tool install` download / may affect: none
- planned: move the guard verbatim / actual: also dropped the now-unused `import re` in `drift_check.py` / why: unused after the move / may affect: none

DEVIATION SCORE: 2

DRIFT: guard refusals split into `RosterInvalid` (roster level) and `RosterEntryInvalid` (component entry) — a landed 25.2 test pins `RosterEntryInvalid` — affects: 25-5
DRIFT: source-checkout detected by a stdlib `.lnk` parse of the Startup shortcut, not via the runner — keeps read-only doctor/status process-free — affects: 25-5
DRIFT: `install` also honours source-checkout mode — avoids rewriting the dev box's shortcut and slots — affects: none
DRIFT: `install --link` runs the plugin leg only; other legs report `skipped` — landed 25.2 link tests use an empty fetcher — affects: 25-5, 25-7
DRIFT: `test_installer_plugin_leg.py` subtest key reworded (file outside the Tasks list) — the narrow parser's wording was removed with it — affects: none
DRIFT: minor local choices (stale-slot deletion timing, TK_SUPERVISOR_WORK reuse, `bun --cwd`, quoted shortcut arg, 900 s app runner, unused `import re` dropped) — unspecified or forced by the runner shape — affects: none

### pass 2 (2026-10-14, review patches + consult DO)

- planned: `install.ps1` top-level `param(-Channel, -Roster)` / actual: parsed from `$args` inside a `& { }` scriptblock / why: a top-level param leaks into the session under `irm | iex` / may affect: 25-7
- planned: `~/.profile` (+ zsh/bash profiles per review) / actual: also `~/.bash_login` when no `~/.bash_profile` / why: bash reads the first of the two / may affect: none
- planned: unspecified / actual: a failed supervisor start rolls studio-web back too; the failed new slot stays on disk, named in the reason / why: restores the last known-good pair / may affect: none
- planned: leg statuses as in pass 1 / actual: new `restarted` (supervisor, web-only change) and `scheduled` (Windows cli self-update); `stale` lists per leg (`studio_web.stale`); `update_helper` under `cli` on update, top-level `cli_update_helper` on other verbs / why: report the review-patch behaviours and the leftover helper / may affect: 25-5, 25-7
- planned: Design Note renames the running `tk-studio.exe` to `.tk-studio.old` / actual: on Windows a detached `<root>/tools/cli-update.cmd` waits for this pid, then `uv tool install --force <root>/tools/wheels/<verified wheel>`; the next run reports (with the log tail) and deletes it / why: the running tool environment's python.exe is locked on Windows / may affect: 25-5
- planned: `install.ps1` verified / actual: static tests only (no `pwsh` in the sandbox) / why: environment / may affect: operator verification on TIM-PC-2

DEVIATION SCORE: 2

DRIFT: new leg statuses `restarted` and `scheduled`, per-leg `stale` lists, `cli.update_helper` / `cli_update_helper` result keys — review patches (web slot before supervisor start; Windows self-update) — affects: 25-5, 25-7
DRIFT: Windows CLI self-update is a detached `<root>/tools/cli-update.cmd` helper, not the `.tk-studio.old` rename — the running tool environment is locked on Windows — affects: 25-5
DRIFT: `install.ps1` takes `-Channel`/`-Roster` from `$args` inside a scriptblock (no param block); one-liners pass `TK_STUDIO_CHANNEL`/`TK_STUDIO_ROSTER` — keeps `irm | iex` from leaking state or closing the window — affects: 25-7

### pass 3 (2026-10-14, follow-up review patches)

- planned: overlay `TK_SUPERVISOR_*` from `env_store` onto the CLI start env / actual: a fixed name list from `set-supervisor-env.ps1` plus a new `WindowsUserEnv.names()` that enumerates `HKCU\Environment` (names only ever reported) / why: the store could only `get` one name at a time / may affect: none
- planned: Windows detached spawner (consult DO) / actual: the default spawner also has a POSIX branch (`start_new_session=True`) and catches `ValueError` as well as `OSError` on launch, both refusing `CliUpdateFailed` / why: a safe default on every platform / may affect: none
- planned: `ServiceStillRunning` text / actual: names every URL still answering, comma-joined (refusal code and outcome unchanged) / why: the old and new bind addresses can differ / may affect: none
- planned: keep the `studio_web` leg dict on a refusal / actual: on a refusal `studio_web` carries the plan fields with no `status`, as `supervisor` already did / why: no new leg status values / may affect: 25-5

DEVIATION SCORE: 2

DRIFT: on a `blocked` verb, a leg dict (`supervisor`, `studio_web`) with no `status` key means planned, not applied; its plan fields are present and the verb's `reason` carries the refusal — no new leg status may be added by a review patch (consult 23:03 / spec:143 closed set) — affects: 25-5
DRIFT: the Windows self-update helper launches through a new injectable `Ctx.spawn_detached` (DEVNULL stdio, close_fds, DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP, no wait), never the capturing runner; the CLI start runs `wt … nt -d <slot>` with the User `TK_SUPERVISOR_*` values overlaid on its env — the capturing runner deadlocked the helper against its pid wait — affects: 25-5

### pass 4 (2026-10-14, follow-up review 2 patches)

- none: the nine patches change reason text, helper bytes, shortcut rollback, README commands and tests only; no new leg status, refusal name, result key or file outside the Tasks list

DEVIATION SCORE (this pass): 0

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 6, low 2)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` supervisor started before the studio-web slot was repointed; web-only update renamed a served slot; web `.previous` never deleted without a supervisor install — web is prepared and repointed before the (re)start, a web-only change restarts a live slot supervisor, stale slots go only after an observed start
  - `[medium]` `[patch]` failed start left `current.json` on the dead slot and the next run read `unchanged` — rollback of the slot rename, `current.json` and shortcut, restart of the old slot
  - `[medium]` `[patch]` a refusal after `stop_slot` left the service down and the shortcut on the new slot — prep (fetch, unpack, bun install, env) before the stop; rollback and restart after it; shortcut written after the swap
  - `[low]` `[patch]` the start probe could be answered by a process already listening — `ServiceAlreadyRunning` before any change
  - `[medium]` `[patch]` `install.ps1` under `irm | iex` exited the user's shell and leaked strict mode/params — scoped scriptblock, `throw` under iex, env-var channel/roster in README
  - `[medium]` `[patch]` `install.ps1` flattened `%VAR%` entries in the User PATH — unexpanded registry read, ExpandString write, WM_SETTINGCHANGE broadcast
  - `[low]` `[patch]` `install.sh` PATH only in `~/.profile` — also `~/.zprofile` (Darwin/zsh) and `~/.bash_profile`/`~/.bash_login`
  - `[medium]` `[patch]` Windows CLI self-update would fail on the locked tool environment — detached helper after exit, reported `scheduled`; next run reports and deletes it (consult DO)
- rejected: Linux `stop_slot` may miss a `bun` child (plausible only; v1 service hosting is the Windows shortcut/wt path and `start.ps1` is not in this repo)

### 2026-10-14 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 1, medium 4, low 4)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5: (high 0, medium 2, low 3)
- addressed_findings:
  - `[high]` `[patch]` Windows self-update helper launched through the capturing runner (inherited pipes deadlock against the helper's pid wait; install hits the locked tool env; CLI still reports `scheduled`) — new injectable detached spawner (consult DO), launch pinned to it, never the runner
  - `[medium]` `[patch]` stop probe re-read `TK_SUPERVISOR_BIND` after `write_supervisor_env` rewrote it, so a supervisor still on the old address read as stopped — pre-write URL captured; stop waits on old and new URLs; `ServiceAlreadyRunning` on the pre-write URL
  - `[medium]` `[patch]` `_slot_pids` matched its own `Get-CimInstance` pwsh (later `taskkill /T /F` on a possibly reused PID) and matched `0.1.1` inside `0.1.10` — `$_.ProcessId -ne $PID`, bounded match on both platforms
  - `[medium]` `[patch]` CLI start had no starting directory and a stale env block, unlike the shortcut — `wt nt -d <slot>` for both, User `TK_SUPERVISOR_*`/`TK_STUDIO_ROOT` overlaid on the start env (names only reported)
  - `[medium]` `[patch]` bun leg ran before the source-checkout check, so a bun failure blocked the AC3 dev-box report and bun was installed although nothing is replaced — bun `skipped` naming the checkout, no bun URL fetched
  - `[low]` `[patch]` rollback left new slots on disk unmentioned and dropped `studio_web` from a refused result — new never-run slots removed (failed-start supervisor slot kept for inspection), unremovable ones named, `studio_web` kept
  - `[low]` `[patch]` the second roster read on install/update surfaced a `Refusal` as `UnexpectedError` — caught, `blocked` with the refusal reason
  - `[low]` `[patch]` an older CLI blocked by a newer roster got no recovery hint — guard refusals name the bootstrap re-run (guard unchanged)
  - `[low]` `[patch]` assertion gaps on stated invariants — shared `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` across both bootstraps and `cli_leg`; commit-phase `ShortcutFailed`/`CurrentUnwritable` rollback; app-zip `UnsafeZipMember`/`ArchiveInvalid`
- deferred: studio-web slot renamed aside under a supervisor this run does not restart (source checkout / skipped) — consult ruled out of scope (AC3 is supervisor-only, spec:235; a new leg status needs a planned matrix entry); deferral (a), reader 25-5
- rejected: uv-managed Python fetched unpinned by `uv run`/`uv tool install` (AC1 pins uv only; interpreter resolution is uv's); no uv leg in `update` (uv is bootstrap-owned per AC1, AC2 lists the app legs); POSIX stop not a tree kill (same claim rejected in pass 1); User env not rolled back on refusal (every written value is slot-independent and machine-derived; token/secret/ntfy kept); no lock on overlapping runs (carried from 25.2, not caused by this story)
- note: the diff (187 KB) was handed to both layers as a saved patch file in the scratchpad rather than inlined; both layers read it in full

### 2026-10-14 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 2, low 7)
- defer: 0
- reject: 4: (high 0, medium 2, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Windows `cli-update.cmd` written as UTF-8 but read by cmd.exe in the OEM code page, so a non-ASCII profile path garbled the uv/log paths and the self-update never ran (rescheduled forever) — `chcp 65001 >nul` as the helper's second line, before any path-bearing line; pinned with a `José` root
  - `[medium]` `[patch]` Windows first install whose new supervisor never answered left the Startup shortcut on the failed slot (`restart_old` with no earlier slot ignored `shortcut_moved`), so logon started it and the next install refused `ServiceAlreadyRunning` — prior shortcut bytes saved before the write and restored, else the shortcut removed, named in the reason
  - `[low]` `[patch]` a refusal in `run_legs` (and on main's second roster read) overwrote `reason`, dropping the plugin leg's `partial` reason — refusal first, then the earlier reasons, `"; "`-joined
  - `[low]` `[patch]` the `NEWER_ROSTER` "re-run the bootstrap" hint was appended to every guard refusal — only on `schema: unsupported` / `unknown component` problems; guard copies untouched
  - `[low]` `[patch]` AC1 assertion gap: nothing pinned the uv archive verified against the embedded SHA before extraction, nor the unmanaged install — static tests for both scripts
  - `[low]` `[patch]` `test_fresh_install_writes_env_and_shortcut` hard-coded `/` in the expected work dir (fails on a Windows host) — built with `os.path.join(... + os.sep, ...)`
  - `[low]` `[patch]` README download-verify-run alternative ran `pwsh` (absent on stock Windows; install.ps1 is 5.1-compatible) and `sha256sum` (absent on stock macOS) — `powershell -ExecutionPolicy Bypass -File .\install.ps1`, a `shasum -a 256 -c -` line for macOS
  - `[low]` `[patch]` install.sh's closing hint printed `$BIN/tk-studio` unquoted (macOS path has a space) — quoted; README published SHA updated to `f3bb442100401316e874d9b2c3fddf5f9670a258af575f57bad13ef4c81d672c`
  - `[low]` `[patch]` with Hermes' `.env` missing, an update flipped an existing working `TK_SUPERVISOR_NOTIFY=telegram` (token and chat set) to an unsubscribed ntfy topic — kept as `telegram`, reported `kept` (names only)
- rejected: CLI start of `wt.exe` through the capturing runner (Design Notes name the runner for start; `wt.exe` returns once the tab opens and the tab's pwsh runs under the terminal's conpty, not this process's pipes — plausible only); a stop whose probe still answers leaves the killed old slot unrestarted (the matrix's `update` row specifies exactly `ServiceStillRunning`, nothing renamed or repointed, and the reason names the stopped process count; restarting into a port something else answers is not observable); POSIX stop not a tree kill (rejected in both earlier passes); source checkout detected only via the Startup shortcut (the intent's matrix row defines the state as the shortcut's working dir)
- note: the diff since baseline (217 KB) was handed to both layers as a saved scratchpad patch file

## Design Notes

- **The bootstrap**: re-running it equals updating.
  - It reads `-Channel` / `TK_STUDIO_CHANNEL` (default `stable`) and the `-Roster` / `TK_STUDIO_ROSTER` override, defaulting to the plugin leg's raw-main roster URL.
  - It embeds the uv version and the per-target SHA-256 values (`install.ps1`: `x86_64-pc-windows-msvc`; `install.sh`: the linux and darwin targets). It downloads `uv-<triple>` from `github.com/astral-sh/uv/releases/download/<v>/`, verifies the archive, and extracts it into `<root>/tools/uv-<v>/`. This is unmanaged, so `uv self update` is off.
  - It fetches the roster and takes `components.cli`. If `cli` is absent, it exits non-zero with `CliNotShipped`.
  - It downloads the wheel, verifies its sha against the roster, and runs `uv tool install --force <wheel>` with `UV_TOOL_BIN_DIR=<root>/bin` and `UV_TOOL_DIR=<root>/tools/uv-tools`.
  - It adds `<root>/bin` to the user PATH: on Windows, the User `Path`; elsewhere, one marked line in `~/.profile`. Both are idempotent.
  - It runs `git config --global core.longpaths true` when `git` exists. Otherwise it says so.
  - The scripts parse JSON with `ConvertFrom-Json` (ps1) and `"<uv>" run --no-project python` (sh).
- **The wheel pin comes from the roster, not the script.** ADR §7 says the script embeds the wheel's tag and SHA too. No `cli` release exists yet, and a digest must never be fabricated. AD-21 makes the roster the only version gate, so the script embeds only uv, as AC1 states. The operator later cuts the wheel with `git tag cli--v0.1.0 && git push origin cli--v0.1.0` then `uv run tools/release_archive.py run --app cli --version 0.1.0`, which records `components.cli`. That step is unverifiable here.
- **`install` / `update` order**:
  1. plugin (unchanged);
  2. bun (only when `supervisor` is present);
  3. supervisor;
  4. studio-web;
  5. on `update` only, cli self-update. This runs when the installed `tk-studio-cli` version ≠ the roster tag. It renames the running `<root>/bin/tk-studio[.exe]` aside to `.tk-studio.old` (Windows will not overwrite a running exe), runs `<uv> tool install --force <verified wheel>`, and deletes `.old` on the next run.
  The first refusal ends the verb `blocked` with its reason, and the legs after it do not run. Result keys: the plugin leg's fields stay top-level, and new legs go under `supervisor`, `studio_web`, `bun` and `cli`.
- **`current.json`** is one atomic pointer file: `<root>/current.json` = `{"supervisor": {"version", "path"}, "studio-web": {"version", "path"}}`. The supervisor reads the web slot from it. Old slots are renamed aside to `<app>/.<version>.previous`.
- **Lifted env (Windows only)**:
  - Writes go through `winreg` `HKCU\Environment`, followed by a `WM_SETTINGCHANGE` broadcast via `ctypes`, behind an injectable writer in tests. The variables and keep-existing rules match the script exactly.
  - Values the script derives from the machine are set only when their source exists: `TK_SUPERVISOR_BIND` from `tailscale ip -4`, the Telegram pair from Hermes' `.env`, and `TK_STUDIO_ROOT` only if the variable already exists. Otherwise the CLI notifies through ntfy and lists the missing values in `env.unset`.
  - The shortcut is the script's, pointed at `<slot>\start.ps1`, and is written through `pwsh`/`powershell` `WScript.Shell` via the runner.
  - On other platforms, `env` and `shortcut` report `skipped: windows only`.
- **Start and stop**:
  - Stop: query processes whose command line contains the old slot path, terminate them, then require the probe to fail.
  - Start: launch the shortcut's command via the runner (detached).
  - Probe: GET `<http|https>://<TK_SUPERVISOR_BIND or 127.0.0.1>:<TK_SUPERVISOR_PORT or 8787>/status`. Any HTTP response, including 401, means the service is up. The default timeout is 60 s, and the probe is injected in tests.
  - Source checkout: on Windows, the Startup shortcut's working directory (read via the runner) is a directory containing `.git` that is not under `<root>/supervisor`. The source-checkout state applies to the supervisor leg only.

## Verification

**Commands (from `plugins/tk-studio/lib` unless noted):**
- `uv run python -m unittest discover tests`: expected green.
- `uv run python ../contracts/conformance/runner.py run`: expected `"ok": true`.
- (repo root) `UV_PROJECT_ENVIRONMENT=<scratch>/venv CLAUDE_CONFIG_DIR=<scratch>/claude XDG_DATA_HOME=<scratch>/data uv run --project tools/installer/cli tk-studio status --roster tools/installer/rosters/latest.json`: the last line is `complete` JSON. Afterwards, `rm -f tools/installer/cli/uv.lock`.
- `bash -n tools/installer/install.sh`: exit 0.

**Unverifiable here (operator, TIM-PC-2):**
- Tag `cli--v0.1.0` at the landed commit, run `uv run tools/release_archive.py run --app cli --version 0.1.0` (records `components.cli` in `latest.json`), then PR the copy into `stable.json`.
- Run the bootstrap one-liner from the README in a fresh PowerShell, then `tk-studio install` and `tk-studio status`.



## Auto Run Result

Status: done

**Summary:** This is the second follow-up review of story 25.4, which landed in d4911e6 and was hardened in d05bca8. The pass applies 9 review patches to the meta-CLI's Windows self-update helper, the first-install rollback, refusal reasons, the roster hint, the bootstrap tests, the README verify-and-run commands and the Telegram keep rule. It adds no new verbs, leg statuses, refusal names or result keys.
- The Windows `cli-update.cmd` helper switches to code page 65001 before any line that holds a path. Before this, a non-ASCII profile path (such as `C:\Users\José\`) was garbled, so the self-update never ran and was rescheduled on every run.
- When a Windows first install's new supervisor never answers, the Startup shortcut is restored to its prior bytes, or removed if there were none. Before this, the shortcut kept pointing at the failed slot, and the next install refused `ServiceAlreadyRunning`.
- A refusal now keeps the reasons collected before it (for example the plugin leg's `partial` reason). The "re-run the bootstrap" hint appears only for a roster newer than the CLI.
- The README's verify-and-run alternative now runs on stock Windows (`powershell`) and macOS (`shasum -a 256`). install.sh quotes the `bin` path in its closing hint, and its published SHA-256 is updated.
- With no Hermes `.env`, an existing working Telegram setup is kept instead of being switched to ntfy.
- New tests cover the uv archive being verified against the embedded SHA before extraction, the unmanaged uv install, and a work-dir path that is correct on each platform.

**Files changed:**
- `tools/installer/cli/tk_studio_cli/apps.py`: `chcp 65001` in the helper; shortcut saved and restored or removed after a failed first start; `blocked_reason` keeps earlier reasons; Telegram kept with no Hermes pair.
- `tools/installer/cli/tk_studio_cli/main.py`: a refusal on the second roster read keeps the earlier reasons.
- `tools/installer/cli/tk_studio_cli/plugin_leg.py`: `NEWER_ROSTER` appended only on `schema: unsupported` or `unknown component` problems.
- `tools/installer/install.sh`: the closing hint quotes `"$BIN/tk-studio"`.
- `README.md`: `powershell -ExecutionPolicy Bypass -File .\install.ps1`; a macOS `shasum -a 256 -c -` line; install.sh SHA-256 is now `f3bb442100401316e874d9b2c3fddf5f9670a258af575f57bad13ef4c81d672c`.
- `plugins/tk-studio/lib/tests/test_installer_apps.py`: tests for the non-ASCII helper, the shortcut restore and removal, kept reasons, the bootstrap hint, Telegram keep and ntfy fallback, and the platform-correct work dir.
- `plugins/tk-studio/lib/tests/test_installer_bootstrap.py`: the uv SHA checked before extraction, the unmanaged uv install, README verify-and-run on stock systems, and the quoted install.sh hint.

**Review:** Both layers ran.
- Results: 9 patches (high 0, medium 2, low 7), 0 deferred, 4 rejected (reasons in the Review Triage Log), 0 bad_spec, 0 intent_gap.
- Consults: none. No objective trigger fired: verify was green, the implementer's deviation score was 0, no finding was high severity, and no file was touched outside the Tasks list.
- Follow-up review recommended: **true**. No patched finding was high severity, but the score is 3×2 + 1×7 = 13, which is at least 5.
- The implementer put each fix back to its old form, and the new test failed every time, except patch 6. Patch 6 is a path-separator fix that cannot fail on Linux; a simulation with a `\` separator showed the old expected value does not match.

**Verification (re-run by this session after the patch pass):**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1046 tests OK, 1 skipped (the opt-in live claude test).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bash -n tools/installer/install.sh`: exit 0.
- `uv run --project tools/installer/cli tk-studio status --roster tools/installer/rosters/latest.json`, with the scratchpad env: the last line was `complete` JSON, and supervisor, studio-web and cli read `not shipped`. `uv.lock` was removed.

**Unverifiable here (operator, TIM-PC-2, Windows):**
- `git tag cli--v0.1.0 && git push origin cli--v0.1.0`, then `uv run tools/release_archive.py run --app cli --version 0.1.0`, then PR the copy into `stable.json`.
- In a fresh Windows PowerShell 5.1 window, run the README download → `Get-FileHash` → `powershell -ExecutionPolicy Bypass -File .\install.ps1` path, then `tk-studio install` and `tk-studio status`.
- Once `supervisor--v0.1.0` and a later `cli--v` release exist, run `tk-studio update` from a profile with a non-ASCII name. Confirm that `<root>/tools/cli-update.log` shows a successful `uv tool install`. The `chcp 65001` helper could only be checked from its bytes here.

**Residual risks:**
- A studio-web update under a supervisor this run cannot restart renames the served slot (DW-12, for 25-5).
- The CLI starts `wt.exe` through the capturing runner. This is accepted on the reading that Windows Terminal does not inherit the pipes; it is unchecked on a live box.
- After a stop whose probe still answers, the killed old slot is not restarted. The matrix specifies this outcome.
- On POSIX, the stop is not a tree kill.
- Overlapping runs take no lock.
- `install.ps1` has still only been checked statically.
- `_bmad-output/implementation-artifacts/deferred-work.md` holds the orchestrator's staged, uncommitted DW-12 harvest. This run leaves it untouched and uncommitted, as the invocation directed.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio install (the installer writes the skills-dir plugin folder <home>/skills/tk-studio/); remove the marketplace copy shadowing the skills-dir folder: claude plugin uninstall tk-studio@tk-studio --scope user; claude plugin marketplace remove tk-studio; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: 6079bbcdcded8a894a034b6b9f7e287d2c559cc3 (branch loop/epic-25); reviewed HEAD d05bca86316e931a7a8602ed10877073cc8eba32

DRIFT: on a `blocked` verb, a leg dict (`supervisor`, `studio_web`) with no `status` key means planned, not applied; its plan fields are present and the verb's `reason` carries the refusal — no new leg status may come from a review patch — affects: 25-5
DRIFT: the Windows self-update helper launches through a new injectable `Ctx.spawn_detached`, never the capturing runner; the CLI start runs `wt … nt -d <slot>` with the User `TK_SUPERVISOR_*` values overlaid — the capturing runner deadlocked the helper — affects: 25-5
DRIFT: minor local choices (fixed name list plus `WindowsUserEnv.names()`, a POSIX branch in the spawner, `ServiceStillRunning` naming every answering URL) — unspecified details — affects: none

## Reconcile

### 2026-10-14 — adjust-stories

- Score: 2
- Reasoning: The landed CLI matches all four ACs. Its deviations are about how results are shaped and how the work is done; none changes a later story's acceptance criteria. Story 25.5's doctor reads what this story produced: the `RosterInvalid`/`RosterEntryInvalid` split, the process-free `.lnk` source-checkout read, `current.json` slots, the `restarted`/`scheduled` leg statuses, per-leg `stale`, the meaning of a blocked leg with no `status`, the `cli-update.cmd` helper, and DW-12. Story 25.7's README and runbooks have to describe what actually shipped: the env-var one-liner (`TK_STUDIO_CHANNEL`/`TK_STUDIO_ROSTER`), the README SHA-256s that a test pins, `install --link` running only the plugin leg, and the pending operator `cli--v0.1.0` cut. Story 25.6 does not touch the CLI. Taking the wheel pin from the roster rather than the script follows AD-21, which makes the roster the only version gate, and AC1, which embeds only uv.
- Affected:
  - 25-5-doctor-says-what-is-wrong — "the supervisor's slot or checkout and whether `/status` answers": doctor builds on `apps.doctor_fields`, `source_checkout` (`.lnk` parse, no process) and `probe_url`/`default_probe` as landed, and reads the landed result vocabulary.
  - 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in — "the README's install section is the one-line bootstrap plus `tk-studio install`": the one-liner passes the channel and roster through env vars (no `-Channel` param under `irm | iex`), the README's published script SHA-256s are pinned by `test_installer_bootstrap.py`, and `--link` is plugin-only.
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 25-5-doctor-says-what-is-wrong
