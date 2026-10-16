---
title: 'Every Run Gets Its Own Worktree and Ends in a PR'
type: 'feature'
created: '2026-10-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_commit: 'aa2bdf3c66a5dfb705e4afa46f315e59e50c7524'
baseline_revision: 'aa2bdf3c66a5dfb705e4afa46f315e59e50c7524'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-27/plans/27-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-27/operator-decisions.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Today a run works in the registered project checkout. `runJob` claims the checkout lock, then runs `wake` and `claude -p` with the checkout as the root. Two loops can therefore share a working tree, and a run can switch the branch under the running service (hole 16; supersedes Story 23.2).

**Approach:** As the operator, I want each run to work in a git worktree of the project cut from its base, and to end as a pull request against that base. Then two loops never share a working tree, a run never switches the branch under a running service, and all agent work arrives PR-only.

**Acceptance Criteria (authoritative, transcribed verbatim from epics.md Story 27.1):**

- **AC1:** **Given** a submission with `base_ref` **When** the run is claimed **Then** the supervisor creates `git worktree add <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>` from the project checkout, refuses a `base_ref` that is the repository's default branch when that branch is not protected on GitHub (`blocked`, naming it), and records the worktree path on the queue run; the checkout itself is never switched
- **AC2:** **Given** the untracked runtime the engine needs in a worktree (`_bmad/` at the pin, `.bmad-loop/policy.toml` and `routing.current.json`, the project's local config overlay) **When** the worktree is prepared **Then** the supervisor materialises them by the studio's own motions (`tk install` at the pin inside the worktree; the policy and routing files copied from the checkout; never a junction into the checkout), `tk activate` is clean inside the worktree, and the engine's `--project` is the worktree
- **AC3:** **Given** a run that launched an engine **When** the engine completes, pauses, or is stopped **Then** the supervisor pushes the run branch and opens a PR against `base_ref` whose body carries the launch status block, the engine run id, the landed commits and the metered cost, records the PR URL on the `ended` event, opens no PR when no commit landed ("no changes" recorded), never force-pushes and never merges; the worktree is removed after the PR opens unless the run is paused (a paused run keeps it for the resume)
- **AC4:** **Given** the supervisor's test suite on the Windows host and the Linux engine **When** it runs **Then** worktree creation, the unprotected-base refusal, the runtime materialisation and the PR body are pinned against a fake `gh` and a real throwaway repository, and the live acceptance on the-universe-awaits (Story 23.3) is re-planned against this story

## Boundaries & Constraints

**Always:**
- Operator decisions are settled. Do not consult on them.
  - §2: `tk-studio-launch` returning writes a `launched` event (status block, engine run id). The run stays `running` and live for the pacer. `ended` is written once, after the close-out, and carries the PR URL. A paused engine leaves the run `paused`, keeps its worktree and the lock, and opens the PR as a **draft**, with the URL on the `paused` event. The PR is marked ready at `ended`. A launch that returns `blocked` ends the run at once ("no changes" when nothing landed).
  - §3: a submission without `base_ref` resolves it at claim. Try `git symbolic-ref --short refs/remotes/origin/HEAD` in the checkout first (strip `origin/`), then `gh repo view --json defaultBranchRef`. Record it as `base_ref` with `base_ref_source: default`, and run the same protection check. No flag keeps the in-checkout path.
  - §5: always run `git worktree add --relative-paths …`. The worktree's `.git` file holds a relative `gitdir:`, and the suite pins it.
- The worktree lies at `<TK_SUPERVISOR_WORK>/worktrees/<project_id>/<queue run_id>` on branch `supervisor/run-<queue run_id>`. A missing `TK_SUPERVISOR_WORK`, or a work folder inside the project root, ends the run `blocked` naming it (reuse `workDir`, `WorkDirMissing`, `isWithin`).
- Every prepare failure ends the run `blocked`, naming the step: add, protection, install, copy, activate drift, or a VM path that is not visible. It never falls back to the checkout.
- The registry, `wake` and the checkout lock keep the registered root (`v.root`, `checkoutKey(root)`). Only the worker's cwd, `payload.directory` and the sbx VM path become the worktree. The lock stays per checkout (plan: Block If, lock key; recorded, not changed).
- `git` and `gh` run through argv-only spawners (`runProcess`). There is no shell.
- The local config overlay is `.tk-studio/config.local.yaml`. It is copied when present and skipped silently when absent (SPEC design notes).

**Block If:**
- The Files list must grow past the plan's 9 files (the 8 listed plus `test/command-line.test.ts`, which the operator accepted on 2026-10-16). HALT `blocked` and record it for `bmad-correct-course`.
- The story is silent on a choice that observably changes behaviour, and no operator decision settles it.

**Never:**
- `git push --force`, `-f`, `--force-with-lease`, `gh pr merge`, any `merge`, or `checkout`/`switch` run in the project checkout.
- A junction, symlink or `mklink` into the checkout.
- Changes to the studio plugin, the driver contract, `epics.md`, `stories.yaml`, `.bmad-loop/policy.toml`/`routing.toml`, or anything under `supervision/`.
- A machine path in a tracked file. A credential in an event, log or PR body.
- Running real `gh` or the network in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | claimed run, `base_ref` = a feature branch | worktree at the layout path, branch `supervisor/run-<id>`, path recorded on the run, `.git` gitdir relative, checkout HEAD unchanged | — |
| Unprotected default | `base_ref` = default branch, `gh` says unprotected | no worktree | run `blocked`, reason names the branch |
| No base_ref | submission omits it | resolved to the default branch, `base_ref_source: default`, protection checked | unprotected → `blocked` |
| Materialise | fresh worktree | `install_base.py --directory <wt>` ran; policy, routing and overlay copied when present; `drift_check.py` result `clean` | install fail or drift → `blocked` naming the step |
| Engine completes with commits | launched, engine finished, commits ahead of base | push (no force), `gh pr create --base <base_ref>`, body has status block, engine run id, commits, cost; `ended` with `detail.pr`; worktree removed | push/PR fail → recorded on `ended`, worktree kept |
| No commits | engine ended, 0 commits ahead | no push, no PR, "no changes" on `ended`, worktree removed | — |
| Paused | `launch.py status` reports a pause | push, draft PR, URL on `paused` event, worktree and lock kept | — |
| Blocked launch | launch status block `blocked` | `ended` at once ("no changes" when nothing landed) | — |

</intent-contract>

## Code Map

The plan's Code Map (`plans/27-1.md`) is the investigation. Its anchors still match HEAD `aa2bdf3`:

- `src/cli.ts` -- `runJob` :697. After the claim (:752), and before `snapshotOnce`/`drive` (:767-768), prepare the worktree and drive with it as the worker root. `drive` :781 → `startRun` :978 (wake on the registered root, unchanged) → `finishRun` :1397 (worker cwd and `payload.directory` → worktree). `mirror` :836 writes `ended` via `queue.endDriven`, with `prUrl` and `launchedEngine` :820. For a launch run with an engine, write `launched` and defer the end. `RunOptions.baseRef` comment :238 retires "no branch is cut". `recoverQueue` :453 and `drainQueue` :481 already call `sweepEnds`, so hook the engine-end sweep beside them (the tick runs `recoverQueue`).
- `src/server.ts` -- `invokeSkill` :1028 (`vmRoot = toVmPath(...)` :1037, `payload.directory` default :1041): root = worktree, VM path = `toVmPath(worktree)`. `buildSbxCommand` :519 (`env -C`). `runUv` :340, `runProcess` :270 to reuse.
- `src/queue.ts` -- DDL :566 plus the additive column list :630: add `worktree TEXT` (and `base_ref_source` if needed) and a recorder beside `recordRunOptions` :913. `QueueRun` :425-442. `handToEngine` :1196, `claim` :955-1010, `launchStatusProbe` :232. `endDriven` `detail` carries `pr`. A `launched`/`paused` event and a paused state on the run.
- `src/hygiene.ts` -- the model for the new module: `snapshotOnce` (once per run, path recorded, failure → `blocked` naming the step), `isWithin` :78, `HygieneDeps` :282 injection, `sweepEnds`.
- `src/env.ts` -- `workDir` :298, `WorkDirMissing` :292 (extend the wording to worktrees). `pluginRoot()` for the studio scripts.
- Studio motions -- `uv run <plugin>/skills/tk-studio-install/scripts/install_base.py --directory <wt>` (JSON), `uv run <plugin>/skills/tk-studio-activate/scripts/drift_check.py --directory <wt>` (`result: clean`), `uv run <plugin>/lib/launch.py status --directory <wt> --run-id <id>` (`run.status` in finished/stopped/interrupted/crashed means ended; `paused_stage`/`paused_reason` means paused).
- `test/fakes.ts` -- `fakeBin` :44, for a fake `gh` that records argv. `test/hygiene.test.ts` holds the pins to mirror. `test/command-line.test.ts` -- the `e2eFixture` runs need a git repo with a bare `origin`, `TK_SUPERVISOR_WORK`, fake `gh`, and fake install and drift scripts. The launch-lifetime pins (~:1011, ~:1044) move from `ended` at launch return to `launched`.

## Tasks & Acceptance

**Execution:**
- `src/worktree.ts` (new) -- the base_ref resolution (§3), the default-branch protection check through `gh`, `git worktree add --relative-paths`, materialisation (install, copy, drift), and the close-out (commits ahead, push without force, `gh pr create [--draft]` with the body, `gh pr ready` at end, `git worktree remove`). Deps are injected like `HygieneDeps`.
- `src/queue.ts` -- the `worktree` (+ `base_ref_source`) columns and recorders; `launched` and `paused` events; a paused run keeps its lock; `ended` detail `pr` / `no_changes`.
- `src/cli.ts` -- prepare after the claim, drive in the worktree, the deferred end for launch runs, and the engine-end sweep in `runJob`/`recoverQueue`/`drainQueue`.
- `src/server.ts` -- `invokeSkill` root and VM path from the worktree.
- `src/env.ts` -- the `WorkDirMissing` wording.
- `test/fakes.ts` -- a fake `gh` helper (argv log, scripted answers for repo, protection and PR).
- `test/worktree.test.ts` (new) -- every I/O-matrix row against a real throwaway repo with a bare origin, plus the fake `gh`. Pin the `.git` relative gitdir, that no argv contains `--force`/`-f`/`merge`, and that the checkout HEAD is unchanged.
- `test/command-line.test.ts` -- the fixture and the launch-lifetime pins as above.
- `README.md` -- the run flow, `TK_SUPERVISOR_WORK` required for runs, the worktree layout.
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` -- a `## Story 27.1` section with the Story 23.3 re-plan note (operator-decisions §4; the loop's own hand-over artifact, not a code file).

**Acceptance Criteria:** AC1–AC4 above, each proven by a named test in `test/worktree.test.ts` or `test/command-line.test.ts`. AC4's Story 23.3 re-plan is proven by the hand-over file. Windows-host runs are `unverifiable-here`.

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 6, low 1)
- defer: 0
- reject: 7 (high 0, medium 4, low 3)
- addressed_findings:
  - `[high]` `[patch]` P3: close-out ran while a worker/engine might still be live (mirror with hold_lock; cancel after an unconfirmed stop; live orphan engine never swept). Guarded `closeOutNow` and both callers (`closeout: skipped`, worktree kept), and extended the sweep to close out terminal runs once driver, worker and engine are confirmed dead, using the appended `closing-out` lease and `closed_out` events (consult 2).
  - `[medium]` `[patch]` P1: cancelling a paused run re-ran `gh pr create`. It now reuses the `paused` draft PR and runs `gh pr ready`.
  - `[medium]` `[patch]` P2: the cancel close-out raced the sweep. It now takes the run via `takeForCloseOut`, else skips.
  - `[medium]` `[patch]` P4: a throw after `takeForCloseOut` left the owner set. `releaseCloseOut` now runs in the catch.
  - `[medium]` `[patch]` P5: `paused` was missing from enqueue idempotency and `runs_one_live`. Both are widened, with an index migration.
  - `[medium]` `[patch]` P6: `origin/main` and `refs/heads/main` bypassed the default-branch protection refusal. `baseBranch()` now normalises the ref.
  - `[medium]` `[patch]` P7: a crash between `recordWorktree` and materialise skipped materialise on re-drive. A `materialised` event marker now triggers the rerun.
  - `[low]` `[patch]` P8: the fallback deferred `finish` in `mirror` dropped its outcome. It is now recorded on `ended`, and a non-terminal run finishes `blocked`.
- rejected (one line each):
  - recover orphans launched runs: refuted, `recover` selects `owner_pid IS NOT NULL` (src/queue.ts orphan query).
  - the runs rebuild is unsafe: refuted. No table references `runs`, the triggers are recreated after it, and `runs_one_live` is its only index.
  - no `git fetch` before the cut: AC1 pins the exact `git worktree add … <base_ref>` from the checkout. A remote-only ref ends `blocked` at "add".
  - the run branch is not deleted, and removal deletes `.bmad-loop/runs/<id>`: the branch is the PR head, and AC3 mandates removing the worktree. A failed remove is recorded and the worktree kept.
  - a re-paused draft is not re-pushed: re-pause follows a resume, which is Story 27.3's path.
  - the snapshot targets the checkout: plausible only. The editor-in-the-loop snapshot protects the registered checkout, and no 27.1 criterion names it.
  - an explicit base_ref is blocked when the default branch cannot be resolved: this is the fail-safe direction of the PR-only rule.

### 2026-10-16 — Review pass (follow-up, review_loop_iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 2, medium 4, low 3)
- defer: 0
- reject: 4 (high 0, medium 2, low 2)
- addressed_findings:
  - `[high]` `[patch]` P1: the checkout lock and the engine probe could point at a worktree the close-out had already removed. The probe's `uv` spawn then failed closed, and the checkout stayed locked for good (mirror with no engine named, cancel, late close-out, every later claim). Now `engineRoot` falls back to the run root when the worktree is gone and claims probe `lockRoot()`. A close-out with its engine confirmed dead releases the lock (`keepEngine`, `releaseEngineLock`, a `lock-released` event).
  - `[high]` `[patch]` P2: `mirror` closed out beside an engine named in its status block when the run was not marked `launched` (a `blocked` launch). It now probes the worktree whenever an engine is named. If the engine may be live, it records `closeout: skipped`, keeps the worktree, and the sweep closes it out later.
  - `[medium]` `[patch]` P3: the drive-failure close-out in `runJob` had no skip guard. `endAfterDriveFailure` now asks `closeOutBlocker(…, { asDriver: true })` first.
  - `[medium]` `[patch]` P4: a crash during a sweep's close-out handed the run to `recover`, which ended it orphaned with no close-out. `recover` now leaves runs with a `launched` event to the sweep, which re-takes a dead lease.
  - `[medium]` `[patch]` P5: a close-out's result was lost when the state write after it failed (a cancel won the race, or SQLITE_BUSY). The run then stranded, or a second `gh pr create` ran. The result is now recorded on an appended `closed_out` event (`raced`, or `pending` applied by the next sweep without a second close-out).
  - `[medium]` `[patch]` P6: the PR body on the cancel and late close-out paths lacked the launch status block and the metered cost (AC3). `launchedCloseOutInput` now feeds every path.
  - `[low]` `[patch]` P7: `baseBranch` did not strip `refs/remotes/origin/`. Fixed.
  - `[low]` `[patch]` P8: a tag or SHA as `base_ref` failed only at `gh pr create`. Prepare now ends `blocked` (`worktree base_ref: …`) unless it names a branch.
  - `[low]` `[patch]` P9: `gh` could resolve to an `upstream` remote. Every `gh` call now gets `GH_REPO` parsed from origin's URL.
- rejected (one line each):
  - driver dies after the worker launched an engine but before `markLaunched`: this is the recorded recover-orphan known gap, owned by 27-5 (consult 1).
  - stale local `origin/HEAD` after a default-branch rename: the resolution order (`symbolic-ref`, then `gh repo view`) is operator-decisions §3.
  - materialised runtime not ignored blocks `git worktree remove`: speculative. The studio's install keeps its runtime ignored, a failed remove is recorded and the worktree kept, and `--force` is forbidden by the plan's Verify.
  - crash between `git worktree add` and `recordWorktree`: fails closed. The re-drive ends `blocked` naming "add", and no criterion is affected.

### 2026-10-16 — Review pass (follow-up 2, review_loop_iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 0, medium 3, low 6)
- defer: 0
- reject: 11 (high 0, medium 4, low 7)
- addressed_findings:
  - `[medium]` `[patch]` P1: a close-out retried after `gh pr create` succeeded but was never recorded hit gh's duplicate refusal. The PR URL was then never recorded and the worktree was kept for good. `closeOut` now adopts an open PR for the run branch (`gh pr list --head <branch> --state open --json url`) before it creates one. A failed `pr list` blocks the create, so a PR is never opened twice.
  - `[medium]` `[patch]` P2: a late close-out whose `closed_out` note threw kept its `closing-out` lease while its process lived. The retry after a restart then ran `git log` in the removed worktree and recorded `failed` with no PR. Now `releaseCloseOut` lets go of a terminal run's own lease with an appended ownerless `closing-out` event. When the worktree is gone, `closeOut` reads commits and pushes from the checkout by branch name.
  - `[medium]` `[patch]` P4: the mirror path's PR body showed the launch worker's cost even when the named engine's `run.json` was metered (AC3). It now prefers `meteredCost(worktree, engine)` and falls back to the worker's cost.
  - `[low]` `[patch]` P3: a launched run whose worktree was gone, with no pending record, was probed `unknown` forever and stayed `running`. It is now closed out without a probe and ended with the launch's end.
  - `[low]` `[patch]` P5: the default-branch protection check compared case-sensitively, so `MAIN` could pass on a case-insensitive filesystem. `isDefaultBranch` now ignores case, and the protection check runs first.
  - `[low]` `[patch]` P6: the PR body went on the command line, risking the win32 length limit. It now goes through `--body-file` (a temp file, removed afterwards), and the fake `gh` records the body file's content.
  - `[low]` `[patch]` P7: a base branch only in the checkout failed only at `gh pr create`, after the whole engine run. A bare base found only on origin failed at `add`. Prepare now requires `refs/remotes/origin/<b>` and a literal `base_ref` that resolves to a commit, else it ends `blocked` with `worktree base_ref: …`.
  - `[low]` `[patch]` P8: the README said a late close-out's PR is notified. It now says that PR is recorded only on the appended `closed_out` event.
  - `[low]` `[patch]` P9: cancelling a `queued` run that has a worktree recorded "held by another close-out". It now names the run's state, and the sweep closes it out.
- rejected (one line each):
  - recover-orphan runs get no PR: the recorded known gap, owned by 27-5 (consult 1).
  - a failed deferred `finish` is not retried: the outcome is recorded on `ended`, and no 27.1 criterion names finish retries (residual risk).
  - the engine's terminal status does not set the end state: recorded deviation D9 (27-3, 27-4).
  - `git worktree remove` without `--force` fails on non-ignored runtime: rejected twice before; `--force` is forbidden by the plan's Verify, and a failed remove is recorded and the worktree kept.
  - the run branch is never deleted: rejected before; it is the PR head.
  - no `git fetch` before the cut, so the local base may be stale: AC1 pins the literal `git worktree add … <base_ref>` from the checkout (rejected before).
  - stale local `origin/HEAD`: operator-decisions §3 fixes the resolution order (rejected before).
  - crash between `git worktree add` and `recordWorktree`: fails closed, `blocked` naming "add" (rejected before).
  - a copied runtime file tracked at `base_ref` is overwritten: AC2 mandates copying the policy and routing files from the checkout, and the plan's gitignore facts keep them ignored.
  - the remote-only half of the base-branch finding is folded into P7 (refused at prepare instead of at `add`).
  - the stale-base half of the same finding duplicates the `git fetch` reject above.

## Design Notes

- PR body sections, in order: the launch status block (fenced JSON), `Engine run: <id>`, landed commits (`git log --oneline <base_ref>..HEAD`), metered cost (`run.json` `total_cost_usd`, or "not metered").
- Close-out detection is an active sweep. For each `running` launch run with an engine, or `paused` run, probe `launch.py status` in its worktree, and close out when it has ended. It is idempotent: a PR already recorded is never opened twice.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: success
- `bun test` -- expected: all green
- `bun test test/worktree.test.ts` -- expected: all green
- `bunx tsc --noEmit` -- expected: no errors
- `grep -nE -- "--force|\"-f\"|merge|\"checkout\"|\"switch\"" src/worktree.ts` -- expected: no git/gh argv hits

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- D1 planned: modify `src/server.ts` `invokeSkill` / actual: not touched; `finishRun` passes the worktree as `root` and `vmHostRoot` / why: `invokeSkill` already derives cwd, payload and VM path from those args / may affect: none
- D2 planned: a paused state on the run / actual: new `RunState` `paused`, one-time `runs` table rebuild on open to widen the CHECK constraint / why: SQLite cannot alter a CHECK / may affect: 27-3, 27-5
- D3 planned: lock stays per checkout / actual: key unchanged, but an engine lock's `root` is now the worktree (where the engine is probed); `endDriven` treats `engineRunId: null` as already probed / why: the engine's `--project` is the worktree / may affect: 27-2
- D4 planned: extend `WorkDirMissing` wording / actual: optional `need` argument; snapshot message unchanged / why: `test/api.test.ts` (outside Files) pins the old text / may affect: none
- D5 planned: no new env var / actual: `GH_BIN` added / why: tests must never run the real `gh` / may affect: none
- D6 planned: launch-with-engine writes `launched` / actual: only for runs with a recorded worktree; older runs and direct `mirror` callers end at once / why: pre-story runs have no worktree to sweep / may affect: none
- D7 planned: operator-decisions §2 moves `jobrun finish` to the engine's end / actual: not done; studio run still finished at launch return, only the queue `ended` is deferred / why: not in this spec's Tasks / may affect: 27-3, 27-5
- D8 planned: close-out when the engine "completes, pauses, or is stopped" / actual: covers engine statuses the sweep reads; an API cancel or a `recover` orphan end is not closed out and keeps its worktree / why: those paths are outside the Code Map / may affect: 27-3
- D9 planned: (silent) state of the deferred end / actual: the state mirrored at launch return is stored in `launched.detail.end`; engine status recorded as `detail.engine` / why: no decision derives queue state from engine status / may affect: 27-3, 27-4
- D10 planned: close-out for runs that launched an engine / actual: also for every other run and start failures after the cut; a blocked launch whose probe finds a live engine skips close-out and keeps the worktree / why: PR-only; never remove a worktree under a live engine / may affect: none
- D11 planned: test for a VM path not visible / actual: written, runs on win32 only / why: on POSIX every path maps / may affect: none
- ENV: `bun install --frozen-lockfile` fails `EPERM` linking `.bin` entries on the `/c` mount; `bun.lock`/`package.json` untouched, deps already installed; `bun test` (622 pass, 4 skip, 0 fail), `bun test test/worktree.test.ts` (20 pass, 1 skip), `bunx tsc --noEmit` clean, forbidden-flag grep no hits.

DRIFT: `paused` RunState added with a runs-table rebuild — SQLite cannot widen a CHECK; operator-decisions §2 needs a paused run — affects: 27-3, 27-5
DRIFT: engine lock `root` is the worktree (key unchanged) — the engine is probed where it runs — affects: 27-2
DRIFT: `jobrun finish` still at launch return, not at engine end — omitted from the spec's Tasks — affects: 27-3, 27-5
DRIFT: cancel and recover-orphan ends are not closed out (worktree kept) — outside the Code Map — affects: 27-3
DRIFT: deferred end state kept in `launched.detail.end` — no decision derives it from engine status — affects: 27-3, 27-4
DRIFT: `GH_BIN` env var — tests never run real gh — affects: none
DRIFT: `src/server.ts` untouched; `WorkDirMissing` wording via optional arg; `launched` only for worktree runs; close-out for all worktree runs; VM-visibility test win32-only — local — affects: none

### pass 2 (2026-10-16, implementer, applying the consult ruling)

- D7 patched: `finishRun` defers `finish` for a launch that started an engine in its worktree (`finish_deferred`); `sweepEngines` calls `jobrun finish` on the ended path only, with the `launched.detail.end` state/reason, the launch status block and the `run.json` cost (else the launch worker's).
- D8 patched (cancel path): `cancelQueueRun` runs `closeOutNow` after `stopEngine` and before the `cancelled` end; `pr`/`no_changes` on `ended`. The `recover` orphan end is unchanged (known gap, 27-5; README notes it).
- D12 planned: the deferred `finish` carries "the launch status block among its artifacts" / actual: `jobrun finish` has no artifacts flag, so the block goes as `--status-block` with the PR URL added to its `artifacts` / why: the verb's argument list / may affect: 27-5
- Verify after pass 2: `bun test` 625 pass, 4 skip, 0 fail; `bunx tsc --noEmit` clean; forbidden-flag grep no hits. `bun install --frozen-lockfile` still EPERM on the `/c` mount (environment, lockfile untouched).

DRIFT: deferred `finish` passes the launch block as `--status-block` (PR URL added to its artifacts) — `jobrun finish` has no artifacts flag — affects: 27-5
DRIFT: the recover-orphan end is not closed out (worktree kept) — consult ruling, known gap — affects: 27-5

### pass 3 (2026-10-16, implementer, review patches P1–P8)

- D13 (P3, consult 2): new events `closing-out` (an atomic lease, re-takeable from a dead owner) and `closed_out`, plus the queue methods `takeEndedCloseOut`, `closeOutBlocker` and `releaseCloseOut`. Terminal rows are never updated / may affect: 27-5
- D14 (P7): a `materialised` event is added to every run's lifecycle / may affect: 27-5
- D15 (P6): `base_ref` is normalised for the default comparison, the protection check and the PR `--base`. The literal value is kept for `git worktree add` and on the run / may affect: none
- D2 widened: `runs_one_live` and the enqueue idempotency include `paused`, with an index migration / may affect: 27-3, 27-5
- Verify after pass 3: `bun test` 641 pass, 4 skip, 0 fail; `bunx tsc --noEmit` clean; forbidden-flag grep finds nothing.

DRIFT: new `closing-out`/`closed_out` events and a late close-out of terminal runs by the sweep — terminal rows are immutable; consult 2 ruling — affects: 27-5
DRIFT: a `materialised` event on every run — a re-drive after a crash must re-materialise — affects: 27-5
DRIFT: `paused` counts as the job's live run (`runs_one_live` widened) — a submit while paused must not mint a second run — affects: 27-3, 27-5

### pass 4 (2026-10-16, implementer, follow-up review patches P1–P9)

- D16 (P5, P1): `closed_out` is also appended on a run a cancel ended mid-sweep (`raced`), and on a non-terminal run with `pending: {phase, …}`, which the next sweep applies without a second close-out. A `lock-released` event comes from the late close-out. `ended` is still written once, and a run with `pending` stays `running`, so the pacer still counts it live (consult 3) / may affect: 27-5
- D17 (P1, P3, P4, P9): `Queue.end`/`endDriven` take `keepEngine`, `closeOutBlocker` takes `{ asDriver }`, `Queue.releaseEngineLock` is new, `recover` skips runs carrying a `launched` event, and `CommandRunner` opts take `env` (gh gets `GH_REPO`) / may affect: 27-5
- D18 (P1): when a run's close-out is done and its engine is confirmed dead, the run releases the checkout lock instead of handing it to the engine (mirror, cancel, drive-failure end). The lock key is unchanged, and `releaseEngineLock` acts only on terminal runs, so a `paused` run keeps its lock (consult 3) / may affect: none
- Files: `src/worktree.ts`, `src/cli.ts`, `src/queue.ts`, `test/worktree.test.ts`, `test/fakes.ts`, `README.md`. All are inside the plan's Files.
- Verify after pass 4: `bun test` 656 pass, 4 skip, 0 fail; `bun test test/worktree.test.ts` 54 pass, 1 skip; `bunx tsc --noEmit` clean; forbidden-flag grep no hits. `bun install --frozen-lockfile` EPERM on the `/c` mount (environment).

DRIFT: `closed_out` also on a raced cancel (`raced`) and a non-terminal run (`pending`), plus a `lock-released` event — a close-out's result must never be lost and the lock never stranded (P5, P1); consult 3 — affects: 27-5
DRIFT: Queue API `keepEngine`, `closeOutBlocker({asDriver})`, `releaseEngineLock`, `recover` skips `launched` runs, `CommandRunner` `env` (`GH_REPO`) — required by P1/P3/P4/P9; consult 3 — affects: 27-5
DRIFT: a run whose close-out is done with its engine confirmed dead releases the checkout lock instead of handing it to the engine (key unchanged, paused keeps its lock) — P1; consult 3 — affects: none

### pass 5 (2026-10-16, implementer, follow-up review 2 patches P1–P9)

- D19 (P2, consult 4): `Queue.releaseCloseOut` also lets go of a terminal run's `closing-out` lease. It appends a `closing-out` event with detail `{owner: null, released: <self>}`, only when the lease is self's and the run has no `closed_out`. It adds no new event kind and no new method, but gives `closing-out` a new release detail shape. Terminal rows are never updated / may affect: 27-5
- D20 (P5): in `prepareWorktree`, the default-branch protection check now runs before the branch-existence checks, so a case variant is refused the same on any filesystem / may affect: none
- D21 (P3): the gone-worktree path calls `finishStudio` as the normal ended path does. A repeat `finish` is refused and recorded as `finish: {ok:false}` on `ended` / may affect: none
- D22 (P1): a failed `gh pr list` is a close-out error that blocks `gh pr create`. The worktree is kept and a later sweep retries / may affect: none
- Files: `src/worktree.ts`, `src/cli.ts`, `src/queue.ts`, `test/worktree.test.ts`, `test/fakes.ts`, `README.md`. All are inside the plan's Files.
- Verify after pass 5: `bun test` 669 pass, 4 skip, 0 fail; `bun test test/worktree.test.ts` 67 pass, 1 skip; `bunx tsc --noEmit` clean; the forbidden-flag grep finds nothing. `bun install --frozen-lockfile` fails EPERM on the `/c` mount (environment).

DRIFT: `closing-out` gains a release detail `{owner: null, released}` (an ended run's own lease let go when its late close-out throws) — P2: a stranded lease lost the close-out's result; consult 4 — affects: 27-5
DRIFT: protection check before branch-existence checks in prepare; a repeat `finish` on the gone-worktree path; a failed `gh pr list` blocks the create — local (P5, P3, P1) — affects: none

## Consult Log

- 2026-10-16T02:22:14Z — trigger: deviation-gt-0 — question: accept D1–D11 at score 2, or reject D7 (jobrun finish timing) / D8 (cancel and recover close-out)? — ruling: reject-deviation (D7; D8 cancel path), accept D1–D6, D9–D11 at score 2 — do: move `finish` for launched runs from launch return to the sweep's ended path (deferred end state, status block, cost), pinned; in `cancelQueueRun`, call `closeOutNow` after `stopEngine` and before the cancelled end, with its detail on `ended`, pinned; record the recover-orphan close-out as a known gap for 27-5 — rule candidate: a planner turns every operator-decisions bullet that moves an existing call into a Task in the first story it touches, and lists every path that ends a run with a worktree (driven end, sweep, cancel, recover) in that story's I/O matrix.
- 2026-10-16T02:31:52Z — trigger: high-severity-finding — question: the close-out can run while a worker or engine may still write in the worktree (mirror with hold_lock; cancel after an unconfirmed stop; a live orphan engine never swept). Patch fully, guard only (defer to 27-2), or escalate? — ruling: apply (option a) — do: guard `closeOutNow` and both callers (skip when hold_lock, worker.mayRun, driverLive, an unconfirmed engine stop, or a live probe holder; record `closeout: skipped`, keep the worktree, no push/PR/remove); extend `awaitingEngine`/`sweepEngines` to terminal runs with a worktree and a skipped close-out, closing them out only once driver, worker and engine are confirmed dead, as an appended `closed_out` event, atomically, never updating the terminal row; pin each skip path and its later close-out against the fake gh and a real repo — rule candidate: a close-out runs only after every process recorded on the run is confirmed dead; otherwise it records `closeout: skipped` and the engine-end sweep owns it, even for terminal runs.
- 2026-10-16T03:04:42Z — trigger: deviation-gt-0 — question: accept the follow-up review pass's D16–D18 (new `closed_out` uses with `raced`/`pending` plus `lock-released`; the Queue API additions `keepEngine`/`asDriver`/`releaseEngineLock`/`recover` skipping launched runs/`CommandRunner` env; releasing the lock instead of handing it to a confirmed-dead engine) at score 2? — ruling: accept-deviation score 2 — do: record D16–D18 as DRIFT (D16, D17 affect 27-5; D18 none) and finish; note that `ended` is still written once, a `pending` run stays `running`, the lock key is unchanged and `releaseEngineLock` acts only on terminal runs — rule candidate: Treat any new appended event kind or new public Queue method added by a review patch as a score-2 seam for the story that consumes run events (27-5), with no consult needed, provided `ended` is still written exactly once and the lock key is unchanged. (observe record: ok)
- 2026-10-16T03:25:04Z — trigger: deviation-gt-0 — question: accept follow-up review 2's D19–D22 (an ownerless `closing-out` release detail from `releaseCloseOut` on terminal runs; protection check first; a repeat `finish` on the gone-worktree path; a failed `gh pr list` blocks the create) at score 2? — ruling: accept-deviation score 2 — do: keep D1 as written and record it beside D13 as "`closing-out` gains a release detail `{owner: null, released}`, may affect: 27-5"; log D2–D4 as local deviations (score 1) with no seam note — rule candidate: Treat any new event kind, any new detail shape on an existing event kind, or any new public Queue method added by a review patch as a score-2 seam for 27-5, with no consult needed, provided `ended` is still written exactly once, the lock key is unchanged and terminal rows are never updated. (observe record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was a second follow-up review pass on the committed story (144e4cf, 115c5c7). Every claimed run still gets its own relative-gitdir worktree under `TK_SUPERVISOR_WORK`. The worktree is cut from `base_ref` (the default branch is refused when unprotected), materialised by the studio's install and drift motions, and driven there. The engine-end sweep pushes without force, opens the PR against `base_ref` and records it on `ended`. This pass fixed nine review defects:
- A retried close-out adopts the open PR instead of failing on a duplicate.
- A late close-out that throws lets go of its lease, and a close-out works from the checkout once the worktree is gone.
- A launched run with no worktree left is closed out instead of being probed forever.
- The PR body carries the engine's metered cost on every path.
- The default-branch check ignores case.
- The PR body goes through `--body-file`.
- A base branch must be on origin and resolvable at prepare.
- The README's notification claim is corrected.
- A queued-run cancel names its real reason.

**Files changed (this pass):**
- `src/worktree.ts`: `closeOut` gains `openPrUrl` adoption, `--body-file` and the gone-worktree path (checkout `git log`/push, `git worktree prune`). `sweepEngines` releases the lease on the terminal branch and closes out a gone-worktree run. `isDefaultBranch` is new, and the two new `prepareWorktree` refusals are the origin branch and `rev-parse`.
- `src/cli.ts`: `mirror` prefers the engine's metered cost, and the cancel's skip reason for a run that is not running or paused is corrected.
- `src/queue.ts`: `releaseCloseOut` lets go of a terminal run's own `closing-out` lease (an appended ownerless event).
- `test/worktree.test.ts`: pins for P1–P9; existing gh-call assertions include `pr list`.
- `test/fakes.ts`: the fake `gh` answers `pr list`, refuses a duplicate `pr create`, and records the `--body-file` content.
- `README.md`: the close-out, lease-release and notification wording.

**Review:** 9 patches applied (high 0, medium 3, low 6), 0 deferred, 11 rejected. Follow-up review is recommended (true): the score is 3×3 + 1×6 = 15, which is 5 or more. No high finding was patched, so the recommendation rests on the score alone.

**Verification:**
- `bun test`: 669 pass, 4 skip, 0 fail (re-run by the session).
- `bun test test/worktree.test.ts`: 67 pass, 1 skip.
- `bunx tsc --noEmit`: clean (re-run by the session).
- The forbidden-flag grep on `src/worktree.ts` finds nothing (re-run by the session).
- `bun install --frozen-lockfile` fails `EPERM` linking `.bin` on the `/c` mount. This is the environment: `bun.lock` and `package.json` are untouched.

**Known gap:** a run that `recover` ends as an orphan (the driver died during the launch verb, before `markLaunched`) is not closed out, and its worktree is kept. Per consult 1 this belongs to Story 27.5.

**unverifiable-here:**
- the win32 `bun test` run, long worktree paths, and the real command-line length limit;
- real `gh` against GitHub branch protection and `gh pr list --head` adoption (operator: submit a run whose `base_ref` is an unprotected default branch and expect `blocked`);
- the sbx `TK_SUPERVISOR_WORK` worktree mount (operator: a sandboxed run's worktree visible at `/c/agent-work/worktrees/...`);
- the Story 23.3 re-plan in tk-studio, handed over in `tk-studio-side-epic-27.md`.

**Residual risks:**
- A failed deferred `finish` is recorded on `ended` and never retried.
- A failed late close-out step is recorded and retried only while its lease is free. A run whose remove keeps failing keeps its worktree.
- `GH_REPO` parsing covers https, `ssh://` and `git@host:` origins. Any other form falls back to gh's default.
- P7 requires a local `refs/remotes/origin/<base>`. A base that exists on GitHub but was never fetched into the checkout is refused (fail-safe).

DRIFT: `paused` RunState added with a runs-table rebuild — SQLite cannot widen a CHECK; operator-decisions §2 needs a paused run — affects: 27-3, 27-5
DRIFT: engine lock `root` is the worktree (key unchanged) — the engine is probed where it runs — affects: 27-2
DRIFT: deferred `finish` passes the launch block as `--status-block` (PR URL added to its artifacts) — `jobrun finish` has no artifacts flag — affects: 27-5
DRIFT: the recover-orphan end is not closed out (worktree kept) — consult 1 ruling, known gap — affects: 27-5
DRIFT: deferred end state kept in `launched.detail.end` — no decision derives it from engine status — affects: 27-3, 27-4
DRIFT: new `closing-out`/`closed_out` events and a late close-out of terminal runs by the sweep — terminal rows are immutable; consult 2 ruling — affects: 27-5
DRIFT: a `materialised` event on every run — a re-drive after a crash must re-materialise — affects: 27-5
DRIFT: `paused` counts as the job's live run (`runs_one_live` widened) — a submit while paused must not mint a second run — affects: 27-3, 27-5
DRIFT: `GH_BIN` env var — tests never run real gh — affects: none
DRIFT: `src/server.ts` untouched; `WorkDirMissing` wording via an optional arg; `launched` only for deferred worktree runs; close-out for all worktree runs; `base_ref` normalised for comparison and `--base`; VM-visibility test win32-only — local — affects: none
DRIFT: `closed_out` also on a raced cancel (`raced`) and a non-terminal run (`pending`), plus a `lock-released` event — a close-out's result must never be lost and the lock never stranded (P5, P1); consult 3 — affects: 27-5
DRIFT: Queue API `keepEngine`, `closeOutBlocker({asDriver})`, `releaseEngineLock`, `recover` skips `launched` runs, `CommandRunner` `env` (`GH_REPO`) — required by P1/P3/P4/P9; consult 3 — affects: 27-5
DRIFT: a run whose close-out is done with its engine confirmed dead releases the checkout lock instead of handing it to the engine (key unchanged, paused keeps its lock) — P1; consult 3 — affects: none
DRIFT: `closing-out` gains a release detail `{owner: null, released}` (an ended run's own lease let go when its late close-out throws) — P2; consult 4 — affects: 27-5
DRIFT: protection check before branch-existence checks in prepare; a repeat `finish` on the gone-worktree path; a failed `gh pr list` blocks the create — local — affects: none

## Reconcile

### 2026-10-16 — adjust-stories

- Score: 2
- Reasoning: Every DRIFT is a supervisor-internal seam (new `paused` state and live index, new event kinds and detail shapes, Queue API additions, the engine lock's `root` at the worktree, the deferred end state in `launched.detail.end`, the recover-orphan close-out gap). None touches the driver contract: the deferred `finish` uses contract §4's `--status-block`. No later story's acceptance criteria must change; 27-2, 27-3, 27-4 and 27-5 each build on a surface 27.1 reshaped, and notes in their `invoke_dev_with` absorb it. Operator-decisions §2's final `finish` status (`ok`/`partial` naming the failing command or stories left) is not yet derived (D9); 27-4 is its natural owner and its AC2 already sets `partial`, so a note suffices.
- Affected: 27-2 — "releases the pin (`sbx stop`) when the run ends and no other run holds the sandbox" (a run now ends only at the deferred `ended` after close-out; `paused` keeps worktree and lock; the engine lock's `root` is the worktree)
- Affected: 27-3 — "a run that paused at the commit gate … relaunches the epic … under the same queue run with a `close-out` event" (`paused` RunState, draft PR on the `paused` event, and 27.1's `closing-out`/`closed_out` kinds already exist and must not be reused for 27-3's `close-out`)
- Affected: 27-4 — "after the engine completes and before the PR opens" (the PR opens inside `closeOut` in `src/worktree.ts`; the end state comes from `launched.detail.end`, set at launch return)
- Affected: 27-5 — "the next recovery ends it, and no run is left unended" and "runbook §4 names the new events" (the recover-orphan end is not closed out, the consult-1 known gap; new kinds `launched`, `paused`, `materialised`, `closing-out`, `closed_out`, `lock-released`)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 27-2-the-supervisor-holds-the-engine-and-nothing-else-starts-one
