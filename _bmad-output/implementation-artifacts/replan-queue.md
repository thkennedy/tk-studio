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

## 29-4-the-contract-names-the-web-as-a-consumer-and-the-runbook — scope: stories — from 29-3-the-office-projection-semantic-states-progress-and-its — 2026-10-18

- What changed: the office projection landed with rules the plan did not name (consults 1–4). (a) Emission: `office.agent` can fire with `state === from` when only `current_run`/`current_story` change; a new run sends an epic-only `office.progress` beside its `office.run`; an agent that leaves the registry gets no event, and only the next snapshot drops it. (b) Run selection, per project: the newest `paused` live run, else the newest non-queued live run, else the newest queued live run, else the latest run when `blocked`. (c) Row 5 (`thinking`): no `launched` yet, or none since the latest `close-out`/`engine-resume`. Row 10 needs a `launched` with no `host-verify` after the latest one. (d) Progress `done` also counts an unsettled, non-current manifest story whose single story spec at the run's root is `status: done`. The journal wins, and the denominator is the first `stories-validated`.
- What no longer holds: nothing in the acceptance criteria. "documents … the projection (`GET /office`, `GET /office/events`, the three `office.*` event kinds and the eight states)" must describe the landed rules.
- Suggested adjustment: Document (a)–(d) as landed in the contract's supervisor-surface text, or link to the README's "office projection (Story 29.3)" bullet. Keep these out of the documented surface: `OFFICE_MAP`'s `when`/`signal` columns, the helper exports (`OFFICE_RANK`, `mapRoles`, `selectRun`, `engineRunDir`, `LIVE_RUN_STATES`, `officeStates`, `officeCachedPaths`, `specsDone`, `launchedSinceMove`).
- Status: closed — applied to the unstarted 29-4 entry's invoke_dev_with by the gate session (2026-10-18)

## 24-4-the-verdict-sets-the-defaults — scope: stories — from 24-2-the-supervisor-is-built-on-the-trial-route — 2026-10-19

- What changed: the 24.2 record (`kb/trial-record-opus-5-5.md`) sorts stories by kind with its own line-count proxy (under 150 insertions + deletions outside `_bmad-output/` is core code), so all 12 stories are `feature` and the $4.4 core band has no trial data. Its dollars are handoff totals, with no per-leg split. 20-1, 20-2 and 21-1 have no ledger observation (they landed before the meter). For 21-2 to 22-5 the observation sits in the supervisor sandbox's store (unverifiable here). Wall-clock is `not recorded` for 4 of the 12 stories.
- What no longer holds: nothing in the acceptance criteria. The evidence behind "Given the Story 24.2 and 24.3 records … each leg gets keep-Opus-5.5, revert, or needs-more-data, with the evidence cited" is thinner than CAP-6 assumed.
- Suggested adjustment: Cite per-leg evidence from the 24.3 paired records (CAP-9 splits dollars by leg). Use the 24.2 record for the feature-kind totals and attempt-1 landings only, with its caveat and the 2.39× all-in ambiguity. Mark any leg needs-more-data where only 24.2 speaks to it. Extend `kb/trial-record-opus-5-5.md` and do not rewrite its 24.2 sections.
- Status: open

## operator — scope: operator — from 24-2-the-supervisor-is-built-on-the-trial-route — 2026-10-19

- What changed: the gate found 24.2 AC1's record half ("its Story 24.1 record exists") unmet for 20-1, 20-2 and 21-1. All three landed before the 24.1 meter (`8b83a7e`, 2026-09-28T10:14:36Z), so no `meter:` observation exists. For 21-2 to 22-5 the observations sit in the supervisor sandbox's `~/.tk-studio` (the check is `sbx exec claude-tk-studio-supervisor -- sh -c "grep '\"meter: story=2[12]-' ~/.tk-studio/measurements/*.jsonl"`).
- What no longer holds: 24.2 AC1, "When each story lands Then … its Story 24.1 record exists", for the three pre-meter stories. SPEC Open Question 1 (retro-price Epic 20, or limit CAP-6 to stories landed after the meter) was never ruled on. 24-2's contract declined to record anything.
- Suggested adjustment: one of these. (a) Accept the three as unmet by construction and mark AC1 satisfied by reference to the handoff figures. (b) Retro-record 20-2 from the surviving host run dir `/c/GitHub/tk-studio/.bmad-loop/runs/20260928-090746-8360` (`meter.py story … --repo-root .`, which records) and accept 20-1/21-1 as not recoverable. There is no run dir for either on this box. (c) Correct-course CAP-6 / AC1 to the stories landed after the meter. Either way, run the sandbox check above for 21-2 to 22-5. Then resume the run. The next gate plans 24-3 and applies the 24-4 entry above.
- Status: open — needs bmad-correct-course

## 30-2-the-supervisor-serves-the-web — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files. `vite.config.ts` has `base: "./"`. `dist/` is ignored, so no tag holds it.
- What no longer holds: "or `index.html` for a path with no file (the single-page fallback)": relative asset URLs break below `/app/`. "builds `dist` from the tag": `tools/release_archive.py` archives `apps/studio-web/dist` at the tag, which is absent there.
- Suggested adjustment: Serve the web under an absolute `/app/` base (vite `base`, and mind `api.ts:580`'s trailing-slash strip). Build `dist` in the release from the tag's `apps/studio-web` (frozen install, then build), as `_build_wheel` does. Use the sandbox /tmp-copy verify rule.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-3-the-live-stream-in-the-browser — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files.
- What no longer holds: nothing in the acceptance criteria; the verify seam only.
- Suggested adjustment: A new web dependency regenerates `bun.lock`. Use the /tmp-copy verify rule; `tools/verify_host.py` on the host is binding.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-4-the-office-screen — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files. `scene.ts` exports `loadSheet`/`SHEET_URL` (the one loader), `drawFloor`/`placeCharacter` taking a `Texture`, `layoutScene`, `floorSize` and `TILE`.
- What no longer holds: nothing in the acceptance criteria. "the canvas is driven through the renderer's exported scene functions" now names these landed signatures.
- Suggested adjustment: Extend the landed `scene.ts` functions rather than add a second loader. The eight placeholder frame sets extend `scripts/make-placeholder.ts`. Use the /tmp-copy verify rule.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-5-the-board-screen — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files.
- What no longer holds: nothing in the acceptance criteria; the verify seam only.
- Suggested adjustment: A new web dependency regenerates `bun.lock`. Use the /tmp-copy verify rule.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-6-the-status-screen-and-the-home — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files. The asset base is settled by 30-2.
- What no longer holds: nothing in the acceptance criteria. "the supervisor answers the web's `index.html`" at `/` relies on an absolute asset base.
- Suggested adjustment: Keep 30-2's absolute asset base when `/` serves `index.html`. Use the /tmp-copy verify rule.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-7-our-own-assets — scope: stories — from 30-1-the-renderer-spike — 2026-10-19

- What changed: `apps/studio-web`'s `bun run verify` is `bun install --frozen-lockfile && bun run build && bun run test` (30-1's consult-ruled loopback). The engine sandbox refuses symlinks, so 30-1 verified bun in a /tmp copy of the committed files. The placeholder comes from `scripts/make-placeholder.ts` (the `sprites` package script), and `scene.ts`'s `loadSheet`/`SHEET_URL` loads it.
- What no longer holds: nothing in the acceptance criteria. "the placeholder sheet of Story 30.1 is deleted" also retires its generator and the `sprites` script.
- Suggested adjustment: Delete `make-placeholder.ts`, `placeholder.png` and the `sprites` script, then repoint `loadSheet`/`SHEET_URL` at `office.png` and its atlas. Use the /tmp-copy verify rule.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-4-the-office-screen — scope: stories — from 30-3-the-live-stream-in-the-browser — 2026-10-19

- What changed: the store (`apps/studio-web/src/live/store.ts`, `createOfficeStore`, `LiveState {view, lastId, status}`) mirrors `OfficeRun.state` as `string | null`. A run first seen in `office.progress`, or in an `office.run` for an unseen run, is a row with `state: null` (progress-born rows only), `engine_run_id: null`, and possibly an empty epic and no stories. Any applied delta sets `status: "live"`.
- What no longer holds: nothing in the acceptance criteria on its own. The HUD's "the run id and state … the engine run id" can meet a row whose state and engine run id are null.
- Suggested adjustment: render `state: null` as pending and `engine_run_id: null` as "—"; count live runs as `App.tsx` does (`state !== null && LIVE_RUN_STATES.has(state)`); extend the 30-3 store rather than add a second one.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-6-the-status-screen-and-the-home — scope: stories — from 30-3-the-live-stream-in-the-browser — 2026-10-19

- What changed: as above. The store's run rows may hold `state: null` (until its `office.run`) and `engine_run_id: null`.
- What no longer holds: nothing in the acceptance criteria. "refreshes from the store" reads those rows.
- Suggested adjustment: when the Status screen counts or lists live runs from the store, filter `state !== null && LIVE_RUN_STATES.has(state)` as `App.tsx` does.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## operator — scope: operator — from 30-3-the-live-stream-in-the-browser — 2026-10-19

- What changed: nothing in 30-3 caused this. Planning 30-4 against the landed 30-3 store found that the 0.1.24 office projection (`GET /office`, `GET /office/events`, mirrored in `store.ts`) carries no per-agent reason, no ended run and no PR. `OfficeAgent` is `{agent_id, project, role, state, current_run, current_story}`. `runs` holds live runs only (`office.ts:283` `selectRun`). The reasons and PRs live in queue events (`awaiting-ruling {story_key, reason}`, `paused` `detail.pr`), served only by `GET /runs/{id}` and `GET /jobs`.
- What no longer holds: 30.4 AC1 "naming what it waits for (the projection's reason)" and AC2 "with no live run it shows the last ended run's end state and PR link". Both read data the web's 0.1.24 surfaces lack, and SPEC Constraints limit the web to those surfaces plus `/board` and `/status`.
- Suggested adjustment: choose one before 30-4 runs. (a) Extend the projection additively in 30-4: an optional `reason` on agent rows and `office.agent`, plus a per-project `last_run {run_id, state, pr}` in the snapshot. This touches `apps/supervisor` and the contract §1 table; fold it into 30.5's 0.1.25 bump, and the epic narrative needs a correct-course line. (b) Let the web read `GET /runs/{id}` (cookie GET, exists) for the reason and PR, and name it in 0.1.25's web surfaces. (c) Narrow AC1/AC2: the bubble names what the store carries (the run's `paused` state and the current story), and the ended-run line waits for 30.5's `GET /board` (each story's latest run, state and PR). Plan 30-4 records this as its Block If.
- Status: open — needs bmad-correct-course

## 30-5-the-board-screen — scope: stories — from 30-4-the-office-screen — 2026-10-19

- What changed: 30.4 took the 0.1.25 bump (operator ruling, session 11). The header clause starts at the anchor `0.1.25 (Story 30.4)` and already says "Story 30.5 adds `GET /board` to this same 0.1.25 entry". `test_0_1_25_extends_the_office_projection_additively` pins it. The 0.1.25 note also defines a from-null `office.run` that carries a terminal `last_run` and is not a live-set entry. The web store's `last_run` holds only each project's newest terminal run.
- What no longer holds: SPEC Assumptions "30.5 takes the one bump to 0.1.25 naming `GET /board`". AC1's "named in the contract's §1 web surfaces at 0.1.25" still holds, as an append.
- Suggested adjustment: Append `GET /board` to the existing 0.1.25 header clause and to the §1 web-surfaces table and note, without a second bump or rewording the 30.4 text. Pin the new text by its own phrases in `test_driver_contract.py`. Count live runs with `state !== null && LIVE_RUN_STATES.has(state)`. Done (ended today) comes from the `/board` answer, not the store's `last_run`.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-6-the-status-screen-and-the-home — scope: stories — from 30-4-the-office-screen — 2026-10-19

- What changed: as above for 0.1.25. In addition, the Pixi canvas effect moved from App.tsx into `src/office/OfficeScreen.tsx`, which reports zoom, ratio and fps through `onStats`. App.tsx keeps the module-level store, the one stream and the debug lines. The per-browser project choice is `rememberedProject`/`rememberProject` in `src/office/model.ts` (key `tk-studio.office.project`, injectable storage).
- What no longer holds: SPEC Assumptions "30.6 extends that same 0.1.25 entry with `GET /status`". The entry is 30.4's, and 30.5 appends `/board` to it. AC3's "(0.1.25, additive)" still holds, as an append.
- Suggested adjustment: Append `GET /status` to the existing 0.1.25 clause, with no bump, and pin it by its own phrases. Switch screens in App.tsx by mounting or unmounting `OfficeScreen`, which owns the canvas; never a second Pixi Application. Remember the last screen with an injectable-storage helper modelled on `rememberedProject`. A from-null `office.run` may carry a never-live terminal run: replace `last_run` by project, never append.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## 30-7-our-own-assets — scope: stories — from 30-4-the-office-screen — 2026-10-19

- What changed: `scene.ts` cuts the placeholder in a pure `cutSheet(source)` used by `loadSheet`. `Sheet` is `{floor, character, desk, frames: Record<OfficeState, Texture[]>}`. `placeDesks(world, sheet, agents, opts?)` (`cols`, `autoUpdate`, `tile`), `setPose`, `deskSetKey`/`syncDesks` swap poses in place. `model.ts` `framesFor(sheet, role, state)` already prefers a role's set and falls back to the shared state set. `scene.test.ts` decodes the committed `placeholder.png` to assert each state's two frames differ at a pixel the desk leaves visible.
- What no longer holds: nothing in the acceptance criteria. "the renderer's frame sets come from the atlas by name" now replaces `cutSheet`'s grid cut. Deleting the placeholder breaks the png-decoding test.
- Suggested adjustment: Replace `cutSheet` with an atlas parse (`<role>.<state>.<n>`) that fills per-role sets. Move `framesFor`'s fallback to the role's `idle` with a console warning naming the gap (injectable warn). Keep `setPose`/`syncDesks` and the in-place swap. Repoint the png-decoding test at `office.png` and its atlas rather than delete it.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-19)

## operator — scope: operator — from 30-5-the-board-screen — 2026-10-19

- What changed: nothing in 30-5 caused this. Planning 30-6 against the landed web found that the store (`live/store.ts` `OfficeView {at, agents, runs, problems, last_run}`) and the web's other reads (`/agents`, `/board`) do not carry the queue's per-state counts, the ledger's last events, or the supervisor's version. The ledger tail is only in the HTML page (`page.ts:258-262`), the counts only in `GET /status` JSON and the page header, and no HTTP surface or the page carries a version.
- What no longer holds: 30.6 AC2, "it shows the queue's counts and live runs, the agents, the office section, the ledger's last events and the supervisor's version, each from the surfaces the web already reads (no new surface)", for counts, ledger and version. SPEC Constraints say "the Status screen adds no surface".
- Suggested adjustment: choose one before 30-6 runs. (a) Narrow AC2: the screen shows what the store carries (live runs, agents, office section) and links to `/status` for counts, the ledger tail and the version (the page would need to gain a version line). (b) Extend `GET /office`'s snapshot additively in 0.1.25 with `supervisor: {version, counts}` and a ledger tail, plus the contract §1 row and note. (c) Let the web read the already cookie-readable `GET /status` JSON, extended additively with `version` and `ledger`, and name it among the §1 web surfaces. Plan 30-6 records this as its Block If; it also settles `/status` as content-negotiated (HTML → the page, otherwise today's JSON) so the bearer API stays unchanged. Also rule SPEC Open Question 3: plan 30-6 finds no conformance drive requests the page, so the supervisor's page tests are the drives that follow `/status`.
- Status: ruled (b) by the operator, 2026-10-19 (session 11): extend GET /office's snapshot additively in 0.1.25 with supervisor {version, counts} and a ledger tail (the last events of the host ledger the supervisor already reads), plus the contract section 1 row and note; the web's Status screen reads them from the one stream it already holds. /status is content-negotiated (HTML gives the page, anything else today's JSON) so the bearer API, set-supervisor-env.ps1 and the runbook's curl stay unchanged. SPEC Open Question 3: no conformance drive requests the page, so the supervisor's page tests are the drives that follow /status. Not blocked.

## operator — scope: operator — from 30-6-the-status-screen-and-the-home — 2026-10-19

- What changed: nothing in 30-6 caused this. Planning 30-7 meets SPEC Open Question 1: AC1 names the art tool "the operator's choice named in the record", the design spec's D6 leaves it open (Adobe CC, or a tool with agentic or MCP support), and a headless session cannot drive Adobe CC.
- What no longer holds: nothing yet. 30.7 AC1's "the art tool ... the operator's choice named in the record" cannot be met by the loop without a recorded choice.
- Suggested adjustment: choose one before 30-7 runs (plans/30-7.md Block If). (a) Tool-neutral, loop-authored: text pixel-grid sources under apps/studio-web/assets/, exported by tools/sprites/export.py, and the tool of record is the loop's exporter. (b) An attended tool (Adobe CC, Aseprite, …): the operator commits PNG sources first and the exporter only packs them. (c) An agentic or MCP tool the operator names, which must be reachable in the engine sandbox.
- Status: ruled (a) by the operator, 2026-10-19 (session 11): tool-neutral, loop-authored for v0. The sources are text pixel grids under apps/studio-web/assets/ (one file per sheet region, a palette file, nearest-friendly, no anti-aliased edges), exported by tools/sprites/export.py into the committed sheet and its JSON atlas; the tool of record is the exporter, named in kb/studio-web-assets.md with the format. The exporter also packs PNG sources, so an attended tool (Aseprite, Adobe CC) can re-source any region later without changing the pipeline: the operator's taste may replace the v0 pixels, the format stays. SPEC Open Question 1 closes the same way. Not blocked.

## 31-2-project-setup-from-a-template — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: kb/atlassian-free-tier.md (Q1, Q3) records these facts. A scoped API token authenticates only through `https://api.atlassian.com/ex/{jira|confluence}/<cloud id>/…`; against `<site>.atlassian.net` it answers 401. A scoped token is created for one app (Jira or Confluence; grade C), and its scopes are taken as fixed after creation (grade D, unconfirmed). The box provides `TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN` (the Jira token) and `TK_ATLASSIAN_CLOUD_ID`, plus `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` (the agent's Confluence token, a new name inside the prefix, so the by-prefix pass-through carries it). Creating statuses, updating the workflow and creating the project need the configuration and project-admin scopes, so the agent's Jira token is created with `read:jira-work`, `write:jira-work`, `read:jira-user`, `manage:jira-project` and `manage:jira-configuration` (scope meanings grade C, endpoint mapping D). Jira Free allows the two custom statuses and a transition in both project types; creating them over REST (`POST /rest/api/3/statuses`, scope GLOBAL or PROJECT, then the workflow update) is graded C, and team-managed transitions are set in the browser editor.
- What no longer holds: the adapter's transport as it is today. `plugins/tk-studio/lib/jirabackend.py` builds `https://<site>/rest/api/2` from `JIRA_API_TOKEN` / `JIRA_EMAIL`, which a scoped token cannot use (SPEC open question 1).
- Suggested adjustment: the adapter reads the `TK_ATLASSIAN_*` names and, when `TK_ATLASSIAN_CLOUD_ID` is set, uses `https://api.atlassian.com/ex/jira/<cloud id>/rest/api/3` with `TK_ATLASSIAN_AGENT_TOKEN`, and `…/ex/confluence/<cloud id>/wiki/api/v2` with `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`. When `TK_ATLASSIAN_AGENT_TOKEN` or `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` is set but `TK_ATLASSIAN_CLOUD_ID` is not, the adapter refuses by name (`TK_ATLASSIAN_CLOUD_ID` missing: a scoped token fails against the site URL) and never falls back to the site URL; Confluence never uses the site URL. `JIRA_*` and the site URL stay as the legacy fallback only when no `TK_ATLASSIAN_AGENT_TOKEN` is set. A `401` is reported by name as the token, its email (`TK_ATLASSIAN_AGENT_EMAIL`), its expiry or the org API-token toggle (kb/atlassian-free-tier.md §1 step 4), never as a missing scope. Inside the engine sandbox, a `403` whose body is the proxy's `Approval required for <host>:443` is the network approval step (kb/atlassian-free-tier.md §1 step 8); any other `403` refusal on a create names the missing scope and asks for a new token with it (scopes are taken as fixed). Setup records the owner seat's `accountId` (kb/atlassian-free-tier.md §1 step 6: read by the owner from their profile, or by a user lookup under `read:jira-user`); where it is stored is 31.2's design, and 31.5 and 31.7 depend on it. Create `Blocked - Awaiting User`, `Block Resolved` and the transition between them over REST on a company-managed project. On a team-managed project, or on any refusal, emit the exact numbered browser steps for the project's own type and verify with `GET statuses/search`: team-managed, Project settings > Issue types > Edit workflow > add status > add transition; company-managed, Settings > Work items > Workflows > Edit > Add status > add transition (kb/atlassian-free-tier.md §2 Q1).
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-3-publish-design-pages-to-confluence — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: kb/atlassian-free-tier.md (Q3, Q4) records that Confluence Free has 10 users, 2 GB of file storage, and unlimited spaces and pages, with no customisable permissions and no anonymous access. The per-file *Attachment maximum size* defaults to 100 MB and a Confluence admin can change it (grade B; its applying to Free unchanged is grade C). REST attachment uploads over 100 MB fail with 502 whatever the site limit (CONFCLOUD-85173). A scoped token is for one app, so Confluence calls use the agent's Confluence token, `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, through `https://api.atlassian.com/ex/confluence/<cloud id>/wiki/api/v2`.
- What no longer holds: nothing in the acceptance criteria; design pages with images fit within these limits.
- Suggested adjustment: authenticate Confluence calls with `TK_ATLASSIAN_AGENT_EMAIL` and `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`, refusing by name when the token is absent. Downscale or compress design images before upload, refuse by name any attachment over the per-file ceiling (the smaller of the site's *Attachment maximum size* and 100 MB; 100 MB at the default; the setting is used only when the operator supplies it or it can be read, no endpoint for reading it being graded; otherwise use 100 MB and say in the output that the ceiling was assumed), and report the bytes it has uploaded against the 2 GB Free storage. Site-wide use is read in the browser at Confluence Settings > Storage (the attended check in kb/atlassian-free-tier.md §2 Q4).
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-4-sync-back-on-a-timer — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: kb/atlassian-free-tier.md (Q2, Q3, Q4) records that API-token traffic is outside the points-based quota and is governed by burst limits (per second, per tenant, per endpoint, per method) plus a per-issue write limit. Atlassian publishes no number for either; a `429` carries `Retry-After` and a `RateLimit-Reason`, and the rate-limit headers are absent on many responses. Free Jira and Free Confluence are deactivated after 120 days of inactivity; whether API-token traffic counts as activity is unknown.
- What no longer holds: nothing in the acceptance criteria. The 10-minute budget is expected to fit a light, JQL-batched load (grade D); it is not measured until the attended header probe and the first real ticks.
- Suggested adjustment: one paged JQL search per tick over the tracked projects, never one GET per issue. JQL reads `updated` to the minute in the agent seat's Jira time zone, so the search overlaps a few minutes (`updated >= <cursor − a few minutes>`, the time written in that time zone or in a form JQL reads unambiguously), orders by `updated ASC`, de-duplicates by issue key and `updated`, and advances the cursor from the largest `updated` seen, not the host clock, only after every page of the tick has been read; an interrupted tick (a `429` or an error mid-pages) leaves the cursor where it was. On `429`, wait `Retry-After` (exponential backoff when it is absent), and treat absent rate-limit headers as normal. Record the observed `RateLimit-*` / `X-RateLimit-*` values and every `429` with its `RateLimit-Reason` in the sync-back's log, so the budget is confirmed from evidence. The page mirror reads bodies and attachment metadata (with `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`) and never re-uploads an unchanged attachment. When `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` is absent, the mirror refuses by name (as 31.3 does) and the `tracking` plane reports that as its own state, not as "no changes". The drift check's `tracking` plane reports an unreachable or deactivated site as its own state (not as "no changes"), naming the owner's sign-in (kb/atlassian-free-tier.md §1 step 10) as the fix; the loop never relies on its own API traffic to keep the site active.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-5-the-two-statuses-and-the-inbox-items — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: kb/atlassian-free-tier.md (Q2) records that on Jira Free, project roles, permission schemes and issue security cannot be customised. On an always-Free site every Jira user is an admin of every project, so the agent seat can transition, comment and attach exactly as the owner can.
- What no longer holds: any assumption that a role or permission separates the owner seat from the agent seat.
- Suggested adjustment: identify the owner by the `accountId` recorded at setup (31.2; kb/atlassian-free-tier.md §1 step 6). When no owner `accountId` is recorded, the inbox refuses by name; an absent or empty `author` or `updateAuthor` `accountId` never matches. A block counts as answered only by a comment whose `author.accountId` is the owner seat's **and** whose `updateAuthor.accountId` is the owner seat's: the agent seat is an admin and could edit an owner comment, which changes `updateAuthor`, and such a comment is not the owner's reply. Agent-authored comments are never the owner's reply.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-6-the-inbox-and-issue-screens — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: as for 31-5 (kb/atlassian-free-tier.md Q2). The owner's token rides `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` (with `TK_STUDIO_ATLASSIAN_OWNER_EMAIL`). The names are outside the `TK_ATLASSIAN_` prefix, so the token is host-only and never passed into the sandbox (Settled shape 1).
- What no longer holds: nothing in the acceptance criteria.
- Suggested adjustment: the supervisor posts the owner's reply and the Done transition with the owner's token, through the gateway (`https://api.atlassian.com/ex/jira/<cloud id>/rest/api/3`), so the author `accountId` is the owner's. The agent's token never posts as the owner. When `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` or `TK_STUDIO_ATLASSIAN_OWNER_EMAIL` is absent on the host, the supervisor refuses by name and never posts the reply or the Done transition with another identity.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-7-validation-of-a-resolution — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24

- What changed: as for 31-5 (kb/atlassian-free-tier.md Q2): any seat can transition on Jira Free.
- What no longer holds: treating any transition to `Block Resolved` as the owner's resolution.
- Suggested adjustment: accept `Block Resolved` only when the issue changelog shows the owner seat's `accountId` made the most recent transition into `Block Resolved`; an older owner transition never validates a later one by another seat. The owner `accountId` is the one recorded at setup (31.2; kb/atlassian-free-tier.md §1 step 6); when none is recorded, validation refuses by name, and an absent or empty changelog `accountId` never matches. Otherwise return the issue to the inbox with a follow-up.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-2-project-setup-from-a-template — scope: stories — from 31-1-the-free-tier-verified — 2026-10-24 (reconcile)

- What changed: the agent seat has five variables, not four. `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN` is the agent's Confluence token. The owner seat's `TK_STUDIO_ATLASSIAN_OWNER_TOKEN` and `TK_STUDIO_ATLASSIAN_OWNER_EMAIL` are host-only and never reach the sandbox. SPEC.md Assumptions bullet 1 still names four.
- What no longer holds: SPEC.md Assumptions bullet 1, "The agent seat's variables are … (`TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`, `TK_ATLASSIAN_CLOUD_ID`)".
- Suggested adjustment: read 31.2's "the two tokens in the environment" as one token per seat (consult ruling, 31-1 pass 2). Setup runs with the agent seat's tokens only (Jira and Confluence) and never needs the owner's token. The refusal names each absent variable. kb/atlassian-free-tier.md §1 step 7 is the authoritative variable list, not SPEC.md's Assumptions.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-4-sync-back-on-a-timer — scope: stories — from 31-2-project-setup-from-a-template — 2026-10-24

- What changed: setup (31.2) creates `Blocked - Awaiting User` and `Block Resolved` in Jira's In Progress category (`jirabackend.create_statuses`), and `pull_back` is unchanged, so `FROM_BACKEND_CATEGORY` maps both to canonical `in-progress`.
- What no longer holds: 31-2 Design Notes "The new statuses map onto canonical blocked by category (AD-6)"; 31.4's "status (mapped onto the canonical enum per AD-6, the Jira original kept under `external.jira`)" yields `in-progress` for them.
- Suggested adjustment: the sync-back's status mapping recognises the two setup statuses by name (`jirabackend.SETUP_STATUSES`) and maps both onto canonical `blocked`, keeping the Jira name under `external.jira` (AD-22, SPEC Constraints AD-6). Every other status keeps the category mapping. Keep round trips stable (AD-5): an unchanged `blocked` must not be re-promoted into a different In Progress status.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-5-the-two-statuses-and-the-inbox-items — scope: stories — from 31-2-project-setup-from-a-template — 2026-10-24

- What changed: as for 31-4. In addition, promote moves issues by status category (`jirabackend._transition_to_category`), which cannot pick one of three In Progress statuses. "Needs you" is shared with the project, and `planning.jira.filter_id` is absent until a rerun after an owner-made project.
- What no longer holds: "the issue … moves to `Blocked - Awaiting User`" cannot be done by category.
- Suggested adjustment: `tk-studio-track block` transitions by the target status name (`Blocked - Awaiting User`), never by category, and refuses by name when no transition reaches it. The inbox reads the issue status by name. It never relies on `filter_id`, and an absent `filter_id` is not an error.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-7-validation-of-a-resolution — scope: stories — from 31-2-project-setup-from-a-template — 2026-10-24

- What changed: as for 31-4 and 31-5. Both setup statuses are In Progress by category.
- What no longer holds: "a pass moves the issue back to `To Do` or `In Progress` … a fail moves it to `Blocked - Awaiting User`" cannot be done by category, and `Block Resolved` must not read as canonical `in-progress`.
- Suggested adjustment: detect `Block Resolved` by status name. Transition by target name (`To Do`/`In Progress` on a pass, `Blocked - Awaiting User` on a fail) and refuse by name when no transition reaches it.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)
