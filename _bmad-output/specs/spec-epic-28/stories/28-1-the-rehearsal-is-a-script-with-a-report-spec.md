---
title: 'The Rehearsal Is a Script With a Report'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: '22cc7be2b23caef4067cc7dbd077013c5937b515'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-28/plans/28-1.md'
  - '{project-root}/_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The supervisor's move into `apps/supervisor` (AD-21, ADR §5) must be a replay of a passed rehearsal, never an improvisation, and no script rehearses it today.

**Approach:** As the operator, I want the migration rehearsed by a script on throwaway clones that ends in a report, so that the real cut-over is a replay of a passed rehearsal and never an improvisation. `tools/restructure/rehearse.py` clones both repositories into a scratch folder, rewrites, merges, runs the checks, and writes the report; the lib suite pins it against a fake pair of small repositories.

Acceptance criteria (verbatim from epics.md, Story 28.1):

- AC1. **Given** a fresh `git clone --no-local` of the supervisor repository and a fresh clone of tk-studio, both in a scratch folder the script creates, **When** `tools/restructure/rehearse.py` runs (stdlib Python; `git` and `uvx git-filter-repo` through subprocess argv, never a shell), **Then** it rewrites the supervisor clone's history under `apps/supervisor/` with `git filter-repo --to-subdirectory-filter apps/supervisor`, asserts there are no tags and no signed commits to lose and no `node_modules` path anywhere in the rewritten history, fetches the rewrite into the tk-studio clone on branch `restructure/supervisor-into-monorepo`, merges it with `--allow-unrelated-histories`, and asserts the merge produced no conflict (every path is new).
- AC2. **Given** the merged clone, **When** the checks run, **Then** the report records each with its exit code, duration and last output lines: `tk activate` clean from the nested root `apps/supervisor` (the plugin's own entry point); `bmad-loop` finds its run workspace from the nested root; the supervisor's `bun test` passes from `apps/supervisor`; tk-studio's `tools/verify_host.py` passes from the repository root; the four loop hooks of `apps/supervisor/.claude/settings.json` fire with `$CLAUDE_PROJECT_DIR` equal to the nested root; the size of the clone after the merge (the design spec's open question).
- AC3. **Given** a check the script's host cannot run (a Windows-only check inside the Linux engine; a Claude session's hook firing where no session can start), **When** the report is written, **Then** the check is listed under `unverifiable-here` with the exact command for the agent PC, never as a pass, and the script's exit status does not count it as failed.
- AC4. **Given** the report `_bmad-output/implementation-artifacts/restructure-rehearsal-<date>.md`, **When** the script ends, **Then** it follows the order of ADR §5 steps 1 to 5, ends with a one-line verdict (`rehearsal passed` or the first failed step), the script exits non-zero when any step or check failed, it never touches `C:\GitHub\tk-studio`, the live supervisor checkout or any remote, and the lib suite pins it against a fake pair of small repositories (a fake `git-filter-repo` only where the real one is unavailable).

## Boundaries & Constraints

**Always:** stdlib-only Python run via `uv run` (NFR9); every subprocess is an argv list (no `shell=True`, no `os.system`); every git command's `cwd` is inside the scratch folder; commit identity via per-command `-c user.name=rehearse -c user.email=rehearse@localhost`; report written atomically (temp + `os.replace`); `main()` reconfigures stdout to UTF-8; tests make no network call (socket guard) and isolate git config (`GIT_CONFIG_NOSYSTEM=1`, `HOME`/`GIT_CONFIG_GLOBAL` into the temp dir). Hooks: enumerate whatever hooks the merged `apps/supervisor/.claude/settings.json` declares, record count and names (count ≠ 4 is a failed check naming it); static script-path resolution under `$CLAUDE_PROJECT_DIR` = nested root is the verifiable part; live firing is always `unverifiable-here` (SPEC design note).

**Block If:** an AC can only be met by writing outside the scratch folder other than the report, by setting global git config, or by executing a hook command; the Files list must grow beyond the three files below.

**Never:** `git push`, adding any remote except the local `svc` remote in the scratch clone, fetching from a source repo's remotes, writing into either source, cloning a GitHub remote from the lib suite, executing a hook command, setting `core.longpaths` or any global config; editing any file outside Files; running the real rehearsal against `thkennedy/tk-studio-supervisor` (operator step).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | fake supervisor (4 hooks, `.gitignore` with `node_modules/`, `package.json`) + fake tk-studio (stub `verify_host.py` rc 0, stub `drift_check.py` clean) | exit 0; report sections Step 1..5 then `## unverifiable-here`; last line `Verdict: rehearsal passed`; branch `restructure/supervisor-into-monorepo` in scratch tk-studio clone with every supervisor path under `apps/supervisor/` | `bun` absent and hook live-firing listed under `unverifiable-here`, exit still 0 |
| Tag present | fake supervisor with a tag | exit 1; `Verdict: failed at Step 2 — tags present`; Steps 3–5 `not run` | — |
| node_modules in history | a commit adding `node_modules/x.js` | exit 1; verdict names the `node_modules` assertion | — |
| Merge conflict | fake tk-studio already holds `apps/supervisor/<same path>` | exit 1; verdict names Step 3 | — |
| Failing check | stub `verify_host.py` exits 1 | exit 1; `Verdict: failed at Step 4 — verify_host`; that check's rc and tail in the report | — |
| Guard | `--scratch` inside a source | exit 2, named reason, nothing written | refused before any write |
| Sources untouched | every case | sources' HEAD, refs (`git for-each-ref`) and remotes unchanged | — |

</intent-contract>

## Code Map

The investigation is `plans/28-1.md` "Code Map" (lines 25–43) — read it in full; it is authoritative for commands, pass rules and report shape. Distilled anchors:

- `_bmad-output/planning-artifacts/briefs/adr-repository-structure-2026-10-09.md:220-238` -- ADR §5 steps 1–5 (Freeze, Rewrite, Merge, Nested studio project with its rehearsal checks, Sandboxes); report section order and exact commands. Step 1: script checks clones are fresh/`--no-local`; reads (never sets) `core.longpaths`, its absence on Linux is `unverifiable-here` with `git config --global core.longpaths true`. Step 4's folder-trust check is Windows-only → `unverifiable-here`. Step 5 sandbox provisioning → `unverifiable-here` with the runbook command.
- `tools/verify_host.py:28-37` -- shape to copy: `subprocess.run(argv, cwd=..., capture_output=True, text=True, encoding="utf-8", errors="replace")`, `time.monotonic()`, `FileNotFoundError` → rc 127. Repo root for rehearse.py is `Path(__file__).resolve().parents[2]`. Check command from merged root: `uv run python tools/verify_host.py`.
- `tk activate` check -- `uv run <merged>/plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory <nested root>`; clean = rc 0 and JSON `result` not `drift`/`error`; record `result` + `fixes[]`. Pre-28.2 it is expected to fail on real repos (recorded failure, not a bug).
- `bmad-loop` check -- `bmad-loop list --json` cwd = nested root (pass: rc 0 + parsable JSON); `bmad-loop validate --project <nested> --json` informational. Missing executable → `unverifiable-here` (host: `/home/agent/.local/bin/bmad-loop` present; tests may run without it on PATH).
- `bun test` -- `bun` absent here → `unverifiable-here` with `cd C:\GitHub\tk-studio\apps\supervisor; bun install --frozen-lockfile; bun test`.
- Clone size -- `git count-objects -vH` + bytes of working tree (excluding `.git`) and of `.git`; recorded, never pass/fail.
- filter-repo argv resolution -- `--filter-repo <argv0>` → `git-filter-repo` on PATH → `uvx git-filter-repo` → `uv tool run git-filter-repo`; record which ran. Host: no `git-filter-repo`, no `uvx`, `uv` at `/usr/local/bin/uv`; the test uses a fake (Python script rebuilding commits under the prefix, e.g. `read-tree --prefix` + `commit-tree`, linear tiny history).
- History assertions (in rewrite) -- `git tag --list` empty; `git log --format=%G? --all` only `N`; `git log --all --name-only --format=` has no `node_modules` path segment; `git ls-tree -r --name-only HEAD` all under `apps/supervisor/`.
- Merge -- `checkout -b restructure/supervisor-into-monorepo`; `remote add svc <rewrite>`; `fetch svc`; `merge --allow-unrelated-histories --no-edit svc/<branch>` (`--supervisor-branch`, default `main`); conflict = rc ≠ 0 or `diff --name-only --diff-filter=U` non-empty; `remote remove svc`. Remove `origin` from both clones right after cloning.
- Guard -- exit 2 before any write when scratch or report resolves inside a source; when a source is a non-local URL without `--allow-remote-source`; when `--scratch` is/inside `C:\GitHub\tk-studio`, `/c/GitHub/tk-studio` or the supervisor checkout.
- Report -- default `<repo root>/_bmad-output/implementation-artifacts/restructure-rehearsal-<UTC YYYY-MM-DD>.md`, `--report` override. Sections `## Step 1 — Freeze` … `## Step 5 — Sandboxes`, `## unverifiable-here`, last line `Verdict: rehearsal passed` | `Verdict: failed at <step> — <check>`. Row: name, command, cwd (relative to scratch), exit code, duration, last N lines fenced. Exit: 0 pass, 1 failed, 2 refused. A Step 2/3 failure stops later steps (`not run`).
- `plugins/tk-studio/lib/tests/test_release_roster.py:32` -- precedent: `sys.path.insert(0, str(PLUGIN_ROOT.parents[1] / "tools"))`; insert `tools/restructure` instead.
- `plugins/tk-studio/lib/tests/test_installer_apps.py:282` -- socket guard pattern to reuse.

## Tasks & Acceptance

**Execution:**
- `tools/restructure/rehearse.py` -- new script with CLI `--supervisor` (required), `--tk-studio` (default repo root, cloned), `--scratch`, `--report`, `--supervisor-branch`, `--filter-repo`, `--allow-remote-source`, `--tail` (default 20), `--keep`; implements Steps 1–5, the checks, the guard and the report per the Code Map -- AC1–AC4.
- `plugins/tk-studio/lib/tests/test_restructure_rehearse.py` -- new fake-pair pin covering every I/O-matrix row plus a static assertion that `rehearse.py` contains no `shell=True` and no `os.system`; prefer the real `git-filter-repo` when on PATH, the fake otherwise -- AC4 pin.

**Acceptance Criteria:**
- Given the fake pair, when the test suite runs, then each I/O-matrix row passes with the stated exit code, verdict line and report content.
- Given any run, when it ends, then no check that could not run is reported as a pass, and `unverifiable-here` entries each carry an exact agent-PC command (AC3).
- Given the real repositories, when the operator runs `uv run python tools/restructure/rehearse.py --supervisor C:\GitHub\tk-studio-supervisor` on the agent PC after Story 28.2, then the report ends `Verdict: rehearsal passed` — `unverifiable-here` for this story (operator step).

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- layers: blind-hunter, edge-case-hunter (band L); both received the diff by file path (`/tmp/diff-28-1.patch`) rather than inline, to keep orchestrator context small
- intent_gap: 0
- bad_spec: 0
- patch: 17: (high 0, medium 8, low 9)
- defer: 0
- reject: 1: (low 1) — bmad-loop "walks up to the outer workspace": `bmad-loop list --project` defaults to cwd, no walk-up
- addressed_findings:
  - `[medium]` `[patch]` tk activate's drift_check ledger event outside scratch — consult (tripwire) accepted at score 1; docstring + Step 4 note; tests isolate TK_STUDIO_HOME
  - `[medium]` `[patch]` relative source paths vetted against cwd but cloned from scratch — clone from resolved paths; test added
  - `[medium]` `[patch]` node_modules check missed merge-commit paths — `rev-list --all --objects` path segments
  - `[medium]` `[patch]` clone size inflated by bun install — measured right after the merge
  - `[medium]` `[patch]` AC-named assertion gaps (signed commit, durations, default report path, report-in-source guard) — tests added
  - `[medium]` `[patch]` unverifiable-here commands carried prose — commands only, prose moved to notes
  - `[medium]` `[patch]` inherited GIT_DIR/GIT_WORK_TREE/... and CLAUDE_PROJECT_DIR could redirect child commands — `child_env()` strips them
  - `[medium]` `[patch]` a hanging check left no report — `--timeout` (default 1800s), process-group kill, recorded fail
  - `[low]` `[patch]` "every path is new" compared HEAD not the merged ref, could pass on an empty listing — compare `svc/<branch>`, fail on empty/failed ls-tree, `-z` + quotePath=false, case-insensitive overlap
  - `[low]` `[patch]` missing svc branch reported as merge conflict — `supervisor branch missing`
  - `[low]` `[patch]` Step 5 rendered after an earlier failure — now `not run`
  - `[low]` `[patch]` report path an existing dir / inside scratch not refused — refused
  - `[low]` `[patch]` live supervisor checkout path not in LIVE_ROOTS — added
  - `[low]` `[patch]` hook paths with spaces failed falsely — placeholder substitution around shlex.split
  - `[low]` `[patch]` test PATH could expose bun/bmad-loop — shim dir; bun and bmad-loop outcomes asserted

### 2026-10-16 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L); diff since baseline by file path (`/tmp/diff-28-1-followup.patch`)
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 5, low 5)
- defer: 0
- reject: 2: (low 2) — hook names not matched against a fixed set (SPEC design note pins "enumerate whatever hooks the settings declare; record count and names; count ≠ 4 fails"); `--timeout 8` in the timeout test could flake on a slow host (speculative host-speed flake in test plumbing; the suite is green)
- addressed_findings:
  - `[medium]` `[patch]` `--report` not vetted against `LIVE_ROOTS` — `_vet_report_live`: live supervisor always refused; live tk-studio only under `_bmad-output/implementation-artifacts/`; test added
  - `[medium]` `[patch]` `%G?` prints `N` for SSH-signed commits without `allowedSignersFile` (verified, git 2.53) and for `mergetag` merges — raw-header scan (`gpgsig`, `gpgsig-sha256`, `mergetag`); fixture drops allowedSignersFile; mergetag test added
  - `[medium]` `[patch]` `rev-list --objects` lists each object once, so a `node_modules` copy identical to an earlier path was missed — `log --all -m --name-only -z`; identical-content test added
  - `[medium]` `[patch]` an `OSError` other than FileNotFoundError, or any stage exception, ended in a traceback with no report — `Popen` catches OSError (126/127); `rehearse()` records `unexpected error` and still writes the report; tests added
  - `[medium]` `[patch]` `bmad-loop list --json` exits 0 with `runs: []` in any folder, so the workspace check was vacuous — pass also needs a JSON `runs` list and `<nested>/.bmad-loop`; tests added
  - `[low]` `[patch]` `_parse_json` first-`{`/last-`}` fallback broke on trailing stderr braces — `raw_decode` over `{`/`[` candidates; test added
  - `[low]` `[patch]` rewrite clone kept `origin` after an early Step 2 failure — removed on every exit path (still after filter-repo on success); asserted
  - `[low]` `[patch]` tk activate passed on a missing or unknown `result` — needs `result == "clean"`; test added
  - `[low]` `[patch]` non-conflict merge failure labelled `merge conflict`; inherited `commit.gpgsign` — `merge failed` unless unmerged paths; per-command `-c commit.gpgsign=false`; tests added
  - `[low]` `[patch]` happy path asserted only duration per row (AC2) — exit code and fenced tail asserted on every command row

### 2026-10-16 — Review pass (follow-up 2)
- layers: blind-hunter, edge-case-hunter (band L); diff since baseline by file path (`/tmp/diff-28-1-followup2.patch`)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 6: (low 6) — bmad-loop pass rule can't tell which workspace it picked (settled in pass 1: `bmad-loop list` reads cwd, no walk-up); report lacks source SHAs / tk-studio base branch, and the prefix check lists rewrite `HEAD` (not AC-named; filter-repo rewrites every ref the same way); operator global `core.hooksPath` runs git hooks (operator's own environment, outside the ACs); `rehearsal passed` with items under `unverifiable-here` (AC3 says they do not count as failed); report write `OSError` gives a traceback (exit is non-zero anyway; plumbing); `--tail 0` records no lines (an explicit operator opt-out)
- addressed_findings:
  - `[low]` `[patch]` Step 1 early failure (tk-studio clone, Windows `core.longpaths`) left `origin` on the supervisor clone — `step_freeze` removes it in a `finally` on any Step 1 failure (`_drop_origin`, shared with Step 2); `test_step1_failure_removes_supervisor_origin`
  - `[low]` `[patch]` a hook token with `$CLAUDE_PROJECT_DIR` mid-token (`--script=$CLAUDE_PROJECT_DIR/…`) made `relative_to` raise, which became a Step 4 "unexpected error" — non-raising `_shown()`, so the hook gets a named row; `test_hook_variable_mid_token`
  - `[low]` `[patch]` an operator global `merge.ff=only` aborted the unrelated-histories merge, a false Step 3 failure — per-command `-c merge.ff=true`; `test_merge_ignores_global_ff_only`
  - `[low]` `[patch]` an exception message with newlines broke the one-line verdict (AC4) — whitespace collapsed; `test_unexpected_error_message_is_one_line`

## Verification

**Commands:** (from `plugins/tk-studio/lib`)
- `uv run python -m unittest discover tests` -- expected: green, including `test_restructure_rehearse`.
- `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` (no contract surface changes).

## Deviation Summary

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (implementer, 2026-10-16)

- planned: tag and signed-commit checks after the rewrite (Code Map) / actual: run on the fresh clone before filter-repo; `node_modules` and prefix checks still run after / why: filter-repo strips signatures by default, so a post-rewrite check always passes and proves nothing / may affect: none
- planned: refuse any report path inside a source / actual: a report inside the tk-studio source is allowed only under `_bmad-output/implementation-artifacts/` / why: AC4's default report location is inside the default tk-studio source / may affect: none
- planned: Step 2 assertions as listed / actual: added `node_modules ignored` check (`git check-ignore --no-index`) / why: ADR §5 step 2 "Confirm node_modules is ignored" / may affect: none
- planned: plain `--keep` / actual: `--keep` / `--no-keep`, default keep / why: plan says the default keeps, so plain `--keep` is a no-op / may affect: none
- planned: `--filter-repo <argv0>` as-is / actual: a `.py` value runs under the current Python / why: fake runs on any OS without an exec bit / may affect: none
- planned: Step 1 lists script checks plus `core.longpaths` / actual: also an `unverifiable-here` entry for the operator freeze actions with agent-PC commands / why: ADR §5 step 1 lists them; AC3 / may affect: none
- planned: Step 3 conflict check only / actual: added an "every path is new" check (pre-merge tk-studio tree vs rewrite paths) / why: AC1 "every path is new"; identical-content collisions merge cleanly / may affect: none

DEVIATION SCORE: 1

DRIFT: tag/signed-commit assertions run before filter-repo, not after — filter-repo strips signatures so a post-rewrite check is vacuous — affects: none
DRIFT: report path inside the tk-studio source allowed only under `_bmad-output/implementation-artifacts/` — AC4's default report location is inside that source — affects: 28-2
DRIFT: added `node_modules ignored` check in Step 2 — ADR §5 step 2 names it — affects: none
DRIFT: `--keep`/`--no-keep` with default keep — plain `--keep` was a no-op per the plan — affects: none
DRIFT: `.py` `--filter-repo` value runs under the current Python — portable fake without exec bit — affects: none
DRIFT: Step 1 lists operator freeze actions under `unverifiable-here` — ADR §5 step 1, AC3 — affects: none
DRIFT: Step 3 adds an "every path is new" check — AC1 wording; identical-content collisions merge cleanly — affects: none

Consult (deviation-gt-0) accepted the pass-1 set at score 1; deviation #2 is AC4's own sanctioned report write, not a new seam.

## Consult Log

- 2026-10-16T20:58:05Z — trigger: deviation-gt-0 — question: accept the seven pass-1 deviations (esp. #2, report path inside the tk-studio source only under `_bmad-output/implementation-artifacts/`) at score 1, 2, reject or escalate? — ruling: accept-deviation score 1 — do: keep the set with no code change; set #2 may-affect to none; leave deviation_score 1 and the DRIFT line, note the consult accepted it at 1 — rule candidate: In a plan's safety guard, the story's own default output path is an exception to "refuse writes inside a source"; planners state it in the Code Map, and a deviation implementing exactly that exception scores 1.
- 2026-10-16T21:01:42Z — trigger: tripwire — question: the `tk activate` check's drift_check emits a ledger event to the per-user store (outside scratch); accept, isolate via TK_STUDIO_HOME copy/empty, or escalate? — ruling: accept-deviation score 1 — do: run the check as planned with no TK_STUDIO_HOME override; add a docstring line and a Step 4 report line naming drift_check's own measurement event; in the lib suite set TK_STUDIO_HOME to the test temp dir — rule candidate: Block If "writing outside the scratch folder" excludes measurement events an invoked studio check emits to the per-user store via ledger.emit; tests still isolate TK_STUDIO_HOME.
- 2026-10-16T21:22:06Z — trigger: deviation-gt-0 — question: accept the three follow-up-pass deviations (stage functions take a `Step` argument; fake filter-repo passes `--no-gpg-sign`; report always fences a tail for command rows) at score 1, 2, reject or escalate? — ruling: accept-deviation score 1 — do: keep all three as implemented, no code change; record them in the deviation log at score 1 with may affect: none and note the consult accepted pass 3 at 1 — rule candidate: In a plan for a single-entry-point script, a changed private helper signature or a more uniform report row still matching the Code Map's row shape scores 1 when the only callers are the script and its own test file.

## Deviation Summary (pass 2, 2026-10-16, review patches)

- planned: duration per check row / actual: computed checks record their own computation time / why: review patch (AC2 durations) / may affect: none
- planned: clone size a Step 4 check / actual: measured in Step 3 right after the merge, reported in Step 4 / why: review patch / may affect: none
- planned: flags as listed in the plan / actual: added `--timeout` (default 1800s) / why: review patch (hung check) / may affect: none
- planned: node_modules via `git log --all --name-only --format=` / actual: `git rev-list --all --objects` path segments / why: review patch (merge commits) / may affect: none
- planned: Step 3 conflict check / actual: added `supervisor branch missing` pre-check; "every path is new" case-insensitive / why: review patches / may affect: none

DEVIATION SCORE: 1 (unchanged). No second consult: every pass-2 item implements a patch this session triaged, at the already-accepted score 1.

DRIFT: computed checks record a duration — AC2 asks duration on every row — affects: none
DRIFT: clone size measured right after the merge — bun install would inflate it — affects: none
DRIFT: added `--timeout` flag — a hung check must still yield a report — affects: none
DRIFT: node_modules check via `rev-list --all --objects` — `log --name-only` skips merge commits — affects: none
DRIFT: `supervisor branch missing` pre-check and case-insensitive overlap — correct labels; Windows target — affects: none


## Deviation Summary (pass 3, 2026-10-16, follow-up review patches)

- planned: turn a stage exception into a failed check / actual: stage functions take a `Step` first instead of creating their own / why: checks recorded before the exception stay in the report / may affect: none
- planned: pin the merge with `-c commit.gpgsign=false` / actual: the test's fake filter-repo also passes `--no-gpg-sign` to `commit-tree` / why: the global-gpgsign test then affects only the merge / may affect: none
- planned: assert the row format the writer emits / actual: the writer always prints a fenced tail for command rows (`(no output)` when empty) / why: an empty output printed no tail, short of AC2 / may affect: none

DEVIATION SCORE: 1 (unchanged). Consult (deviation-gt-0) accepted pass 3 at score 1.

DRIFT: stage functions take a `Step` argument — an exception must keep earlier checks in the report — affects: none
DRIFT: test fake filter-repo passes `--no-gpg-sign` — isolates the global-gpgsign merge test — affects: none
DRIFT: report fences a tail on every command row — AC2 last output lines on every row — affects: none

## Deviation Summary (pass 4, 2026-10-16, follow-up review 2 patches)

- none: the four patches stay inside the plan's Files and Code Map (the merge's per-command `-c merge.ff=true` follows the per-command config already there). Implementer DEVIATION SCORE: 0. No consult was needed.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A second follow-up review of `tools/restructure/rehearse.py`, the ADR §5 rehearsal on throwaway clones (AC1–AC4). It applied 4 low-severity patches:
- A Step 1 failure no longer leaves `origin` on the supervisor clone.
- A hook token that has `$CLAUDE_PROJECT_DIR` mid-token gets a named pass/fail row instead of a Step 4 "unexpected error".
- An operator's global `merge.ff=only` no longer fails the Step 3 merge (per-command `-c merge.ff=true`).
- An exception message with newlines no longer breaks the one-line verdict (AC4).

**Files:**
- `tools/restructure/rehearse.py` (modified): the 4 patches above.
- `plugins/tk-studio/lib/tests/test_restructure_rehearse.py` (modified): 4 new tests, one per patch, each red against the pre-fix script. The command string expected by `test_merge_ignores_global_gpgsign` now includes `-c merge.ff=true`.
- `_bmad-output/specs/spec-epic-28/stories/28-1-the-rehearsal-is-a-script-with-a-report-spec.md` (modified): this pass's triage, deviation record and result.

**Review:** blind-hunter plus edge-case-hunter, band L. 4 patches applied (high 0, medium 0, low 4), 0 deferred, 6 rejected (reasons in the Review Triage Log).
**Follow-up review recommended:** false. Patched findings: medium 0, low 4, score 3×0 + 4 = 4, below 5.

**Verification:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` ran 1268 tests, OK (1 skip, already there before this story). The implementer ran it, then this session re-ran it.
- `uv run python ../contracts/conformance/runner.py run` reports `ok: true`.
- `rehearse.py` contains no `shell=True` and no `os.system`.

**unverifiable-here (operator):**
- Run the real rehearsal on the agent PC after Story 28.2 lands: `uv run python tools/restructure/rehearse.py --supervisor C:\GitHub\tk-studio-supervisor`. Expect `Verdict: rehearsal passed`.

**Residual risks:**
- The real git-filter-repo was never run here; only the fake was.
- An operator's global `core.hooksPath` would still run their own git hooks during clone, checkout and merge (rejected: outside the ACs).
- The report records the source paths but not the source commit SHAs.
- The Windows `taskkill` timeout path is untested.
- The test class skips on a host that cannot create symlinks.
- When bun is present, `bun install --frozen-lockfile` reaches the npm registry; that happens on the operator run only.
- On the real supervisor, the bmad-loop check fails if `apps/supervisor/.bmad-loop` is not tracked.

DRIFT: tag/signed-commit assertions run before filter-repo, not after — filter-repo strips signatures so a post-rewrite check is vacuous — affects: none
DRIFT: report path inside the tk-studio source allowed only under `_bmad-output/implementation-artifacts/` — AC4's default report location is inside that source (consult: accepted, score 1) — affects: none
DRIFT: added `node_modules ignored` check in Step 2 — ADR §5 step 2 names it — affects: none
DRIFT: `--keep`/`--no-keep` with default keep — plain `--keep` was a no-op per the plan — affects: none
DRIFT: `.py` `--filter-repo` value runs under the current Python — portable fake without exec bit — affects: none
DRIFT: Step 1 lists operator freeze actions under `unverifiable-here` — ADR §5 step 1, AC3 — affects: none
DRIFT: Step 3 adds an "every path is new" check — AC1 wording; identical-content collisions merge cleanly — affects: none
DRIFT: tk activate's drift_check writes its own ledger event to the per-user store — the check's own measurement (consult: accepted, score 1) — affects: none
DRIFT: computed checks record a duration — AC2 asks duration on every row — affects: none
DRIFT: clone size measured right after the merge — bun install would inflate it — affects: none
DRIFT: added `--timeout` flag — a hung check must still yield a report — affects: none
DRIFT: node_modules check via `log --all -m --name-only` (was `rev-list --all --objects`) — both earlier forms miss paths (merges; deduplicated objects) — affects: none
DRIFT: `supervisor branch missing` pre-check and case-insensitive overlap — correct labels; Windows target — affects: none
DRIFT: signed-commit check reads raw commit headers instead of `%G?` — `%G?` prints `N` for SSH signatures without allowedSignersFile — affects: none
DRIFT: bmad-loop check also requires `<nested>/.bmad-loop` — `bmad-loop list` exits 0 in any folder — affects: none
DRIFT: stage functions take a `Step` argument — an exception must keep earlier checks in the report (consult: accepted, score 1) — affects: none
DRIFT: test fake filter-repo passes `--no-gpg-sign` — isolates the global-gpgsign merge test (consult: accepted, score 1) — affects: none
DRIFT: report fences a tail on every command row — AC2 last output lines on every row (consult: accepted, score 1) — affects: none

## Reconcile

- 2026-10-16 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 28-2-a-nested-studio-project-is-a-first-class-root
