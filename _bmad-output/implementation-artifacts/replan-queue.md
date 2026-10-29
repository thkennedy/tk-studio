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

## 31-5-the-two-statuses-and-the-inbox-items — scope: stories — from 31-4-sync-back-on-a-timer — 2026-10-24

- What changed: sync-back maps both setup statuses to canonical `blocked` and keeps the Jira name in `external.jira.status`. A Jira-name change within the same canonical status is reported as `applied[].fields` = `["external.jira.status"]`. `sync-state.json` `last_run` is `{at, status, case, counts, newest_comment, reason}`, and the run cases include `rate-limited` and `error`. Comments carry `author: owner | agent` from `author.accountId` only.
- What no longer holds: "cleared when the status changes" and "every issue in that status" both assume the canonical `status`. It stays `blocked` through `Block Resolved`.
- Suggested adjustment: derive the inbox and clear the "!" bubble from `external.jira.status` by name. `Blocked - Awaiting User` is open and `Block Resolved` is resolved; canonical `blocked` alone is never enough. Rewrite `inbox.json` only after a tick that read every page. A `rate-limited`, `error` or `blocked` tick leaves the previous file as it is. An owner reply also needs `updateAuthor.accountId` (the 31-1 note), which the 31.4 comment log does not record.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-7-validation-of-a-resolution — scope: stories — from 31-4-sync-back-on-a-timer — 2026-10-24

- What changed: as for 31-5. `Block Resolved` is canonical `blocked`, and the transition into it is reported only as `applied[].fields` = `["external.jira.status"]`.
- What no longer holds: "Given an issue in `Block Resolved` When the sync-back sees it", if "sees" is read as a canonical status change.
- Suggested adjustment: queue `validate-resolution` from `applied[]` entries whose `fields` include `external.jira.status` and whose entity's `external.jira.status` is now `Block Resolved` (by name). A `rate-limited` or `error` tick queues nothing for issues on pages it did not read. A pass or a fail is a status the next tick reads back the same way, so keep it idempotent per (issue, transition).
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-6-the-inbox-and-issue-screens — scope: stories — from 31-5-the-two-statuses-and-the-inbox-items — 2026-10-24

- What changed: `GET /inbox?project=<id>` serves `inbox.json` v1 as written: `{ok, project, generated_at, items[]}`, where items carry `state: open | resolved | validating`. A missing file gives `generated_at: null, items: []`, and no `project` gives 400 `ProjectRequired`. `OfficeAgent.blocked_issue` is always `{issue, state}` or `null`. On a paused run it falls back to the paused story. The new `tk-studio-track` skill leaves the released-roster guard red until the release motion (3 tests).
- What no longer holds: "it lists open items sorted as served" (served items are not all open).
- Suggested adjustment: filter the served items to `state === "open"`, keeping the served order. Count the nav badge over open items. Treat an empty `items` / `generated_at: null` as an empty inbox, not an error. Read `blocked_issue` as always present (null = none). The 3 released-roster guard failures are red by design (unverifiable-here, release motion). Do not edit `released-roster.json`.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-7-validation-of-a-resolution — scope: stories — from 31-5-the-two-statuses-and-the-inbox-items — 2026-10-24

- What changed: the supervisor's paused-run pass (`apps/supervisor/src/closeout.ts`) calls `track.py block --directory <run.root>` on three triggers. These are awaiting-ruling (`awaiting-ruling` + `track-block`), a not-landed spec `status: blocked` (`devBlocked`, `track-block` only) and a not-landed stage `escalation` (`escalationBlocked`, `track-block` only). Each happens once per (story key, engine run id) since the latest `paused`. bmad-loop has no escalation hook. A transient Jira failure ends `partial` + `ok: false` + `retry: true`, and no `track-block` is recorded, so the pass retries. The re-block comment skip reads comments live and skips only when the issue was already in the status with an identical newest agent comment. Comment-log lines carry `update_author`.
- What no longer holds: "the supervisor's paused run resumes with the ruling written into the spec" read as tied to an `awaiting-ruling` event. Two of the three block triggers write none.
- Suggested adjustment: key re-arming off the run's `track-block` event (story key, engine run id), not `awaiting-ruling`. Accept all three triggers. On a fail, re-block through `track.py block` (reason = the follow-up), treating `retry: true` as "call again" and recording nothing. Identify the owner's reply with both `author` and `update_author` = owner from `comments.jsonl`. Add no engine hook.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-24)

## 31-7-validation-of-a-resolution — scope: stories — from 31-6-the-inbox-and-issue-screens — 2026-10-25

- What changed: `buildWorkerEnv` (`apps/supervisor/src/server.ts`) strips `TK_STUDIO_ATLASSIAN_OWNER_*` from every worker's env, so a host-tier job never holds the owner seat. `track.py reply` skips an identical owner comment that stands after the issue's newest agent comment (read live; named in `skipped[]`, `commented: true`). The owner's Done posts the body `Done.` and makes the owner's transition into `Block Resolved`.
- What no longer holds: "the session reads the reason and the reply" read as one owner comment per press: a repeated identical reply in the same block cycle is skipped, and the validation worker cannot act as the owner.
- Suggested adjustment: the `validate-resolution` session acts on the agent seat only (never `track.py reply`, never the owner variables). The reply to judge is the owner comments (`author` and `update_author` both `owner`) after the newest agent comment; `Done.` is a valid simple answer. A fail re-blocks through `track.py block` with a new follow-up comment, which opens a new block cycle, so the owner's next reply posts.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)


## 32-2-the-planner-leg-behind-the-chat-route — scope: stories — from 32-1-the-engagement-record-and-its-states — 2026-10-25

- What changed: ENG-NNN ids are minted per served root, so a project-less `/engagements/{id}` lookup is 409 AmbiguousEngagement `{engagement, projects[]}` when more than one root holds the id, and `?project=` settles it (`engagement.ts`/`api.ts` `locateEngagement`). `GET /engagements/{id}` answers `{ok, project, engagement, chat {route, path, last_seq}}`. `parseRecord` rejects malformed records as 500 EngagementRecordInvalid. The 32.1 lib test (`test_driver_contract.py` `test_0_1_27_opens_the_engagement_entry`) pins `**0.1.28**` absent, the `### The engagement state table (0.1.27, Story 32.1)` heading, `**0.1.27 (Story 32.1, additive).**` and "keyed by project plus id".
- What no longer holds: "`POST /chat/{engagement} {message}`", read as an id that alone names one engagement.
- Suggested adjustment: resolve the chat route's engagement with 32.1's `locateEngagement` rule (accept `?project=`; ambiguity is 409 AmbiguousEngagement; never take the first hit). Extend 0.1.27 additively and keep the pinned strings. If the story edits `driver-contract.md`, list `plugins/tk-studio/lib/tests/test_driver_contract.py` in Files.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-7-the-chat-screen — scope: stories — from 32-1-the-engagement-record-and-its-states — 2026-10-25

- What changed: the office's `engagements[]` rows and the `office.engagement` delta carry `project`, and the delta is keyed by project plus id (`office.ts`). A removed or unreadable record emits `state: null`. `OfficeView.engagements` is optional in the TS type but always present on the wire. The answer shapes are `GET /engagements?project=` → `{ok, project, engagements, problems}` and `GET /engagements/{id}` → `{ok, project, engagement, chat}`. A repeated id with no `?project=` is 409 AmbiguousEngagement. No engagement GET returns `X-CSRF-Token`, because the session-scoped token comes from `GET /inbox`. Board Needs-you items are the union `TriageItem | EngagementTriageItem {engagement, state, title}`.
- What no longer holds: "the hub emits `office.engagement {id, state, from}` deltas", read as keyed by id alone.
- Suggested adjustment: key the web store's engagements by `project` + `id`, and drop the row on `state: null`. Always send `?project=` on engagement reads and inputs. Take the CSRF token as the inbox reply does (`GET /inbox`). Render `EngagementTriageItem` in Needs-you by its `engagement` key.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-8-delivery-the-closeout-report-and-change-requests — scope: stories — from 32-1-the-engagement-record-and-its-states — 2026-10-25

- What changed: the state table is the contract subsection `### The engagement state table (0.1.27, Story 32.1)` at the end of §1's web-surfaces section. A bun test checks it equal to `TRANSITIONS` both ways, and the lib test pins its heading. `POST /engagements` refuses `follows` with 400 SchemaError (Settled shape 5). The event rows `launched`, `run-paused`, `run-resumed`, `cap` and `run-ended` are applied by the exported `applyEvent` with source `supervisor`.
- What no longer holds: "the contract's … §7.1 the state table", read as a new §7.1 section.
- Suggested adjustment: treat 32.1's subsection as the "§7.1" state table and amend it in place (any table change updates `TRANSITIONS` and the bun equality test together). Lift the `follows` refusal additively within 0.1.27. Wire the run-end rows through `applyEvent`. List `plugins/tk-studio/lib/tests/test_driver_contract.py` in Files when the contract changes, and keep the 32.1 pinned strings.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-3-clarifying-questions-through-the-inbox — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: an `engagement-chat` session runs in the run's worktree. Its payload is `{engagement, project, project_root, seq}` plus the queue `run_id`, and `project_root` (the served root) maps to `engage.py --directory`. `chat.jsonl` and `engagement.yaml` live untracked in the served root. The record is JSON text, and `engage.py` reads JSON only. `enqueue`'s `stack` applies to `engagement-chat` alone (`runs_one_live` leaves only it out). Any other job adopts the live run of its (job, checkout).
- What no longer holds: "the planner writes `engage.py questions`" and "the supervisor applies on the planner's behalf from the written file … with source `planner` and the run id", read as the session writing in its cwd with a studio run id.
- Suggested adjustment: add `questions` to `engage.py` beside `reply`, writing under `--directory <project_root>` with the same atomic write and status block. The supervisor reads the written file from the served root and records the queue `run_id` (the chat line's). A planner turn after answers is minted through `mintChatTurn` (`stack`), never a new job. A record write outside the serve path re-reads fresh and merges only its own fields (the `chatSpendPass` rule).
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-4-the-scope-of-work-on-confluence — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: as for 32-3. The planner session writes through `engage.py --directory <project_root>` into the served root, never its worktree. The record is JSON. The planner reads `kb/confluence/` at `<project_root>/<path>` (SKILL.md).
- What no longer holds: "the planner writes `engage.py scope` from the turn's `scope.md`", read as a path in the session's cwd.
- Suggested adjustment: `engage.py scope` takes `--directory` and writes `_bmad-output/engagements/<id>/scope.md` and `scope_page` in the served root. The record update re-reads fresh and merges only `scope_page` (and the scope fields).
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-5-the-quote-band — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: `spend.planning_usd` is kept by `chatSpendPass` (`chat.ts`) at the run-end `finally` sites. It maps each `chat-queued` queue run → `studio_run_id` → ledger `job-run` cost, re-reads the record fresh and merges only `planning_usd`. No shared `engagement.yaml` lock exists (consult 2026-10-25T06:03:23Z). A sub-ms read→rename window remains.
- What no longer holds: "whether scoping was billable (the planning spend so far)", read as a figure the quote computes itself.
- Suggested adjustment: read `spend.planning_usd` from the record. `engage.py quote` writes under `--directory <project_root>` and merges only `quote` (and the state) into a fresh read. If the story adds a shared record lock, `chatSpendPass` and the input route take it too; otherwise record the window as a risk.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-6-approval-autonomy-and-the-first-run — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: 32.2's spend pass sets the pattern for an engagement spend sum. Queue run ids are mapped through `studio_run_id` to the ledger `job-run` cost, and only the owned field is merged into a fresh read. The checkout lock is shared, so a `run-epic` run and a chat turn on the same served root wait on each other. `stack` is `engagement-chat` only, so the `run-epic-N` job keeps today's adoption.
- What no longer holds: "`spend.runs_usd` sums the engagement's runs' `job-run` costs", read as a new mechanism.
- Suggested adjustment: compute `spend.runs_usd` beside `chatSpendPass` (the same `finally` sites, the same queue → `studio_run_id` → ledger mapping, merge-only into a fresh read). Never pass `stack` for `run-epic-N`.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-7-the-chat-screen — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: `GET /chat/{id}?since=` answers `{ok, project, engagement, since, last_seq, lines}`. SSE uses `id: <seq>` and `event: chat`. `POST /chat/{id}` answers `{ok, engagement, seq, run_id}`. Its refusals include 409 EngagementClosed, 409 AmbiguousEngagement, 500 ChatJobUnresolved, 500 ChatQueueFailed (no line kept) and 503 ChatBusy (nothing appended). A planner line's `run_id` is the queue run id, not the studio run id, and the line carries no cost.
- What no longer holds: "owner and planner lines, the planner's run cost on hover", read as a cost on the line.
- Suggested adjustment: get the hover cost through the queue run id. `GET /runs/{run_id}` returns the run and its events but no cost, so map `studio_run_id` → ledger `job-run`, as the issue read's `cost_usd` does. Without that, show no cost; a server addition is additive on 0.1.27. Never add a field to the chat line from the web story. Render ChatBusy/ChatQueueFailed as retryable and EngagementClosed as final. Always send `?project=`.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-8-delivery-the-closeout-report-and-change-requests — scope: stories — from 32-2-the-planner-leg-behind-the-chat-route — 2026-10-25

- What changed: the same seams as 32-3 and 32-6. `engage.py` writes under `--directory <project_root>`. Chat `run_id`s are queue run ids, mapped to the ledger through `studio_run_id`. `spend.planning_usd` is already summed. The spend pass's record write is merge-only into a fresh read, with no shared lock (left to 32-5/32-8 by consult). `stack` is `engagement-chat` only.
- What no longer holds: "the planning spend" and "`engage.py closeout`", read as new computations in the served root's cwd.
- Suggested adjustment: read the planning spend from `spend.planning_usd`. `engage.py closeout` takes `--directory`. The engagement pass merges only `closeout` and the state into a fresh read, or adds the shared record lock to every writer (chat spend pass, input route, engagement pass) and names it in the 0.1.27 entry.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-6-approval-autonomy-and-the-first-run — scope: stories — from 32-4-the-scope-of-work-on-confluence — 2026-10-25

- What changed: `scope.md` is shape-checked only on the planner's `engage.py scope`. An owner page edit (mirrored back by `mdstorage.to_markdown`) or a `revise` body replaces it verbatim. After the round trip, a story's `As a`/`I want`/`So that`/`**Acceptance Criteria:**` can be joined into one paragraph. `engage.py` `STORY_SHAPE` matches them as substrings. The `### Epic <k>:`/`#### Story <k>.<m>:` headings survive.
- What no longer holds: "the scope's proposed epics and stories appended to `epics.md` as `## Epic N` sections", read as a line-by-line copy of `scope.md`'s story lines.
- Suggested adjustment: split the proposed stories on the `####` headings. Find the user-story parts and the acceptance criteria as substrings (reuse `engage.py` `STORY_SHAPE`), then re-emit them in `epics.md`'s line shape when renumbering. At approve, refuse by name a scope whose stories fail that check.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-8-delivery-the-closeout-report-and-change-requests — scope: stories — from 32-4-the-scope-of-work-on-confluence — 2026-10-25

- What changed: the same unchecked `scope.md` as for 32-6. The planner's check (`engage.py` `SIGNAL_RE`, per line) takes `Acceptance signal:` with an optional leading bullet or bold and the colon inside or outside the bold. In owner text (a mirrored edit or a `revise`) the signal can also be soft-wrapped into a joined paragraph, or be missing. 32.4 also built `confluence.find_child_folder` and `create_folder(parent_id)` for `Engagements/ENG-NNN`, the publish skip (footer hash AND remote version = recorded version), `scope.lock`, and `ScopeUnwritable`/`ConfluenceEnvMissing` refusals.
- What no longer holds: "each deliverable's acceptance signal checked against the landed stories' specs and PRs", read as a line-start `Acceptance signal:` parse.
- Suggested adjustment: parse deliverables on `###` headings with `engage.py` `parse_scope`. Find the signal with `SIGNAL_RE`, and fall back to a substring search inside the deliverable's text. A deliverable with no signal is reported as `not done — no acceptance signal`, never as a crash. Publish `ENG-NNN: Closeout` through 32.4's folder and skip helpers in `engage.py`, and record the page the same way `scope_page` is recorded.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-6-approval-autonomy-and-the-first-run — scope: stories — from 32-5-the-quote-band — 2026-10-25

- What changed: the quote's `basis.epics[] {k, title, stories, ep_id}` predicts `EP-<next.epic+k-1>`, and `ep_id` is `null` (with no `epics` band written) when the counter was unreadable. `basis.notes` is a list of strings. A `scope.md` rewrite while `scoping` voids the quote first. The `epics` writer is `quote.epic_bands_text`, which keeps other epics' entries.
- What no longer holds: "the board draws the band against it" (not without re-keying the band to the minted EP id)
- Suggested adjustment: at approve, read each new epic's minted EP id after `plansync normalize`. Where it differs from `basis.epics[].ep_id`, move that `usd_estimate` to the minted id in the epics block, in `epic_bands_text`'s byte shape. Where `ep_id` is `null`, write no band and report it. Read `quote.cap` as a USD number and `basis.notes` as strings.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## operator — scope: operator — from 32-6-approval-autonomy-and-the-first-run — 2026-10-25

- What changed: implementing 32.6 AC1 found that a `base_ref` approval, queued "at once" while the engagement PR is open, cannot be driven: `runJob` (`apps/supervisor/src/cli.ts`) and `jobrun.py submit` resolve the `run-epic-N` definition from the served root, where the job file and config entry land only with the merge. The consult escalated with three options: (a) a definition source separate from `--directory` on `jobrun.py submit` (a new §4 surface), (b) writing the job untracked into the served root (lifts "never dirtied"), (c) a `base_ref` run drives only after the merge.
- What no longer holds: 32.6 AC1's "the run cuts from `base_ref` when given" read as "queued at once from the approve commit".
- Suggested adjustment: (c).
- Status: ruled (c) by the operator, 2026-10-25 (session 11): Operator ruling 2026-10-25 (session 11), on the second consult's `escalate`: **(c)**. A `base_ref` approval never drives before the engagement PR merges. The merge watch queues the first `run-epic-N` in every case (the job resolves from the served root only once the PR lands); `base_ref`, when given, is recorded on the input and passed to that queued run as its `base_ref` (its worktree is cut from it), nothing else. No untracked file reaches the served root (never dirtied), and `jobrun.py` keeps its `--directory` definition source (no new §4 surface). AC1's clause reads: queued on the merge in both cases, cut from `base_ref` or main. The first consult's enqueue-time patch (resolve and enqueue before the merge, the OPEN-PR test) is withdrawn: remove it, or keep the branch-definition validation as a pre-check that never enqueues, the implementer's choice within Files. The drive-time gap is closed by construction (not `unverifiable-here`). Proceed to review (step 04) and commit.

## operator — scope: operator — from 32-6-approval-autonomy-and-the-first-run — 2026-10-25 (second)

- What changed: review-patch pass 4 of 32.6 added `git push --force -u origin engagement/ENG-NNN` to the approve pass so a re-approval after `revise` could push a fresh branch while the earlier PR is unmerged; the consult escalated it against the hard rule (`permissions.deny` keeps `git push --force*`; the supervisor never force-pushes) with three options: (1) allow the force, (2) no force, commit fast-forward on top of `origin/engagement/ENG-NNN`, (3) a new branch and PR per approve cycle.
- What no longer holds: nothing in the AC; the implementation's force-push.
- Suggested adjustment: (2).
- Status: ruled (2) by the operator, 2026-10-25 (session 11): Operator ruling 2026-10-25 (session 11), on the review-patch pass 4 escalation: **(2), never force.** The supervisor never force-pushes (the `permissions.deny` list keeps `git push --force*`; `--force-with-lease` is a force too). On a re-approval after `revise`, the approve worktree is cut from `origin/engagement/ENG-NNN` when that branch exists on origin (else from the default branch), the new plan lands as one more commit on top of it, replacing the earlier sections and entities wholesale in content, and the push is a plain fast-forward `git push -u origin engagement/ENG-NNN`; an open PR on that branch carries the new commit (no new PR), a merged earlier PR means the branch is cut from the default branch again and a new PR is opened; a push the remote rejects as non-fast-forward is a named refusal retried at the next pass, never forced. (b) the resume not rewriting `run-epic-N.json` and (c) the injectable `cancelQueued` are accepted at score 1. Proceed to review and commit.

## 32-7-the-chat-screen — scope: stories — from 32-6-approval-autonomy-and-the-first-run — 2026-10-25

- What changed: operator ruling (c): the first run is queued on the approve PR's merge even with `base_ref`; the approve pass writes nothing into the record (its steps live in `engagement-approve` service events, `detail.pr {number, url}` on step `pr`, then `engagement-run-queued {engagement, project, run_id, job, after_run?}`); a cap or ask pause is a `kind: cap|ask` block of the engagement's issue.
- What no longer holds: "an **Approve** control with the autonomy choice (sends `approve`)" as an immediate start: `approved` means "PR opened, waiting for merge" until `launched` moves it to `in-progress`.
- Suggested adjustment: the Approve control offers `ask | steady | full` and an optional `base_ref`; copy says the run starts when the plan PR merges; show the PR link only if a server read exposes it (an additive 0.1.27 field), never parse service events in the web. `partial` shows the cap figures and **Go** with a `{cap}` figure (replaces `quote.cap`) or **Cancel**; `paused` (ask) resumes by an owner `continue` comment on the Jira issue, not a web verb.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)

## 32-8-delivery-the-closeout-report-and-change-requests — scope: stories — from 32-6-approval-autonomy-and-the-first-run — 2026-10-25

- What changed: apps/supervisor/src/approve.ts adds `approvePass`, `engagementRunPass`, `engagementRunSpendPass` and the events `engagement-approve`, `engagement-run-queued`, `engagement-run-stop`, `engagement-cap`, `engagement-continue`; one `run-epic-N` job per appended epic, only the first queued; links are scoped to the newest approve line (`allLinks` spans every cycle, spend is unscoped); only `blocked` `engagement-issue` events carry `kind` (kind-less reads as `questions`); `cancel` has no `afterInput` and applies at the next `finally` tick.
- What no longer holds: "the engagement's last run ending" as a single obvious run: with `steady`/`ask` a run ends after each story and is resubmitted, and later epics of a multi-epic scope are declared but never queued.
- Suggested adjustment: find the engagement's runs from `engagement-run-queued` over every approve cycle; "last run" = an ended linked run with no resubmit pending (no `steady`/`ask` resubmit or ask pause owed, no cap block owed); report an unqueued later epic's deliverables "not done - epic not run". Sum per-story costs over all cycles' runs (as `spend.runs_usd` does). Before moving the issue to `Done`, close any open cap/ask block too (32.6 never closes one, DW-47), keyed on the `kind` of the newest `blocked` event. Side exits come from `engagement-cap` / `engagement-run-stop` events. The revise graceful stop is still unbuilt; reuse `launchStopGraceful` as the cap does.
- Status: closed — applied to the unstarted entry's invoke_dev_with by the gate session (2026-10-25)


## 33-4-the-host-leg-runs-the-supervisors-suites — scope: stories — from 33-1-the-supervisors-log-file — 2026-10-26

- What changed: while 33-1 ran, the engine sandbox's root filesystem reached 100 % inodes (1,310,049 of 1,310,720; `df -i /`): `/tmp` inside the VM held 1.3 million inodes of `tk-sup-*` temp directories leaked by the supervisor's `bun test` suites, which every dev session runs inside the sandbox (hole 70, the twin of hole 64 on the host). The skill render could not write its snapshot and 33-1's two dev attempts idled to the timeout; hole 65 ("a stale view of the render") was most likely this too. The operator pruned `/tmp` by hand (`/c/agent-work/worktrees/clean_tmp.py`).
- What no longer holds: 33.4's "a run of the whole gate leaves no `tk-sup-*` folder behind" is not only the host leg's concern: the leak happens wherever `bun test` runs, above all inside the sandbox.
- Suggested adjustment: the shared helper `apps/supervisor/test/tmp.ts` must remove what it made on every platform and under every exit (Linux too, where the EBUSY of hole 63 never shows), and the engine's own test run (the dev session's `bun test`) must leave `/tmp` as it found it; add a check to the story: after the full suite runs inside the sandbox, `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l` is 0. Also within 33.4 or 33.2: `tk-studio-launch check` warns when the sandbox's root has fewer than 50,000 free inodes (`df -i /` through `sbx exec`) and the supervisor's pin prunes `/tmp/tk-sup-*` and `/tmp/tmp.*` older than a day before each run.
- Status: closed — applied to the unstarted 33-4 entry's invoke_dev_with by the 33-2 gate session (2026-10-26); the inode warning and the /tmp prune stay suggestions for 33-4's planner

## 33-3-the-pin-restarts-a-logged-out-sandbox — scope: stories — from 33-2-refusals-reach-the-owner-not-the-console — 2026-10-26

- What changed: 33-2 moved the drained run's pin before the claim: `claimGate` → `pinBeforeClaim` (`apps/supervisor/src/cli.ts:1277-1318`), then `maxLoginPreflight`, then the claim. Run mode, relaunch and resume still pin in the drive (`queueRecorder.pin`, `cli.ts:1703` → `invokeSkill`, `server.ts:1115`, then `authPreflight`) and end `blocked`, and a drained run's drive skips its second pin (`prePinned`, `cli.ts:1421/1488`). A refusal goes through `recordedRefusal` (`hygiene.ts:290`) with a stable `key` (`max-login`, `pin-failed:<sb>`). A repeated key patches the same event in place (`Queue.refuseClaim`/`patchEventDetail`, `queue.ts:2173/2192`). `pin-failed` is one event per failure episode, patched in place.
- What no longer holds: "the pin stops and starts the sandbox once …, probes again, and only then runs the preflight" as one site (there are two pin sites now), and "refuses the claim through 33.2's event" for every run (only drained runs claim).
- Suggested adjustment: put the probe-and-restart in one shared seam in `sandbox.ts`, called by both `pinBeforeClaim` and `queueRecorder.pin`. A drained run still logged out after the restart refuses through the existing `max-login` key (`loginResolves`, which names the renewal). Do not add a new key. A relaunched or resumed run keeps ending `blocked` through `authPreflight`. Record `pin-restart` with the same in-place rule as `pin-failed`, so the events never flood. See plans/33-3.md.
- Status: closed — applied to the unstarted 33-3 entry's invoke_dev_with and to plans/33-3.md by the gate session (2026-10-26)

## 34-3-the-playable-verify-leg — scope: stories — from 34-1-the-engine-gate-on-the-host-leg — 2026-10-27

- What changed: 34-1 made `engine?: EngineStep` optional on `HostVerifyRan` (`apps/supervisor/src/hostverify.ts`). The producer always writes it from contract 0.1.29, but recorded pre-34.1 events are re-read by the close-out and the re-run (consult ruling, score 2). `redReason` and `prSection` tolerate its absence.
- What no longer holds: the plan's "prefer fixtures gaining `engine` over making it optional" (34-1 Code Map); 34-3's "the `host-verify` event carries `playable: pass | fail | skipped`" must follow the same pattern.
- Suggested adjustment: add `playable` optional on `HostVerifyRan`, always written on a ran leg, and tested on the producer's output. Treat a missing `engine` or `playable` as "not run" in every reader. The leg's `green` becomes host green && engine not red && playable not fail. Extend the 0.1.29 paragraph and do not bump the version (SPEC design note, contract 0.1.29).
- Status: closed — applied to the unstarted 34-3 entry's invoke_dev_with by the 34-1 gate session (2026-10-27)

## 34-2-spike-a-playable-run-on-the-box — scope: stories — from 34-1-the-engine-gate-on-the-host-leg — 2026-10-27

- What changed: 34-1 found that the box's console exe is `Godot_v4.7.2-stable_mono_win64_console.exe` (runbook §2). Prepending `dirname($GODOT)` to PATH does not make a bare `godot` resolve, so projects call `$GODOT`. A non-absolute `GODOT` gets no prepend, and the doctor's `engine` row fails it.
- What no longer holds: the epic narrative's "Godot (`$env:GODOT`, `godot` on PATH)" for the host.
- Suggested adjustment: `playable.py run` starts the absolute path in `$GODOT` (or a `--godot` flag), never a bare `godot`. Its refusal and the launch check warning name an unset or non-absolute `GODOT`, as the doctor row does.
- Status: closed — applied to the unstarted 34-2 entry's invoke_dev_with and to plans/34-2.md by the 34-1 gate session (2026-10-27)

## 34-4-engine-knowledge-pinned-per-project — scope: stories — from 34-1-the-engine-gate-on-the-host-leg — 2026-10-27

- What changed: as for 34-2. On the box, the engine is reached only through `$GODOT` (an absolute path to the `*_console.exe`). `godot` on PATH is not the box's name for it. The sandbox's Linux Godot, when provisioned with `WITH_GODOT`, is the one place a bare `godot` exists (runbook :689-693).
- What no longer holds: "`godot` on PATH" as the box's rule (epic narrative).
- Suggested adjustment: the skill's `$env:GODOT` rule reads "on the host, call `& $env:GODOT …` (an absolute path to the console exe); a bare `godot` resolves only in a sandbox provisioned with `WITH_GODOT`".
- Status: closed — applied to the unstarted 34-4 entry's invoke_dev_with by the 34-1 gate session (2026-10-27)

## 34-3-the-playable-verify-leg — scope: stories — from 34-2-spike-a-playable-run-on-the-box — 2026-10-27

- What changed: 34-2 shipped `playable.py run` with default `--mode movie` (the ruling, from the operator's baseline measurement 515fe86; harness-based re-measurement still pending); `frames[]` may include moment and failing-tick frames; the host `no_error_log` override counts only error lines before `PLAYABLE: harness detached`, so a `pass` report can carry a non-empty `log_errors[]`; exit 2 refuses a project without the `PlayableHarness` autoload, an unset/relative `GODOT`, or `--out` inside the Godot project folder.
- What no longer holds: nothing in 34.3's acceptance criteria; the implicit reading "a clean run has an empty `log_errors[]`".
- Suggested adjustment: the judge and the host leg read `report.json` `verdict` (never `log_errors` emptiness); map `playable.py` exit 0/1/2 explicitly (2 is a refusal, not a harness fail); keep `--out` outside the project's Godot folder; movie mode needs the logged-in desktop. See plans/34-3.md.
- Status: closed — applied to the unstarted 34-3 entry's invoke_dev_with and to plans/34-3.md by the 34-2 gate session (2026-10-27)

## 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap — scope: stories — from 34-6-the-asset-manifest-and-the-greybox-rung — 2026-10-27

- What changed: 34-6 fixed manifest `bounds` as glTF axes, Y up (`y` is height; `greybox.py` maps to Blender X, Z, Y; `facts` and the origin rule use the same), pinned in driver-contract.md `## Asset manifest`. A greybox entry whose existing `<name>.label.png` decodes to other pixels fails (`action: failed`, `label_state: stale`); greybox rows carry `label_state: written | kept | stale`. `greybox` gates Blender's export through `facts_of` + `gate` before placing it. DW-74 is open: `facts_of` reads POSITION accessor min/max and ignores node transforms and instancing.
- What no longer holds: an unstated axis convention for "scaled to the bounds, the origin per the rule"; `facts` being sound on third-party `.glb` files ("passed through the `facts` gate").
- Suggested adjustment: `match`/`generate` normalisation uses the contract's glTF Y-up bounds (same mapping as `greybox.py`) and reuses `facts_of`/`gate` and the hard-link `_publish_new`; resolve DW-74 (node transforms, instancing) inside 34.7 before the gate judges kit or generated files; the visual gate's greybox reference is the placed `.glb` with a `kept`/`written` label, never a `stale` one.
- Status: closed — applied to the unstarted 34-7 entry's invoke_dev_with and to plans/34-7.md by the 34-6 gate session (2026-10-27)

## 34-8-the-run-vertical-slice-job-and-the-engagements-game-path — scope: stories — from 34-6-the-asset-manifest-and-the-greybox-rung — 2026-10-27

- What changed: `assets.py` verbs end in status blocks with `status: complete | partial | blocked` (status-block.schema.json; `intent: assets`), exit 0 ok, 1 gate red or Blender failure (`partial`), 2 refusal (`blocked`); `greybox` needs `BLENDER` (else `--blender`, else `blender` on PATH) and is bounded by `--wall` (default 600 s); art path is config `assets.art_path` (TUA sets `art/world/greybox`).
- What no longer holds: plan 34-6 Design Notes' `done | failed | blocked` value set, if 34.8's plan reads it from there.
- Suggested adjustment: the host leg reads `check`/`greybox` results from status-block.schema.json values and exit codes 0/1/2 (2 is a refusal, not a red gate); the box's `BLENDER` user variable is set per the runbook; TUA's config carries `assets.art_path: art/world/greybox`.
- Status: closed — applied to the unstarted 34-8 entry's invoke_dev_with by the 34-6 gate session (2026-10-27)

## 34-8-the-run-vertical-slice-job-and-the-engagements-game-path — scope: stories — from 34-7-the-cc0-mirror-and-the-paid-rung-behind-a-cap — 2026-10-27

- What changed: 34-7 shipped `assets.py mirror-index | match | generate`. If an explicit `--mirror` names a missing folder, `match` refuses (exit 2). If the `TK_ASSETS_MIRROR` or default folder is missing, or there is no mirror at all, it ends `complete` with cc0 entries `skipped`. A Blender or normalise failure gives action `failed` with exit 1 and leaves the entry `status` unchanged. An accepted row whose write-back fails ends `failed` ("not placed"), and a failed replace is rolled back. `generate`'s cap is per invocation, may overshoot by at most one call (the run ends `partial`), and is `not-run: ledger unwritable` after a ledger failure. Tag-token scoring is in driver-contract.md:1359-1361 and :1371-1376.
- What no longer holds: an implicit reading of "`match` when the mirror exists" in which the host leg passes `--mirror` itself, or treats every exit 1 as a red gate.
- Suggested adjustment: the host leg calls `match` without `--mirror` (the env or the default resolves it) and treats exit 1 with action `failed` as a tool fault, not a gate verdict. It calls `generate` at most once per run, only when the owner has set `assets.credit_cap` and `TK_ASSETS_MESHY_KEY`, and reads the driver-contract.md 34.7 paragraph (:1359-1361, :1371-1376) as the seam.
- Status: closed — applied to the unstarted 34-8 entry's invoke_dev_with and to plans/34-8.md (Settled shape 5) by the 34-7 gate session (2026-10-27)

## 35-2-every-story-gets-its-plan-and-its-records — scope: stories — from 35-8-every-stage-leaves-a-start-and-a-stop — 2026-10-29

- What changed: 35-8 added `**0.1.30 (Story 35.8, additive).**` after 35.1's paragraph (driver-contract.md :1600; `## 8. Conformance` is now at :1710) and a header clause after 35.1's. `test_driver_contract.py` pins the order 35.1 < 35.8 and the Stories row `Story 35.1, Story 35.8 (Epic 35)`. `task-planning.md` §3 now opens with the `**Stage Log (Story 35.8).**` paragraph (`plansync.py stage --start/--stop --stage plan`). The supervisor copy `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` must equal `tools/restructure/nest_pipeline.py`'s render (`test_nest_pipeline`).
- What no longer holds: plans/35-2.md "The 35.1 paragraph runs :1531-1598; add `**0.1.30 (Story 35.2, additive).**` before `## 8. Conformance` (:1600)."
- Suggested adjustment: Put the 35.2 paragraph and header clause after 35.8's, and pin the order 35.8 < 35.2 and the Stories row `Story 35.1, Story 35.8, Story 35.2 (Epic 35)` (relax 35.8's exact-row check only to admit 35.2). In the §1 bootstrap rewrite, keep §3's Stage Log bracket, one `stage --start/--stop` per plan written. Re-render the nested `task-planning.md` with `nest_pipeline.py`, a test-pinned mirror (score 1 per the 35-8 consult rule).
- Status: closed — applied to the unstarted 35-2 entry's invoke_dev_with by the gate session (2026-10-29)
