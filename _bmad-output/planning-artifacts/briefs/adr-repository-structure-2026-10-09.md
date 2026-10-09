# ADR: one repository for the studio's three apps, per-app releases, one installer

| | |
|---|---|
| Proposed id | AD-21 (the spine ends at AD-20; this number is taken on signature) |
| Status | **Proposed, awaiting Tim's ruling.** Nothing in this document is in force until signed. |
| Date | 2026-10-09 |
| Decides | Where the Claude Code plugin, the Bun supervisor service and the planned Next.js front end live, how each is versioned and released, how a newcomer installs and updates all three |
| Evidence | `_bmad-output/planning-artifacts/research/studio-front-end-and-repo-structure-2026-10-09/research.md` (deep recon, 8 assistants, 6 verifiers, 1 red team, 260 sources). Bracketed numbers below are that report's source rows. |
| Amends | AD-1 (composite distribution): the clause "no bootstrap script in the repo (ruled 2026-07-26)" is withdrawn by the 2026-10-09 ruling that one installer is a hard gate; the marketplace-based plugin distribution and the `bmad.lock` discipline stay. The separate-supervisor-repository choice of 2026-09-27 (`briefs/brief-studio-supervisor-2026-09-27`) is superseded if O2 is signed. |
| Rulings already in force, not reopened | no third repository; one installer, setup and updater as a hard gate; Next.js first; engines only in Docker Sandboxes; `main` protected and PR-only on every repository; TUA is the game reference and stays its own project repository |

## 1. Context: the facts as of 2026-10-09

**The three apps.**

| App | Where today | Versioning today | Release today | Built by |
|---|---|---|---|---|
| Plugin `tk-studio` | `thkennedy/tk-studio` (public, 6.8 MB), `plugins/tk-studio`, marketplace root is the repository root (`.claude-plugin/marketplace.json`, relative source `./plugins/tk-studio`), developer install through `extraKnownMarketplaces` directory source on folder trust | 0.2.16; 11 tags `tk-studio--v*`; no other tags | Local maintainer motion: gate-x3 bump commit, `claude plugin tag`, `tools/release_archive.py` builds a deterministic zip from the tag, hashes it, publishes it as the GitHub Release asset, re-downloads and verifies, records `archive: {url, sha256}` in `released-roster.json` | The studio's own loop in its sandbox (Epics 20, 24) |
| Supervisor | `thkennedy/tk-studio-supervisor` (private, 4.3 MB pack, 48 commits since 2026-09-27, no tags, no releases, no LFS, no submodules); Bun + TypeScript, `package.json` 0.1.0 private, `src/` (api, auth, cli, queue, server, tick, transcript, conformance), `start.ps1`; console-hosted on TIM-PC-2 from the checkout; also an **onboarded studio project**: own `_bmad/`, `_bmad-output/` (Epics 21, 22, 23), `.tk-studio/config.yaml`, `.bmad-loop/` (routing, policy, runs), `.claude/settings.json` with the loop's four hooks and `Bash(uv run:*)` | none yet | none yet | The loop in sandbox `claude-tk-studio-supervisor`, which mounts the supervisor checkout read-write and tk-studio read-only |
| Front end | planned (research decision B) | | | |

**Protection and CI.** All three repositories: classic branch protection on `main`, pull request required with 0 approvals, admins exempt (`enforce_admins: false`), no required status checks, no rulesets, **no GitHub Actions workflows at all**. Tests (792 lib tests, 116 conformance checks) run locally and inside the loop.

**The operator's frame (agreed 2026-10-09).** Hard gates: (1) a newcomer clones one repository and is running; (2) the plugin keeps its pinned zip and the `tk-studio--vX.Y.Z` prefix; (3) the supervisor keeps protected-main PR flow and its unattended loop builds; (4) independent versions and GitHub Releases per app; (5) the driver contract stays provable from outside the plugin (a package boundary, not necessarily a repository boundary); (6) one installer, setup and updater abstracts cloning, compatible release sets and updates. Weighted preferences, in order: newcomer clarity; release tooling that works on Windows with Bun and uv; blast radius of a bad merge; history preservation; CI simplicity; sandbox mount simplicity for the engines.

**Tim's own words.** "If the first step was to clone three repos I don't think I would go any further. Multi-app repos are not uncommon. I only conceded the separate supervisor repo because I thought it would end up being the main studio front door." And: "I'm not opposed to rewriting the entire project if it will offer clear benefits to me or any potential users."

## 2. Options

### O1. Separate repositories (today's shape), front end beside the service, one meta-installer over both

The plugin stays in `tk-studio`; the supervisor stays in `tk-studio-supervisor` and gains `web/` for the Next.js front end it serves; the installer clones or downloads both.

**Benefits.** Nothing moves and no history is touched. Each repository's protection, required checks and "latest release" are unambiguous [35][39]. A bad merge in one app cannot touch the other. Each loop keeps its own checkout and sandbox mount, exactly as today. The plugin repository stays a small, plain marketplace root, which sidesteps the marketplace clone problem entirely (§11 of the research, [239][240]).

**Drawbacks.** Fails gate 1 on its face: the newcomer path is two clones, and only the installer hides that. Cross-cutting changes (a contract bump consumed by the supervisor, a front-end feature that needs a new queue event) become ordered pull requests across repositories, and an AI assistant working in one checkout cannot see the other's call sites [10]. BMad's own distribution shows the newcomer-confusion cost of source and distribution living apart [16]. The research found no project in this class that keeps a service, its UI and its plugin apart on purpose; the one documented split reason (rebuild coupling at team scale [8][9]) does not apply to one maintainer.

### O2. One repository, `tk-studio`, three apps, per-app releases (recommended)

```
tk-studio/
  plugins/tk-studio/        the plugin, unchanged, sealed (nothing inside reaches outside it)
  apps/supervisor/          the Bun service, moved with its full history, its own package.json and bun.lock
  apps/studio-web/          the Next.js front end (new), static export served by the supervisor
  tools/installer/          bootstrap scripts, the meta-CLI, the committed roster, the hosted marketplace catalog
  tools/release_archive.py  generalised: one release motion per app prefix
  kb/, _bmad-output/, …     as today
```

**Benefits.** Meets gate 1 literally. Every comparable project ships per-app tags from one repository: Omnara (`omnarad-`, `cluster-`, `sdk-`, one workflow each) [1], OpenCode (`vscode-v` beside a lockstep core) [3], PostHog (four schemes) [6], n8n [7]; Happy archived its separate CLI and server repositories on 2026-02-14 and folded both back in [5]. Claude Code's marketplace is built for a plugin inside a bigger repository (relative source, `git-subdir`, `archive` + `sha256`) and its own docs name `<plugin>--v<version>` tags as the convention [29][30][31]. One PR flow, one `main`, one set of conventions; the assistant sees the whole graph [10]. The front end is a build artifact the service serves, so it belongs beside the service. The installer's roster has one source of tags.

**Drawbacks, each with the rule that contains it.** (a) The marketplace is the repository, and Claude Code clones the whole repository on every plugin install and every refresh, within a 120 s budget, sparse checkout being user-side only; a plugin shipped from a product repository is failing today on this Windows build at MAX_PATH [239][240][241]. Rule: the plugin reaches users through the pinned zip (`archive` + `sha256` from a hosted catalog; the repository is public so the assets need no auth), never through a clone of the monorepo; no submodules, no LFS; users who add the git marketplace pin a tag or `#stable`. (b) An installed plugin's cache holds only its own folder, so co-location buys no runtime sharing [242]. Rule: `plugins/tk-studio` is sealed, and CI installs the built zip into a clean `CLAUDE_CONFIG_DIR` before running conformance. (c) One "latest" release per repository [244][245]. Rule: `make_latest: false` on every app release; everything resolves by tag. (d) Shared `main` widens the blast radius of a bad merge from one app to three. Rule: per-app paths, per-app jobs with change detection, one fan-in gate job that asserts `success` for every job not deliberately skipped when CI arrives [38][246][247]; bypass lists do not exist on a user-owned repository, so admin exemption is a yes-or-no choice (§6). (e) History moved with `git filter-repo` keeps path-limited `git log`; `git subtree add` would not [249][250][51]. (f) The two loops (plugin and supervisor) now share one checkout and serialise on the supervisor's lock per checkout until worktrees land (loop-hole candidate 16, §5). (g) Release tooling: release-please cannot parse the `--` separator, so releases stay scripted, as today [43].

### O3. Hybrid: plugin and front end in `tk-studio`, supervisor stays separate

The pattern Happy and Supabase use for different-runtime satellites [5][19].

**Benefits.** The supervisor's checkout, sandbox and loop stay exactly as today; the plugin repository grows only by a static web app; the marketplace clone stays small.

**Drawbacks.** Fails gate 1 the same way O1 does. Splits the front end from the service that serves it and that it is written against (the supervisor's queue, SSE and session cookie), which is the one coupling the research says to keep tight (§10, insight 2). Two repositories' worth of pin-bump upkeep for the pair that changes together. The satellite pattern in the wild has no written boundary rule and grows duplicates (two things named `happy-agent`) [5].

### O4. Fresh monorepo with a workspace tool (Turborepo or Nx) from day one, histories re-imported or dropped

Tim allowed a full rewrite if it offers clear benefits.

**Benefits.** A task graph and remote cache from the start; a clean tree with no legacy layout.

**Drawbacks.** No evidence in the research of a benefit a rewrite buys that a move does not. Turborepo's Python support is experimental [26]; the Nx Python plugin is community-maintained and invalidates every project's cache on any lockfile change [24]; PostHog, the strongest mixed uv + pnpm precedent, drives uv outside Turborepo [20]. Bun workspaces have no task graph [22]; pnpm needs Developer Mode or junctions on Windows [23]. The plugin is stdlib-only Python run through `uv run` and the supervisor is a single Bun package: there are not enough tasks to cache. History preservation scores worst. Deferred: a workspace tool can be added to O2 later if the task count grows.

## 3. Scoring against the frame

**Hard gates** (pass / pass with a rule / fail).

| Gate | O1 separate | O2 one repo | O3 hybrid | O4 rewrite |
|---|---|---|---|---|
| 1. One clone and running | fail (two clones; only the installer hides it) | pass | fail | pass |
| 2. Plugin keeps pinned zip and `tk-studio--v` prefix | pass | pass | pass | pass (re-tagged) |
| 3. Supervisor keeps PR-only main and loop builds | pass | pass, loops serialise per checkout until worktrees (§5) | pass | pass |
| 4. Independent versions and Releases per app | pass | pass with `make_latest: false` and tag-only resolution | pass | pass |
| 5. Driver contract provable from outside the plugin | pass | pass with the sealed-plugin rule: the supervisor consumes the contract through `TK_STUDIO_ROOT` and the released surface, never a relative path into `plugins/tk-studio` | pass | pass |
| 6. One installer, setup and updater | pass | pass | pass | pass |

Only O2 and O4 pass gate 1 without the installer papering over it.

**Weighted preferences** (weights are mine, in Tim's order: 30, 20, 15, 15, 10, 10; scores 1 to 5; change the weights and the sums move, but the gate result above does not).

| Preference (weight) | O1 | O2 | O3 | O4 |
|---|---|---|---|---|
| Newcomer clarity (30) | 2 | 5 | 3 | 5 |
| Release tooling on Windows with Bun and uv (20) | 4 | 4 | 4 | 3 |
| Blast radius of a bad merge (15) | 5 | 3 | 4 | 3 |
| History preservation (15) | 5 | 4 | 5 | 2 |
| CI simplicity (10) | 4 | 3 | 4 | 3 |
| Sandbox mount simplicity for the engines (10) | 4 | 3 | 4 | 3 |
| **Weighted total** | **3.70** | **3.95** | **3.85** | **3.45** |

The weighted totals are close because O1 and O3 win on isolation and O2 wins on clarity; the gates decide. O2 is the only option that passes every gate and scores highest.

## 4. Decision put to Tim

**Adopt O2: one repository, `tk-studio`, holding the plugin, the supervisor and the front end, each with its own version, tag prefix and GitHub Release, with the plugin distributed to users as a pinned zip, the supervisor's history moved with `git filter-repo`, the old supervisor repository archived, and one installer (bootstrap script plus meta-CLI plus committed roster) as the only newcomer path.** The design rules in §2 O2 (a) to (g) are part of the decision, not advice.

**What this does not change.** Engines run only in Docker Sandboxes; `main` is PR-only on every repository; AD-2's downward-only dependency and the driver contract as the sole upward interface; the Max login pays; the-universe-awaits stays its own repository (it is a project the studio works on, not a studio app). The single checkout on TIM-PC-2 for development and the running service stays (Tim's 2026-10-09 decision); the installer's versioned-slot layout is for newcomers.

## 5. Migration plan (the supervisor into `apps/supervisor`)

**Rehearse first, on throwaway clones, until every check below passes; then do it once for real.** The supervisor repository is untouched until the final archive step, so rollback before that is "close the PR".

1. **Freeze.** No supervisor loop run in flight; all PRs merged on both repositories; the supervisor tab stopped from the console (Tim). `git config --global core.longpaths true` on the box (a user-level git setting; I can set it).
2. **Rewrite the history under the new folder.** `git clone --no-local C:\GitHub\tk-studio-supervisor svc-rewrite`, then `uvx git-filter-repo --to-subdirectory-filter apps/supervisor` (filter-repo requires a fresh clone and removes `origin` itself [50]). There are no tags to rename and no signed commits, so nothing is lost. Confirm `node_modules` is ignored and absent from history.
3. **Merge on a branch of `tk-studio`.** `git checkout -b restructure/supervisor-into-monorepo`; `git remote add svc ..\svc-rewrite`; `git fetch svc`; `git merge --allow-unrelated-histories svc/main`; remove the remote. Expected conflicts: none (every path is new). Fix-ups in the same branch: root `.gitignore` gains the supervisor's ignore entries under `apps/supervisor/`; `README.md` and `kb/agent-pc-setup-runbook.md` §4 point at `apps/supervisor`; `tools/release_archive.py` learns the second prefix (§6).
4. **Keep the supervisor a nested studio project.** `apps/supervisor` keeps its own `_bmad/`, `_bmad-output/` (Epics 21 to 23 keep their numbers; they already do not collide with tk-studio's 20 and 24), `.tk-studio/config.yaml` (add `project_id: supervisor`), `.bmad-loop/` and `.claude/settings.json` (its hooks and `Bash(uv run:*)`). The registry entry's `root` becomes `C:\GitHub\tk-studio\apps\supervisor` (the registry schema stores an absolute root per project and `project_id` defaults to the basename, so a nested root is representable). Rehearsal checks: `tk activate` from the nested root is clean; a Claude session started in `apps/supervisor` fires the four loop hooks with `$CLAUDE_PROJECT_DIR` equal to the nested root; the nested folder is trusted on the box (trust is per folder with no inheritance, runbook §4.1); `bmad-loop` finds its run workspace. If any check fails, the fallback is one project root with the supervisor's planning artifacts merged under `_bmad-output/` and the interchange counters reconciled, which is more work and the reason to rehearse.
5. **Sandboxes.** One sandbox `claude-tk-studio` mounting `C:\GitHub\tk-studio` read-write serves both loops; `launch-epic.sh` takes `ROOT=/c/GitHub/tk-studio/apps/supervisor` for supervisor epics and the repository root for plugin epics. The two loops serialise on the supervisor's lock per checkout; concurrent runs need `git worktree` support in the supervisor, recorded as loop-hole candidate 16 in the observation ledger. The `tk-studio:ro` second mount disappears (`TK_STUDIO_ROOT` is now inside the same mount). Rehearsal check: provision the sandbox and run the supervisor's `bun test` and tk-studio's conformance from the one mount.
6. **Service cut-over on TIM-PC-2.** The Startup shortcut target becomes `C:\GitHub\tk-studio\apps\supervisor\start.ps1` (Tim edits the shortcut); User environment unchanged (`TK_STUDIO_ROOT` is still `C:\GitHub\tk-studio`); `bun install --frozen-lockfile` in `apps/supervisor`; start the tab from the console; `curl /status` from another device; one queued job to a guarded end.
7. **Open the PR, merge through protected `main`.** The PR description carries the rehearsal checklist with results.
8. **Archive `thkennedy/tk-studio-supervisor`** after its README points at `tk-studio/apps/supervisor`. Archiving keeps code, PRs, issues and history readable at the old URL with no redirect [54]; the PR discussions stay there (they do not move with the git history). Do not delete it.
9. **Record.** Runbook §3.8 and §4 updated; the handoff updated; the spine gains AD-21; the ledger gets the holes found during rehearsal.

**Rollback.** Before step 8: close the PR and delete the branch; the old repository is intact. After step 8: unarchive (archiving is reversible [54]) and revert the merge commit on `main` through a PR.

## 6. Per-app release scheme

| App | Tag prefix | Artifact | Motion |
|---|---|---|---|
| Plugin | `tk-studio--vX.Y.Z` (unchanged) | the deterministic zip of `plugins/tk-studio`, SHA-256 recorded in `released-roster.json` | unchanged: gate-x3 bump, `claude plugin tag`, `release_archive.py` |
| Supervisor | `supervisor--vX.Y.Z` | a zip of `apps/supervisor` (source plus `bun.lock`, the same `git archive` plus normalisation the plugin uses), SHA-256 recorded; later, optionally, a compiled single executable | `release_archive.py --app supervisor` (the script generalised by prefix and subtree) |
| Front end | `studio-web--vX.Y.Z` | a zip of the static export `out/`, SHA-256 recorded | `release_archive.py --app studio-web` after `next build` |
| Meta-CLI | `cli--vX.Y.Z` | a Python wheel, SHA-256 recorded | `release_archive.py --app cli` after `uv build` |

Rules that apply to every row: `gh release create --latest=false` so no app owns the repository's "latest" [244]; consumers (the meta-CLI, the roster, the bootstrap) resolve by tag, never `/releases/latest`; the `--v` separator stays because it is Claude Code's own convention [31] and the release step is scripted anyway (release-please would mis-parse it [43]); one `on.push.tags` workflow per prefix is the shape to use **if** releases ever move to GitHub Actions, with path filters not relied on for tag pushes [33]; until then releases stay the local maintainer motion that works today on Windows with uv and gh.

**Compatible sets** are expressed by the roster (§7), not by a fourth meta-release: one `roster` file names the tag, URL and SHA-256 of each app for a channel.

**Protection and CI.** The merge changes nothing about protection: PR required, 0 approvals, admins exempt, no required checks, no rulesets, as today on all three. When CI is added (a separate story): per-app jobs gated by change detection, one fan-in `gate` job as the only required check, asserting `success` for every job not deliberately skipped [38][246][247]; every non-release workflow filtered to `branches:` so tag pushes do not fan out [33]. Bypass lists are unavailable on a user-owned repository [246], so the admin-exempt setting is binary: see §8.

## 7. Installer design (one setup and updater)

**Shape.** The pattern Claude Code, uv, Hermes and Microsoft's own dev-box setup ship on Windows: a bootstrap script installs a small self-updating CLI, and the CLI owns everything after that [56][57][61][63]. Hermes's `install.ps1` is the blueprint to copy: hash-pinned downloads into versioned tool slots, only a launcher directory on the user PATH, a JSON provenance marker, re-run equals update [62].

1. **Bootstrap** (`tools/installer/install.ps1`, `install.sh`; published with their SHA-256 in the README, with a download-verify-run alternative to `irm | iex` [259]). The script embeds the pinned uv version and SHA-256 and the pinned meta-CLI wheel tag and SHA-256 (the Hermes model: pins live inside the versioned script). It installs uv unmanaged into `%LOCALAPPDATA%\tk-studio\tools\uv-<version>\` (`UV_UNMANAGED_INSTALL`, so the studio owns it and `uv self update` is off [60]), then `uv tool install "tk-studio-cli @ <wheel url>"` after verifying the wheel's digest, and puts only `%LOCALAPPDATA%\tk-studio\bin` on the user PATH. It turns on long paths for git. It never clones the repository.
2. **Meta-CLI** `tk-studio` (stdlib Python, delivered as a wheel; `uv tool upgrade` honours install-time pins [58][59]): `install`, `update`, `doctor`, `status`. Verbs read the **roster**.
3. **Roster** `tools/installer/rosters/{stable,latest}.json`, committed, PR-bumped: `{ schema, channel, requires: { claude-code: ">=2.1.224" }, components: { plugin: {tag, url, sha256}, supervisor: {...}, studio-web: {...}, cli: {...}, uv: {version, sha256}, bun: {version, sha256} } }`. The shape of `mise.lock` and rustup's channel manifest: a committed set with checksums; rollback is "install the previous roster" [72][73]. The plugin's manifest `version` and `released-roster.json` are written from the same numbers, so Claude Code's recompute-and-compare agrees with the roster [30]. Two channels: `stable` is about a week behind `latest`, as Claude Code and Tailscale do [56][81].
4. **Plugin leg.** `claude plugin marketplace add <raw URL of tools/installer/marketplace.json>` (a hosted `url` catalog fetches only the JSON [29]) whose entry is `archive` + `sha256` pointing at the release zip, then `claude plugin install tk-studio@<catalog> --yes` [75]. Third-party marketplaces do not auto-update and there is no update-all, so `tk-studio update` runs `claude plugin update` itself [30][74]. The in-repo `.claude-plugin/marketplace.json` stays the developer catalog (relative source, in-place edits); catalog naming is settled in the installer story with the drift check in mind. The old `claude plugin marketplace add thkennedy/tk-studio` path keeps working for developers who want the clone, pinned to a tag.
5. **Supervisor leg.** Download the release zip by tag, verify, unpack into `%LOCALAPPDATA%\tk-studio\supervisor\<version>\`, `bun install --frozen-lockfile` there with the roster's pinned Bun, write the User environment through the existing `set-supervisor-env.ps1`, create the Startup shortcut, and point `current.json` at the slot (a pointer file, not a junction). `update` stops the service tab first (Windows will not replace a running executable; it can only be renamed [66][253]), renames the old slot aside, verifies the new one starts, then deletes the old on the next successful start. Tim's box runs from the git checkout instead (`doctor` recognises "source checkout" mode, as Hermes does [61]).
6. **Front-end leg.** The export zip into `%LOCALAPPDATA%\tk-studio\web\<version>\`; the supervisor serves the slot `current.json` names.
7. **Doctor.** Versions against the roster, folder trust, long paths, PATH, the sbx daemon, the plugin's installed version against the catalog, certificate age.
8. **Integrity.** SHA-256 per asset from the roster, the roster itself over HTTPS from the public repository; `gh attestation verify` once releases are built in CI [64].

**Not in v1.** Unattended self-update of the running service; MSIX (no per-user services, no install-directory writes [70]); winget (one PR per version, no roster concept [67][68]); mise as a dependency (a fourth runtime before the one command runs [72]).

## 8. Rulings only Tim can make

1. **Sign O2**, or choose another option.
2. **Admin exemption on `main`**: keep "admins not enforced" (today; your hotfix lane, and the unattended merges run under your token) or bind admins too (absolute, no lane; bypass lists are not available on a user-owned repository).
3. **Front-end release**: its own `studio-web--v` tag paired by the roster (recommended, honours gate 4), or bundled into the supervisor's release (one artifact, lockstep, simpler).
4. **Nested studio project** for `apps/supervisor` (recommended, decided by the rehearsal) or one project root with merged planning artifacts.
5. **Archive the old supervisor repository** after the merge (recommended) or keep it as a read-only mirror.
6. **Order of work**: restructure first, then the front-end brief and epic land as `apps/studio-web` (recommended), or the front-end epic first in the supervisor repository and the restructure after.
7. **Meta-CLI delivery**: a wheel on its own `cli--v` release (recommended; no clone, hash-pinned) or `uv tool install` from the git tag (clones the repository).

**Signature.** ______________________ Tim Kennedy, date ______________
