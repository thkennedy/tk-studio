---
title: Offline install runbook — the skills-dir write from a downloaded zip
description: How to put the tk-studio plugin into ~/.claude/skills/tk-studio/ on an air-gapped or git-less machine from the SHA-256-pinned release zip, how the release motion produces that zip, and the operator's 0.3.0 release commands.
rank: 40
---

# Offline install runbook — the skills-dir write from a downloaded zip

The sneakernet path for a machine without network, git, or npm (ST-057,
EP-018 / PROP-012). Since Epic 25 (AD-21) the plugin is delivered as the
skills-dir folder `~/.claude/skills/tk-studio/`, which Claude Code loads in
place as `tk-studio@skills-dir`; offline, that folder is written from the
release zip carried to the box. The earlier marketplace-era probe record,
[claude-plugin-archive-install-envelope.md](claude-plugin-archive-install-envelope.md),
is historical. The release motion's archive step is
`tools/release_archive.py`.

**Deprecation watch (skills-dir plugins):** this delivery rests on Claude
Code loading a plugin folder from the skills directory. Where to look for a
change: https://code.claude.com/docs/en/plugins/create ("Develop without a
marketplace"), https://code.claude.com/docs/en/plugins/loading (the
name-conflict order), and the Claude Code CHANGELOG (grep `skills-dir`).
Status: none found as of 2026-10-15.

## What each release publishes

From 0.2.6 on, the release motion publishes a GitHub release
`tk-studio--v<version>` carrying `tk-studio-<version>.zip` — the plugin
tree at the tagged commit, contents at the zip root, **normalized to
byte-determinism** (raw `git archive <tag>:subdir` output varies with
the archiving wall clock — subtree archives are tree objects — and with
local `core.autocrlf`; both probed live 2026-08-10, so the tool archives
with eol conversion pinned off and rewrites entries sorted, dated by the
commit, STORED not deflated, `create_system` pinned — machine- and
platform-independent bytes) — and records its digest in the roster:

```json
"archive": {
  "url": "https://github.com/<owner>/tk-studio/releases/download/tk-studio--v<version>/tk-studio-<version>.zip",
  "sha256": "<64 hex>"
}
```

The digest is computed from the built zip AND re-verified against the
re-downloaded published asset before it is recorded; the lib suite
(`test_release_roster.py`) goes red from the 0.2.6 floor on if a release
records no archive or a malformed one. Because the build is
deterministic, anyone at the tag can independently re-derive the
recorded digest without publishing:

```bash
uv run tools/release_archive.py run --app plugin --dry-run
```

## Sneakernet, end to end

On a **connected machine** (the repo has been public since 2026-09-15,
so the download itself needs no auth; this runbook exists for the target
machine that has no network, git, or npm at all):

```bash
gh release download tk-studio--v<version> --pattern "tk-studio-<version>.zip" --repo <owner>/tk-studio
```

Carry the zip to the target machine along with the expected digest
(read it from `released-roster.json` at the **archive-record commit
immediately after the tag** — repo tip, in practice; the roster at the
tag itself predates its own record by design — a second channel, not
the zip itself).

On the **target machine**, verify out-of-band before use:

```powershell
(Get-FileHash tk-studio-<version>.zip -Algorithm SHA256).Hash.ToLower()
```

(or `sha256sum` / `shasum -a 256` on POSIX). A mismatch means the
artifact is not what the release recorded — stop.

Then write the skills-dir folder from it. Routes (a) and (b) end with
`~/.claude/skills/tk-studio/.claude-plugin/plugin.json` (under
`$CLAUDE_CONFIG_DIR/skills/` when that is set); the zip carries the plugin
tree at its root.

- **(a) With the meta-CLI: not yet run on a box, and refused by today's
  CLI.** The offline box needs the meta-CLI first, and its bootstrap
  downloads `uv` and the CLI wheel, so the box must be connected once (or
  get those carried too). Until the first `cli--v` release is recorded in
  the roster, the bootstrap stops with `CliNotShipped`. The intended route
  is a local roster whose `plugin` entry points at the carried zip and
  carries the recorded digest, then an install from that roster:

  ```json
  "plugin": {
    "tag": "tk-studio--v<version>",
    "url": "file:///<path-to>/tk-studio-<version>.zip",
    "sha256": "<the recorded 64 hex>"
  }
  ```

  ```bash
  tk-studio install --roster <path-to-roster.json>
  ```

  The plugin leg's fetcher accepts `file://` URLs and `--roster` takes a
  path, but the roster guard (`roster_guard.py`, the copy the CLI loads)
  requires every release URL to be
  `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`, so
  today this roster is refused `RosterEntryInvalid` before anything is
  written. Use route (b) until the guard admits a local URL.

- **(b) Manual extract: not yet run on a box.** After the digest check
  above, with Claude Code closed, extract the zip into the folder (the
  blocks remove a `--link` junction or symlink without following it):

  ```powershell
  $dir = Join-Path $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { "$HOME\.claude" }) 'skills\tk-studio'
  if ((Get-Item $dir -Force -EA SilentlyContinue).LinkType) { cmd /c rmdir "$dir" } else { Remove-Item -Recurse -Force $dir -EA SilentlyContinue }
  Expand-Archive tk-studio-<version>.zip -DestinationPath $dir
  ```

  ```bash
  dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/tk-studio"
  rm -rf "$dir"
  mkdir -p "$dir" && unzip -q tk-studio-<version>.zip -d "$dir"
  ```

  Then remove the marketplace copies that would shadow the folder, as the
  installer does: `claude plugin uninstall tk-studio@<m> --scope user` for
  each user-scope copy, `claude plugin marketplace remove tk-studio`, and,
  from a project that has one, `claude plugin uninstall tk-studio@<m>
  --scope project` (or `--scope local` for a local-scope copy; the installer
  only reports project- and local-scope copies).
  `claude plugin list` should then show `tk-studio@skills-dir` with
  `Status: ✔ loaded` (what the 25.2 probe saw for the installer-written
  folder, below).

- **Or, without writing the folder: session-scoped (proven live, zero
  network):**

  ```bash
  claude --plugin-dir path/to/tk-studio-<version>.zip
  ```

  The CLI loads the zip directly — the full skill roster, no
  marketplace, no install record. Repeat the flag per session.

Where the engine sandboxes need the plugin too, run
`sbx skills import --force` on the host after either route (the sandbox
store is a copy, not a live view; see the Story 25.6 section below).

**Historical — the seed mechanism (marketplace era).** Before the
skills-dir folder, the persistent offline route was a plugin seed:
pre-populate a seed on the connected machine
(`CLAUDE_CODE_PLUGIN_CACHE_DIR=<seed>` + marketplace add + plugin
install), carry the seed directory, and run with
`CLAUDE_CODE_PLUGIN_SEED_DIR=<seed>` plus a `settings.json` carrying
the `extraKnownMarketplaces`/`enabledPlugins` halves (they never enter
the seed). The serve split, proven live 2026-08-10 (ST-056 probes —
see the envelope record for the evidence): a seeded session serves
plugin skills on **explicit `/plugin:skill` invocation only**, zero
network, and never advertises them to the session — the model cannot
discover a seeded skill on its own. That was sufficient for
driver-contract headless drives, which name their skill exactly
(§2's invocation form), and insufficient for attended discovery. Unchanged gap at CLI 2.1.226: the
`claude plugin …` management verbs do not read the seed either. It is
kept here as the record, not as a route.

## The archive marketplace source (historical: the marketplace-era seam)

Historical: this was the marketplace delivery seam, retired by AD-21 (the
skills-dir folder above). `{"source": "archive", "url": …, "sha256": …}`
in a marketplace entry is the harness-native pinned install — but it
fetches over public HTTPS (headers only survive same-origin, and GitHub
asset downloads redirect off-origin), so it could not serve this repo's
assets while the repo was private. The repo went public on 2026-09-15,
which lifted that blocker; the archive-source path was never re-probed
live against the public asset.

## Release-motion order (why the record trails the tag)

A zip cannot contain its own digest, so the motion is two commits:
gate ×3 bump + `claude plugin tag` first, then
`uv run tools/release_archive.py run --app plugin` (build → hash →
publish → verify → record) and the roster archive-record commit
immediately after — main is never left between the two. The record
commit carries both `released-roster.json` `archive` and `latest.json`'s
`plugin` entry (gate ×4). Gate ×4 binds `latest.json` only — the channel
the motion writes; `stable.json` trails it by PR and is checked for shape
only, so a `stable` plugin entry at an older tag is not drift.

## Release motion for every app

AD-21 (Story 25.1): one script cuts any app by its tag prefix, and no
release owns the repository's "latest" — every `gh release create` passes
`--latest=false` (a release that already exists is demoted with
`gh release edit <tag> --latest=false`); consumers resolve by tag through the installer roster,
never `/releases/latest`.

| `--app` | tag | built from (at the tag) | artifact |
|---|---|---|---|
| `plugin` (default) | `tk-studio--vX.Y.Z` | `plugins/tk-studio` | `tk-studio-<v>.zip` |
| `supervisor` | `supervisor--vX.Y.Z` | `apps/supervisor` (AD-21; `--repo <old checkout>` only for the old repository's historical tags, from its root) | `supervisor-<v>.zip` |
| `studio-web` | `studio-web--vX.Y.Z` | `apps/studio-web/dist` | `studio-web-<v>.zip` |
| `cli` | `cli--vX.Y.Z` | `tools/installer/cli` | wheel (`uv build`, `SOURCE_DATE_EPOCH` = commit) |

The plugin's version comes from `plugin.json`; every other app takes
`--version X.Y.Z` and needs the `<prefix>--v<version>` tag to exist. The
script builds deterministically, publishes, re-downloads and verifies the
digest, then records `{tag, url, sha256}` under the app's component in
`tools/installer/rosters/<channel>.json` (`--channel latest`, the
default, or `stable`; `--app plugin` records into `latest` only and
refuses `--channel stable`, since it also rewrites `released-roster.json`
`archive` — gate ×4) — adding `source: "<owner>/<repo>"` when the asset
lives on another repository. It refuses, before any `gh` mutation, a
roster the drift check's guard (`roster_problems`) rejects — shape plus
gate ×4 for `--channel latest`, shape only for `--channel stable` — and a
`cli` wheel whose version is not `--version`. `stable`
trails `latest`: promoting an entry is a PR that copies it into
`stable.json` (no promotion command).

Roster components are optional per channel: an absent component means
"not shipped in this channel". At the first cut both rosters carry
`plugin`, `uv` and `bun`, and are identical except `channel` (first-cut
evidence, not an invariant: `stable` trails `latest` from the next cut).

### Operator step: the supervisor's first release (`supervisor--v0.1.0`)

The engine never cuts or pushes a tag on another repository; the
operator runs these. In a `thkennedy/tk-studio-supervisor` checkout on
an up-to-date `main`:

```bash
git switch main && git pull --ff-only origin main && git tag supervisor--v0.1.0 && git push origin supervisor--v0.1.0
```

then from this repository:

```bash
uv run tools/release_archive.py run --app supervisor --version 0.1.0 --repo <path-to-supervisor-checkout> --channel latest
```

then copy the written `supervisor` entry into `stable.json` by PR.
Unverifiable here: the engine records them and never runs them.

That cut is history: `supervisor--v0.1.0` lives on the old repository, so
both rosters' `supervisor` entries carry `source:
thkennedy/tk-studio-supervisor` until the next cut.

### Operator step: the next supervisor release (from `apps/supervisor`)

Since the supervisor moved into `apps/supervisor` (AD-21, Story 28.3), every
later cut is from this repository, with no `--repo`. Pick `X.Y.Z` above
0.1.0. On an up-to-date `main` of `thkennedy/tk-studio`:

```bash
git switch main && git pull --ff-only origin main && git tag supervisor--vX.Y.Z && git push origin supervisor--vX.Y.Z
```

then, from the repository root:

```bash
uv run tools/release_archive.py run --app supervisor --version X.Y.Z --channel latest
```

The zip is `apps/supervisor` at the tag, and the entry written into
`latest.json` is `{tag, url, sha256}` on `thkennedy/tk-studio` with no
`source`. Then promote it by PR: copy that whole written `supervisor`
entry from `latest.json` into `stable.json` verbatim (the promotion route
above), and run `tk-studio update --channel latest` (and `--channel stable`
once the PR lands) on the box to check every component still resolves
against the rosters' digests. Never hand-edit a roster's entry merely to
delete `source` without a cut.
Unverifiable here: the engine records these and never runs them.

### Operator step: the 0.3.0 release (25.7 AC2)

Results: **pending: operator.** The plugin moves to 0.3.0, a minor bump
because the distribution changed. The engine never bumps, tags or publishes:
a gate ×3 bump committed without the archive-record commit turns
`test_gate_files_are_in_four_way_lockstep` red. On an up-to-date `main` of
this repository:

1. The gate ×3 bump to `0.3.0`, committed: `version` in
   `plugins/tk-studio/.claude-plugin/plugin.json`, `plugins[0].version` in
   `.claude-plugin/marketplace.json`, and `version` in
   `plugins/tk-studio/.claude-plugin/released-roster.json`. The same commit
   updates the README's "Plugin release" status row to 0.3.0. Do not push
   `main`: mint the tag at the bump commit and push only the tag, which
   carries that commit to the remote (step 2's `gh release create
   --verify-tag` refuses a tag that is not on the remote). `main` is pushed
   only after step 4:

   ```bash
   claude plugin tag plugins/tk-studio --push
   ```

2. Build, publish, verify and record the zip:

   ```bash
   uv run tools/release_archive.py run --app plugin
   ```

3. Commit the archive record immediately after (`released-roster.json`
   `archive` and `tools/installer/rosters/latest.json` `components.plugin`).
   Do not push it yet.
4. From `plugins/tk-studio/lib`, both green after step 3:

   ```bash
   uv run python -m unittest discover tests
   uv run python ../contracts/conformance/runner.py run
   ```

   Only then push both commits, the bump and the archive record, to `main`
   (`git push origin main`). If the push is rejected because `origin/main`
   moved, merge `origin/main` (do not rebase) so the tagged bump commit stays
   an ancestor of `main`, re-run step 4's checks, then push.

5. On TIM-PC-2 (PowerShell), first `git pull` in the tk-studio checkout:
   `tk activate` reads the rosters from the checked project, so a checkout
   short of the archive-record commit still has `latest.json` at 0.2.16 and
   reports `stale`. If the migration in
   [agent-pc-setup-runbook.md](agent-pc-setup-runbook.md) §3.4 ("Moving from
   the marketplace install") has not been done on this box, first run
   `claude plugin uninstall tk-studio@tk-studio --scope project` from the
   checkout: that copy shadows the folder and `tk activate` cannot see it.
   Then, from the checkout root, pass the pulled roster (the default raw
   `main` URL can serve the cached 0.2.16 `latest.json` for a few minutes
   after step 4's push):

   ```powershell
   tk-studio update --channel latest --roster tools/installer/rosters/latest.json
   ```

   `claude plugin list` should then show `tk-studio@skills-dir` and no
   `tk-studio@tk-studio`. Then `tk activate --channel latest` in a session:
   clean on all four planes, with the plugin plane reading
   `~/.claude/skills/tk-studio` at 0.3.0; then `sbx skills import --force` for the engine sandboxes.
   `stable.json` picks 0.3.0 up only by the promotion PR, so until then
   plain `tk-studio update` (channel `stable`) stays at 0.2.16, and a plain
   `tk activate` (its plugin plane defaults to `--channel stable`) reads the
   0.3.0 folder against 0.2.16 and reports `stale`. Do not run its printed
   fix (plain `tk-studio update`, channel `stable`) before the promotion PR
   lands: it rewrites the folder back to 0.2.16.

The `cli` component shipped on 2026-10-15 (`cli--v0.1.0`, a 50 KB wheel) and
`stable` was promoted to match `latest` the same day (plugin 0.3.0,
supervisor 0.1.0, cli 0.1.0), so the bootstrap runs end to end on the
default channel. A checkout can still run the meta-CLI directly
(`uv run --project tools/installer/cli tk-studio ...`).

### Where the uv and Bun pins came from

`uv` and `bun` entries are `{version, sha256: {<target triple>: <hex>}}`,
one digest per upstream platform asset, read from the newest
non-prerelease upstream release at 2026-10-14 — never computed or
invented:

- uv 0.13.1 (per-asset `.sha256` files):
  - `x86_64-pc-windows-msvc`: https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-pc-windows-msvc.zip.sha256
  - `x86_64-unknown-linux-gnu`: https://github.com/astral-sh/uv/releases/download/0.13.1/uv-x86_64-unknown-linux-gnu.tar.gz.sha256
  - `aarch64-apple-darwin`: https://github.com/astral-sh/uv/releases/download/0.13.1/uv-aarch64-apple-darwin.tar.gz.sha256
- Bun 1.4.3 (`SHASUMS256.txt`, https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/SHASUMS256.txt):
  - `x86_64-pc-windows-msvc`: `bun-windows-x64.zip`
  - `x86_64-unknown-linux-gnu`: `bun-linux-x64.zip`
  - `aarch64-apple-darwin`: `bun-darwin-aarch64.zip`

## Skills-dir plugin: the on-box probe (Story 25.2)

`tk-studio install` writes the plugin to `$CLAUDE_CONFIG_DIR/skills/tk-studio/`
(else `~/.claude/skills/tk-studio/`) from the roster's SHA-256-verified zip;
Claude Code loads it in place as `tk-studio@skills-dir`. The staging
`.tk-studio.new`, the kept `.tk-studio.previous` and `.tk-studio.retired`
(the old previous, set aside only when a target is superseded; it exists
only during a swap, or is left behind when its post-success delete fails,
and then the next run deletes it, or when a failed restore leaves it as
the only copy, and then the next run renames it back to
`.tk-studio.previous` before swapping) are dot-prefixed so Claude Code
does not load them. The probe is an opt-in lib test that runs
the real `claude` against an isolated temp `CLAUDE_CONFIG_DIR` (never the
real `~/.claude`), from `plugins/tk-studio/lib`:

```bash
TK_STUDIO_LIVE_CLAUDE=1 uv run python -m unittest tests.test_installer_live -v
```

It zips the tracked `plugins/tk-studio` tree plus a test-only
`skills/zz-probe/SKILL.md`, installs it twice through the plugin leg (so a
`.tk-studio.previous` exists), and checks list, validate and a headless
`claude -p "/tk-studio:zz-probe"` (the user's `.credentials.json` is
symlinked, never copied, into the temp config; absent, that step is
skipped by name).

Outcome on this box (Linux sandbox, Claude Code 2.1.300, 2026-10-14) —
OK, all three steps run:

- `claude plugin list`: `Skills-directory plugins (.claude/skills/*):` /
  `❯ tk-studio@skills-dir` / `Version: 0.2.16` / `Scope: user` /
  `Path: <tmp>/config/skills/tk-studio` / `Status: ✔ loaded`; the
  `.tk-studio.previous` sibling is not listed.
- `claude plugin validate <folder>`: `✔ Validation passed` (one advisory
  line, not a verdict change: the README has no marketplace install line).
- probe: `ROOT=<tmp>/config/skills/tk-studio` and
  `SKILL=<tmp>/config/skills/tk-studio/skills/zz-probe` — both forward-slash
  paths under the folder.

`claude plugin eval <folder>` was tried against a `git archive
HEAD:plugins/tk-studio` copy placed in a temporary config's
`skills/tk-studio` (same layout as the leg's output, no probe skill) — the
open question closes: eval resolves a skills-dir folder as a target, and this
plugin ships no eval suite. Verbatim, first without and then with
`--trust-plugin`:

```text
Error: <folder> is not a trusted plugin directory, and this run cannot stop to ask you about it (no interactive terminal, or --json / CI). `claude plugin eval` loads the plugin and runs its eval suite on this machine as you - only evaluate plugins you trust. Run it once in a terminal to trust this directory, or pass --trust-plugin to assert that you trust this plugin's code and eval suite (e.g. in CI).
```

```text
No eval cases found under <folder>.
Cases are expected in a evals/ directory under <folder> (the default), each case a directory containing case.yaml or prompt.md.
Run `claude plugin eval init` for a guided interview, or `claude plugin eval init --bare <name>` to scaffold a blank case.
```

Still to run by the operator on TIM-PC-2 (Windows): the same live test
(junction and forward-slash substitution on Windows) and
`uv run --project tools/installer/cli tk-studio install --link C:/GitHub/tk-studio`
(junction plus the real marketplace removal).

## Sandboxes read the host skills folder (Story 25.6)

An engine sandbox no longer gets its own marketplace copy of the plugin
(AD-21). `tools/sbx-engine/provision-engine.sh` used to run `claude plugin
marketplace add`, `install` and `update tk-studio@tk-studio --scope user`
inside the microVM; its `skills-mount` step now runs
`tools/sbx-engine/check-skills-mount.sh`, which only verifies, in order:

1. a `/proc/mounts` row targets `/home/agent/.claude/skills` (`SKILLS_MOUNT`
   overrides the path, `PROC_MOUNTS` the file);
2. its options include `ro`;
3. `tk-studio/.claude-plugin/plugin.json` exists under it;
4. `claude plugin list`, run from the project (`PROJECT_DIR`, which
   provisioning sets to the project; default the current directory, so a
   project-scope copy in its `.claude/settings.json` is listed), shows no
   marketplace copy `❯ tk-studio@<m>` (any marketplace but `skills-dir`,
   driver contract §6) shadowing it (checked first: a real shadow likely
   keeps the skills-dir entry from loading, and its fix is the uninstall);
5. the same listing shows `❯ tk-studio@skills-dir` with `Status: ✔ loaded`
   and its `Path:` is the mount's `tk-studio` folder (a loaded entry from
   another path, such as a project's `.claude/skills/tk-studio`, fails with
   its own line naming that path).

Each failure prints one line naming the mount and its fix and exits 1, and
provisioning stops. The check never uninstalls, imports or calls `sbx`; for
each shadowing copy it names `claude plugin uninstall tk-studio@<m> --scope
user` (and `--scope project`, then `--scope local`, from the project); for the `tk-studio@tk-studio`
copy it adds `claude plugin marketplace remove tk-studio`, since the old
provisioning registered that marketplace and the copy can come back from it.
A failing `claude plugin list` is its own one-line failure, naming its first
line of output; it runs under `timeout` (`LIST_TIMEOUT`, default 120 seconds)
when that is on PATH, and a listing that stalls fails with `timed out`. The lib test `tests.test_sbx_skills_mount`
drives it with a fake mounts file and a fake `claude`.

**The flag, as found.** `--skills readonly|readwrite|off` on `sbx create` or
`sbx run`, applied only when the sandbox is created (remove and recreate to
change it); `sbx settings set skills.defaultMode readonly` sets the default
for future sandboxes. Source: Docker's "Share agent skills" page,
https://docs.docker.com/ai/sandboxes/workflows/agent-skills/ (fetched
2026-10-15, marked experimental). That page now says sandboxes mount the
store read-only by default; the red-team digest (C1-redteam-1 F2) found an
earlier rendering saying read-write since sbx 0.37.0, so the runbook passes
`--skills readonly` explicitly. Not yet confirmed against `sbx create --help`
on TIM-PC-2 (operator step below); no sbx version is recorded here.

**Live mount or copy: a copy.** The docs say `sbx skills import` copies each
skill directory under the host's `~/.claude/skills` (and the other agents'
folders) into one persistent shared store, Windows
`%LOCALAPPDATA%\DockerSandboxes\sandboxes\state\agent-skills`; "Importing
replaces the complete skill directory rather than merging files"; a
top-level symlink is followed but symlinks inside a skill directory are
skipped; sandboxes "mount the contents of the store each time they start";
`sbx reset` clears the store. So the sandbox does not read the host folder
itself, and a host `tk-studio install` or `update` reaches the sandboxes only
through another import.

**Observed in this engine sandbox** (claude-tk-studio, created before this
story, 2026-10-15): `/proc/mounts` has
`host /home/agent/.claude/skills virtiofs ro,nosuid,nodev,relatime 0 0`, the
folder is empty, and `claude plugin list` shows `tk-studio@tk-studio` 0.2.16
at user and project scope (the old provisioning). The check fails loudly
here, as AC1 requires:

```text
$ bash tools/sbx-engine/check-skills-mount.sh; echo $?
skills-mount FAIL: /home/agent/.claude/skills has no tk-studio/.claude-plugin/plugin.json (the shared store is empty): run tk-studio install on the host, then sbx skills import --force there (the store is a copy of the host folder, not a live view)
1
```

**The "sandbox store" drift case.** The store a sandbox mounts differs from
the host's `~/.claude/skills`. Inside the sandbox the drift check's plugin
plane shows it as `stale`; no new case or plane. When the store is empty the
plugin does not load, so `check-skills-mount.sh` reports it first, and the
drift check runs from the studio checkout mount instead
(`uv run /c/GitHub/tk-studio/plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory <project>`),
which shows it as `missing`. Fix on the host: `tk-studio install` (or `update`), then
`sbx skills import --force`, then a fresh agent session in the sandbox (stop
and start the sandbox, with no run in flight, if the plugin plane still
shows `stale`). The installer does not run the import (it never calls
`sbx`); that is the manual step until Story 25-7 decides otherwise.

### Operator step: recreate one sandbox with the mount (AC3)

Results: **pending: operator.** Run from PowerShell on TIM-PC-2. Pick a
sandbox with no run in flight (never the one hosting a live `bmad-loop
run`); `claude-<project>` below.

```powershell
sbx daemon status                       # must say running; if not:
# Start-ScheduledTask -TaskName "Docker Sandboxes daemon"   (runbook §3.5)
cd $HOME
sbx create --help                       # confirm the --skills flag and its values; record the sbx version (sbx version)
tk-studio install                       # writes %USERPROFILE%\.claude\skills\tk-studio
sbx skills import --dry-run             # expect tk-studio from ~/.claude/skills
sbx skills import --force               # copies it into the shared store
sbx skills ls
sbx rm claude-<project>
sbx create --skills readonly --name claude-<project> claude C:\GitHub\<project> C:\GitHub\tk-studio:ro
```

Then provision it from Git Bash (runbook §3.8); the `skills-mount` step must
print `skills-mount ok`:

```bash
MSYS_NO_PATHCONV=1 sbx exec claude-<project> bash -lc 'GIT_NAME="Tim Kennedy" GIT_EMAIL="<noreply email>" bash /c/GitHub/tk-studio/tools/sbx-engine/provision-engine.sh /c/GitHub/<project> /c/GitHub/tk-studio'
```

The in-sandbox proof (`sbx exec -it claude-<project> bash -l`):

```bash
grep ' /home/agent/.claude/skills ' /proc/mounts         # expect ro
bash /c/GitHub/tk-studio/tools/sbx-engine/check-skills-mount.sh
claude plugin list                                        # tk-studio@skills-dir, ✔ loaded, no tk-studio@tk-studio
# tk activate (the activate skill runs this drift check): four planes (bmad-base, plugin, store, vault) all ok:
uv run /home/agent/.claude/skills/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory /c/GitHub/<project>
# a headless drive of one skill; ${CLAUDE_PLUGIN_ROOT} must substitute to the mounted path:
cd /c/GitHub/<project> && claude -p "/tk-studio:tk-studio-activate" --output-format stream-json --verbose \
  | grep -o '/home/agent/.claude/skills/tk-studio/skills/tk-studio-activate/scripts/drift_check.py' | head -1
# the per-sandbox syscall cost of the skills folder, measured once:
command -v strace >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq strace
strace -f -c -o /tmp/strace-all.txt claude plugin list >/dev/null
strace -f -e trace=%file -o /tmp/strace-file.txt claude plugin list >/dev/null
grep -c '/home/agent/.claude/skills' /tmp/strace-file.txt   # file syscalls touching the mount
head -25 /tmp/strace-all.txt                                 # total syscalls and time
```

Record here: the sbx version and the `--help` text for `--skills`; the
`skills-mount ok` line; the four plane results; the substituted
`${CLAUDE_PLUGIN_ROOT}` path (expected `/home/agent/.claude/skills/tk-studio`);
the syscall counts (file syscalls on the mount, total syscalls and seconds
from `strace -c`). Watch for the open points: whether `sbx skills import`
copies a plugin folder (one with `.claude-plugin/plugin.json` and nested
`skills/*/SKILL.md`, no top-level `SKILL.md`) as one skill directory;
whether it also copies the installer's dot-prefixed `.tk-studio.previous`
sibling; and whether it follows a Windows junction (the `tk-studio install
--link` developer mode writes `~/.claude/skills/tk-studio` as a junction, and
the docs only say a top-level symlink is followed).
