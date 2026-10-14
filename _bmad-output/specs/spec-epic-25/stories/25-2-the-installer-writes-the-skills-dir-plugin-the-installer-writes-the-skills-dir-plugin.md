---
title: 'The Installer Writes the Skills-Dir Plugin'
type: 'feature'
created: '2026-10-14'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
baseline_revision: b16814f6aab8ab53a88d2083570178a7bd923bcc
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/SPEC.md'
warnings: ['oversized']
deferred: []
---

# The Installer Writes the Skills-Dir Plugin

Story 25.2 (Canonical: ST-082). Authoritative text: `_bmad-output/planning-artifacts/epics.md` §"Story 25.2". No `plans/25-2.md` exists; the Code Map below is the investigation.

<intent-contract>

## Intent

**Problem:** The plugin reaches users only through the git marketplace (clone, cache copies, MAX_PATH), and a same-named marketplace install silently shadows a skills-dir folder. AD-21/O5 make `~/.claude/skills/tk-studio/` (loaded in place as `tk-studio@skills-dir`) the delivery path.

**Approach:** Start the meta-CLI package at `tools/installer/cli` (the subtree 25.1's `release_archive.py` already builds as the `cli` wheel) with the plugin leg only: `tk-studio install|update` write the folder from the roster's verified zip, `install --link` links a checkout, every run removes marketplace copies, and a minimal `doctor` reports the folder's mode. Stories 25.4/25.5 add the bootstrap, the other legs and the full doctor on top.

### User story

As a user of any machine with Claude Code signed in, I want the plugin written to `~/.claude/skills/tk-studio/` from the verified release zip, with every marketplace copy removed, so that Claude Code loads the studio in place with no clone, no cache copy and nothing shadowing it.

### Acceptance criteria (transcribed verbatim from the authoritative story)

- **AC1** — **Given** `tk-studio install` or `update` and a roster **When** the plugin leg runs **Then** it downloads the plugin zip by the roster's tag, verifies the SHA-256 before extracting, writes the folder atomically (new folder beside, rename over; the previous folder kept until the next successful start), and the result names the version written; a digest mismatch refuses by name and leaves the existing folder untouched
- **AC2** — **Given** the developer's own checkout **When** `tk-studio install --link <checkout>` runs **Then** the folder is a junction (Windows) or symlink to `<checkout>/plugins/tk-studio`, so edits are live, and `doctor` reports "link mode" with the target
- **AC3** — **Given** a marketplace copy of `tk-studio` at user or project scope **When** the plugin leg runs **Then** it uninstalls the user-scope copy (`claude plugin uninstall`) and removes the `tk-studio` marketplace from the user's known marketplaces, reports every project-scope `enabledPlugins` or `extraKnownMarketplaces` entry it finds without editing another project's tracked files, and this repository drops its own committed `extraKnownMarketplaces` and `enabledPlugins` entries in the same story
- **AC4** — **Given** the written folder **When** `claude plugin list` and `claude plugin validate` run and a probe skill is invoked headless **Then** the plugin loads as `tk-studio@skills-dir`, validation passes, and `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` substitute as forward-slash paths (the 2026-10-09 probe, now a test the story runs on the box); `claude plugin eval` is tried against the folder and the outcome recorded in the kb (the open question closes either way)

## Boundaries & Constraints

**Always:**
- Stdlib-only Python (NFR9), runnable as `uv run --project tools/installer/cli tk-studio <verb>` and as `python -m tk_studio_cli` with `tools/installer/cli` on `sys.path`; `pyproject.toml` names project `tk-studio-cli`, version `0.1.0`, script `tk-studio = "tk_studio_cli.main:main"`.
- Target folder = `$CLAUDE_CONFIG_DIR/skills/tk-studio` when `CLAUDE_CONFIG_DIR` is set, else `~/.claude/skills/tk-studio` (resolved per OS via `Path.home()`, AD-15). Staging `.tk-studio.new` and previous `.tk-studio.previous` are dot-prefixed siblings in the same skills dir (probed 2026-10-14: Claude Code 2.1.300 does not load dot-prefixed folders there).
- Roster input: `--roster <path|https-url>` (default the raw `main` URL of `tools/installer/rosters/<channel>.json`, `--channel stable|latest`, default `stable`). The leg consumes only `components.plugin`; an absent `plugin` component is reported "not shipped in this channel", never an error (SPEC ruling 1). The plugin entry must be `{tag, url, sha256}`, sha256 64 lowercase hex, and the url must contain the tag ("by the roster's tag") — else a named refusal.
- Verify the digest of the downloaded bytes before any extraction; after extraction, `.claude-plugin/plugin.json` `version` must equal the tag's `X.Y.Z` (else refuse, staging removed, target untouched). Extraction refuses absolute paths and `..` members (zip-slip).
- Write order: remove an old `.tk-studio.previous` → extract to `.tk-studio.new` → rename target → `.tk-studio.previous` → rename `.tk-studio.new` → target. On any failure before the last rename the target is untouched; a failed final rename restores the previous.
- Never follow a link when deleting: a symlink/junction target or previous is unlinked (`os.unlink`/`os.rmdir` for a junction), never `shutil.rmtree`'d through, so a linked checkout is never deleted.
- Every verb prints exactly one JSON object as the last stdout line: `{status: complete|partial|blocked, intent: "tk-studio-cli-<verb>", artifacts: [...], reason, ...leg fields}` (AD-11 shape); a refusal is `blocked` with a named `reason` (e.g. `DigestMismatch`, `PluginVersionMismatch`, `UnsafeZipMember`, `LinkTargetInvalid`) and exit code 1.
- `claude` is invoked through one injectable runner (tests pass a fake); the downloader is one injectable fetcher (tests serve bytes from memory). Lib tests make no network call, never invoke the real `claude`, and never touch the real home (tempdir `CLAUDE_CONFIG_DIR`/home).
- Credentials never land in tracked files, results or logs (NFR5).

**Block If:**
- The AC4 on-box run shows `tk-studio@skills-dir` failing to load or validation failing for the unmodified plugin tree — HALT; do not change shipped plugin files to make it pass.

**Never:**
- Never run the leg against this box's real `~/.claude` (no real uninstall, no real marketplace removal, no write to the real skills dir): AC4's live run uses an isolated `CLAUDE_CONFIG_DIR`.
- Never edit any project's settings files other than this repository's `.claude/settings.json`; never edit `installed_plugins.json`/`known_marketplaces.json` directly (only via `claude plugin …`).
- No bootstrap scripts, supervisor/web legs, `status` verb, or full doctor (25.4/25.5); no drift-check or conformance change (25.3); no README/runbook install-path rewrite (25.7); no plugin version bump; no change under `plugins/tk-studio/skills|agents|.claude-plugin`.
- No push, tag, release, or `gh` call.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Fresh install | roster plugin entry, no folder | folder written, result `version_written: "0.2.16"`, `mode: "written"` | — |
| Update over existing | folder v0.2.15 present | new folder in place, old at `.tk-studio.previous` | — |
| Next run | `.tk-studio.previous` exists, run succeeds | old previous removed, replaced by the folder just superseded | — |
| Digest mismatch | bytes ≠ roster sha256 | `blocked`, reason `DigestMismatch` naming `plugin`; no staging left, target bytes unchanged | exit 1 |
| Bad roster entry | missing/short sha256, url without tag | `blocked`, reason names the field | exit 1, nothing downloaded |
| Plugin absent in channel | roster has no `plugin` | `complete`, `plugin: "not shipped in this channel"` | — |
| Version mismatch | zip's plugin.json ≠ tag | `blocked` `PluginVersionMismatch`; target untouched | exit 1 |
| Zip-slip | member `../x` | `blocked` `UnsafeZipMember` | exit 1 |
| Link | `--link <checkout>` with `plugins/tk-studio/.claude-plugin/plugin.json` | target is symlink (POSIX) / junction (Windows, `mklink /J`) to it; `mode: "link"`, `link_target` | missing manifest → `LinkTargetInvalid` |
| Link replaces folder / folder replaces link | either existing | swapped atomically; a link is never recursed into | — |
| doctor | linked / written / missing | `mode: "link"` + `link_target` ("link mode") / `mode: "written"` + version / `mode: "missing"` | read-only |
| Marketplace user copy | `installed_plugins.json` has `tk-studio@<m>` scope `user`; `known_marketplaces.json` has `tk-studio` | runner called `claude plugin uninstall tk-studio@<m> --scope user` and `claude plugin marketplace remove tk-studio`; both in result `removed[]` | non-zero exit from `claude` → `partial` naming the command; folder write still reported |
| Project-scope entries | project/local records in `installed_plugins.json`; `~/.claude.json` `projects` keys; each project's `.claude/settings.json`/`settings.local.json` with a `tk-studio` key in `enabledPlugins` or `extraKnownMarketplaces` | each listed in `project_entries[]` as `{project, file, key}`; no file modified (mtime + bytes pinned) | unreadable/invalid JSON file → listed with `error`, never fatal |
| No `claude` on PATH | — | marketplace step `skipped` with reason, leg still writes | — |

</intent-contract>

## Code Map

- `tools/release_archive.py:74` -- `APPS["cli"] = ("cli--v", "tools/installer/cli", "wheel")`: this story creates that subtree; `:170` builds it with `uv build` from its `pyproject.toml` version. Read-only.
- `tools/release_archive.py:252` -- the plugin zip is `git archive <tag>:plugins/tk-studio` normalised: members sit at the zip root (`.claude-plugin/plugin.json`, `skills/`, `agents/`, `lib/`, …). Asset name `tk-studio-<v>.zip`.
- `tools/installer/rosters/{stable,latest}.json` -- real rosters (schema 1; `components.plugin` = `tk-studio--v0.2.16`, url, sha256 `2abc4e47…`). Read-only; test fixtures must also pass `roster_problems` (25.1 guard, `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py`): six known names, `schema: 1`, channel = stem, `>=X.Y.Z` floor, non-periodic 64-hex digests.
- `plugins/tk-studio/lib/tests/test_release_roster.py:27-33` -- the pattern for importing repo-side code from the lib suite via `sys.path.insert(0, PLUGIN_ROOT.parents[1] / ...)`; mirror it for `tools/installer/cli`. Its `_digest()` helper shows non-periodic fixture digests.
- `plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py:134-136` -- `CLAUDE_CONFIG_DIR or ~/.claude` home resolution and `plugins/installed_plugins.json`; mirror the resolution. Do not modify.
- `~/.claude/plugins/installed_plugins.json` (shape, v2): `{"version":2,"plugins":{"tk-studio@tk-studio":[{"scope":"user",...},{"scope":"project","projectPath":"/c/GitHub/tk-studio",...}]}}`; `~/.claude/plugins/known_marketplaces.json`: `{"tk-studio": {...}, ...}`; `~/.claude.json` `projects` is an object keyed by project path. Read only; fixtures copy these shapes.
- `claude` 2.1.300 CLI: `claude plugin uninstall <plugin> -s user`, `claude plugin marketplace remove <name>`, `claude plugin list` (prints `Skills-directory plugins (.claude/skills/*):` then `❯ <name>@skills-dir` … `Status: ✔ loaded`), `claude plugin validate <path>` (prints `Validation passed`), `claude plugin eval [target]`. `claude -p` needs auth: in an isolated `CLAUDE_CONFIG_DIR` it prints `Not logged in`.
- `.claude/settings.json:2-12` -- the committed `extraKnownMarketplaces.tk-studio` and `enabledPlugins["tk-studio@tk-studio"]` blocks to drop; keep `hooks` and `permissions` byte-identical. No lib test or conformance code reads these keys (grep 2026-10-14).
- `kb/offline-install-runbook.md` -- append the AC4 probe record (no frontmatter change → kb index needs no regeneration). README/other kb mentions of `extraKnownMarketplaces` are 25.7's.

## Tasks & Acceptance

**Execution (Files boundary):**
- `tools/installer/cli/pyproject.toml` -- new; per Always; no dependencies; build backend stdlib-compatible (`hatchling` or `setuptools` as build-time only, matching what `uv build` resolves) -- AC1/AC2 entrypoint.
- `tools/installer/cli/tk_studio_cli/__init__.py`, `__main__.py`, `main.py` -- argparse verbs `install [--link CHECKOUT]`, `update`, `doctor`; `--roster`, `--channel`; JSON result -- AC1/AC2.
- `tools/installer/cli/tk_studio_cli/plugin_leg.py` -- roster entry check, fetch, verify, safe extract, atomic swap, link, marketplace removal, project-scope report, doctor read -- AC1–AC3.
- `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py` -- one test per matrix row plus a real-roster test (the committed `stable.json` plugin entry is accepted by the leg's check) -- AC1–AC3.
- `plugins/tk-studio/lib/tests/test_installer_live.py` -- opt-in (`TK_STUDIO_LIVE_CLAUDE=1`, skipped otherwise with that reason): isolated `CLAUDE_CONFIG_DIR`; builds a zip of `plugins/tk-studio` plus a test-only `skills/zz-probe/SKILL.md` that echoes `ROOT=${CLAUDE_PLUGIN_ROOT}` / `SKILL=${CLAUDE_SKILL_DIR}`, a guard-valid roster with its digest, runs `install` with a `file://`-serving fetcher; asserts `claude plugin list` shows `tk-studio@skills-dir` loaded, `claude plugin validate <folder>` passes, `.tk-studio.previous` (after a second run) is not listed; headless `claude -p "/tk-studio:zz-probe"` with the user's own `.credentials.json` symlinked (never copied) into the temp config when it exists, else skip that step naming it; asserts both values are forward-slash paths under the folder -- AC4.
- `.claude/settings.json` -- drop `extraKnownMarketplaces` and `enabledPlugins` -- AC3.
- `kb/offline-install-runbook.md` -- section "Skills-dir plugin: the on-box probe (Story 25.2)": the live-test command, this box's outcome (list/validate/probe lines), and the `claude plugin eval <folder>` outcome verbatim -- AC4.

**Acceptance Criteria:** AC1–AC4 in the intent contract, each proven by a named test or a Verification command.

## Spec Change Log

## Review Triage Log

### 2026-10-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` A failed run (extract, version, link, first rename) deleted `.tk-studio.previous` (AC1 breach; the spec's Always write order contradicted AC1 verbatim, AC1 wins) — old previous now set aside as `.tk-studio.retired` and deleted only after the final rename; everything renamed back on failure; tests pin target and previous unchanged after each refusal.
  - `[medium]` `[patch]` A channel without a plugin still uninstalled the user's only marketplace copy — removal now runs only when the skills-dir folder exists after the leg; otherwise `skipped`, project entries still reported.
  - `[medium]` `[patch]` Uncaught OSError paths (mkdir, cleanup, symlink, restore rename, runner) printed tracebacks instead of the AD-11 last JSON line — each is a named refusal or a failed command; `main()` has a last-resort `UnexpectedOSError` handler; argparse errors end with a `UsageError` line (exit 2).
  - `[low]` `[patch]` Live probe parsed `ROOT=`/`SKILL=` with `\S+` and compared unresolved paths — now captures to end of line and accepts raw or resolved forward-slash paths.
  - `[low]` `[patch]` A `tk-studio@skills-dir` key would have been fed to `claude plugin uninstall` — excluded from the uninstall set.

### 2026-10-14 — Review pass (follow-up review)
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 5, low 2)
- defer: 0
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` `_swap` retired and deleted `.tk-studio.previous` when no target was superseded (target missing), and a lone `.tk-studio.retired` left by a failed restore was deleted by the next run's stale-sibling cleanup (AC1, previous kept) — previous is set aside only when a target exists; a lone retired is renamed back to previous before the swap (`CleanupFailed` if that fails); tests `PreviousKeptWithoutTarget`.
  - `[medium]` `[patch]` Non-OSError extract failures (`zlib.error`, `NotImplementedError`, `RuntimeError`) and any other non-OSError exception escaped as tracebacks with no AD-11 JSON line, leaving staging half-written — extract catches every exception into `PluginZipInvalid` and removes staging; `main()` last resort `UnexpectedError` (exit 1); tests `ExtractErrorsAreNamed`.
  - `[medium]` `[patch]` `is_link`'s Windows fallback (Python < 3.12) was guarded by `path.exists()`, so a dangling junction read as "missing" and blocked every later install with `SwapFailed` (AC2) — guarded by `os.path.lexists`; test `DanglingJunction`.
  - `[medium]` `[patch]` `default_runner` had no timeout and inherited stdin, so a stalled `claude plugin …` hung the verb with no JSON line (AC3) — `stdin=DEVNULL`, `RUNNER_TIMEOUT = 120`, `TimeoutExpired` recorded as a failed command → `partial`; tests `RunnerTimeout`.
  - `[medium]` `[patch]` An unreadable or invalid `installed_plugins.json`/`known_marketplaces.json` was treated as clean, silently leaving a user-scope copy shadowing the folder (AC3) — each is a `failed` row `{command: null, file, error}`, the other file's commands still run, and the leg returns `partial`; tests `UnreadableRecordFiles`.
  - `[low]` `[patch]` `project_entries` listed `tk-studio@skills-dir` keys as project-scope marketplace records, unlike `marketplace_cleanup` — excluded; test `SkillsDirKeyNotReported`.
  - `[low]` `[patch]` `main.py` docstring said every refusal exits 1 while `UsageError` exits 2 (ruled) — docstring corrected; `test_usage_error` pins `code == 2`.
- rejected (one line each):
  - `--help` prints no JSON line — help is argparse's interactive output, not a verb; AD-11 binds the verbs.
  - `requires.claude-code` not checked before marketplace removal — the Claude Code floor check is Story 25.5's doctor (epics §Story 25.5), not a 25.2 criterion.
  - Concurrent install runs share `.tk-studio.new` (lock file) — no criterion names concurrent runs.
  - User-scope `<config>/settings.json` marketplace keys not reported — AC3 names project-scope reporting; user scope is handled through the `claude plugin` commands the leg runs, and the re-registration claim is speculative.
- procedural note: both review layers ran (band L); the 1686-line diff was handed to each layer as a scratchpad file path rather than inline text.

## Design Notes

- "The previous folder kept until the next successful start" is read as: the previous folder survives this run and is removed only by the next successful plugin-leg run (which then keeps the folder it supersedes). The CLI cannot observe Claude Code's own start; 25.5's doctor may tighten this.
- The leg checks only the fields it consumes. 25.4 (replan note) routes every roster read through the landed guard; until the guard is packaged into the wheel, the leg's own entry check is deliberately narrow and refuses by field name.
- Junction creation on Windows: `subprocess.run(["cmd", "/c", "mklink", "/J", link, target])` (no admin needed); detection via `os.path.isjunction` (3.12+) or `os.readlink` fallback.

## Verification

**Commands (from `plugins/tk-studio/lib`):**
- `uv run python -m unittest tests.test_installer_plugin_leg` -- OK.
- `TK_STUDIO_LIVE_CLAUDE=1 uv run python -m unittest tests.test_installer_live -v` -- OK on this box (headless step run or skipped by name).
- `uv run python -m unittest discover tests` -- OK (live test skipped).
- `uv run python ../contracts/conformance/runner.py run` -- `"ok": true`.
- From repo root: `uv run --project tools/installer/cli tk-studio doctor` -- last line JSON, `status` complete, `mode` reported.
- `python3 -c "import json;d=json.load(open('.claude/settings.json'));assert 'extraKnownMarketplaces' not in d and 'enabledPlugins' not in d"`.

**Unverifiable here (operator, TIM-PC-2, Windows):** `uv run --project tools/installer/cli tk-studio install --link C:/GitHub/tk-studio` (junction, real marketplace removal) and the forward-slash probe on Windows: `TK_STUDIO_LIVE_CLAUDE=1 uv run python -m unittest tests.test_installer_live -v` from `plugins/tk-studio/lib`.

## Deviation Summary

### pass 1 (2026-10-14, implementer)

- planned: write order "remove old `.tk-studio.previous` → extract to `.tk-studio.new` → …" / actual: the digest check and the zip-path safety check run before the old previous is removed, and a leftover `.tk-studio.new` is cleared before extracting / why: a refusal on those checks then changes nothing / may affect: none
- planned: Code Map `claude plugin uninstall <plugin> -s user` / actual: `--scope user` as in the I/O matrix (same flag) / why: the matrix is the more specific row / may affect: none
- planned: refusal names given as examples / actual: added `RosterEntryInvalid`, `RosterUnreadable`, `RosterInvalid`, `DownloadFailed`, `PluginZipInvalid`, `SwapFailed`, `LinkFailed`, `UnsupportedUrl`, `MarketplaceRemovalFailed`; reason format `"<Name>: <detail>"`; `project_entries` rows from `installed_plugins.json` also carry `scope` / why: the spec left these unnamed / may affect: 25-4, 25-5
- planned: `claude plugin eval` tried against the folder the leg writes / actual: tried by hand on a `git archive HEAD:plugins/tk-studio` copy in a temporary config's skills folder (same layout, no probe skill), outcome recorded in the kb / why: eval needs `--trust-plugin` and its output is a one-time kb record, not an assertion / may affect: none
- planned: `uv run --project tools/installer/cli tk-studio doctor` from the repo root / actual: ran with `UV_PROJECT_ENVIRONMENT` in the scratchpad; the generated `uv.lock` was deleted / why: this mount refuses the venv symlink / may affect: 25-4

DEVIATION SCORE: 1

DRIFT: digest and zip-path checks run before the old previous is removed — a refusal then changes nothing — affects: none
DRIFT: refusal vocabulary extended (RosterEntryInvalid … MarketplaceRemovalFailed, reason "<Name>: <detail>", project_entries carry scope) — the spec named only examples — affects: 25-4, 25-5
DRIFT: `claude plugin eval` tried on an archived copy of the plugin tree rather than the leg-written folder — eval needs --trust-plugin and is a one-time record — affects: none
DRIFT: doctor verification ran with UV_PROJECT_ENVIRONMENT outside the mount; no uv.lock committed — the mount refuses the venv symlink — affects: 25-4

### pass 2 (2026-10-14, implementer, review patches)

- planned: remove the old previous immediately before the swap (Always write order) / actual: the old previous is renamed to a third dot-prefixed sibling `.tk-studio.retired` before the swap and deleted after it succeeds; a leftover retired folder is cleared first; the result may carry `retired_left` / why: AC1 requires the previous unchanged after a failed first rename / may affect: 25-3, 25-5
- planned: refusal names as examples / actual: also `FolderUnwritable`, `CleanupFailed`, `UnexpectedOSError`, and `UsageError` exiting 2 (every blocked refusal exits 1) / why: those error sites had no named reason / may affect: 25-4, 25-5
- planned: last-resort handler in `main()` / actual: `main()` also takes optional `fetch`/`runner`/`env` and guards `sys.stdout.reconfigure` / why: tests drive `main()` and read its stdout / may affect: none

DEVIATION SCORE: 1 (implementer); 2 by consult

DRIFT: old previous set aside as `.tk-studio.retired` and deleted only after the final rename; new result field `retired_left`; refusals FolderUnwritable/CleanupFailed/UnexpectedOSError added, UsageError exits 2 — AC1 keeps the previous across a failed swap, which two folders cannot — affects: 25-3, 25-5

### pass 3 (2026-10-14, implementer, follow-up review patches)

- planned: refusal and reason names as listed / actual: last-resort reason `UnexpectedError: <Type>: <msg>` (exit 1) for any non-OSError exception / why: AD-11 JSON line on every path / may affect: 25-4, 25-5
- planned: `marketplace.failed[]` rows `{command, exit, error?}`, partial only on `status == "failed"` / actual: an unreadable record file is `{command: null, file, error}`; a `skipped` result can carry `failed`; partial on any non-empty `failed` / why: an unreadable file must never read as clean / may affect: 25-5
- planned: `CleanupFailed` only for a stale sibling / actual: also when a lone `.tk-studio.retired` cannot be renamed back to previous / why: P1 restore path / may affect: none
- planned: old previous set aside on every swap / actual: set aside only when a target is superseded; a lone retired is restored to previous first / why: AC1, previous kept until the next successful run / may affect: 25-3
- kb: `kb/offline-install-runbook.md` 25.2 section's `.tk-studio.retired` parenthetical updated per consult (lines 197-201); deviation 0

DEVIATION SCORE: 2 (implementer); 2 by consult

DRIFT: UnexpectedError last-resort reason (exit 1); marketplace.failed[] gains {command: null, file, error} rows, a skipped result can carry failed, and partial triggers on any non-empty failed[]; CleanupFailed also covers an unrestorable lone .tk-studio.retired; old previous set aside only when a target is superseded and a lone retired is restored to previous — follow-up review patches for AC1/AC3 and the AD-11 JSON line — affects: 25-3, 25-4, 25-5

## Consult Log

- 2026-10-14T20:57Z — trigger: deviation-gt-0 — question: accept pass 1 at score 1 or 2, and is eval on an archived copy (item 4) acceptable — ruling: accept-deviation score 2 — do: set score 2 and keep item 3's 25-4/25-5 note; correct kb/offline-install-runbook.md:225 to name the archived-copy target, outputs unchanged, no re-run; items 1, 2, 5 local, do not commit uv.lock — rule candidate: A pass that adds named values to a JSON result read by later stories scores at least 2, and a kb probe record must name the exact target it ran against.
- 2026-10-14T21:04Z — trigger: deviation-gt-0 — question: accept the review-patch swap via a third sibling .tk-studio.retired (+ retired_left, new refusal names) at score 1 or 2, and update the kb — ruling: accept-deviation score 2 — do: keep the three-sibling swap, record DRIFT, score stays 2; add .tk-studio.retired to the kb 25.2 section's sibling sentence (~line 196) only; leave blocked refusals at exit 1, exit 2 only for UsageError — rule candidate: Any dot-prefixed sibling the installer creates in the skills dir is named in the spec's folder-layout bullet and the story's kb section in the same pass; later readers judge only skills/tk-studio and ignore every .tk-studio.* sibling.
- 2026-10-14T21:14Z — trigger: deviation-gt-0 — question: accept follow-up review patches (UnexpectedError reason; marketplace.failed[] {command:null,file,error} rows, failed on skipped, partial on any failed; CleanupFailed for an unrestorable lone retired; previous retired only when a target is superseded, lone retired restored) at score 1 or 2, and does the kb 25.2 sibling sentence change — ruling: accept-deviation score 2 — do: accept all four, one DRIFT line affects 25-3, 25-4, 25-5, score stays 2; in kb/offline-install-runbook.md:196-198 change only the .tk-studio.retired parenthetical (set aside only when a target is superseded; exists only during a swap, or left behind when its post-success delete fails — next run deletes it — or when a failed restore leaves it the only copy — next run renames it back to .tk-studio.previous before swapping); do not edit the spec's Always write-order bullet — rule candidate: A pass that changes when a .tk-studio.* sibling is created, kept, restored or deleted updates the story's kb sibling sentence in the same pass, and a change to an existing result field's shape or to the status mapping is scored 2 without a consult.

## Auto Run Result

Status: done

**Summary:** This was a follow-up review pass of the story, which was already done. The meta-CLI's plugin leg at `tools/installer/cli` was reviewed again: it covers `install|update` from the verified roster zip, `install --link`, marketplace cleanup, the project-scope report and `doctor`. This pass hardened it and changed no behaviour the criteria name:
- A previous folder is never lost when no target is superseded. A lone `.tk-studio.retired` is restored rather than deleted.
- Every exception path ends with the AD-11 JSON line.
- A dangling Windows junction is detected on Python < 3.12.
- A stalled `claude` is bounded at 120 s.
- Unreadable Claude Code record files return `partial`, never `clean`.
- A `tk-studio@skills-dir` key is no longer reported as a marketplace record.

**Files changed (this pass):**
- `tools/installer/cli/tk_studio_cli/plugin_leg.py`: the `_swap` retired/previous lifecycle, catch-all extract refusal, the `lexists` junction fallback, `RUNNER_TIMEOUT` and `stdin=DEVNULL`, `failed` rows for unreadable record files, `partial` on any failure, and `@skills-dir` excluded from `project_entries`.
- `tools/installer/cli/tk_studio_cli/main.py`: the `UnexpectedError` last-resort handler (exit 1), and the docstring now says usage errors exit 2.
- `plugins/tk-studio/lib/tests/test_installer_plugin_leg.py`: 12 new offline tests (55 in all), and `test_usage_error` pins exit 2.
- `kb/offline-install-runbook.md`: the `.tk-studio.retired` parenthetical in the 25.2 section, per consult.

**Review:** Both layers ran (band L).
- Findings: 7 patches applied (high 0, medium 5, low 2), 0 deferred, 4 rejected, 0 bad_spec, 0 intent_gap.
- Consult: 1 (`deviation-gt-0`), ruled accept-deviation score 2. It is logged under `## Consult Log` and recorded as an observation event.
- Follow-up review recommended: **true**. Score is 3×5 + 1×2 = 17, which is at least 5.

**Verification (re-run by this session after the patches):**
- `uv run python -m unittest tests.test_installer_plugin_leg`: 55 OK.
- `TK_STUDIO_LIVE_CLAUDE=1 uv run python -m unittest tests.test_installer_live -v`: OK on this box, in an isolated config. The headless probe ran.
- `uv run python -m unittest discover tests`: 904 OK, 1 skipped (the opt-in live test).
- `uv run python ../contracts/conformance/runner.py run`: `"ok": true`.
- `uv run --project tools/installer/cli tk-studio doctor` (with `UV_PROJECT_ENVIRONMENT` in the scratchpad): last line is JSON `status: complete`, `mode: missing`. The generated `uv.lock` was removed, and the real `~/.claude` was never written.
- The settings assertion passes.

**Unverifiable here (operator, TIM-PC-2, Windows):**
- Run `uv run --project tools/installer/cli tk-studio install --link C:/GitHub/tk-studio` (the junction and the real marketplace removal).
- Then, from `plugins/tk-studio/lib`, run `TK_STUDIO_LIVE_CLAUDE=1 uv run python -m unittest tests.test_installer_live -v` (the Windows forward-slash probe).

**Residual risks:**
- 25.5's doctor must check the Claude Code floor (`requires.claude-code`). Until it does, the leg removes marketplace copies without checking that the installed Claude Code can load a skills-dir plugin.
- Two install runs that overlap share `.tk-studio.new`; there is no lock.
- 25.3 and 25.5 must judge only `skills/tk-studio`, ignore every `.tk-studio.*` sibling, and read the new `marketplace.failed[]` row shape.
- The earlier risks still stand:
  - Plugin-plane drift until 25.3.
  - README and the runbook still describe the `extraKnownMarketplaces` prompt; that is 25.7's.
  - The narrow roster check stays until 25.4.
  - `uv.lock` is not committed.

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent
Baseline: b16814f6aab8ab53a88d2083570178a7bd923bcc (branch loop/epic-25)

DRIFT: UnexpectedError last-resort reason (exit 1); marketplace.failed[] gains {command: null, file, error} rows, a skipped result can carry failed, and partial triggers on any non-empty failed[]; CleanupFailed also covers an unrestorable lone .tk-studio.retired; old previous set aside only when a target is superseded and a lone retired is restored to previous — follow-up review patches for AC1/AC3 and the AD-11 JSON line — affects: 25-3, 25-4, 25-5
