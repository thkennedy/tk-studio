# Replan queue

## 25-3-the-drift-check-and-conformance-read-the-folder-and-the — scope: stories — from 25-1-the-roster-and-the-release-motion-for-every-app — 2026-10-14

- What changed: the roster guard (`lib/release_roster.py` as landed by 25.1) accepts only the six known component names, `schema: 1`, `channel` in {stable, latest}, a `>=X.Y.Z` `requires.claude-code` floor and `X.Y.Z` `uv`/`bun` versions; a roster with no `plugin` entry requires `source` on every app entry; the drift plane's ok detail names both rosters with per-channel components, and gate ×4 binds `latest.json` only (`stable.json` is shape-only).
- What no longer holds: the plan's draft wording of the plane's ok detail; nothing in the story's acceptance criteria.
- Suggested adjustment: Replan (25-1 reconcile, 2026-10-14): build on the landed guard and the plane as they are; any roster fixture passes the guard (six names, schema 1, valid channel, floor and version formats, `source` on foreign entries); the `stale`/`missing`/`shadowed` cases extend the plane's existing per-channel detail rather than replacing it; read the configured channel from the roster file stem.
- Status: closed — applied to the unstarted 25-3 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-4-the-bootstrap-and-the-meta-cli — scope: stories — from 25-1-the-roster-and-the-release-motion-for-every-app — 2026-10-14

- What changed: as above; and `uv`/`bun` entries are `{version, sha256: {<target>: <hex>}}` per platform, app entries may carry `source` naming a foreign repository, and the release motion refuses `--app plugin` with a foreign `--repo`.
- What no longer holds: nothing in the story's acceptance criteria; the fakes must match the landed shape.
- Suggested adjustment: Replan (25-1 reconcile, 2026-10-14): the meta-CLI reads the roster through the landed guard (never a second parser), selects the running platform's digest from the `sha256` map and refuses a missing key by name (`PlatformNotPinned`), honours `source` on foreign app entries, and treats an absent component as "not shipped in this channel"; every fake roster in its tests passes the guard.
- Status: closed — applied to the unstarted 25-4 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-3-the-drift-check-and-conformance-read-the-folder-and-the — scope: stories — from 25-2-the-installer-writes-the-skills-dir-plugin — 2026-10-14

- What changed: the plugin leg writes `~/.claude/skills/tk-studio/` through a three-sibling swap (`.tk-studio.new`, `.tk-studio.previous`, `.tk-studio.retired`) and its marketplace cleanup reads the install records and the user's `settings.json` keys (`extraKnownMarketplaces.tk-studio`, `enabledPlugins` `tk-studio@<marketplace>`, never `@skills-dir`).
- What no longer holds: nothing in the acceptance criteria; the plane's `missing`/`shadowed` detection has concrete inputs now.
- Suggested adjustment: Replan (25-2 reconcile, 2026-10-14): the sibling folders are never the plugin; `shadowed` is read from the same records and settings keys the leg's cleanup reads; the plane names the sibling it found when it reports.
- Status: closed — applied to the unstarted 25-3 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-4-the-bootstrap-and-the-meta-cli — scope: stories — from 25-2-the-installer-writes-the-skills-dir-plugin — 2026-10-14

- What changed: the meta-CLI package exists at `tools/installer/cli/tk_studio_cli` (stdlib only, `pyproject.toml`, `main.py`, `plugin_leg.py`) with a refusal vocabulary (`RosterEntryInvalid` … `MarketplaceRemovalFailed`, `FolderUnwritable`, `CleanupFailed`, `UnexpectedOSError`, `UnexpectedError`, `UsageError` exit 2, every blocked refusal exit 1), `<Name>: <detail>` reasons, a `--help` that ends with the AD-11 JSON line, and `default_runner` taking `env`; sandbox verification needs `UV_PROJECT_ENVIRONMENT` outside the mount and no committed `uv.lock`.
- What no longer holds: nothing in the acceptance criteria.
- Suggested adjustment: Replan (25-2 reconcile, 2026-10-14): extend the landed package and its vocabulary for the bootstrap, supervisor and web legs and the `update`/`status` verbs; never a second CLI; keep the JSON line on every path including `--help`; verify in the sandbox with `UV_PROJECT_ENVIRONMENT` outside the mount.
- Status: closed — applied to the unstarted 25-4 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-5-doctor-says-what-is-wrong — scope: stories — from 25-2-the-installer-writes-the-skills-dir-plugin — 2026-10-14

- What changed: as above; the leg's result may carry `retired_left`, and a leftover `.tk-studio.retired` or `.tk-studio.new` is a state doctor can meet.
- What no longer holds: nothing in the acceptance criteria.
- Suggested adjustment: Replan (25-2 reconcile, 2026-10-14): doctor reports the sibling folders and `retired_left`, reuses the leg's refusal names in its fixes, and reads (never edits) `settings.json` for marketplace entries.
- Status: closed — applied to the unstarted 25-5 entry's invoke_dev_with by the attended session (2026-10-14)

## 25-5-doctor-says-what-is-wrong — scope: stories — from 25-3-the-drift-check-and-conformance-read-the-folder-and-the — 2026-10-14

- What changed: the drift check's plugin plane (as landed) reports `ok`, `stale` (fix names the channel), `missing` (also for a folder with no `.claude-plugin/plugin.json`; fix `tk-studio install`), `shadowed` (from the install records, `known_marketplaces` and `settings.json`) and `error` (a failed read, no `case` field); a marketplace catalog without a `tk-studio` entry is skipped with a note; driver-contract §6 says so at 0.1.19.
- What no longer holds: nothing in the acceptance criteria ("Story 25.3's cases" is the reference).
- Suggested adjustment: Replan (25-3 reconcile, 2026-10-14): doctor calls the plane and reports its results as landed; an `error` is a failed read with its path, not a judged case; a foreign catalog is a note, never a failure.
- Status: closed — applied to the unstarted 25-5 entry's invoke_dev_with by the attended session (2026-10-14)


## 25-5-doctor-says-what-is-wrong — scope: stories — from 25-4-the-bootstrap-and-the-meta-cli — 2026-10-14

- What changed: The meta-CLI landed with these pieces: a `doctor` that merges `plugin_leg.doctor` with `apps.doctor_fields` (slot / `not installed` / `source checkout`, never probing `/status`); source-checkout detection by a stdlib `.lnk` parse of the Startup shortcut (no process); `RosterInvalid` (roster level) and `RosterEntryInvalid` (entry level); the leg statuses `restarted` and `scheduled`, plus per-leg `stale` lists; a blocked leg dict with no `status` meaning planned, not applied; the Windows self-update helper `<root>/tools/cli-update.cmd` with its log, launched through `Ctx.spawn_detached`; and DW-12 (a studio-web slot renamed under a supervisor this run did not restart).
- What no longer holds: Nothing in the acceptance criteria. "The supervisor's slot or checkout and whether `/status` answers" now has concrete landed seams.
- Suggested adjustment: Extend the landed `doctor` (main.py, `apps.doctor_fields`, `source_checkout`, `probe_url`/`default_probe`) rather than writing a second one. Reuse the landed refusal names in the fixes. Report a leftover `cli-update.cmd` or its log, `.previous` stale slots, and DW-12's state (a served path that no longer exists). Keep doctor read-only and process-free except for the probes the AC names.
- Status: closed — applied to the unstarted 25-5 entry's invoke_dev_with by the gate session (2026-10-14)

## 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in — scope: stories — from 25-4-the-bootstrap-and-the-meta-cli — 2026-10-14

- What changed: README.md has a "Bootstrap (one command)" subsection. Its one-liners pass the channel and roster through `TK_STUDIO_CHANNEL`/`TK_STUDIO_ROSTER`; `install.ps1` has no top-level param block, so it stays safe under `irm | iex`. The README publishes each script's SHA-256, which `test_installer_bootstrap.py` pins to the file bytes (`.gitattributes` pins LF). The download-verify-run alternative uses `powershell -ExecutionPolicy Bypass -File` and `shasum -a 256`. `install --link` runs only the plugin leg. The bootstrap exits `CliNotShipped` until the operator cuts `cli--v0.1.0` and records `components.cli`.
- What no longer holds: Nothing in the acceptance criteria. "The README's install section is the one-line bootstrap plus `tk-studio install`" builds on the landed subsection.
- Suggested adjustment: Rewrite the README install section around the landed bootstrap subsection and keep the published SHA-256s and the stock-OS verify commands, so the bootstrap tests stay green. Document `--link` (plugin only) under the "developers who clone" note. The 0.3.0 release step needs `components.cli` in the roster first (the operator's `cli--v0.1.0` cut); if it is still absent, record that as unverifiable rather than fabricating it.
- Status: closed — applied to the unstarted 25-7 entry's invoke_dev_with by the gate session (2026-10-14)

## 25-7-the-docs-and-the-release-say-the-installer-is-the-way-in — scope: stories — from 25-6-sandboxes-read-the-host-skills-folder — 2026-10-15

- What changed: The sandbox skills store is a copy of the host's `~/.claude/skills`, filled by `sbx skills import --force` and not a live view. `kb/offline-install-runbook.md` §"Sandboxes read the host skills folder (Story 25.6)" and `kb/agent-pc-setup-runbook.md` §3.5/§3.8 document the import step and the "sandbox store" drift case; `provision-engine.sh` no longer installs the plugin per sandbox.
- What no longer holds: Nothing in the acceptance criteria. "the offline runbook describes the skills-dir write from a downloaded zip" must not drop 25.6's sections or the import step.
- Suggested adjustment: Rewriting the README, the offline runbook and §3.4 keeps 25.6's kb section and §3.5/§3.8 as landed (edit them only to remove a stale marketplace reference). Wherever the docs say `tk-studio install`/`update` on the host, they add "then `sbx skills import --force` for engine sandboxes".
- Status: closed — applied to the unstarted 25-7 entry's invoke_dev_with by the gate session (2026-10-15)

## 26-3-routing-legs-carry-an-advisor-and-an-effort — scope: stories — from 26-1-launch-ends-every-path-with-the-block-and-owns-its-bootstrap — 2026-10-15

- What changed: 26-1 already bumped the driver contract to 0.1.21. Its header clause starts at the anchor `0.1.21 (Epic 26)`, and `test_driver_contract.py` pins both the version and that anchor.
- What no longer holds: "it documents the `advisor` field and the pairing rule (0.1.21, additive)". It cannot be a bump now, only an append to the existing clause.
- Suggested adjustment: Append the §5 `advisor` text after the existing `0.1.21 (Epic 26)` clause in the header, without rewording it or bumping the version again. Put `plugins/tk-studio/lib/tests/test_driver_contract.py` in Files and pin the new clause by its own text.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-15)

## 26-5-the-adapter-takes-a-status-pull-back-from-a-driver — scope: stories — from 26-1-launch-ends-every-path-with-the-block-and-owns-its-bootstrap — 2026-10-15

- What changed: same as 26-3. Contract 0.1.21 is already the header under the anchor `0.1.21 (Epic 26)`, and `test_driver_contract.py` pins it.
- What no longer holds: "the verb is documented as additive (0.1.21)". It cannot be a bump now, only an append to the existing clause.
- Suggested adjustment: Append the §4 `plansync.py status` text after the existing `0.1.21 (Epic 26)` clause, without rewording it or bumping the version again. Put `test_driver_contract.py` in Files. If a launch refusal is read, `budget` is present only when a mismatch was found.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-15)

## operator — scope: operator — from 28-3-the-merged-tree-builds-releases-and-launches-from-one-root — 2026-10-17

- What changed: nothing in 28-3 itself. The gate found AC3's live clause unmet because of the pre-existing supervisor defect DW-25: `prepareWorktree` and `invoke(workRoot ?? root, …)` serve the worktree top level, and nothing maps a project below its git top level (`apps/supervisor/src/worktree.ts:110-111`, `:254`; `cli.ts:1051`, `:1922`).
- What no longer holds: 28.3 AC3, "the project served is the nested root and its `verify.host` is the one read at the run's base".
- Suggested adjustment: correct-course to give the fix a story (a new 28.x, or widen 28.5, which already resolves the git top level per submission). The run should serve `<worktree>/<prefix>` (the prefix comes from `git rev-parse --show-prefix` of the root). Then mark 28.3 AC3 satisfied by reference, as 28.5 does for AC2. Decide the order relative to 28-4 (28.4's smoke test queues a supervisor job).
- Status: closed — correct-course applied by the attended session (2026-10-17): Story 28.5 widened with the subpath AC (DW-25), 28.3 AC3's live clause satisfied by reference; order kept 28-4 then 28-5
