---
title: 'The Docs and the Release Say the Installer Is the Way In'
type: 'chore'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-25/plans/25-7.md'
warnings: ['oversized']
deferred:
  - summary: 'roster_guard refuses a file:// plugin URL, so the offline route (a) (a local roster + `tk-studio install --roster <path>`) cannot run; the runbook documents route (b), a manual extract, instead'
    evidence: 'tools/installer/cli/tk_studio_cli/plugin_leg.py:153-163 → roster_guard.py:140-145 (https://github.com/.../releases/download only); plugin_leg.py:86-87 default_fetch accepts file://'
    location: 'tools/installer/cli/tk_studio_cli/roster_guard.py:140'
    severity: low
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: '78b2bfa8137725d568cf103c22b7d7f89df6c811'
---

<intent-contract>

## Intent

**Problem:** Epic 25 made the installer-written skills-dir plugin (`~/.claude/skills/tk-studio/`, loaded as `tk-studio@skills-dir`) the user delivery path (AD-21, O5). The README, the offline runbook and runbook §3.4 still teach the marketplace install, so a reader follows the retired path.

**Approach:** Rewrite those docs so that the bootstrap plus `tk-studio install` is the only user path. The marketplace becomes a developer catalog pinned to a tag. The archive-envelope record is marked historical. The skills-dir form carries a deprecation watch. The 0.3.0 release (AC2) is the operator's motion: the docs record its exact commands, and the loop never runs it.

Story ACs, transcribed verbatim from epics.md Story 25.7:

- **AC1.** **Given** `README.md`, `kb/offline-install-runbook.md`, `kb/agent-pc-setup-runbook.md` §3.4 and `kb/claude-plugin-archive-install-envelope.md` **When** the story lands **Then**:
  - the README's install section is the one-line bootstrap plus `tk-studio install`;
  - the offline runbook describes the skills-dir write from a downloaded zip;
  - §3.4 drops `claude plugin marketplace add` for users and keeps it, pinned to a tag, under a "developers who clone" note;
  - the envelope document is marked historical with a pointer here;
  - the kb index regenerates;
  - the skills-dir form carries a "deprecation watch" line naming where to look.
- **AC2.** **Given** the release gate **When** the story closes **Then**:
  - the plugin ships at 0.3.0 (a minor bump: the distribution changed) through the generalised motion, with the roster, `released-roster.json` and `plugin.json` in lockstep (gate ×4);
  - the lib suite and conformance are green;
  - `tk activate` is clean on all four planes on TIM-PC-2, with the plugin loaded from the skills-dir folder.

## Boundaries & Constraints

**Always:**
- Documentation only. Keep README "Bootstrap (one command)" (l.53–103) byte-for-byte: its script URLs, SHA-256 rows, `TK_STUDIO_CHANNEL`/`TK_STUDIO_ROSTER` one-liners and the verify commands (`powershell -ExecutionPolicy Bypass -File`, `shasum -a 256`). `tests/test_installer_bootstrap.py` pins them.
- Wherever the docs say `tk-studio install` or `update` on the host, add "then `sbx skills import --force` for engine sandboxes". The sandbox store is a copy, not a live view (25-6 replan).
- Document `tk-studio install --link <checkout>` (plugin leg only) under the "developers who clone" note. Say that a same-named marketplace copy shadows the skills-dir folder.
- Mark any offline route not proven by a test or the 25.2 probe "not yet run on a box". Say that the offline box also needs the meta-CLI, whose bootstrap downloads `uv` and the wheel.
- The deprecation watch names where to look: code.claude.com/docs/en/plugins/create ("Develop without a marketplace"), code.claude.com/docs/en/plugins/loading (the name-conflict order), and the Claude Code CHANGELOG (grep `skills-dir`). Its status is "none found as of 2026-10-15" (red-team digest C1 F3).
- `kb/index.md` is regenerated only by `kb.py index`.

**Block If:**
- Landing AC2 in the loop's commit would need the version bump: a gate ×3 bump without the operator's archive-record commit turns `test_gate_files_are_in_four_way_lockstep` red. Default: do not bump; AC2 is unverifiable-here.
- A doc step depends on `components.cli` / `cli--v0.1.0` being present. It is absent from `latest.json` today, so record it as unverifiable and never fabricate a tag, URL or digest.
- A doc rewrite needs a code or test change.

**Never:**
- Version bumps, tags, `release_archive.py`, `claude plugin tag`, any `sbx` or marketplace command.
- Edits to `SPEC.md`, `epics.md`, `stories.yaml`, or any file outside the Files list.
- Rewriting the 25.6 kb section of the offline runbook, or runbook §3.5/§3.8, beyond stale marketplace references.
- Inventing a deprecation notice.

</intent-contract>

## Code Map

The full map, with line anchors, is in `plans/25-7.md` § Code Map. These are the essentials:

- `README.md`:
  - l.3 tagline ("git marketplace") and l.9 status row ("**0.2.8** (marketplace catalog is the version gate)"). The live version is 0.2.16; the roster `tools/installer/rosters/` is the gate.
  - l.53–103: Bootstrap, pinned. Leave it alone.
  - l.105–127 "### 1. Install the plugin": Options A, B and C, plus "Updating later" (marketplace).
  - l.129–135 "### 2. Verify": "installed plugin vs the marketplace catalog".
  - l.262 repo map: "marketplace.json … the update gate".
- `kb/agent-pc-setup-runbook.md`:
  - §3.4 l.319–357: clone, trust, the auto-prompt, `plugin install … --scope project`, and marketplace update.
  - l.963 troubleshooting row: fix is `claude plugin install tk-studio@tk-studio --scope project`.
  - §3.5 l.358–427 and §3.8 l.523+: 25.6, protected.
- `kb/offline-install-runbook.md`:
  - frontmatter: title "the archive backstop".
  - l.44–95 Sneakernet: `--plugin-dir` and the seed/marketplace.
  - l.97–107 the archive marketplace seam.
  - l.109–190 the release motion: keep.
  - l.191–388 the 25.2 probe and the 25.6 section: keep.
- `kb/claude-plugin-archive-install-envelope.md`: 169 lines; mark it historical.
- Facts the docs can cite:
  - `plugin_leg.py` l.86 accepts `https://` and `file://` plugin URLs.
  - The meta-CLI `--roster` takes a path or URL (`main.py` l.64).
  - `latest.json` components are `plugin` (0.2.16), `uv` and `bun`. There is no `cli`.
- The release motion: `tools/release_archive.py` l.13–21, and offline runbook l.109–119.

## Tasks & Acceptance

**Execution:**
- `README.md`:
  - Tagline and status row: the installer is the delivery path; the roster is the gate; the version is 0.2.16.
  - Replace §1 with `tk-studio install` (→ `~/.claude/skills/tk-studio/`, `tk-studio@skills-dir`), `tk-studio update` (+ `sbx skills import --force`), a "developers who clone" note (`install --link`; marketplace pinned to a tag, e.g. `claude plugin marketplace add thkennedy/tk-studio#tk-studio--v<X>`, with the shadow warning), and the offline runbook pointer.
  - §2: the skills-dir folder vs the channel roster, plus `tk-studio doctor`.
  - Repo-map line: the developer catalog.
  - A deprecation watch line beside install.
- `kb/agent-pc-setup-runbook.md`:
  - Rewrite §3.4 as the bootstrap + `tk-studio install` (+ `sbx skills import --force`). Keep the clone (the box works in the checkout) and "tk activate → tk install → tk onboard".
  - Put the pinned marketplace add under the "developers who clone" note.
  - Change the l.963 fix to `tk-studio install`.
  - In §3.5/§3.8, touch stale marketplace references only.
- `kb/offline-install-runbook.md`:
  - Frontmatter title and description: the skills-dir write from a downloaded zip.
  - Rewrite the Sneakernet consume step:
    - (a) meta-CLI with a local roster whose plugin `url: file:///…/tk-studio-<v>.zip` + the recorded `sha256`, then `tk-studio install --roster <path>`;
    - (b) a manual extract into `~/.claude/skills/tk-studio/` after the digest check;
    - mark both untested routes "not yet run on a box";
    - keep `--plugin-dir` as session-scoped.
  - Mark the seed/marketplace and archive-marketplace-seam text historical.
  - Add the skills-dir deprecation watch line.
  - Add an "Operator step: the 0.3.0 release (25.7 AC2)" subsection with the exact commands (see Verification). Note that the `cli` component is absent, so the bootstrap stays `CliNotShipped` until the operator's `cli--v0.1.0` cut.
- `kb/claude-plugin-archive-install-envelope.md`: frontmatter title/description prefixed "Historical —", plus a lead paragraph pointing to `kb/offline-install-runbook.md` and AD-21. The probe facts stay.
- `kb/index.md`: regenerate with `uv run plugins/tk-studio/lib/kb.py index --directory .`.

**Acceptance Criteria:**
- Given the edited docs, when grepping `marketplace add\|plugin install tk-studio@tk-studio` in README.md and the agent-pc runbook, then every hit sits under a "developers who clone" note or a historical marker.
- Given README.md and the offline runbook, when grepping `-i "deprecation watch"`, then each has a hit naming the docs pages and the CHANGELOG.
- Given the kb index, when `kb.py index` runs twice, then the second run is a no-op and the envelope and offline entries reflect the new frontmatter.
- Given the verify gate, when run, then the lib suite (including `test_installer_bootstrap`, and `test_release_roster` at 0.2.16) is green and conformance is `ok: true`.
- AC2 is unverifiable-here, with the commands recorded.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- layers: blind-hunter and edge-case-hunter (band M)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 4, low 3)
- defer: 0 (the one deferral in frontmatter came from the deviation consult, not from review)
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Offline route (b): the PowerShell block's recursive Remove-Item could follow a `--link` junction and empty the checkout. The guard (LinkType → `cmd /c rmdir`) is now inside the block, with the same approach for bash (consult: apply).
  - `[medium]` `[patch]` AC2 operator step 5 now checks with `tk activate --channel latest`; the plain form read `stale` against the stable roster.
  - `[medium]` `[patch]` Added a "Moving from the marketplace install" note (README §1, runbook §3.4). The installer only reports a project-scope `tk-studio@tk-studio`, which shadows the folder; this includes TIM-PC-2.
  - `[medium]` `[patch]` The developers-who-clone notes now say that `tk-studio install`/`update` removes the `tk-studio` marketplace (plugin_leg.py l.475).
  - `[medium]` `[patch]` The README Development section no longer points to the historical envelope for the offline path.
  - `[low]` `[patch]` Route (b) resolves the target from `CLAUDE_CONFIG_DIR` before `~/.claude`, as the installer does (plugin_leg.py l.65), and its shadow cleanup matches the installer's.
  - `[low]` `[patch]` The §3.4 code block is split at "open a new PowerShell window", so the bootstrap's PATH change applies.
  - `[low]` `[patch]` The README repo-map `plugin.json` comment now says gate x4 lockstep.

### 2026-10-15 — Review pass (follow-up)
- layers: blind-hunter and edge-case-hunter (band M); the diff (README.md + kb/, baseline 78b2bfa8137725d568cf103c22b7d7f89df6c811) was handed to both layers as a scratchpad file
- intent_gap: 0
- bad_spec: 0
- patch: 10 (high 0, medium 6, low 4)
- defer: 0
- reject: 2 — "the CliNotShipped fallback assumes uv": uv is a README prerequisite (l.45) and runbook §2 installs it with winget; "trusting the checkout prompts the marketplace install": `.claude/settings.json` carries no `extraKnownMarketplaces` entry
- addressed_findings:
  - `[medium]` `[patch]` README §1 main path now warns that the bootstrap stops with `CliNotShipped` until the first `cli--v` release, and points to the checkout form.
  - `[medium]` `[patch]` Runbook §3.4: `sbx skills import --force` is qualified as "once §3.5 is done" (a fresh box has no `sbx login`/daemon/policy yet).
  - `[medium]` `[patch]` `sbx skills import --force` added after the migration install and the `--link` install (README and runbook §3.4), per the story's Always rule.
  - `[medium]` `[patch]` Operator step 1 mints and pushes the tag (`claude plugin tag plugins/tk-studio --push`): step 2's `gh release create --verify-tag` (release_archive.py l.351) refuses a local-only tag. `main` is not pushed at step 1, so the gate stays in lockstep on the remote.
  - `[medium]` `[patch]` Operator steps 3–4 reordered: the archive record is committed, both checks run green, and only then are both commits pushed to `main`.
  - `[medium]` `[patch]` Operator step 5 starts with `git pull` in TIM-PC-2's checkout: drift_check reads the rosters from the checked project (drift_check.py l.186–205).
  - `[low]` `[patch]` Offline runbook lead says "Routes (a) and (b) end with …"; the `--plugin-dir` bullet is introduced as the alternative that writes no folder.
  - `[low]` `[patch]` README repo map "gate x4" → "gate ×4".
  - `[low]` `[patch]` Operator step 5 warns not to run the stable-channel `stale` fix before the promotion PR (it rewrites the folder back to 0.2.16).
  - `[low]` `[patch]` Migration notes add the `claude plugin list` check: "tk activate" sees only user-scope copies (skills_plane.py l.192–204).

### 2026-10-15 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 3, low 5)
- defer: 0
- reject: 4 (the clone re-adds the marketplace copy: false, because the tracked `.claude/settings.json` holds no `tk-studio` key; `update` on a box with no folder: `run_leg` treats install and update alike; the route (a) roster sample shows only `plugin`: the route is refused today and DW-15 tracks it; the "update stale ×3/×4" sub-claims were folded into patch 8)
- addressed_findings:
  - `[medium]` `[patch]` agent-pc §3.4: the `CliNotShipped` fallback pointed at the `--link` form, which installs no apps. It now says to clone first and then run `uv run --project tools/installer/cli tk-studio install` with no `--link`, matching the README.
  - `[medium]` `[patch]` offline runbook, operator step 5: TIM-PC-2 skipped the project-scope migration, so `tk activate` could pass while the copy still shadowed the folder. Added the `--scope project` uninstall (linked to §3.4) and the `claude plugin list` check.
  - `[medium]` `[patch]` README and agent-pc developer notes: a plain `install` or `update` silently replaces a `--link` folder with the zip. Both now say so and give the re-link step.
  - `[low]` `[patch]` operator step 5: the default raw-URL roster can be a cached 0.2.16. Both the update command and the fallback now pass `--roster tools/installer/rosters/latest.json`.
  - `[low]` `[patch]` operator step 4: added "merge, do not rebase" for a rejected push, so the tag stays on `main`.
  - `[low]` `[patch]` README, agent-pc and offline docs: the installer only reports local-scope copies, not just project-scope ones. Added `--scope local`.
  - `[low]` `[patch]` operator step 1: the bump commit also updates README's "Plugin release" row.
  - `[low]` `[patch]` README contributor paragraph: gate ×3 bump vs gate ×4 lockstep, made explicit.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `uv run plugins/tk-studio/lib/kb.py index --directory .` twice: the second run gives no diff.
- `grep -n "sbx skills import" kb/agent-pc-setup-runbook.md kb/offline-install-runbook.md README.md`: present.

**Unverifiable here (AC2, operator; results `pending: operator`):**
1. The gate ×3 bump to 0.3.0 (`plugin.json`, `.claude-plugin/marketplace.json`, `released-roster.json`) committed, not pushed; then `claude plugin tag plugins/tk-studio --push` (the tag only).
2. `uv run tools/release_archive.py run --app plugin`.
3. The archive-record commit (`released-roster.json` `archive` + `latest.json` `components.plugin`), not pushed yet.
4. The lib suite and conformance green after step 3; only then `git push origin main` (both commits; if rejected, merge `origin/main`, never rebase).
5. On TIM-PC-2: `git pull` in the checkout, `claude plugin uninstall tk-studio@tk-studio --scope project` if the §3.4 migration is not done, `tk-studio update --channel latest --roster tools/installer/rosters/latest.json`, `claude plugin list` (`tk-studio@skills-dir`, no `tk-studio@tk-studio`), then `tk activate --channel latest` clean on four planes with the plugin plane reading `~/.claude/skills/tk-studio` at 0.3.0, then `sbx skills import --force`.

## Deviation Summary

### pass 1 (2026-10-15, implementer)

- planned: offline route (a), a local roster with plugin `url: file:///…` then `tk-studio install --roster <path>`, documented as an untested route / actual: documented, but stated as refused by today's CLI (`RosterEntryInvalid` from `roster_guard`, which accepts only GitHub release URLs), with route (b), the manual extract, as the one to use / why: making route (a) work needs a code change, which is out of scope for this docs-only story / may affect: none in epic 25
- planned: AC2 step 5 is `tk-studio update` on TIM-PC-2 / actual: recorded as `tk-studio update --channel latest`, with a note that `stable` only gets 0.3.0 through the promotion PR / why: `release_archive.py --app plugin` records into `latest.json` only, and the meta-CLI's default channel is `stable` / may affect: none
- planned: the `--link` note in §3.4 and the README / actual: shows the `uv run --project tools/installer/cli` form, with a `CliNotShipped` caveat / why: the bootstrap cannot install the meta-CLI until a `cli--v` release exists / may affect: none

DRIFT: offline route (a) is documented as refused by roster_guard (file:// rejected), and route (b) is the working path — the guard accepts only GitHub release URLs; changing it is code, out of scope — affects: none
DRIFT: AC2 operator step 5 uses `tk-studio update --channel latest` — release_archive records only into latest.json — affects: none
DRIFT: the --link example uses `uv run --project tools/installer/cli` with a CliNotShipped caveat — the meta-CLI is not shipped until cli--v0.1.0 — affects: none

## Consult Log

- 2026-10-15T01:13:20Z — trigger: deviation-gt-0 — question: accept the implementer's three score-1 deviations (offline route (a) documented as refused by roster_guard, so route (b) is the working path; AC2 step 5 `--channel latest`; `--link` via `uv run --project` with a CliNotShipped caveat)? — ruling: accept-deviation score 1 — do: keep the runbook as written; keep step 5 and the --link note; record the roster_guard file:// refusal as deferred work, with no code change — rule candidate: In docs-only stories, every CLI route the planner prescribes must be checked against the roster guard (roster_guard._release_entry_problems) and the CLI defaults before it is pinned; when a route is refused, the doc says so, the route is logged as deferred work, and no consult is needed.
- 2026-10-15T01:15:08Z — trigger: high-severity-finding — question: should the offline route (b) PowerShell block's recursive Remove-Item through a --link junction (data loss) be fixed as a patch in this docs-only story? — ruling: apply — do: guard the block (LinkType → cmd /c rmdir, else Remove-Item) with $dir resolved from CLAUDE_CONFIG_DIR before ~/.claude; give bash the same base with no trailing slash; ship with the other review patches, with no code or test change — rule candidate: When a runbook gives a destructive command and only the surrounding prose warns about a hazard, put the guard inside the copy-paste block, and resolve paths as the installer does (CLAUDE_CONFIG_DIR before ~/.claude).

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio install (the installer writes the skills-dir plugin folder <home>/skills/tk-studio/); remove the marketplace copy shadowing the skills-dir folder: claude plugin uninstall tk-studio@tk-studio --scope user; claude plugin marketplace remove tk-studio; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review pass on the done story, because the previous pass recommended one. Both layers ran (band M): the blind hunter and the edge-case hunter, on `claude-opus-5-5`, over the docs diff since `78b2bfa`. The implementer applied 8 doc patches. They tighten the user path and the operator's 0.3.0 commands:
- The §3.4 `CliNotShipped` fallback now uses the non-link install.
- Operator step 5 migrates TIM-PC-2's project-scope copy, checks `claude plugin list`, and reads the pulled roster.
- A rejected push is merged, never rebased.
- `--link` is replaced by a plain install or update, and the docs now say so.
- Local-scope copies get their own uninstall.
- The README status row is in the bump commit.
- The ×3/×4 gate wording is explicit.

**Files changed (this pass)**
- `README.md`: the local-scope uninstall in the migration note, the `--link` replacement sentence in the developer note, and the gate ×3 bump vs ×4 lockstep wording.
- `kb/agent-pc-setup-runbook.md`: the §3.4 `CliNotShipped` fallback (clone, then a non-link install), local-scope wording and uninstall, and the `--link` replacement sentence.
- `kb/offline-install-runbook.md`: the route (b) local-scope clause, plus operator steps 1 (README row), 4 (merge, not rebase) and 5 (migration, `--roster` from the checkout, `claude plugin list`).

**Review.**
- 8 patches applied (high 0, medium 3, low 5); 0 deferred; 4 rejected.
- Follow-up review recommended: **true**. The score is 3×3 + 1×5 = 14.
- The prose rules have settled. The findings now come from the operator-sequence and migration edge cases, so a third pass should focus on operator steps 1–5 only.
- No consult was triggered: no high-severity finding, no file outside the plan's Files, and no new deviation.

**Verification**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 1140 tests OK, 1 skipped.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `kb.py index`: `mutated: false`, because no frontmatter changed.
- README l.53–103 (the pinned bootstrap) is byte-identical to HEAD: sha1 `c0c9cd2067de0311f48a07c29f00bc2a6838d274`.
- `sbx skills import` is present: README 3, agent-pc runbook 10, offline runbook 8.

**Acceptance**
- AC1: met, unchanged by this pass.
- AC2: **unverifiable-here**, results `pending: operator`. The exact commands are in `kb/offline-install-runbook.md` § "Operator step: the 0.3.0 release (25.7 AC2)" and in `## Verification` items 1–5 (updated this pass).

**Residual risks**
- `claude plugin tag plugins/tk-studio --push` comes from the release handoffs and was not run here.
- Route (b) has still not been run on a box.
- Route (a) still waits on the deferred roster_guard change (DW-15).
- The `--scope local` uninstall and the raw-URL cache window are inferred from the code and were not run live.

## Reconcile

- 2026-10-15 — score 1; reconcile not required.
- Gate: Part A not-required; Part B epic complete: no next story (25-7 accepted: AC1 met, AC2 unverifiable-here pending operator)
