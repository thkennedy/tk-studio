---
title: "The Host Leg Runs the Supervisor's Suites"
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '119dc2a371d9f43ce563f4eb7fbc5d9df2f2ae0a'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: no-impact
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-4.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The supervisor's suites run on the Windows host only by a hand recipe (holes 51, 56), so a Windows-only failure (hole 63's EBUSY on open SQLite queues) reaches `main`; and every run leaks `tk-sup-*` temp folders (hole 64: ~90,000 in the host Temp; hole 70: 1.3 M inodes in the engine sandbox's `/tmp`).

**Approach:** A `supervisor` gate in `tools/verify_host.py`, one shared test helper `apps/supervisor/test/tmp.ts` that owns every suite's temp folder and queue and removes them under every exit, and a `supervisor-temp` doctor warning.

**User story (verbatim, epics.md "### Story 33.4"):** As the operator, I want `tools/verify_host.py` to run the supervisor's test suites when `apps/supervisor` changed, So that a Windows-only failure is caught by the gate and not by a hand recipe, and the suites stop leaking temp folders (holes 63, 64, 51, 56).

**AC1 (verbatim):** **Given** a run whose diff touches `apps/supervisor` **When** the host leg runs **Then** `verify_host.py` adds a `supervisor` gate after `conformance`: each `test/*.test.ts` file but the e2e command-line suite in its own `bun test` under a per-file timeout (420 s), with every `TK_SUPERVISOR_*` variable stripped from its environment and `TMPDIR`/`TEMP` pointing at a per-run folder under the run's worktree that the gate removes afterwards, then `bunx tsc --noEmit -p apps/supervisor`; the gate's lines name each file's pass/fail counts and the slowest file; an unchanged `apps/supervisor` skips it like the studio-web gate; the recipe the handoff carried (hole 51/56) retires

**AC2 (verbatim):** **Given** the suites **When** they create temp directories and queues **Then** a shared helper `apps/supervisor/test/tmp.ts` owns `mkdtemp`, the queues opened inside it and the removal in `afterAll` (queues closed first, hole 63), every suite uses it, and a run of the whole gate leaves no `tk-sup-*` folder behind; `tk-studio doctor` warns when the user's Temp holds more than 500 `tk-sup-*` folders and names the cleanup; the runbook's hole-64 row is updated

**Replan (gate, from 33-1, hole 70):** `test/tmp.ts` removes what it made on every platform and under every exit, Linux included. Verify step: after the full suite runs in the sandbox, `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l` is 0 for the folders the run made (the run's own `TMPDIR` holds none, and the `/tmp` count does not grow).

## Boundaries & Constraints

**Always:**
- The shapes are the plan's Settled shape 1–5 (`plans/33-4.md`), also in SPEC.md Design notes CAP-7/CAP-8: e2e excluded by exact name `command-line.test.ts`; temp folder `<worktree>/.verify-tmp/supervisor-<UTC yyyymmddThhmmssZ>-<pid>/` with `TMPDIR`/`TEMP`/`TMP`, removed in `finally` (failed removal fails the gate), `/.verify-tmp/` gitignored; the gate's lines exactly as Settled shape 3; `tmp.ts` exports `tempDir`, `track`, `cleanupTemp`, registered once in `preload.ts` as a global `afterAll` plus `process.on("exit")`; doctor `supervisor-temp` as Settled shape 5.
- `studio_web_changed` generalises to `app_changed(rel)` with the studio-web lines word for word. Gate order: lib suite, conformance, supervisor, studio-web.
- Subprocesses argv only, never a shell. Studio Python stdlib-only. Doctor never deletes, never `fail`s on this check.
- The Files list in `plans/33-4.md` §Files is the boundary.

**Block If:**
- The Files list must grow beyond the plan's (halt; the band is oversize, do not split).
- A `src/` producer of `tk-sup-*` is found to leak (planning read `inbox.ts:312`, `approve.ts:818`, `delivery.ts:258`, `hostverify.ts:178`, `worktree.ts:452`: each removes its folder in `finally`).
- Routing a suite's temp folder through `tmp.ts` changes an existing assertion beyond the path.
- bun's preload `afterAll` does not run as a global hook in the installed bun (1.4.3): fall back to per-file `afterAll` imported from `tmp.ts`, recorded as a deviation (not a halt).
- A measured or estimated total gate time exceeds the job's host-verify guard.

**Never:** The inode warning in `tk-studio-launch check` and the `/tmp` prune at the pin (`pinBeforeClaim`) — deferred per Settled shape 6, recorded as DW entries and DRIFT `affects: none`. No push, tag, release; no edit of epics.md, stories.yaml, the canonical plan, or `supervision/`. No `pkill`-style kills.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unchanged | no diff under `apps/supervisor` | `== supervisor: skipped (apps/supervisor unchanged since <base12>)` | — |
| Changed | diff or untracked file under `apps/supervisor` | per-file lines, tsc line, closing line with totals and slowest; `verify_host: ok (…, supervisor, …)` | — |
| Git fails | no merge base / git error | gate runs, saying why | never a silent skip |
| Timeout | a file exceeds 420 s | killed (win32: `taskkill /T /F /PID`), `(timed out after 420s)`, counts as fail | gate FAILED, tail repeated |
| Unparseable bun output | no ` n pass`/` n fail` | `? pass, ? fail`, judged by exit code | — |
| Temp removal fails | `PermissionError` 3× at 1 s | `== supervisor: could not remove <path>: <error>` | gate FAILED |
| Doctor ≤500 / >500 / unreadable | `tk-sup-*` dirs in temp from `ctx.env` TMP/TEMP/TMPDIR | pass / warn with the cleanup fix / skipped | never fail |
| tmp.ts | tracked queue + folder; cleanup twice | queue closed before folder removed; second cleanup no-op | close errors swallowed |

</intent-contract>

## Code Map

The plan's Code Map (`plans/33-4.md` §Code Map) is the investigation; read it first. Key anchors:

- `tools/verify_host.py` -- `GATES` :27, `STUDIO_WEB_GATE` :31, `studio_web_changed()` :39-68 (→ `app_changed(rel)`), `run_gate` :71 (no timeout today; env `{**os.environ, PYTHONIOENCODING}`), `main` :81.
- `plugins/tk-studio/lib/tests/test_restructure_rehearse.py` -- precedent for loading a `tools/` script by path in the lib suite.
- `apps/supervisor/bunfig.toml` -- preloads `./test/preload.ts`; `preload.ts` strips notifier vars and sets `TK_SUPERVISOR_UNDER_TEST=1`.
- `apps/supervisor/tsconfig.json` -- includes `src` and `test`; `bunx tsc --noEmit -p apps/supervisor` from root.
- `apps/supervisor/test/*.test.ts`, `test/fakes.ts` -- every `mkdtempSync(join(tmpdir(), "tk-sup-…"))` → `tempDir("tk-sup-…")`; every fixture `new Queue(…)` (`src/queue.ts:848`, `close()` :885) in such a folder → `track(new Queue(…))`. Per-file counts in the plan. `status-block.test.ts` unchanged.
- `tools/installer/cli/tk_studio_cli/doctor.py` -- `_check` :79, `check_supervisor_log` :673, `check_stale_slots` :968 (shape), `run_doctor` list :1110-1141 (add after `check_supervisor_log` :1137).
- `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- check-order lists at :285-293, :969, :1042-1044.
- `kb/agent-pc-setup-runbook.md` -- §8 (new hole-64 row), line ~1374 (hand recipe to retire, keep the e2e by-hand note).
- `apps/supervisor/README.md:18` -- testing line; `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md:18` -- the "per-file suites by hand" clause.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- append two DW entries (inode warning; `/tmp` prune at the pin), evidence hole 70.
- Bun in the engine sandbox: `~/.bun/bin/bun` (1.4.3), not on PATH; `bunx` cannot link here, use `bun x tsc` or `bun node_modules/typescript/bin/tsc` (33-1 precedent).

## Tasks & Acceptance

**Execution:**
- `tools/verify_host.py` -- `app_changed`, the `supervisor` gate (per-file `bun test <file>` with 420 s timeout, `TK_SUPERVISOR_*` stripped, per-run temp folder with `TMPDIR`/`TEMP`/`TMP`, removal in `finally`), then `bunx tsc --noEmit -p apps/supervisor` (record `bunx` vs `bun x`), the lines of Settled shape 3; update the docstring.
- `plugins/tk-studio/lib/tests/test_verify_host.py` (new) -- the plan's listed cases with git and subprocess faked.
- `.gitignore` -- `/.verify-tmp/`.
- `apps/supervisor/test/tmp.ts` (new), `test/preload.ts`, `test/tmp.test.ts` (new) -- the helper, its global registration with exit fallback, and its tests.
- `apps/supervisor/test/fakes.ts` and the 31 suites in the plan's Files -- the mechanical swap and `track` wrapping.
- `tools/installer/cli/tk_studio_cli/doctor.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- `check_supervisor_temp` and its tests, order lists updated.
- `kb/agent-pc-setup-runbook.md`, `apps/supervisor/README.md`, the handoff (one clause), `deferred-work.md` -- docs and the two DW entries.

**Acceptance Criteria:**
- Given a diff under `apps/supervisor`, when `verify_host.main` runs (unit-tested with fakes), then the `supervisor` gate runs after `conformance` with every file but `command-line.test.ts`, each under `timeout=420`, an env with no `TK_SUPERVISOR_*` and `TMPDIR`/`TEMP`/`TMP` at the per-run folder, which is gone afterwards; then tsc; the lines name per-file counts and the slowest file.
- Given no diff under `apps/supervisor`, when it runs, then the skip line prints and the studio-web lines are unchanged word for word.
- Given the suites, when each `test/*.test.ts` runs in its own `bun test` under a fresh `TMPDIR`, then that `TMPDIR` holds 0 `tk-sup-*` afterwards and `/tmp`'s count does not grow; `grep -rn mkdtempSync apps/supervisor/test` lists only `tmp.ts`.
- Given >500 `tk-sup-*` folders in the injected temp, when doctor runs, then `supervisor-temp` warns with the cleanup fix; ≤500 passes; unreadable is skipped.
- The runbook has the hole-64 row and the retired recipe; README, handoff and deferred-work updated.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 3, low 2)
- defer: 0
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[high]` `[patch]` per-run TMPDIR under the worktree turns ~30 suite tests red (`queueDbPath` refuses paths inside a git checkout, `src/queue.ts:152-155`; reproduced: delivery 15, sandbox 6, queue 5, guards 3, auth 2, worktree 2, account 1, closeout 1, tier 1) — consult ruled accept-deviation score 2: folder moved to `<tempfile.gettempdir()>/tk-verify-supervisor-<stamp>-<pid>/`, `.git`-ancestor refusal added, `/.verify-tmp/` dropped from `.gitignore`, docs updated
  - `[medium]` `[patch]` `remove_tmp` failed on read-only files (git objects left by a killed file on Windows) — rmtree handler clears the read-only bit and retries; tested with a real read-only file
  - `[medium]` `[patch]` an `OSError` other than `FileNotFoundError` (PermissionError, Smart App Control) or a temp-folder creation failure escaped `main` with a traceback — caught per file (rc 127) and per gate; closing line and `verify_host: FAILED (supervisor)` still print
  - `[medium]` `[patch]` `preload.ts` cleaned up on `exit` only, not on SIGINT/SIGTERM — signal handlers call `cleanupTemp()` then exit 130/143 (replan: "under every exit")
  - `[low]` `[patch]` POSIX timeout killed only the direct child; grandchildren holding the pipe could stall the read — `start_new_session` + `killpg`, post-kill read bounded by `DRAIN_TIMEOUT` 10 s
  - `[low]` `[patch]` doctor read TMP/TEMP/TMPDIR, not `tempfile.gettempdir()`'s TMPDIR/TEMP/TMP order — order fixed, test re-pinned
- rejected: the gate triggers only on `apps/supervisor` changes though suites read plugin files (AC1 names that trigger); the `mkdtempSync` rule has no enforcing test (plumbing; the verify grep proves it); the "after every file" doc claim for shared-process runs (unverified; bun 1.4.3 was checked to run the preload `afterAll` per file); `conformance.test.ts` keeps its pre-existing `tk-conf-` prefix (baseline 119dc2a; doctor counts `tk-sup-*` as AC2 names, and `tmp.ts` removes them anyway)

### 2026-10-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 1, low 3)
- defer: 0
- reject: 7: (high 0, medium 0, low 7)
- note: a follow-up pass on the `done` spec. The diff 119dc2a..working tree (269 KB, 4186 lines, `_bmad-output/specs` excluded) was too large to inline in the prompt, so both layers (band L) read it from a scratch file outside the repo.
- addressed_findings:
  - `[medium]` `[patch]` Nothing proved that the preload's registered cleanup runs, and under the gate the per-run folder removal hides a missing hook (AC2: "the removal in `afterAll`"). `tmp.test.ts` gained two child-`bun test` tests. A fixture written at run time is run with `--preload <abs preload.ts>` and a fresh TMPDIR, and no `tk-sup-*` may be left: one case ends normally (the global `afterAll`), the other calls `process.exit(3)` (the `exit` fallback). Mutation-checked: removing either preload line fails only its own test.
  - `[low]` `[patch]` README, runbook row, the `tmp.ts` and `preload.ts` comments claimed cleanup "after every file". A probe of bun 1.4.3 (two files and a preload `afterAll`) printed the hook once, after the last file. This reverses the previous pass's rejection, which assumed per-file. Reworded: at the end of the `bun test` process, per file under the host gate (one process per file), and on `process.exit`/SIGINT/SIGTERM.
  - `[low]` `[patch]` The gate passed with 0 files when `supervisor_files()` found none. It now refuses with `== supervisor: no test/*.test.ts files under <path>`: FAILED, tsc skipped, the pinned closing line, the temp folder removed. New test `test_no_test_files_fails_the_gate_before_any_spawn`.
  - `[low]` `[patch]` `spawn()` killed the tree only on `TimeoutExpired`. A KeyboardInterrupt mid-read left the POSIX session-leader `bun test` running while the `finally` removed its temp folder. Added `except BaseException:` with the tree kill, a bounded drain and a re-raise. New test `test_an_interrupt_while_reading_kills_the_tree_and_is_raised_again`.
- rejected:
  - The e2e exclusion prints no line. AC1 names the exclusion and Settled shape 3 pins the lines; the README and runbook say the e2e suite is run by hand.
  - Only `TK_SUPERVISOR_*` is stripped. AC1 names exactly that set.
  - The doctor fixture sets only `TMP`. `self.env` is a fresh dict, not `os.environ`, so the box's TEMP/TMPDIR never leak in.
  - `conformance.test.ts` keeps its `tk-conf-*` prefixes and `join(tmpdir(), "tk-conf-sandbox")`. The prefixes are baseline and removed by `tempDir`; the fixed paths are argv strings, never created.
  - The gate has no total time cap. The per-file 420 s is pinned; the measured total is 82 s against the 3600 s guard.
  - A hard-killed leg leaks its `tk-verify-supervisor-*` folder, which the doctor does not count. No `finally` survives a tree kill. A start-of-run sweep would delete a concurrent leg's live folder, and AC2 pins the doctor's `tk-sup-*` count.
  - rc 0 with no parseable bun summary passes as `? pass`. The plan's Code Map pins this: "judged by the exit code alone".

### 2026-10-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 2, low 3)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- note: the third pass on the `done` spec (follow-up recommended by pass 2). Both layers (band L) read the diff 119dc2a..working tree (273 KB, 4264 lines, `_bmad-output/specs` excluded) from a scratch file outside the repo.
- addressed_findings:
  - `[medium]` `[patch]` The tsc step ran `bunx tsc --noEmit -p apps/supervisor` with `cwd=ROOT`. The root has no `node_modules`, so bunx could not find `apps/supervisor`'s pinned TypeScript (`^5.6.0`) and downloaded the latest one. Reproduced: with a fresh `BUN_INSTALL_CACHE_DIR`, the root run printed "Resolving dependencies … Version 7.0.2". This explains the earlier passes' "unpinned TypeScript" residual risk. AC1's argv and cwd are kept verbatim. The tsc step's env puts `apps/supervisor/node_modules/.bin` first on PATH (built from `SUPERVISOR` when the step runs); the `bun test` runs don't get it. A scratch-folder probe confirmed that both `bunx` and `bun x` then run the local `tsc`. `test_runs_after_conformance_each_file_but_the_e2e_then_tsc` now asserts the PATH prefix for tsc and its absence for `bun test`.
  - `[medium]` `[patch]` Seven suites (`approve`, `chat`, `delivery`, `questions`, `scope`, `log`, `engagement`) kept their own `made[]`/`queues[]` and their own `afterAll`, which called `rmSync(d, {recursive, force})` with no try and no retries. It ran before the helper's cleanup, and on Windows a transient EBUSY/EPERM would fail the file (the hole-63 class). AC2 has `tmp.ts` own the removal in `afterAll`. The local blocks, the `queues.push`, the `made.push` lines (every pushed path was already inside a `tempDir` folder) and the imports they left unused are removed. `sandbox.test.ts` had no such block and is unchanged.
  - `[low]` `[patch]` `preload.ts` handled SIGINT/SIGTERM but not SIGHUP, which a dropped `sbx exec` or terminal session sends on Linux (replan: "under every exit, Linux included", hole 70). It now runs `cleanupTemp()` on SIGHUP and exits 129. The signal lists in the `preload.ts` and `tmp.ts` comments are updated.
  - `[low]` `[patch]` No test covered the signal paths. `tmp.test.ts` gained a POSIX-only test, parametrised over SIGTERM → 143 and SIGHUP → 129. A child `bun test --preload <abs preload.ts>` with a fresh TMPDIR makes a `tk-sup-fixture-` folder and signals that it is ready. The test sends the signal, then asserts the exit code and that no `tk-sup-*` is left. Every wait is bounded and the `finally` sends SIGKILL. Mutation-checked: removing either handler fails only its own case; `preload.ts` was restored byte-for-byte.
  - `[low]` `[patch]` The doctor's `_temp_folder` used Python's `TMPDIR, TEMP, TMP` order. Bun's `os.tmpdir()`, which makes the folders, reads `TEMP`, `TMP` on Windows and `TMPDIR`, then `/tmp`, on POSIX. It now follows bun per `ctx.plat.windows`: on Windows `TEMP`, `TMP`, `<SystemRoot>\temp`, then `tempfile.gettempdir()`; on POSIX `TMPDIR`, then `/tmp`. The docstring is updated. `test_temp_folder_order_per_os` pins both orders with a mocked platform, and `test_posix_reads_tmpdir_then_tmp_like_bun` checks the POSIX order end-to-end.
- rejected:
  - Nothing enforces "every suite uses it" or checks for leftovers inside the gate's folder. The Verification grep (`mkdtempSync` only in `tmp.ts`) and the per-file `find "$T" … | wc -l` = 0 run prove it. That is plumbing, and the AC's outcome holds.
  - A hard-killed gate leaks its `tk-verify-supervisor-*` folder, which the doctor does not count. Same reasons as pass 2: no `finally` survives a tree kill, a start-of-run sweep would delete a concurrent leg's live folder, and AC2 pins the doctor's `tk-sup-*` count.
  - With several failing files, `main`'s `--tail 40` repeats only the last lines. The tail is `main`'s existing mechanism (`--tail N`), and each failing file's own line still names it with its counts.

## Design Notes

Settled shape 3's lines, e.g.:
```
== supervisor: apps/supervisor changed since 119dc2a371d9
== supervisor: test/api.test.ts 97 pass, 0 fail in 12s
== supervisor: test/queue.test.ts 97 pass, 1 fail in 30s rc=1
== supervisor: tsc ok in 9s
== supervisor: FAILED in 240s; 33 files, 1500 pass, 1 fail; slowest test/sandbox.test.ts 41s
```

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- green; `uv run python ../contracts/conformance/runner.py run` -- `ok: true`.
- From `apps/supervisor`, `PATH=~/.bun/bin:$PATH`, `TK_STUDIO_ROOT` set: record `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l`; `T=$(mktemp -d)`; for each `test/*.test.ts`: `TMPDIR=$T timeout -k 5 420 bun test <file>`; then `find "$T" -maxdepth 1 -name 'tk-sup-*' | wc -l` -- 0, `/tmp` count not grown; `rm -rf "$T"`. Compare failures against the baseline (3 known `command-line.test.ts` "worker tiers (Story 21.4)" fails; sbx/closeout fails 33-1 recorded).
- `bun x tsc --noEmit` (or `bun node_modules/typescript/bin/tsc --noEmit`) in `apps/supervisor` -- exit 0.
- `grep -rn mkdtempSync apps/supervisor/test` -- only `tmp.ts`.

**Manual checks (if no CLI):**
- `unverifiable-here`: on the agent PC, `uv run python tools/verify_host.py` in the run's worktree shows the `supervisor` lines; `Get-ChildItem <worktree>\.verify-tmp` is absent afterwards.

## Deviation Summary

### pass 1 (implementer, 2026-10-26)

- planned: the timeout through `subprocess.run(timeout=420)`, with the tree killed on win32 / actual: a small `spawn()` helper using `Popen.communicate(timeout=420)` that runs `taskkill /T /F /PID` before `kill()`; the unit tests fake `spawn` and check `timeout == 420` / why: `subprocess.run` kills only the direct child before anything else can run, so the tree cannot be killed first / may affect: none
- planned: the mechanical swap covers only `mkdtempSync` calls / actual: also moved 3 marker files in `command-line.test.ts` (`tk-sup-authkill-…`, `tk-sup-kill-drain-…`, `tk-sup-kill-…`, previously written straight into the temp folder) into `join(tempDir("tk-sup-…-"), "marker")`; the `existsSync(marker)` assertions keep their meaning / why: otherwise 4 `tk-sup-*` entries were left in `TMPDIR`, failing the "0 left" verify step / may affect: none
- planned: record whether the gate used `bunx` or `bun x` / actual: the gate tries `bunx` and falls back to `bun x` only when `bunx` cannot start; the tsc line keeps the specified shape and does not say which ran / why: keeps the specified line shape / may affect: none
- planned: DW entries shaped like existing `spec-deferred <hash>` entries / actual: `origin: spec-deferred 33-4 (plans/33-4.md Settled shape 6, …)` with no hash (DW-59 inode warning, DW-60 `/tmp` prune at the pin) / why: no engine-generated hash was available / may affect: none

DEVIATION SCORE: 1

DRIFT: the gate's timeout uses a `Popen.communicate(timeout=420)` helper instead of `subprocess.run(timeout=420)` — `subprocess.run` cannot kill the win32 tree before killing the child — affects: none
DRIFT: three e2e marker files in `command-line.test.ts` moved into `tempDir` folders — they were `tk-sup-*` entries left in TMPDIR — affects: none
DRIFT: the tsc step tries `bunx` then `bun x`; the line does not say which ran — keeps Settled shape 3's line — affects: none
DRIFT: DW-59/DW-60 carry `origin: spec-deferred 33-4` without a hash — no engine hash available — affects: none
DRIFT: the replan's inode warning in `tk-studio-launch check` deferred as DW-59 — outside AC1/AC2, plan Settled shape 6 — affects: none
DRIFT: the replan's `/tmp/tk-sup-*`/`/tmp/tmp.*` prune at the pin (`pinBeforeClaim`) deferred as DW-60 — outside AC1/AC2, plan Settled shape 6 — affects: none

### pass 2 (review patches, 2026-10-26)

- planned: per-run folder `<worktree>/.verify-tmp/supervisor-<stamp>-<pid>/` (AC1 "under the run's worktree"; SPEC CAP-7; plan Settled shape 2) / actual: `<tempfile.gettempdir()>/tk-verify-supervisor-<stamp>-<pid>/`, with a `.git`-ancestor refusal; `/.verify-tmp/` not in `.gitignore` / why: `queueDbPath` refuses queue DBs inside a git checkout, so ~30 tests went red under the worktree folder; consult ruled accept-deviation score 2 / may affect: SPEC.md CAP-7, plans/33-4.md Settled shape 2 and its Verify host-leg check (`Get-ChildItem <worktree>\.verify-tmp`)
- planned: read-only handler `os.chmod(path, stat.S_IWRITE)` / actual: `os.chmod(path, os.lstat(path).st_mode | stat.S_IWRITE)` / why: a bare 0o200 strips read/exec from a POSIX directory / may affect: none
- planned: post-kill read bounded by `GIT_TIMEOUT` (60 s) / actual: `DRAIN_TIMEOUT = 10` s / why: a pipe held after the kill must not cost 60 s per file / may affect: none
- planned: refusal fails the gate before the first file / actual: a refused or uncreatable temp folder runs neither files nor tsc and prints the closing line with `0 files … slowest none` / why: nothing runs without the isolated folder; the pinned closing line still prints / may affect: none

DEVIATION SCORE: 2 (consult)


### pass 3 (follow-up review patches, 2026-10-26)

- planned: Settled shape 3's lines only / actual: an empty `supervisor_files()` refuses with `== supervisor: no test/*.test.ts files under <path>`, then FAILED with the pinned closing line `0 files … slowest none` / why: a gate that runs nothing must not pass. This is the same refuse-before-any-file shape the 23:08:45Z consult ruled on, so it was not consulted again. / may affect: none

DEVIATION SCORE: 2 (unchanged; this pass is local)

DRIFT: AC1/CAP-7 "per-run folder under the run's worktree" → per-run folder under the OS temp (`tk-verify-supervisor-<stamp>-<pid>`), outside every git checkout, refused if any ancestor holds `.git` — `queueDbPath` refuses queue DBs inside a checkout (apps/supervisor/src/queue.ts:152-155), ~30 tests red otherwise — affects: SPEC.md CAP-7, plans/33-4.md Settled shape 2
DRIFT: the read-only removal handler keeps the mode and adds the write bit — a bare S_IWRITE breaks POSIX directory retries — affects: none
DRIFT: the post-kill pipe read is bounded by a new DRAIN_TIMEOUT of 10 s — a held pipe must not cost 60 s per file — affects: none
DRIFT: a refused or uncreatable temp folder skips files and tsc and prints `0 files … slowest none` — nothing runs without the isolated folder — affects: none

## Consult Log

- 2026-10-26T22:47:53Z — trigger: deviation-gt-0 — question: accept the four pass-1 deviations (Popen timeout helper, e2e markers into tempDir, bunx→bun x fallback unnamed in the tsc line, DW origin without hash)? — ruling: accept-deviation score 1 — do: keep all four as written; add one line to the spec saying which runner ran tsc in this story's own verification; carry on to review — rule candidate: Code Map 'record X' notes are satisfied by a spec Dev Notes line unless a Settled shape pins X into an output line; hand-written DW entries use `origin: spec-deferred <story-key> (<plan ref>)` when no engine hash exists

### Verification notes (session, 2026-10-26)

- tsc runner in this story's own verification: `bun node_modules/typescript/bin/tsc --noEmit` (exit 0); `bunx` cannot link in the engine sandbox (33-1 precedent). The gate itself runs `bunx tsc --noEmit -p apps/supervisor`, falling back to `bun x` when `bunx` cannot start.
- 2026-10-26T23:00:18Z — trigger: high-severity-finding — question: AC1 pins the per-run TMPDIR "under the run's worktree" but queueDbPath (apps/supervisor/src/queue.ts:152-155) refuses any path inside a git checkout, turning ~30 tests red under the gate; keep the location and change src, move the folder outside every checkout, or escalate? — ruling: accept-deviation score 2 — do: create the per-run folder as `<tempfile.gettempdir()>/tk-verify-supervisor-<UTC stamp>-<pid>/` resolved before the override, keep the rest of Settled shape 2, fail the gate if any ancestor holds `.git`, pin location+check in the unit test; drop `/.verify-tmp/` from .gitignore and record the DRIFT naming SPEC CAP-7 and plans/33-4.md Settled shape 2; change no src/ file or suite assertion — rule candidate: a gate that sets TMPDIR/TEMP/TMP for apps/supervisor suites must point them outside every git checkout; planners must not pin a temp folder under a worktree for those suites
- 2026-10-26T23:08:45Z — trigger: deviation-gt-0 — question: accept pass-2 refinements (mode-preserving chmod, DRAIN_TIMEOUT 10 s, refuse-then-closing-line with 0 files)? — ruling: accept-deviation score 1 — do: keep all three; add a DRIFT line each; a refusal test asserting the refusal line, no spawn, the closing line and rc=1 (already present: test_verify_host.py `test_a_temp_folder_inside_a_git_checkout_fails_the_gate_before_any_file`) — rule candidate: when a gate refuses before running any file it still prints its pinned closing line with 0 files and "slowest none", and fails



## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version), nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the third review pass on the `done` story; the second pass had recommended a follow-up. The first pass's implementation is commit 7478732 and the second pass's patches are bfe67b0. This pass reviewed the whole diff 119dc2a..HEAD with both layers (band L) and applied 5 patches:
- The tsc step now uses `apps/supervisor`'s installed TypeScript instead of downloading the latest one. AC1's command and cwd are kept verbatim; `node_modules/.bin` goes first on PATH for that step only.
- The helper alone now closes and removes. Seven suites had kept their own unguarded `afterAll` `rmSync`, which is gone.
- A SIGHUP cleanup handler was added.
- A test now covers the signal paths (SIGTERM → 143, SIGHUP → 129).
- The doctor reads the temp folder in bun's per-OS order.

**Files changed (this pass).**
- `tools/verify_host.py`: tsc step env with `apps/supervisor/node_modules/.bin` first on PATH; docstring.
- `plugins/tk-studio/lib/tests/test_verify_host.py`: tsc PATH prefix asserted; absent for `bun test`.
- `apps/supervisor/test/{approve,chat,delivery,questions,scope,log,engagement}.test.ts`: the local `made`/`queues`/`afterAll` removal and the imports it left unused are deleted.
- `apps/supervisor/test/preload.ts`: SIGHUP → `cleanupTemp()`, exit 129; comment.
- `apps/supervisor/test/tmp.ts`: comment (signal list).
- `apps/supervisor/test/tmp.test.ts`: the POSIX signal-path test (SIGTERM, SIGHUP).
- `tools/installer/cli/tk_studio_cli/doctor.py`: `_temp_folder` per-OS order like bun's `os.tmpdir()`; docstring.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`: `test_temp_folder_order_per_os` and `test_posix_reads_tmpdir_then_tmp_like_bun`; setUp sets `TMPDIR` and `TMP`.

**Review findings (this pass).**
- 5 patches applied: high 0, medium 2, low 3.
- 0 deferred.
- 3 rejected (reasons in the Review Triage Log).

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 3; score 3×2 + 1×3 = 9, which is 5 or more.

**Verification.** This session re-ran the checks after the implementer.
- From `plugins/tk-studio/lib`:
  - `uv run python -m unittest discover tests`: `Ran 2062 tests`, `OK (skipped=2)`.
  - `uv run python ../contracts/conformance/runner.py run`: `"ok": true`.
- From `apps/supervisor`, each file in its own `bun test` with a fresh `TMPDIR`/`TEMP`/`TMP`:

  | File | Pass | Fail |
  |---|---|---|
  | `tmp` | 8 | 0 |
  | `approve` | 44 | 0 |
  | `chat` | 17 | 0 |
  | `questions` | 35 | 0 |
  | `scope` | 6 | 0 |
  | `log` | 18 | 0 |
  | `engagement` | 105 | 0 |

  0 `tk-sup-*` were left in the fresh folder, and `/tmp` `tk-sup-*` stayed at 104 → 104.
- `delivery.test.ts` gives 6 pass, 15 fail (Story 32.8 closeout cases, `closed: []`). This is the same at HEAD (the implementer found the same failing names) and at the story's baseline 119dc2a (this session ran a `git archive` copy: 6 pass, 15 fail). The failures are pre-existing in this sandbox and not caused by this story.
- `sandbox.test.ts` is unchanged and fails its 5 known baseline tests.
- `bun x tsc --noEmit` in `apps/supervisor`: rc 0.
- `grep -rln mkdtempSync apps/supervisor/test` lists only `test/tmp.ts`.
- The implementer mutation-checked both new signal handlers and restored them byte-for-byte.
- `unverifiable-here` (operator command; there is no Windows host here): on the agent PC, in the run's worktree, run `uv run python tools/verify_host.py`. Expect the `supervisor` lines, with tsc resolving `apps\supervisor\node_modules\.bin\tsc` and no "Resolving dependencies" line. Afterwards, `Get-ChildItem $env:TEMP -Directory -Filter 'tk-verify-supervisor-*'` should find nothing, and the count of `tk-sup-*` folders in `$env:TEMP` should not grow.

**Residual risks.**
- On Windows, finding the `.bin\tsc` shim through PATH is not verified.
- In this sandbox `apps/supervisor/node_modules/.bin` is empty, so a real gate run here would still download TypeScript. The fix relies on a box that ran `bun install`, and the gate itself runs no `bun install` (carried over).
- These carry over from earlier passes:
  - The sbx-tier failures (sandbox 5, delivery 15) are pre-existing in this sandbox; their result on the Windows host is unknown.
  - The win32-only paths are covered by unit tests only.
  - A hard tree-kill of the whole leg still leaks one `tk-verify-supervisor-*` folder per kill (rejected in triage).
- SIGKILL cannot be handled. A `bun test` killed that way outside the gate still leaves its `tk-sup-*`, which the doctor's warning covers.

DRIFT: the gate's timeout uses a `Popen.communicate(timeout=420)` helper instead of `subprocess.run(timeout=420)` — `subprocess.run` cannot kill the win32 tree before killing the child — affects: none
DRIFT: three e2e marker files in `command-line.test.ts` moved into `tempDir` folders — they were `tk-sup-*` entries left in TMPDIR — affects: none
DRIFT: the tsc step tries `bunx` then `bun x`; the line does not say which ran — keeps Settled shape 3's line — affects: none
DRIFT: DW-59/DW-60 carry `origin: spec-deferred 33-4` without a hash — no engine hash available — affects: none
DRIFT: the replan's inode warning in `tk-studio-launch check` deferred as DW-59 — outside AC1/AC2, plan Settled shape 6 — affects: none
DRIFT: the replan's `/tmp/tk-sup-*`/`/tmp/tmp.*` prune at the pin (`pinBeforeClaim`) deferred as DW-60 — outside AC1/AC2, plan Settled shape 6 — affects: none
DRIFT: AC1/CAP-7 "per-run folder under the run's worktree" → per-run folder under the OS temp (`tk-verify-supervisor-<stamp>-<pid>`), outside every git checkout, refused if any ancestor holds `.git` — `queueDbPath` refuses queue DBs inside a checkout (apps/supervisor/src/queue.ts:152-155), ~30 tests red otherwise — affects: SPEC.md CAP-7, plans/33-4.md Settled shape 2
DRIFT: the read-only removal handler keeps the mode and adds the write bit — a bare S_IWRITE breaks POSIX directory retries — affects: none
DRIFT: the post-kill pipe read is bounded by a new DRAIN_TIMEOUT of 10 s — a held pipe must not cost 60 s per file — affects: none
DRIFT: a refused or uncreatable temp folder skips files and tsc and prints `0 files … slowest none` — nothing runs without the isolated folder — affects: none
DRIFT: an empty supervisor_files() refuses with `== supervisor: no test/*.test.ts files under <path>` and fails with the pinned `0 files … slowest none` closing line — a gate that runs nothing must not pass (follow-up review) — affects: none

## Reconcile

### 2026-10-26 — no-impact

- Score: 2
- Reasoning: The one DRIFT that affects anything moves the gate's per-run TMPDIR from `<worktree>/.verify-tmp/` to `<OS temp>/tk-verify-supervisor-<stamp>-<pid>/`. It names only this story's own AC1 wording, SPEC.md CAP-7 (and its design note) and plans/33-4.md Settled shape 2. `queueDbPath` refuses a queue DB inside a git checkout (`apps/supervisor/src/queue.ts:152-155`), so the move was forced, and the consult accepted it at score 2. AC1's purpose is kept: an isolated per-run folder that the gate removes. No later story (33-5 to 33-8) or later epic depends on the folder's location. 33-8 runs `verify.host` "exactly as the close-out does" in a fresh worktree it removes, and that still holds. Every other DRIFT says `affects: none`.
- Affected: none
- Invariant: none. No AD, contract surface or operator ruling names the folder. SPEC.md CAP-7's design note ("`<worktree>/.verify-tmp/…`") is now stale. That note is a planner-settled shape, not a ruling, and this gate does not edit SPEC.md. The retrospective should correct it.


Gate: Part A no-impact; Part B story accepted, planned 33-5-the-roster-gate-inside-the-engine-tracked
