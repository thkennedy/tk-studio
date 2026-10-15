---
id: SPEC-epic-25
companions:
  - ../../planning-artifacts/briefs/adr-repository-structure-2026-10-09.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/README.md
  - ../../planning-artifacts/design/studio-design-spec-2026-10-09/feature-ledger.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 25: One Installer Writes the Studio

## Why

A mandate plus a pain. AD-21 (signed 2026-10-14) and O5 (ruled 2026-10-09) retire the git marketplace as the user delivery path: the marketplace clone breaks on MAX_PATH on this Windows build, newcomers must clone, and the three apps can skew. The replacement is one installer: a bootstrap script installs a small self-updating meta-CLI; the meta-CLI reads a committed roster of compatible versions and installs or updates the plugin, supervisor and studio web; the plugin lands as an installer-written skills-dir plugin at `~/.claude/skills/tk-studio/`, which Claude Code loads in place as `tk-studio@skills-dir` with `${CLAUDE_PLUGIN_ROOT}` substituting (Tim's probe, 2026-10-09). This is the first epic of the design spec's build order (README §10; order ruled 2026-10-14, D3). The installer design is ADR §7 with the plugin leg replaced by the skills-dir write; `doctor` absorbs the runbook's smoke table and trust holes 14 and 15. Trace: ADR §6, §7, §8.7; spec §4, §6.5, F1, F7; holes 14, 15. Repos: tk-studio (every story); the supervisor repo for its first tagged release (25.1, an operator step until EP-31).

## Capabilities

- **CAP-1** (25.1)
  - **intent:** One committed roster per channel names the compatible set of app releases with checksums.
  - **success:** `tools/installer/rosters/stable.json` and `latest.json` each carry `schema`, `channel`, `requires` (at least `claude-code` as a version floor), and `components` with `plugin`, `supervisor`, `studio-web`, `cli` as `{tag, url, sha256}` and `uv`, `bun` as `{version, sha256}`; an entry whose URL is on another repository is allowed and named in a `source` field.
- **CAP-2** (25.1)
  - **intent:** The roster's shape and its agreement with the plugin are guarded.
  - **success:** A lib guard pins the shape, refuses a missing or malformed digest by name, and asserts the roster's `plugin` entry agrees with `released-roster.json` and `plugin.json` (gate ×3 becomes gate ×4); the guard runs in the drift check's plugin plane.
- **CAP-3** (25.1)
  - **intent:** One release script cuts any app by its prefix without owning the repository's "latest".
  - **success:** `tools/release_archive.py --app <plugin|supervisor|studio-web|cli>` builds the deterministic zip (wheel for `cli`) from the app's subtree at the `<prefix>--vX.Y.Z` tag, publishes with `gh release create --latest=false`, re-downloads and verifies the digest, and records `{tag, url, sha256}` under the right roster component; the plugin's motion is unchanged in effect; the lib suite asserts `make_latest: false` against a fake `gh`.
- **CAP-4** (25.1)
  - **intent:** The supervisor has its first tagged release in the roster.
  - **success:** `supervisor--v0.1.0` is cut from the supervisor repo's `main` by the operator using exact commands the story provides (the script runs against that checkout until EP-31), and the roster's `supervisor` entry points at that asset.
- **CAP-5** (25.2)
  - **intent:** `install`/`update` write the plugin to the skills-dir folder from the verified release zip.
  - **success:** The plugin leg downloads the zip by the roster tag, verifies SHA-256 before extracting, writes `~/.claude/skills/tk-studio/` atomically (new folder beside, rename over, previous kept until the next successful start), and names the version written; a digest mismatch refuses by name and leaves the existing folder untouched.
- **CAP-6** (25.2)
  - **intent:** A developer links the folder to their checkout so edits are live.
  - **success:** `tk-studio install --link <checkout>` makes the folder a junction (Windows) or symlink to `<checkout>/plugins/tk-studio`; `doctor` reports "link mode" with the target.
- **CAP-7** (25.2)
  - **intent:** No marketplace copy shadows the folder.
  - **success:** The plugin leg runs `claude plugin uninstall` on the user-scope copy, removes the `tk-studio` marketplace from the user's known marketplaces, and reports every project-scope `enabledPlugins` / `extraKnownMarketplaces` entry without editing other projects' tracked files; this repository drops its own committed entries in the same story.
- **CAP-8** (25.2)
  - **intent:** The skills-dir load is proven on the box.
  - **success:** `claude plugin list` shows `tk-studio@skills-dir`, `claude plugin validate` passes, and a headless probe skill substitutes `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` as forward-slash paths; `claude plugin eval` is tried against the folder and the outcome recorded in the kb either way.
- **CAP-9** (25.3)
  - **intent:** The drift check's plugin plane judges the folder against the roster.
  - **success:** `drift_check.py` reads the folder's `plugin.json` version, compares it with the roster's `plugin` entry for the configured channel (and with the in-repo catalog only in a developer checkout), and reports `ok`, `stale` (guidance `tk-studio update`), `missing` (guidance `tk-studio install`) or `shadowed` (guidance names the uninstall); it never reads `installed_plugins.json` as truth; the lib suite pins all four cases.
- **CAP-10** (25.3)
  - **intent:** Conformance cannot pass against the repository tree for the wrong reason.
  - **success:** The harness-loadable assertion reads the skills-dir folder, and the runner's `--from-archive <zip>` installs the built zip into a clean `CLAUDE_CONFIG_DIR` skills folder before driving.
- **CAP-11** (25.3)
  - **intent:** The driver contract and the spine state the folder-and-roster rule.
  - **success:** The contract header reads 0.1.19 with an additive changelog clause, §6 (drift-check invocation) states the folder-and-roster rule, the spine's AD-13 wording "installed plugin version vs `marketplace.json`" is amended to the folder and the roster, and conformance is ok over every surface.
- **CAP-12** (25.4)
  - **intent:** One bootstrap command installs the meta-CLI without cloning.
  - **success:** `tools/installer/install.ps1` and `install.sh` install the pinned `uv` unmanaged into the studio's tools folder (version and SHA-256 embedded), verify the meta-CLI wheel's digest, `uv tool install` from it, put only the studio's `bin` on the user PATH, turn on git long paths, and never clone; the README publishes each script's SHA-256 with a download-verify-run alternative.
- **CAP-13** (25.4)
  - **intent:** The meta-CLI installs, updates and reports the supervisor and studio web from the roster.
  - **success:** `tk-studio` (stdlib Python, wheel on `cli--vX.Y.Z`) `install`/`update` download and verify the supervisor zip by tag, unpack into `%LOCALAPPDATA%\tk-studio\supervisor\<version>\` (or platform equivalent), run `bun install --frozen-lockfile` with the roster's Bun, write the User environment and Startup shortcut through logic lifted from `tools/agent-pc/set-supervisor-env.ps1` (token and session secret generated once and kept), and point `current.json` at the slot; studio web unpacks into its own slot the supervisor serves; `update` stops the service tab, renames the old slot aside, verifies the new one starts, and deletes the old on the next successful start; `status` prints each component's installed and roster versions.
- **CAP-14** (25.4)
  - **intent:** A box running the supervisor from a git checkout is reported, not replaced.
  - **success:** `update` and `doctor` recognise "source checkout" mode, report instead of replacing, and name the checkout.
- **CAP-15** (25.4)
  - **intent:** Every meta-CLI verb is tested offline.
  - **success:** The lib suite exercises every verb against a fake roster, release host and `claude`, including digest-mismatch, stale-slot and source-checkout cases, with no network call.
- **CAP-16** (25.5)
  - **intent:** `tk-studio doctor` names every failure with its fix.
  - **success:** Doctor reports pass, fail and the fix for: Claude Code version vs the roster floor; the skills-dir plugin vs the roster (CAP-9 cases); the per-user store; `sbx daemon status`; folder trust (`hasTrustDialogAccepted`) for every registry root; long paths; the PATH launcher; Tailscale certificate age vs its 90-day life; the supervisor's slot or checkout and whether `/status` answers; and, when a Hermes home exists, a warning naming `auth.adopt_external_logins` and the Claude-login risk if it is on.
- **CAP-17** (25.5)
  - **intent:** Doctor runs headless.
  - **success:** `--json` emits one JSON object ending with the AD-11 status block; a conformance drive covers it.
- **CAP-18** (25.5)
  - **intent:** The runbook defers to doctor.
  - **success:** Runbook §7's smoke table says "run `tk-studio doctor`" and keeps only rows the CLI cannot check (RDP scope, the Startup shortcut's visible tab).
- **CAP-19** (25.6)
  - **intent:** Sandboxes consume the host skills folder instead of a per-sandbox install.
  - **success:** `tools/sbx-engine/provision-engine.sh` no longer installs the plugin inside the microVM; it verifies the mounted skills folder is present and read-only and that `tk-studio@skills-dir` loads inside the sandbox, and fails loudly naming the mount when absent.
- **CAP-20** (25.6)
  - **intent:** The runbook documents the mount and its drift case.
  - **success:** Runbook §3.8 and §3.5 document `sbx create` with the skills mount read-only, drop the per-sandbox plugin install from the provisioning list, and name the "sandbox store" drift case (mounted folder differs from the host's) with its fix.
- **CAP-21** (25.6)
  - **intent:** The mount is proven on one real sandbox.
  - **success:** After the operator recreates one existing sandbox with the mount (exact commands provided; PowerShell, daemon running), `tk activate` inside it is clean on four planes, a headless skill drive substitutes `${CLAUDE_PLUGIN_ROOT}` to the mounted path, and the per-sandbox syscall cost of the skills folder is measured once and recorded in the kb.
- **CAP-22** (25.7)
  - **intent:** The docs name the installer as the only install path.
  - **success:** README's install section is the one-line bootstrap plus `tk-studio install`; `kb/offline-install-runbook.md` describes the skills-dir write from a downloaded zip; `kb/agent-pc-setup-runbook.md` §3.4 drops `claude plugin marketplace add` for users and keeps it, pinned to a tag, under a "developers who clone" note; `kb/claude-plugin-archive-install-envelope.md` is marked historical with a pointer; the kb index regenerates; the skills-dir form carries a "deprecation watch" line naming where to look.
- **CAP-23** (25.7)
  - **intent:** The plugin ships through the new motion.
  - **success:** The plugin ships at 0.3.0 via the generalised motion with roster, `released-roster.json` and `plugin.json` in lockstep (gate ×4); lib suite and conformance are green; `tk activate` is clean on all four planes on TIM-PC-2 with the plugin loaded from the skills-dir folder.

## Constraints

- AD-21: the installer never clones; consumers resolve by tag, never `/releases/latest`; every release is `make_latest: false`; the roster is the only version gate.
- The plugin is sealed: nothing inside `plugins/tk-studio` reaches outside it.
- Every downloaded asset is SHA-256 verified before extract or install; a mismatch refuses by name and changes nothing.
- A same-named marketplace install shadows the skills-dir folder: user-scope copies are removed; other projects' tracked files are reported, never edited.
- Doctor runs `sbx daemon status` only — never an sbx command that would auto-start the daemon.
- Lib suite tests make no network call.
- Nothing depends on EP-31; until then the roster points at two repositories' releases.
- Driver contract changes are additive (0.1.18 → 0.1.19); conformance stays ok over every surface (AD-11).
- On Windows, a supervisor update stops the service tab before replacing (a running executable can only be renamed).

## Non-goals

- Moving the supervisor into this repository (EP-31).
- Unattended self-update of the running service; MSIX; winget; mise as a dependency (ADR §7 "Not in v1").
- CI-built releases and `gh attestation verify`; releases stay the local scripted motion.
- Editing another project's tracked settings when removing marketplace entries.

## Success signal

- On TIM-PC-2, the one-line bootstrap plus `tk-studio install` produces a studio whose plugin loads from `~/.claude/skills/tk-studio/` as `tk-studio@skills-dir` at 0.3.0, matching the roster; `tk-studio doctor` and `tk activate` are clean on the host and inside a sandbox reading the host's skills mount; lib suite and conformance are green.

## Assumptions

- `contracts/conformance/` is `plugins/tk-studio/contracts/conformance/`.
- The roster's `requires.claude-code` floor starts at the ADR §7 example (`>=2.1.224`) unless the story measures a different floor.

## Rulings on the open questions (2026-10-14, recorded by the operator's delegate; Tim may override)

The first 25.1 session halted on two schema questions and the consult ruled `escalate`. Both follow from the design spec and the ADR (never fabricate a digest; `mise.lock`-style pins), so they are settled here and in the story text:

1. **Roster components are optional per channel.** A component absent from a channel's roster means "not shipped in this channel"; the installer installs only present components and `doctor` reports an absent one as "not shipped", never as an error. A **present** `plugin`, `supervisor`, `studio-web` or `cli` entry is `{tag, url, sha256}` with all three required (`sha256` is 64 hex); the guard refuses a present entry with a missing or malformed digest by name and never accepts a placeholder or a fabricated value. At 25.1's first cut the roster carries `plugin` (0.2.16, the digest already in `released-roster.json`), `uv` and `bun`. `supervisor` is added when the operator cuts `supervisor--v0.1.0` (the story provides the commands and the schema accepts an entry whose URL is on another repository, named in the entry's `source`); `cli` lands with Story 25.4; `studio-web` lands with its first release in a later epic.
2. **`uv` and `bun` carry a per-platform digest map:** `{version, sha256: {"<target>": "<hex>", ...}}` keyed by the upstream release asset's target triple (for example `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`, `aarch64-apple-darwin`). The installer selects the running platform's key; a missing key is a named refusal (`PlatformNotPinned`). Only platforms whose digests were read from the upstream release are present; Windows x64 at minimum at first cut.
3. `stable.json` and `latest.json` are identical at the first cut. The release motion writes `latest`; promoting an entry to `stable` is a PR that copies it (ADR: stable about a week behind).
4. Operator-only steps (25.1's tag, 25.6's sandbox recreation) do not pause the engine: the story lands with the exact commands in the runbook or the kb, and the operator step is closed separately by the operator, with the result recorded afterwards.
5. Docker's read-only skills mount flag is discovered in Story 25.6, which investigates and records it; it is not a block for 25.1.
6. Slot paths outside Windows: `$XDG_DATA_HOME/tk-studio` (default `~/.local/share/tk-studio`) on Linux and `~/Library/Application Support/tk-studio` on macOS; the meta-CLI resolves the path per OS, never hard-codes it (AD-15).
7. `doctor`'s per-user store check reuses the drift check's existing store plane and its pass criteria.

## Open Questions (answered above on 2026-10-14; kept as the record)

- `studio-web` and the `cli` wheel have no releases when 25.1 lands, yet the roster requires `{tag, url, sha256}` for both: placeholders, optional entries, or added only once they exist?
- Are `stable.json` and `latest.json` identical at first cut, and what motion moves `latest` to `stable` (ADR: stable about a week behind)?
- Stories 25.1 (tagging `supervisor--v0.1.0`) and 25.6 (recreating a sandbox) contain operator-only steps: does the engine run pause for the operator, or does the story land with the commands and close the operator step separately?
- Which `sbx` flag or setting is Docker's read-only skills mount, and is it available on the installed sbx version?
- What is the Linux/macOS equivalent of `%LOCALAPPDATA%\tk-studio` for the tool, supervisor and web slots?
- Is doctor's "per-user store" check the drift check's existing store plane, or a new check with its own pass criteria?
