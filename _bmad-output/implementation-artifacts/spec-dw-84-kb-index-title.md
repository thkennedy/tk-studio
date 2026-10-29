---
title: 'DW-84: kb.py index titles kb/index.md with the stable project name, not the checkout folder'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: 'ad73ab1a789c8bb9f20c390ed46b37fa65cc7aa2'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** `kb.py index` titles `kb/index.md` with `project_root.name` (`plugins/tk-studio/lib/kb.py:171`), so every regeneration from a differently named worktree (`q-run-epic-34-…`) rewrites the header and implementers restore `tk-studio` by hand (DW-84).

**Approach:** `generate_index` takes the title from the tracked config's `project_id` (via `config.tracked_project_id`), falling back to the main repository's basename — the parent directory of `git rev-parse --git-common-dir` — and only when neither resolves (no git, not a repo) to the folder name. Never the worktree folder name when git can name the main repo.

## Boundaries & Constraints

**Always:** stdlib-only (NFR9); git call bounded with a timeout and any failure (git missing, non-zero exit, OSError, timeout) falls back silently to `project_root.name`; atomic write path unchanged; output JSON shape of `kb.py index`/`standup` unchanged; title is the raw `project_id` string (not `store.safe_name`'d).

**Block If:** the fix would require changing the `kb.py` CLI contract or `driver-contract.md`.

**Never:** edit the deferred-work ledger; hand-edit `kb/index.md`; change `config.project_key` / registry identity semantics; touch files outside the Code Map.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| explicit id | `.tk-studio/config.yaml` has `project_id: alpha`, folder `q-run-x` | header `# alpha — knowledge base` | none |
| git worktree | main repo dir `tk-main`, linked worktree `q-run-x`, no project_id | header `# tk-main — knowledge base` | none |
| main checkout | plain git repo dir `proj`, no project_id | header `# proj — knowledge base` | none |
| no git | not a repo / git missing | header uses folder name | git failure swallowed |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/kb.py:161-176` -- `generate_index`; line 171 `render_index(project_root.name, entries)` is the bug. Add a `_project_name(project_root)` helper used here.
- `plugins/tk-studio/lib/kb.py:127` -- `render_index(project_name, entries)`; unchanged.
- `plugins/tk-studio/lib/config.py:237` -- `tracked_project_id(project_root) -> str | None`; reuse (import `config as configlib`, the convention in `job.py:52`, `orchestrate.py:43`). config.py imports only stdlib + `classify`/`miniyaml`/`store` siblings — safe for kb.
- `.tk-studio/config.yaml:8` -- this repo's `project_id` is commented out, so the git fallback is what yields `tk-studio` here (`git rev-parse --git-common-dir` → `/c/GitHub/tk-studio/.git`).
- `git rev-parse --git-common-dir` may print a path relative to cwd (e.g. `.git`); resolve it against `project_root` before taking `.parent.name`.
- `plugins/tk-studio/lib/tests/test_kb.py:14-30` -- `KbTestCase` fixture (tmp `proj` dir, `_write`, `_index`); add tests here.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/kb.py` -- add `_project_name(project_root)`: `configlib.tracked_project_id` → else `git -C <root> rev-parse --git-common-dir` (subprocess, `timeout=10`, capture output) resolved against root, take `.parent.name` → else `project_root.name`; use it at line 171 -- stable header across worktrees.
- `plugins/tk-studio/lib/tests/test_kb.py` -- add a test class covering the I/O matrix: project_id wins over folder name; a `git worktree add` into a differently named folder titles after the main repo dir (skip if `git` unavailable; set `user.email`/`user.name` locally and commit once so the worktree can be added); non-git folder falls back to folder name -- proves the fix at the CLI's library surface.

**Acceptance Criteria:**
- Given a linked git worktree folder `q-run-x` of a main repo `tk-main` with a `kb/` dir and no tracked project_id, when `kb.generate_index(worktree)` runs, then `kb/index.md` starts with `# tk-main — knowledge base`.
- Given a tracked `project_id: alpha`, when the index is generated from any folder, then the header is `# alpha — knowledge base`.
- Given this repository's worktree, when `uv run plugins/tk-studio/lib/kb.py index --directory .` runs, then `kb/index.md` is unchanged (`changed: false`, header `# tk-studio — knowledge base`).

## Spec Change Log

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story (2 files; no story plan, band measured from the pass-1 diff: 88 new lines)

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 1 (low 1)
- addressed_findings:
  - `[medium]` `[patch]` nested project inside an enclosing repo took the outer repo's name — `_project_name` now uses the git name only when `--show-toplevel` equals project_root; test added
  - `[low]` `[patch]` submodule / `--separate-git-dir` common dir not named `.git` gave a wrong title (e.g. `modules`), and an inherited GIT_DIR could redirect git — falls back to folder name unless common dir is `.git`; GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR stripped from the subprocess env; tests added
  - `[low]` `[patch]` git tests inherited host git config/env (gpgsign, hooksPath, GIT_DIR) — tests now run git and generate_index under a hermetic env
- rejected: existing IndexTests depend on tmp location — no existing test asserts the header (grep of test_kb.py), so nothing is exposed

### 2026-10-29 — Review pass (follow-up)
- layers: blind-hunter + edge-case-hunter (no story plan; reviewed diff is 2 files, 165 new lines > 150, so not S-band)
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 1 (low 1)
- addressed_findings:
  - `[low]` `[patch]` linked worktree of a bare main repo (common dir `tk-main.git`) fell back to the worktree folder name — `_project_name` now titles after `<name>` for a `<name>.git` common dir (`.git` → parent name; other names → folder name, unchanged); mock + real-git bare-worktree tests added
- rejected: title depends on host (git missing / untrusted dir / no `.git`) — the git fallback is the intent's prescribed design and `project_id` is the pin; not a defect in the change

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_kb -v` -- expected: all pass including new tests
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run plugins/tk-studio/lib/kb.py index --directory .` (repo root) -- expected: `changed: false`; `git diff --exit-code kb/index.md` clean

## Deviation Summary

### pass 1 (2026-10-29)

- planned: the non-git row is tested on a real non-git folder / actual: the non-git test mocks `subprocess.run` to return exit code 128; an extra test covers git missing / timeout / why: a temp dir may sit inside a git repo on some machines, making a real non-git test unreliable / may affect: none
- planned: git call with `timeout=10` and captured output / actual: also `encoding="utf-8", errors="replace"` / why: a non-UTF-8 path in git output must not raise past the silent fallback / may affect: none

DEVIATION SCORE: 1

DRIFT: non-git matrix row tested by mocking subprocess.run (exit 128) instead of a real non-git folder — tmp dirs may be inside a git repo — affects: none
DRIFT: git subprocess also decodes with encoding=utf-8, errors=replace — keeps the fallback silent on non-UTF-8 output — affects: none

### pass 2 (2026-10-29, review patch)

- planned: test git isolation strips GIT_* location vars, sets GIT_CONFIG_NOSYSTEM/GIT_CONFIG_GLOBAL, commit.gpgsign=false / actual: also strips GIT_CEILING_DIRECTORIES, GIT_CONFIG_PARAMETERS/COUNT/KEY_*/VALUE_*, GIT_TEMPLATE_DIR and passes `-c core.hooksPath=<devnull>` / why: neutralise hooks/templates and env-injected config / may affect: none
- planned: isolate the `_git` helper / actual: real-git tests also run `kb.generate_index` under patched `os.environ` (`_generate_isolated`) / why: kb's own git call must not see host git env / may affect: none
- planned: one mock test for a non-`.git` common dir / actual: also a positive `.git` mock test asserting env stripping / why: cover the env patch / may affect: none

DEVIATION SCORE: 1

DRIFT: test git env isolation is wider than briefed, so tests stay hermetic on any host — affects: none

### pass 3 (2026-10-29, follow-up review patch)

- planned: bare `<name>.git` common dir titles `<name>`, one mock test, optional real-git test / actual: as planned, both tests added / why: n/a / may affect: none

DEVIATION SCORE: 0

## Consult Log

- 2026-10-29T21:11:02Z — trigger: deviation-gt-0 — question: accept the mocked non-git test and utf-8/replace decoding deviations? — ruling: accept-deviation score 1 — do: keep both deviations as implemented; leave Deviation Summary and score 1; proceed to review — rule candidate: specs needing a "not a git repo" test should prescribe mocking subprocess.run (non-zero exit) or GIT_CEILING_DIRECTORIES, and subprocess text calls default to encoding="utf-8", errors="replace"
- 2026-10-29T21:19:08Z — trigger: deviation-gt-0 — question: accept pass-2 test-only deviations (wider git env isolation, isolated generate_index, extra .git mock test)? — ruling: accept-deviation score 1 — do: keep all three; add pass 2 entry + DRIFT line; keep score 1; proceed to verification — rule candidate: specs adding real-git tests prescribe a shared hermetic git env helper and run the code under test inside it

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T200840Z-2846e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Follow-up review of the done DW-84 fix (a4144878431ae66908ca81617674230f362a1507). `kb.py index` titles `kb/index.md` with the tracked `project_id`, else the main repository's name from git (parent of a `.git` common dir, or `<name>` of a bare `<name>.git` common dir, only at the work-tree top), else the folder name. This pass adds the bare-repo case.

**Files changed (this pass):**
- `plugins/tk-studio/lib/kb.py` — `_project_name` titles a bare `<name>.git` common dir as `<name>`; docstring updated.
- `plugins/tk-studio/lib/tests/test_kb.py` — `test_bare_dotgit_common_dir_names_main_repo` (mock) and `test_worktree_of_bare_repo_titles_after_repo` (real git, skipped without git).

**Review:** blind-hunter + edge-case-hunter. 1 patch applied (low 1), 0 deferred, 1 rejected.

**Follow-up review recommendation:** false — patched high 0, medium 0, low 1; score 3×0 + 1×1 = 1 (< 5).

**Verification:** `unittest tests.test_kb` 21 OK; `unittest discover tests` 2586 OK (4 skipped); conformance `ok: true`; `kb.py index --directory .` → `changed: false`, `git diff --exit-code kb/index.md` clean.

DRIFT: non-git matrix row tested by mocking subprocess.run (exit 128) instead of a real non-git folder — tmp dirs may be inside a git repo — affects: none
DRIFT: git subprocess also decodes with encoding=utf-8, errors=replace — keeps the fallback silent on non-UTF-8 output — affects: none
DRIFT: test git env isolation is wider than briefed, so tests stay hermetic on any host — affects: none

**Residual risks:** one extra git subprocess per index run when no `project_id` is set (10s cap). The git-derived title is host-dependent (no git, untrusted dir, or a copy without `.git` → folder name); set `project_id` to pin it. A `.bare`-style bare repo dir still titles after the folder. `_bmad-output/implementation-artifacts/deferred-work.md` carries the orchestrator's uncommitted DW-84 status change; left untouched and uncommitted per the invocation's ledger rule.

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Spec resolution: unit key `dw-kb-index-title` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261029-200950-8dfd state.json), `spec-dw-84-kb-index-title.md`.
- Part B note: this unit is a sweep DW bundle (DW-84), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_linked_worktree_titles_after_main_repo` (real git worktree); AC2 `test_project_id_wins_over_folder_name`; AC3 `kb/index.md` header is `# tk-studio — knowledge base` with no working-tree change, and the dev session recorded `changed: false` (index command not rerun here). This session's rerun of `tests.test_kb`: 21 OK.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met.
