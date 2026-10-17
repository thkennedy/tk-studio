---
title: 'One Checkout Lock for a Nested Project and Its Repository'
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_revision: '5889efe6c0893ece4cb9f708a47724be33c60537'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-28/plans/28-5.md'
warnings: [oversized]
deferred:
  - summary: >-
      A nested run live across the upgrade still holds its lock under its project-root key, so a new repository-root run claims under the git top-level key and the two can run at once until it ends.
    evidence: |-
      lockKeyOf falls back to run.checkout for rows minted before the lock_checkout column (spec Always); a pre-migration live run of apps/supervisor keeps locks.checkout = checkoutKey(apps/supervisor) while a post-migration repo-root run keys checkoutKey(<repo>). Transient: needs a live nested run across the supervisor restart that migrates. DEFERRAL DISCIPLINE (a): AC2's serialisation. Edge-case-hunter, review pass 2026-10-17.
    location: >-
      apps/supervisor/src/queue.ts lockKeyOf / ADDED_RUN_COLUMNS migration
    severity: low
---

<intent-contract>

## Intent

**Problem:** The supervisor keys its checkout lock by the project root (`checkoutKey`, `apps/supervisor/src/queue.ts`), so a run on `apps/supervisor` and a run on the repository root never wait on each other although they are one git checkout. A run of a nested project also cuts a worktree of the whole repository and serves its top level (DW-25).

**Approach:** Resolve the root's git top-level and prefix once per submission and record both on the run. Key only the lock by the canonical, case-folded top-level (`checkout` stays the job's project-root identity). Serve `<worktree>/<prefix>` wherever the run acts as the project; keep the worktree top for the git motions.

Story 28.5 acceptance criteria, transcribed verbatim from `_bmad-output/planning-artifacts/epics.md`:

- **AC1.** **Given** a project whose registered root is nested inside a git checkout (`apps/supervisor` under `C:\GitHub\tk-studio`) **When** a run is enqueued, claimed, or looked up as live (`checkoutKey`, `enqueue`, the locks table, the live-run and lock lookups in `queue.ts` and `cli.ts`, the sandbox probe in `sandbox.ts`) **Then** the lock's key is the canonical, case-folded git top-level of the root (`git rev-parse --show-toplevel`, resolved once per submission and recorded on the run), never the project root itself; a root that is not inside a git checkout keys by itself, as today; the lock row and the status page still name the project root that holds it.
- **AC2.** **Given** a queued run for the nested project and a queued run for the repository root **When** `drain` or a tick claims one **Then** the other waits on the same lock (`holder` names the first run) and the two never run at once; `bun test` from `apps/supervisor` pins it with a nested fixture, the case-folded spelling included on win32.
- **AC3.** **Given** a project whose registered root sits below its git top-level (`apps/supervisor`) and a run the supervisor prepares for it **When** the worktree is cut and the run is invoked (`prepareWorktree` and the invocation root in `apps/supervisor/src/worktree.ts` and `cli.ts`; DW-25) **Then** the root the run serves is `<worktree>/<prefix>` with the prefix from `git rev-parse --show-prefix` of the project root (the worker's cwd, `payload.directory`, the sbx VM path, the `verify.host` read at the run's base), never the worktree's top level; a project at its git top-level is unchanged; `bun test` from `apps/supervisor` pins both cases.
- **AC4.** **Given** runbook §4 and the deferred-work ledger **When** the story closes **Then** §4's lock row says the lock is per git checkout and names the served subpath; DW-25 is closed; and 28.3's AC2 (the serialisation) and AC3's live clause (the project served) are satisfied by reference to this story.

## Boundaries & Constraints

**Always:**
- `runs.checkout` / `jobs.checkout` stay the project-root key (job identity: `jobs` PK `(job_id, checkout)`, `runs_one_live (job_id, checkout)`, `enqueue`'s adopt-the-live-run lookup). The lock key is a NEW run column beside it (e.g. `lock_checkout`), plus a prefix column (`""` at the top). Planner's ruling.
- One rule for the lock key (`lockKeyOf(run)`): the run's lock column, falling back to `run.checkout` for rows minted before the migration (pinned by one test).
- `locks.checkout` (PK) holds the lock key; `locks.root` keeps the holder's project root, so the lock row and status page name the project.
- The git read at submission is argv-only (`runProcess`), bounded by a short timeout; any failure keys by `checkoutKey(root)` with prefix `""` and never refuses the submission. Canonicalise `--show-toplevel` (forward slashes on win32) before `foldCase`.
- `run.worktree` stays the worktree top for git work (`worktreeAddArgv`, push/PR in `closeOut`, `git worktree remove`).
- Verify gate: `bun test` and `bun run typecheck` from `apps/supervisor`, plus the studio gate from `plugins/tk-studio/lib` (unittest discover; conformance `ok: true`).

**Block If:**
- The lock key cannot be separated from the job identity without changing `jobs`/`runs_one_live` (never re-key `checkout`) → HALT and consult.
- A driver-contract or conformance-schema surface would change (e.g. `/status` payload shape) → HALT (AD-19).
- The Files list below must grow → HALT and record oversize (the operator's `bmad-correct-course`, never a split here).

**Never:**
- Change the starter lock (`writeStarterLock`/`writeStarterLocks`, per project, `checkout: checkoutKey(root)`); `command-line.test.ts:519` and `sandbox.test.ts:829` stay green unchanged.
- Re-key `liveRun`/`mine` in `cli.ts` (they match a job on a project, not the lock).
- Touch `apps/supervisor/_bmad-output/.../deferred-work.md` (its unrelated DW-25), `epics.md`, `stories.yaml`, routing/policy files; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nested root | root `<repo>/apps/sup` | lock key = foldCase(canonical(`<repo>`)), prefix `apps/sup/`; `locks.root` = project root | none |
| Top-level root | root `<repo>` | lock key = checkoutKey(`<repo>`), prefix `""`; served = worktree top (unchanged) | none |
| Not in git | root outside any checkout | lock key = checkoutKey(root), prefix `""` | git non-zero/timeout → fallback, submission accepted |
| Nested + root queued | two runs, same repo | second claim waits, `holder` names the first | none |
| win32 spelling | `C:\GitHub\TK-Studio` vs `c:/github/tk-studio` | one key via `checkoutKey(…, "win32")` | none |
| Pre-migration row | run with null lock column holding a lock | lock sites use `checkout` | none |
| Resumed / swept nested run | resume path, engine-end sweep, closeout | read `<worktree>/<prefix>/.bmad-loop`, never the outer one | none |

</intent-contract>

## Code Map

All paths under `apps/supervisor/` unless rooted. Full detail: `plans/28-5.md` Code Map (the paid investigation; line numbers verified at HEAD 5889efe).

- `src/queue.ts` -- `canonicalPath`/`foldCase`/`checkoutKey` :100-127 (reuse for the top-level); schema :584-614; `ADDED_RUN_COLUMNS` :663 (migration path for the two new columns); `engineRoot` :725 (must return the served root); `lock(root)` :888 (take the run or lock key; called by `api.ts:216` with `run.root`); `enqueue` :1012-1060 (store the new columns, keep the `(job_id, checkout)` live lookup); `recordExternal` :1479-1500 (columns optional). Every locks site to move to `lockKeyOf(run)`: :889, :1188-1194, :1210, :1403-1408, :1448, :1576, :1596, :1635-1644, :1667-1677, :1751, :1941-1955, :2102, :2127-2134, :2225-2233.
- `src/cli.ts` -- `projectIdOf` :327 (file-read pattern); enqueue sites :755 (`submit`/`POST /jobs`) and :1032 (`run`/`drain`): resolve top-level + prefix before `queue.enqueue`; `liveRun` :338-341 and `mine` :994-995 stay by `checkout`; `workRoot` :1051-1054 → invoke cwd :1922, `vmHostRoot` :1927; resume path :1701 (`workRoot: run.worktree` → served root); `meteredCost` :1221.
- `src/hostverify.ts` -- `runProcess` usage :77-78 (argv runner to reuse); `verifyCommand` :67-92 reads `git show <base>:<prefix>.tk-studio/config.yaml` from `run.root`; `hostVerify` cwd :125-128 → served root.
- `src/worktree.ts` -- `materialise` :208-235 (`install_base.py --directory`, drift check, `COPIED_RUNTIME` targets → `<worktree>/<prefix>`; sources already the project root); `prepareWorktree` :238-300 returns the served root at :248/:299, sbx `toVmPath` check :291 holds for the served path; `meteredCost` :307, :482; `engineStatus` :560 and `sweepEngines` :615-660 read `<served>/.bmad-loop/runs/<id>`.
- `src/closeout.ts` -- served root for `findSpec` :128, `runDirOf` :240, meter harvest :246, bmad-loop archive :262-263 (host and VM), `meteredCost` :308, :384-388, :473-479; push/PR :350-375 stay on `run.worktree`.
- `src/sandbox.ts` -- `lookupEnginePid(run.worktree, …)` :244, :356 → served root. Starter lock :370-430 untouched: it answers AC1's "sandbox probe" as per-project (planner's ruling).
- `src/api.ts` -- :216 lock lookup by the run.
- `src/page.ts` -- `holderOf` :32, `KeptLock` :47-66 read `locks.root`; modify only if the page reads the lock by `run.root`.
- `test/fakes.ts` -- `gitInit` :295, `gitRepo` :309; nested fixture: `gitRepo({"apps/sup/.tk-studio/config.yaml": "project_id: sup\n"})`, root `join(checkout, "apps/sup")`.
- `test/queue.test.ts` -- `checkout lock` describe :431 (two owners, `claim`, `holder`) is the AC2 pattern; win32 skip style :961-977; case-fold via `checkoutKey(…, "win32")` injection.
- `test/worktree.test.ts` -- `fixture()` :20 (AC3 pattern); engine-end sweep describe :275; Story 27.4 host-verify describe :474 (prefixed `verify.host` read).
- `kb/agent-pc-setup-runbook.md` -- §4 :928; intro :932 ("a lock per checkout"); add a `Checkout lock` row in §3.8 "Supervisor runs" table style.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-25 :180-186, set `status: closed` naming Story 28.5.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/queue.ts` -- add run columns (lock key, prefix) via `ADDED_RUN_COLUMNS`; `lockKeyOf(run)` with `checkout` fallback; move every locks site to it; `lock()` by the run/key; `engineRoot` → served root; `enqueue` stores the columns -- AC1, AC2.
- `apps/supervisor/src/cli.ts` -- bounded argv git read (`--show-toplevel`, `--show-prefix`) at both enqueue sites, fallback on failure; `workRoot` and resume path → served root; `meteredCost` -- AC1, AC3.
- `apps/supervisor/src/worktree.ts` -- served-root helper (e.g. `servedRoot(run)`); `prepareWorktree`, `materialise`, `engineStatus`/`sweepEngines`, `meteredCost` -- AC3.
- `apps/supervisor/src/hostverify.ts` -- prefixed `git show`, served cwd -- AC3.
- `apps/supervisor/src/closeout.ts` -- served root for spec, run dir, harvest, archive, cost -- AC3.
- `apps/supervisor/src/sandbox.ts` -- `lookupEnginePid` calls on the served root only -- AC3.
- `apps/supervisor/src/api.ts` -- lock lookup by the run -- AC1.
- `apps/supervisor/src/page.ts` -- only if it reads the lock by `run.root` -- AC1.
- `apps/supervisor/test/fakes.ts` -- nested repo helper only if `gitRepo` with files does not suffice.
- `apps/supervisor/test/queue.test.ts` -- nested and root share one lock (holder names first, never concurrent); non-git root keys by itself; win32 case-folded spelling; pre-migration fallback; lock row names the project root -- AC1, AC2.
- `apps/supervisor/test/worktree.test.ts` -- nested served root (prepareWorktree answer, `install_base.py --directory` argv, copied runtime under `<wt>/<prefix>`), top-level unchanged, prefixed `verify.host` read, engine-end sweep under the prefix -- AC3.
- `kb/agent-pc-setup-runbook.md` -- §4 lock row (per git checkout; nested project and repository share it; run serves `<worktree>/<prefix>`); amend :932 -- AC4.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-25 closed by Story 28.5 -- AC4.

**Acceptance Criteria:**
- Given AC1–AC4 above, when the verify gate runs, then each is proven by a named `bun test` case or a command whose output shows it.
- Given 28.3's AC2 and AC3 live clause, when this story closes, then they are satisfied by reference to this story (recorded in the runbook/ledger close-out and the Auto Run Result); attended Windows check stays `unverifiable-here`.

## Spec Change Log

## Review Triage Log

### 2026-10-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 1, medium 1, low 1)
- defer: 1 (high 0, medium 0, low 1)
- reject: 1 (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[patch]` The status page's lock card printed only `locks.checkout` (now the git top-level), so a nested holder was named by the repository root (AC1). `page.ts` now titles the card with `locks.root`, the checkout as a secondary line; test in `queue.test.ts`. Consult ruling `apply` (`api.ts` unchanged, not an AD-19 surface).
  - `[medium]` `[patch]` AC3's worker cwd, `payload.directory` and sbx VM path were not asserted for a nested run. Two tests in `worktree.test.ts` drive `finishRun` → real `invokeSkill` (host and sbx); the resume path is pinned through `servedRoot` (consult: accept).
  - `[low]` `[patch]` `engineState()` spliced the raw prefix into `:(exclude,glob)` pathspecs; `globLiteral()` now escapes `* ? [ ] \`; unit and real-repo `apps/s[u]p` tests.
- deferred: pre-migration live nested lock across the upgrade (DEFERRAL DISCIPLINE (a), AC2), in frontmatter `deferred`.
- rejected: `resolveCheckout` falls back silently (no event records it) — the spec's Always rules a silent key-by-root fallback that never refuses; no AC names a trace.
- matrix audit: every I/O row has a passing test; the "Resumed" row's resume path is pinned through the shared `servedRoot` helper (sweep and close-out driven directly).

### 2026-10-17 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 2 (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` An engine-kind lock's card was titled with `locks.root`, which `handToEngine` writes as `engineRoot(run)`, the served worktree path. So a launched nested run's lock never named its project root (AC1). Both layers reported this. `page.ts` now titles an engine lock with `queue.get(l.run_id)?.root`, falling back to `l.root`. The test is in `queue.test.ts`, covering the nested project root and the fallback.
  - `[low]` `[patch]` `closeOut`'s PR-body cost fallback read `meteredCost(wt, …)` at the worktree top, so a nested run's PR body lost its metered cost whenever the caller passed no `costUsd`. `closeOut`'s run Pick now carries `prefix`, and the fallback reads at `servedRoot(run)`. The test is in `worktree.test.ts`: $2.50 at the served root against a $9 decoy at the top.
- rejected: DW-26 understates the pre-migration fallback's reach (queued or paused nested rows, not only live ones). The fallback to `checkout` is the spec's Always, and the gap is already deferred as DW-26. The ledger entry belongs to the orchestrator and is not rewritten here.
- rejected: `resolveCheckout` falls back silently when rev-parse fails or times out inside git. The spec's Always rules a key-by-root, prefix `""` fallback that never refuses. This was rejected in the first pass too.

## Design Notes

AC1 row-by-row answer: `checkoutKey` reused for the top-level; `enqueue` records lock key + prefix; the locks table keyed by the lock key with `root` = holder's project; live-run lookups (`liveRun`, `mine`, `enqueue` adopt) stay on `checkout` because they identify a job on a project, not the lock; the lock lookups (`lock()`, `api.ts:216`, every locks site) use `lockKeyOf(run)`; the sandbox probe (starter lock) stays per project.

## Verification

**Commands:**
- `cd apps/supervisor && bun install --frozen-lockfile && bun test` -- expected: green, the new nested cases passing.
- `cd apps/supervisor && bun run typecheck` -- expected: clean.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `grep -n "DW-25" -A6 _bmad-output/implementation-artifacts/deferred-work.md` -- expected: `status: closed`.
- `git diff --stat` -- expected: no file outside the 13 listed.

**Manual checks (unverifiable-here):**
- On the agent PC: `bun test` from `C:\GitHub\tk-studio\apps\supervisor`; then two queued runs, `--directory C:\GitHub\tk-studio\apps\supervisor` and `--directory C:\GitHub\tk-studio`: the second shows `lock-wait` naming the first on `/status`.

## Deviation Summary

### pass 1 (2026-10-17, implementer)

- planned: closeout.ts changes limited to the Code Map sites / actual: also prefixed the engine-state excludes in `commitStep`'s `git add` (`:(exclude,glob)<prefix>.bmad-loop/...`) / why: the excludes are relative to the worktree top, so a nested run's `.bmad-loop/runs` and copied runtime would otherwise be committed by the paused-run pass / may affect: none
- planned: every locks site moves to `lockKeyOf(run)` / actual: also changed `claimProbes`' job-definition fallback from `lock.checkout` to `checkoutKey(lock.root)` / why: `locks.checkout` now holds the git top-level, not the job's identity / may affect: none
- planned: served-root helper in `worktree.ts` / actual: `servedRoot` and `lockKeyOf` live in `queue.ts` / why: `engineRoot` in `queue.ts` needs it; defining it in `worktree.ts` would create an import cycle / may affect: none
- planned: `bun install --frozen-lockfile` + `bun run typecheck` / actual: typecheck run as `bun node_modules/typescript/bin/tsc --noEmit` / why: the sandbox's `node_modules` holds Windows shims (EPERM on link, `tsc` not on PATH) / may affect: none

DEVIATION SCORE: 1

DRIFT: commitStep excludes prefixed with `<prefix>` in closeout.ts — the nested run's engine state would otherwise be committed by the paused-run pass — affects: none
DRIFT: claimProbes' job-definition fallback reads `checkoutKey(lock.root)` instead of `lock.checkout` — `locks.checkout` now holds the lock key, not the job identity — affects: none
DRIFT: `servedRoot`/`lockKeyOf` defined in queue.ts, not worktree.ts — `engineRoot` needs it and worktree.ts imports queue.ts (cycle) — affects: none
DRIFT: typecheck via `bun node_modules/typescript/bin/tsc --noEmit` — sandbox node_modules holds Windows shims — affects: none

### pass 2 (2026-10-17, review patches)

- planned: patch 3 adds a small test for an escaped prefix / actual: also exported `engineState` from `closeout.ts` and refactored the existing nested paused close-out test into a helper `pausedCloseOutNested(nested)` reused by an `apps/s[u]p` case / why: to check the built pathspec directly and run the full close-out without duplicating ~30 lines / may affect: none
- planned: patch 2 covers the resume path through a seam / actual: `rebuildStarted`'s `workRoot` is pinned only by the value `servedRoot(run)`; resume itself is not driven / why: `rebuildStarted` is not exported and calls `validate()` (registry, `runJobVerb resolve`), not injectable from the Files' test files / may affect: none

DEVIATION SCORE: 1

DRIFT: `engineState` exported and paused close-out test refactored into `pausedCloseOutNested` — test the escaped pathspec and reuse the real-repo close-out — affects: none
DRIFT: resume path (`rebuildStarted`, cli.ts:1724) pinned through `servedRoot(run)`, not by driving resume — not reachable from test files on the plan's Files — affects: none

## Consult Log

- 2026-10-17T04:41Z — trigger: deviation-gt-0 — question: accept the implementer's four score-1 deviations (commitStep prefixed excludes; claimProbes fallback via checkoutKey(lock.root); servedRoot/lockKeyOf in queue.ts; tsc via bun launcher), and is the claimProbes fallback safe for nested engine locks? — ruling: accept-deviation score 1 — do: Keep all four deviations as implemented. Add one test (in a file already on the plan's list) for item 1: a nested run with a non-empty prefix whose served root holds .bmad-loop/runs/... and a copied-runtime file closes out with none of them staged. Re-run the verify gate after adding it. — rule candidate: When a lock's key is no longer the job's identity, look up a job's definition from the run row or checkoutKey(lock.root) for run-kind locks, never from locks.checkout; any git pathspec built for a served root carries the run's prefix.
- 2026-10-17T04:49Z — trigger: high-severity-finding — question: the status page renders only locks.checkout (now the git top-level), not the holder's project root (AC1); patch page.ts or bad_spec loopback, and does /status locks[].checkout's changed value hit the AD-19 Block If? — ruling: apply — do: Patch page.ts so the lock card is titled with the holder's project root (root: l.root in KeptLock and the push at :227; print t(l.root) at :419; l.checkout may stay as a secondary line); add a test in a file on the plan showing the card names apps/sup's project root. Leave api.ts:229 as is; add no field. Re-run the verify gate. — rule candidate: When a story changes what a stored key means, the Code Map lists every place that renders or serialises that column; an unpinned /status field whose value changes while its shape stays the same is not an AD-19 surface change.
- 2026-10-17T04:57Z — trigger: deviation-gt-0 — question: accept the review-patch pass's score-1 deviations (engineState exported + pausedCloseOutNested test helper; resume path rebuildStarted pinned only via servedRoot(run), driving it needs a test file outside Files)? — ruling: accept-deviation score 1 — do: Keep both deviations as implemented. Do not add a test in command-line.test.ts or resume.test.ts; record in the Auto Run Result that rebuildStarted's workRoot: servedRoot(run)! (cli.ts:1724) is pinned through the shared servedRoot helper, not by driving resume. Re-run the verify gate after any edit, then continue to close-out. — rule candidate: When a Code Map call site can't be tested without a file outside the plan's Files, it counts as pinned through the shared helper it calls, named so in the Auto Run Result; don't widen Files for it.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review pass on the done story (the first pass recommended one). The story keys the checkout lock by the canonical, case-folded git top-level, so a nested project and its repository share one lock (AC1, AC2). It serves `<worktree>/<prefix>` for a nested run (AC3, DW-25), keeps `checkout` as the job's project-root identity, adds runbook §4 rows, and closes DW-25 (AC4). This pass fixed two gaps in the story's own change:
- An engine-held lock's card now names the handing run's project root, not the served worktree path (AC1).
- `closeOut`'s PR-body cost fallback now reads the metered cost at the served root.

**Files (this pass):**
- `apps/supervisor/src/page.ts`: an engine-kind lock is titled with its run's project root (`queue.get(l.run_id)?.root ?? l.root`).
- `apps/supervisor/src/worktree.ts`: `closeOut`'s run Pick carries `prefix`. The cost fallback reads `meteredCost(servedRoot(run)!, …)`. Git motions stay at `wt`.
- `apps/supervisor/test/queue.test.ts`: an engine lock for a nested run is titled with the project root, and with the lock root when the run is gone.
- `apps/supervisor/test/worktree.test.ts`: with no `costUsd`, the PR body carries the cost from `<wt>/<prefix>/.bmad-loop/runs/<id>/run.json`, not the decoy at the top.

The story as a whole still touches 12 of the plan's 13 Files, plus this spec. The first pass's file list stands.

**Review:** blind-hunter and edge-case-hunter (band L). 2 patches applied (medium 1, low 1), 0 deferred, 2 rejected. Reasons are in the Review Triage Log.
**Follow-up review recommended:** false. Patched counts: high 0, medium 1, low 1. Score: 3×1 + 1×1 = 4, below 5.

**Verification** (re-run by this session after the patches):
- From `apps/supervisor`, `bun test`: 872 pass, 5 skip, 0 fail.
- From `apps/supervisor`, `bun node_modules/typescript/bin/tsc --noEmit`: exit 0.
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: 1363 tests, OK (1 skipped).
- From `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- DW-25 still shows `status: closed 2026-10-17 — Story 28.5`.
- `git diff --stat` from the baseline shows 13 files: the 12 planned Files plus this spec.
- The implementer reports that each new test fails when its source fix is reverted.
- Unverifiable here (attended, on the agent PC): run `bun test` from `C:\GitHub\tk-studio\apps\supervisor`. Then queue two runs, `--directory C:\GitHub\tk-studio\apps\supervisor` and `--directory C:\GitHub\tk-studio`. On `/status`, the second should show `lock-wait` naming the first.

**Residual risks:**
- Pre-migration rows still key by `checkout` (DW-26, open). That covers queued or paused nested rows as well as live ones, until they end.
- `bun install --frozen-lockfile` and `bun run typecheck` can't run in this sandbox because `node_modules` holds Windows shims. tsc was run directly.

This pass added no deviations, so `deviation_score` stays at the first pass's 1. The first pass's DRIFT lines remain in `## Deviation Summary`:
DRIFT: commitStep excludes prefixed with `<prefix>` in closeout.ts — the nested run's engine state would otherwise be committed by the paused-run pass — affects: none
DRIFT: claimProbes' job-definition fallback reads `checkoutKey(lock.root)` instead of `lock.checkout` — `locks.checkout` now holds the lock key, not the job identity — affects: none
DRIFT: `servedRoot`/`lockKeyOf` defined in queue.ts, not worktree.ts — `engineRoot` needs it and worktree.ts imports queue.ts (cycle) — affects: none
DRIFT: typecheck via `bun node_modules/typescript/bin/tsc --noEmit` — sandbox node_modules holds Windows shims — affects: none
DRIFT: `engineState` exported and paused close-out test refactored into `pausedCloseOutNested` — test the escaped pathspec and reuse the real-repo close-out — affects: none
DRIFT: resume path (`rebuildStarted`, cli.ts:1724) pinned through `servedRoot(run)`, not by driving resume — not reachable from test files on the plan's Files — affects: none

## Reconcile

- 2026-10-17 — score 1; reconcile not required.

Gate: Part A not-required; Part B epic complete: no next story (28-5 accepted; AC1–AC4 met; attended agent-PC lock-wait check unverifiable-here)
