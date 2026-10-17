---
title: 'The Merged Tree Builds, Releases and Launches From One Root'
type: 'chore'
created: '2026-10-17'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_commit: '4236e6a65c39a5b9834be779f2bc4789efed9c31'
baseline_revision: '4236e6a65c39a5b9834be779f2bc4789efed9c31'
deviation_score: 1
context:
  - '{project-root}/_bmad-output/specs/spec-epic-28/plans/28-3.md'
  - '{project-root}/_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A supervisor-queued run of the nested project apps/supervisor serves the outer tk-studio root, not apps/supervisor, so AC3's live clause ("the project served is the nested root and its verify.host is the one read at the run's base") cannot pass until a fix under apps/supervisor/src lands; that fix needs an operator correct-course to give it a story (28.5 or a new one).
    evidence: |-
      The supervisor cuts `git worktree add` of the whole repository from the project checkout and makes the worktree root the run's payload.directory and sbx VM path; nothing in apps/supervisor/src maps a project that sits below its git top-level (no --show-prefix / subpath handling). Pre-existing Epic 27 code, untouched by this story; the intent contract's Never forbids editing apps/supervisor/src. Consult ruling 2026-10-17 (high-severity-finding): defer under DEFERRAL DISCIPLINE (a).
    location: >-
      apps/supervisor/src/worktree.ts:110-111, :254; apps/supervisor/src/cli.ts:79, :373
    severity: high
---

<intent-contract>

## Intent

**Problem:** The attended merge put the supervisor's history under `apps/supervisor`, but the merged tree still points at the old repository: the root `.gitignore`, README, runbook §3.8/§4, the offline-install runbook, `release_archive.py --app supervisor` (which refuses to cut from this checkout) and the two-mount engine sandbox all assume `thkennedy/tk-studio-supervisor`.

**Approach:** Apply ADR §5 step 3 fix-ups on the merged tree: root ignore entries for `apps/supervisor/`, docs pointing at `apps/supervisor`, `release_archive.py` reading subtree `apps/supervisor` (ADR §6 second prefix), the one-mount sandbox documented in the scripts and runbook; keep both host gates green.

### Acceptance criteria (verbatim, epics.md Story 28.3)

- **AC1. Given** the merge landed on `main` through the attended PR **When** the fix-ups are applied **Then** the root `.gitignore` carries the supervisor's ignore entries under `apps/supervisor/`; `README.md`, the runbook §3.8 and §4 and the offline-install runbook point at `apps/supervisor`; `tools/release_archive.py --app supervisor` reads `apps/supervisor` in this repository (the second prefix, ADR §6) and both rosters' supervisor entries drop their foreign `source`; `tk-studio update` on each channel still resolves every component against the rosters' digests
- **AC2. Given** the engine sandboxes **When** `claude-tk-studio` is recreated with one read-write mount of `C:\GitHub\tk-studio` and the read-only skills store **Then** `launch-epic.sh` and `resume-run.sh` take `ROOT=/c/GitHub/tk-studio/apps/supervisor` for a supervisor epic and the repository root for a plugin epic; the `tk-studio:ro` second mount is gone from the runbook and the provisioning (`WITH_BUN=1` provisions bun for the nested project); `check-skills-mount.sh` holds; `claude-tk-studio-supervisor` is retired from the runbook; the two loops serialise on the checkout lock *(the serialisation itself is Story 28.5, carved out by correct-course on 2026-10-17)*
- **AC3. Given** the supervisor's own `.tk-studio/config.yaml` (`verify.host: bun test`) and its transcribed plan **When** a supervisor run goes through the supervisor itself **Then** the project served is the nested root and its `verify.host` is the one read at the run's base; `apps/supervisor/_bmad-output/planning-artifacts/epics.md` stays the nested project's transcription (Epics 21 to 23 and 27 keep their numbers) and the repository root's plan stays canonical; the supervisor's `TK_STUDIO_ROOT` is still the outer root
- **AC4. Given** the host gates **When** this story's work is verified **Then** `tools/verify_host.py` from the root and `bun test` from `apps/supervisor` are green on both hosts (the Windows run attended), and the old repository's README (one commit there, before archiving) points at `tk-studio/apps/supervisor`

## Boundaries & Constraints

**Always:** Touch only the plan's Files (below). Stdlib-only Python via `uv run`; atomic writes; AD-11 JSON status block on every headless surface. Keep `release_archive.py --repo` working for the old checkout's historical tags, and its `source` logic unchanged (a cut from `REPO_ROOT` writes no `source`). Keep README's bootstrap SHA-256 lines byte-identical (`test_installer_bootstrap.py`). `TK_STUDIO_ROOT` stays the outer root in `provision-engine.sh`. Other projects (e.g. a Godot game) keep the two-mount §3.8 form; say so explicitly.

**Block If:** a fix-up would need a supervisor-side code or test path into `plugins/tk-studio` (ADR §3 gate 5); dropping a roster's `source` would need a hand-edit, a tag or a release.

**Never:** hand-edit `tools/installer/rosters/*.json`; push, tag, `gh release`, or touch any remote; edit anything under `apps/supervisor/src` (checkout lock is Story 28.5), `tools/agent-pc/set-supervisor-env.ps1`, or `apps/supervisor/_bmad-output` (no renumbering); write the cut-over date, archive note or AD-21 "done" (Story 28.4); hand-edit `apps/supervisor/.bmad-loop/plugins/studio-pipeline/*` (regenerate with `tools/restructure/nest_pipeline.py --out` only if the render test goes red); change the hold loop or payload of the sandbox scripts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| In-repo supervisor cut | `release_archive.py run --app supervisor --version X.Y.Z` from `REPO_ROOT`, tag `supervisor--vX.Y.Z` present | zip holds `apps/supervisor` subtree paths; roster entry has no `source` | — |
| Tag absent | same, `--dry-run`, no tag | builds against `apps/supervisor` | fails "tag … not found", never "runs against its own checkout" |
| Foreign historical cut | `--repo <old checkout>` | subtree `.` of that checkout; entry records `source` | unchanged behaviour |
| Bad ROOT (if refusal added) | `ROOT` neither a studio root nor holding `.bmad-loop/` | named message | exit 2 |

</intent-contract>

## Code Map

All anchors re-checked on the merged tree at `4236e6a`. Full investigation: `plans/28-3.md` Code Map.

- `apps/supervisor/.gitignore` -- source of entries to copy (prefixed `apps/supervisor/`): `.tk-studio/config.local.yaml`, `node_modules/`, `*.tsbuildinfo`, `.env`, `.env.*`, `.bmad-loop/{runs,cache,archive}/`, `.bmad-loop/policy.toml`, `.bmad-loop/routing.current.json`, `_bmad/render/`, `_bmad/config.user.yaml`, `_bmad-output/implementation-artifacts/supervision/`. Keep the nested file.
- `.gitignore` -- 16 lines, no supervisor entries today.
- `README.md` `## Repository map` (~`:271`) -- add `apps/supervisor` (nested studio project, AD-21; Bun/TS; `bun test` from `apps/supervisor`).
- `kb/agent-pc-setup-runbook.md` -- §3.8 `:590`, two-mount `sbx create` `:605`, `:757` "`tk-studio-supervisor` shows the adaptation"; §4 `:865`, repo/clone `:873-875`, §4.1 install `:879-894` (trust for `C:\GitHub\tk-studio\apps\supervisor`, no inheritance), §4.3 Startup `:962`. Record the `pgrep -f "bmad-loop run"` hold hazard (two loops, one sandbox: harmless, longer).
- `kb/offline-install-runbook.md` -- release table row `:203`; §"Operator step: the supervisor's first release" `:227-243` (keep as history, add the successor cut command with no `--repo`).
- `tools/release_archive.py` -- `APPS["supervisor"]` `:72` (`"."` → `"apps/supervisor"`), comment `:68-69`, refusal `:224-226`, docstring `:40-41`, `source` logic ~`:300-310` unchanged.
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- pattern `test_foreign_supervisor_cut_records_source` (~`:1015`), temp-repo globals (~`:923`).
- `tools/sbx-engine/launch-epic.sh` (`:1-12` usage, hold `:37`), `resume-run.sh` (`:1-4`, hold `:29`), `provision-engine.sh` (`:3-6` usage, `TK_STUDIO_ROOT=$STUDIO` `:79-80`, `WITH_BUN` `:72`), `check-skills-mount.sh`.
- `plugins/tk-studio/lib/tests/test_sbx_skills_mount.py` -- provisioning pins `:377-390`, `test_listing_runs_from_project_dir` `:331`.
- `plugins/tk-studio/lib/tests/test_nest_pipeline.py` -- real nested copy test runs and is green on the merged tree; no regeneration needed.
- Read-only: `lib/config.py` (nearest-root rule, 28.2) gives AC3's nested root; `apps/supervisor/.tk-studio/config.yaml` has `project_id: supervisor`, `verify.host: bun test`.

## Tasks & Acceptance

**Execution:**
- `.gitignore` -- append each `apps/supervisor/.gitignore` entry prefixed `apps/supervisor/` under a comment -- AC1.
- `README.md` -- repository map gains `apps/supervisor` -- AC1.
- `kb/agent-pc-setup-runbook.md` -- §3.8 one sandbox `claude-tk-studio`, one RW mount of `C:\GitHub\tk-studio`, `WITH_BUN=1 … provision-engine.sh /c/GitHub/tk-studio /c/GitHub/tk-studio`, the two ROOT values, `sbx rm claude-tk-studio-supervisor` with why, two-mount form kept for other projects, hold hazard; `:757` → `apps/supervisor`; §4 repo/path/install/trust/Startup target → `apps/supervisor` -- AC1, AC2.
- `kb/offline-install-runbook.md` -- row `:203` → `apps/supervisor`; add the next-cut operator step (tag on `thkennedy/tk-studio` `main`, `uv run tools/release_archive.py run --app supervisor --version X.Y.Z --channel latest`, no `--repo`, then PR into `stable.json`) -- AC1.
- `tools/release_archive.py` -- supervisor subtree `apps/supervisor`, refusal and EP-31 comment removed, docstring drops `--repo` from the primary usage (keep it documented as the historical path) -- AC1.
- `plugins/tk-studio/lib/tests/test_release_roster.py` -- add an in-repo supervisor cut from a temp `REPO_ROOT` with an `apps/supervisor` subtree: entry has no `source`, zip holds the subtree's paths; replace any test pinning the removed refusal; keep the foreign-cut test green -- AC1.
- `tools/sbx-engine/launch-epic.sh`, `resume-run.sh` -- header comments state both ROOT values; optional named refusal (exit 2) for a ROOT with neither `.tk-studio/config.yaml` nor `.bmad-loop/` -- AC2.
- `tools/sbx-engine/provision-engine.sh` -- usage comment for the one-mount layout (same path twice) -- AC2.
- `plugins/tk-studio/lib/tests/test_sbx_skills_mount.py` -- pins for any ROOT refusal and the provisioning usage; a nested-dir `check-skills-mount.sh` case on the `:331` pattern -- AC2.

**Acceptance Criteria:**
- Given the merged tree, when `git check-ignore -v apps/supervisor/node_modules/x` runs from the root, then it names a root `.gitignore` line.
- Given no `supervisor--v` tag, when `uv run tools/release_archive.py run --app supervisor --version 0.1.1 --dry-run` runs, then it fails only on the absent tag, never with "runs against its own checkout".
- Given the lib suite, when the in-repo cut test runs, then the recorded entry has no `source` and the zip lists `apps/supervisor` paths.
- Given `config.py root --directory apps/supervisor`, then it prints `nested: true` and `project_id: supervisor` (AC3 evidence).
- Given the gates, then lib suite, conformance, `tools/verify_host.py` and `bun test` from `apps/supervisor` are green.

## Spec Change Log

## Review Triage Log

### 2026-10-17 — Review pass
- note: both layers ran (band L); the diff was handed to the reviewers as a scratchpad file path rather than inlined (613 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` runbook §4.2 still runs `set-supervisor-env.ps1`, which needs the old clone and writes the old Startup target. Added a note to §4.2, plus pointers from §4.1 and §4.3: keep the old clone until 28.4, and retarget the shortcut after running the script (or use `-NoShortcut`).
  - `[medium]` `[patch]` one-mount provisioning ran `check-skills-mount.sh` only from the outer root. It now also runs it with `PROJECT_DIR=apps/supervisor` when that project's config exists. Pinned in the tests and described in runbook §3.8.
  - `[medium]` `[patch]` `--repo` pointed at a tk-studio clone zipped the whole repository as the supervisor. A foreign repo now probes `<tag>:apps/supervisor` and falls back to `.`. New test `test_foreign_tk_studio_clone_cuts_the_supervisor_subtree`.
  - `[low]` `[patch]` the two-loop note in §3.8 now says the `engine-gone` stamp may record the other loop's engine, and to run one loop at a time until Story 28.5.
  - `[low]` `[patch]` added positive ROOT tests: `launch-epic.sh` and `resume-run.sh` get past the check with only `.tk-studio/config.yaml`, or with only `.bmad-loop/`.

### 2026-10-17 — Review pass (follow-up)
- note: follow-up pass on the committed story (4e63827), review_loop_iteration reset to 0; both layers ran (band L); diff 4236e6a..working tree minus the spec, handed over as a scratchpad file path (753 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 1 (high 1)
- reject: 0
- note: the blind hunter's `--repo` finding and the edge-case hunter's single finding were deduplicated (same action: guard the root fallback). Its premise that the merged `supervisor--v0.1.0` tag lacks `apps/supervisor` is false (`git cat-file -t supervisor--v0.1.0:apps/supervisor` = `tree`), so only the mis-minted-tag case was patched.
- note: the deferral meets DEFERRAL DISCIPLINE (a), per the consult ruling (high-severity-finding).
- addressed_findings:
  - `[low]` `[patch]` `release_archive.py` `--repo` root fallback could zip a whole tk-studio tree as the supervisor when its tag lacked `apps/supervisor`. It now refuses before any `gh` call when `<tag>:plugins/tk-studio` is a tree. New test `test_foreign_tk_studio_tag_without_the_subtree_is_refused`.
  - `[low]` `[patch]` the offline-install runbook's next-cut step read as "copy into stable.json by PR" against "never hand-edit a roster to drop source". It now says the PR copies the cut's whole written entry verbatim (the promotion route), and never to hand-edit an entry merely to delete `source` without a cut.
  - `[low]` `[patch]` runbook §3.8 called two loops in one sandbox "harmless", against §4's "Engine hold" row. It now says the hold only lengthens the wait, names the shared checkout and `.git` as the hazard, and points to the §4 row until Story 28.5.

## Design Notes

unverifiable-here (operator/attended; record verbatim in the Auto Run Result):
- Roster `source` drop (AC1): tag `supervisor--vX.Y.Z` (X.Y.Z > 0.1.0) on `thkennedy/tk-studio` `main`, then `uv run tools/release_archive.py run --app supervisor --version X.Y.Z --channel latest`, then PR into `stable.json`; then `tk-studio update --channel latest|stable` on the box.
- Sandbox recreate (AC2): `sbx rm claude-tk-studio-supervisor`; `sbx create --skills readonly --name claude-tk-studio claude C:\GitHub\tk-studio`; `WITH_BUN=1 bash tools/sbx-engine/provision-engine.sh /c/GitHub/tk-studio /c/GitHub/tk-studio`.
- AC2 checkout-lock clause: Story 28.5.
- AC3 live supervisor run through the supervisor; AC4 Windows `verify_host.py` and `bun test`; the old repository's README commit pointing at `tk-studio/apps/supervisor`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- `ok: true`
- `uv run python tools/verify_host.py` -- exit 0
- `git check-ignore -v apps/supervisor/node_modules/x` -- names root `.gitignore`
- `uv run tools/release_archive.py run --app supervisor --version 0.1.1 --dry-run` -- fails only "tag … not found"
- `uv run python plugins/tk-studio/lib/config.py root --directory apps/supervisor` -- `nested: true`, `project_id: supervisor`
- `cd apps/supervisor && bun install --frozen-lockfile && bun test` -- green

## Deviation Summary

### pass 1 (2026-10-17, implementer)

- planned: `git check-ignore -v apps/supervisor/node_modules/x` names a root `.gitignore` line, nested file kept / actual: with the nested `.gitignore` in place git reports the nested line (deeper file wins); root lines verified by moving the nested file aside (ten probed paths matched root lines; `git status --ignored` identical), then restored / why: "keep the nested file" and that expected output cannot both hold / may affect: none
- planned: each entry prefixed `apps/supervisor/` / actual: the four slash-free entries (`node_modules/`, `*.tsbuildinfo`, `.env`, `.env.*`) written as `apps/supervisor/**/<entry>` / why: slash-free patterns match at any depth in the nested file; a plain prefix anchors them / may affect: none
- planned: change only `APPS["supervisor"]` `"."` → `"apps/supervisor"` / actual: also `FOREIGN_SUBTREES = {"supervisor": "."}` applied when `repo != REPO_ROOT` / why: the I/O matrix keeps the `--repo` historical cut at subtree `.` / may affect: none
- planned: add in-repo test, replace refusal pin / actual: also rewrote `test_each_app_archives_its_subtree_at_its_tag` (pinned the old `.` subtree via `--repo`); fake `_run` gained opt-in `archive_from_disk` / why: that test pinned the old layout; foreign `.` still covered by `test_foreign_supervisor_cut_records_source` / may affect: none

DRIFT: check-ignore names the nested .gitignore line, root lines proven with the nested file moved aside — git's deeper-file precedence; the spec keeps the nested file — affects: none
DRIFT: slash-free supervisor ignore entries written as apps/supervisor/**/<entry> — a plain prefix would anchor them and change their meaning — affects: none
DRIFT: release_archive.py gains FOREIGN_SUBTREES for --repo cuts — keeps the historical cut at subtree "." per the I/O matrix — affects: none
DRIFT: test_each_app_archives_its_subtree_at_its_tag rewritten, fake _run gains archive_from_disk — it pinned the pre-merge supervisor subtree — affects: none

Consult ruling (pass 1): all four entries accepted at score 1. The plan's Verify line `plans/28-3.md:97` is read as: with the nested `.gitignore` set aside, `git check-ignore -v` names the root line (the check the implementer ran); the binding check is `git status --ignored` parity (`plans/28-3.md:35`).

## Consult Log

- 2026-10-17T03:11Z — trigger: deviation-gt-0 — question: accept the four pass-1 deviations (check-ignore precedence, `**/` mirroring, FOREIGN_SUBTREES, rewritten subtree test)? — ruling: accept-deviation score 1 — do: accept all four, keep the tree; restate plan Verify :97 as check-ignore with the nested file set aside, never edit apps/supervisor/.gitignore — rule candidate: When a plan keeps a nested .gitignore next to mirrored root entries, its Verify uses git status --ignored parity (or check-ignore with the nested file set aside), and slash-less nested patterns are mirrored as <prefix>/**/<pattern>.
- 2026-10-17T03:26Z — trigger: high-severity-finding — question: follow-up review found the supervisor serves a worktree's top level (apps/supervisor/src/worktree.ts:110-111, :254; cli.ts:373), so AC3's nested-root clause fails at the live run; defer or intent_gap? — ruling: apply — do: route as defer (high) under DEFERRAL DISCIPLINE (a), naming the defect and that AC3's live clause needs an operator correct-course giving the src fix a story; keep 4e63827, record AC3 live run unverifiable-here with the defect in residual risks, do not edit apps/supervisor/src; finish done and state AC3 is known to fail at the attended run — rule candidate: When a story's AC names live behaviour that depends on code the intent contract's Never puts off-limits, and review finds that code defective but not changed by the story, route it defer (a), naming the blocked AC and "needs operator correct-course"; never intent_gap.

### pass 2 (2026-10-17, implementer, review fixes)

DEVIATIONS: none (score 0)

### pass 3 (2026-10-17, implementer, follow-up review fixes)

DEVIATIONS: none (score 0)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review of the committed story (4e63827). The merged tree already pointed only at itself, and this pass hardened it:
- The `--repo` root fallback in `release_archive.py` now refuses a tk-studio tree whose tag lacks `apps/supervisor`.
- Two runbook passages that read as contradictions are clarified.
- One pre-existing supervisor defect that blocks AC3's live clause is deferred for an operator correct-course.

The earlier pass's work is unchanged:
- `.gitignore`: the root file carries the mirrored supervisor ignore entries.
- Docs: README, runbook §3.8 and §4, and the offline-install runbook point at `apps/supervisor`.
- Release: `release_archive.py --app supervisor` cuts from `apps/supervisor`.
- Sandbox: one-mount usage, with the ROOT values and the named exit-2 refusal.

**Files (this pass):**
- `tools/release_archive.py`: the `--repo` fallback refuses when `<tag>:plugins/tk-studio` is a tree. The comment is updated, and the `source` logic is unchanged.
- `plugins/tk-studio/lib/tests/test_release_roster.py`: `test_foreign_tk_studio_tag_without_the_subtree_is_refused` (no `gh` call, no archive, rosters untouched).
- `kb/offline-install-runbook.md`: the next-cut step promotes the whole written entry verbatim. Never hand-edit an entry merely to delete `source`.
- `kb/agent-pc-setup-runbook.md` §3.8: the two-loop paragraph agrees with §4's "Engine hold" row and names the shared checkout as the hazard.

(Earlier pass, 4e63827: `.gitignore`, `README.md`, both runbooks, `tools/release_archive.py`, `tools/sbx-engine/{launch-epic,resume-run,provision-engine}.sh`, `test_release_roster.py`, `test_sbx_skills_mount.py`.)

**Review:** blind-hunter plus edge-case-hunter, band L. 3 patches applied (low 3), 1 deferred (high: AC3's nested root in the supervisor's worktree path), 0 rejected. The false premise in one finding (that the merged tag lacks the subtree) is noted in the triage log.
**Follow-up review recommended:** false. Patched findings: high 0, medium 0, low 3. Score 3×0 + 3 = 3, which is below 5.

**Verification** (re-run by this session after the patches):
- `uv run python -m unittest discover tests`: 1333 tests, OK, skipped=1.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `uv run python tools/verify_host.py`: exit 0.
- `release_archive.py run --app supervisor --version 0.1.1 --dry-run`: fails only on `tag supervisor--v0.1.1 not found`.
- `config.py root --directory apps/supervisor`: `nested: true`, `project_id: supervisor`.
- `bun install --frozen-lockfile && bun test` from `apps/supervisor`: 860 tests, 0 fail, 5 skip.
- `git check-ignore -v apps/supervisor/node_modules/x`: names the nested `.gitignore:3` while that file is present. The root lines were proven with it set aside (pass-1 consult ruling).

**unverifiable-here (operator or attended):**
- AC1, the rosters' `source` drop: tag `supervisor--vX.Y.Z` (X.Y.Z > 0.1.0) on `thkennedy/tk-studio` `main`, then `uv run tools/release_archive.py run --app supervisor --version X.Y.Z --channel latest`, then a PR copying the entry verbatim into `stable.json`, then `tk-studio update --channel latest|stable` on the box.
- AC2, the sandbox recreate: `sbx rm claude-tk-studio-supervisor`; `sbx create --skills readonly --name claude-tk-studio claude C:\GitHub\tk-studio`; `WITH_BUN=1 bash tools/sbx-engine/provision-engine.sh /c/GitHub/tk-studio /c/GitHub/tk-studio`.
- AC2, the checkout-lock clause: Story 28.5.
- AC3, a live supervisor run through the supervisor. **It is known to fail at the attended run** until the deferred `apps/supervisor/src` fix lands: the run serves the worktree's top level, the outer root. That fix needs an operator correct-course to give it a story.
- AC4: the Windows `uv run python tools/verify_host.py` and `cd apps\supervisor; bun install --frozen-lockfile; bun test`, plus one commit on `thkennedy/tk-studio-supervisor`'s README pointing at `tk-studio/apps/supervisor`.

**Residual risks:**
- AC3: `apps/supervisor/src/worktree.ts:110-111`, `:254` and `cli.ts:79`, `:373` serve the worktree root. A supervisor-queued run of the nested project serves the outer tk-studio root (deferred, high, needs an operator correct-course).
- `tools/agent-pc/set-supervisor-env.ps1` still hard-codes the old clone (CAP-14), so the old clone stays on the box until 28.4.
- Two loops in one sandbox are not serialised until 28.5. The runbook says to run one at a time.

DRIFT: check-ignore names the nested .gitignore line, root lines proven with the nested file moved aside — git's deeper-file precedence; the spec keeps the nested file — affects: none
DRIFT: slash-free supervisor ignore entries written as apps/supervisor/**/<entry> — a plain prefix would anchor them and change their meaning — affects: none
DRIFT: release_archive.py gains FOREIGN_SUBTREES for --repo cuts (probing <tag>:apps/supervisor first, refusing a tk-studio tree without it) — keeps the historical cut at subtree "." per the I/O matrix — affects: none
DRIFT: test_each_app_archives_its_subtree_at_its_tag rewritten, fake _run gains archive_from_disk — it pinned the pre-merge supervisor subtree — affects: none
