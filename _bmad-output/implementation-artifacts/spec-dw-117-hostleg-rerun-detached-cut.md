---
title: 'DW-117: the host-leg re-run cuts detached when no slice commit is due'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: 'bfab89aee14cd1688a24e8a4cf01dfc9e78e4d13'
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

**Problem:** `rerunHostLeg` (apps/supervisor/src/hostleg.ts) always cuts `git worktree add --relative-paths -B supervisor/run-<id>`, so a plain re-run is refused exactly when it is most needed: the run branch held by the run's own worktree that a close-out kept on error (`closeOut` `finish`: `out.error` → `worktree: "kept"`), or a local run branch left ahead of origin (`refuseAheadBranch`).

**Approach:** Owner ruling TKSTUDIO-221 A. A re-run whose run is not a slice (`isSlice(queue.definition(run))` false — the only runs whose re-run commits, `sliceCommit`) cuts a detached checkout at origin's tip (`git worktree add --relative-paths --detach <path> <tip>`), skipping `refuseAheadBranch`. A slice re-run keeps the `-B` cut, the ahead refusal and the held refusal, and the held refusal's `VerifyFailed` reason always names the holding (kept) worktree's path.

## Boundaries & Constraints

**Always:** slice decided once in `rerunHostLeg` before the cut and passed to `runLeg` (no second `isSlice` read); the detached leg still runs `runPr` (by branch name), the body rewrite (`git log <base_ref>..HEAD`), both PR flips and the worktree removal unchanged; the held reason names the path — from git's stderr when present, else from `git worktree list --porcelain` (the entry whose `branch` is `refs/heads/<branch>`), else the existing fallback; Windows-safe paths (compare separator-insensitively in tests); every `bun test` names `--timeout`; the hostleg.ts header's `the cut` paragraph rewritten to the new rule.

**Block If:** a non-slice re-run is found to need to commit or push anything onto the run branch.

**Never:** remove or modify the kept worktree or the local branch; force anything; touch `worktree.ts`, the deferred-work ledger, or any planning artifact; offer removal (not in ruling A).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain re-run, branch held | non-slice run; a close-out kept its worktree on error (holds the run branch) | cut `--detach` at tip; leg runs, `host-verify` recorded, `.verify` removed; kept worktree untouched | none |
| Plain re-run, branch ahead | non-slice run; local run branch has an unpushed commit | cut `--detach`; leg runs; local branch and its commit untouched | none |
| Slice re-run, branch held | slice run; a close-out kept its worktree on error | `VerifyFailed` naming branch and the kept worktree's path; kept worktree untouched; lease released; no `host-verify` | refusal |
| Slice re-run, branch ahead | slice run; local branch ahead | `VerifyFailed` naming branch and commit (as today) | refusal |
| Slice re-run, stale branch | slice run; local branch behind origin | `-B` reset, commit, push (as today) | none |

</intent-contract>

## Code Map

- `apps/supervisor/src/hostleg.ts:11-17` -- header `the cut` paragraph (Story 35.1 rule) to rewrite.
- `apps/supervisor/src/hostleg.ts:239-250` -- `refuseAheadBranch`; slice-only after the change.
- `apps/supervisor/src/hostleg.ts:254-301` -- `rerunHostLeg`; the cut at :276-287 (`-B`, held-regex `already (checked out|used by worktree) at '…'`).
- `apps/supervisor/src/hostleg.ts:330-341` -- `runLeg`; computes `slice` at :338; accept it via `at` instead.
- `apps/supervisor/src/worktree.ts:885-902` -- `closeOut` `finish`: an `out.error` keeps the worktree (read-only; use the real `closeOut` in the new test).
- `apps/supervisor/test/hostleg.test.ts:33-104` -- `fixture` (removes the run worktree at :97); add an option to keep it so a real `closeOut` with a failing step (e.g. the fake `gh` answering `pr create` exit 1) keeps it.
- `apps/supervisor/test/hostleg.test.ts:121-159` -- asserts the non-slice `-B` argv; becomes `--detach`.
- `apps/supervisor/test/hostleg.test.ts:575-600` -- `sliceFixture` (SLICE definition).
- `apps/supervisor/test/hostleg.test.ts:851-862` -- the pin to replace (hand-added `held` worktree).
- `apps/supervisor/test/hostleg.test.ts:864-880` -- ahead refusal on a non-slice fixture; move it to a slice fixture.
- `apps/supervisor/test/hostleg.test.ts:897-901` -- "a non-slice re-run uses the same cut"; update to the detached cut.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostleg.ts` -- decide `slice` before the cut; non-slice: `--detach` cut, no `refuseAheadBranch`; slice: unchanged `-B` path, held reason resolved from porcelain when stderr lacks the path; pass `slice` to `runLeg`; rewrite the header's cut paragraph -- ruling A.
- `apps/supervisor/test/hostleg.test.ts` -- replace the :851 pin with a slice test whose holder is the run worktree a real `closeOut` kept on error; add a detached plain re-run test on the same kept-worktree state; move the ahead refusal to a slice fixture and add its non-slice detached counterpart; update the `-B` argv assertions for non-slice runs -- proves the matrix.

**Acceptance Criteria:**
- Given a non-slice ended run whose close-out kept its worktree on error, when `rerunHostLeg` runs, then the cut argv is `worktree add --relative-paths --detach <wt>.verify <tip>`, the leg records one new `host-verify` with `rerun.worktree: "removed"`, and the kept worktree still exists with its files.
- Given a slice ended run whose close-out kept its worktree on error, when `rerunHostLeg` runs, then it throws `VerifyRefused` `VerifyFailed` whose message names the run branch and (separator-insensitively) the kept worktree's path, the lease is released, and no `host-verify` is added.
- Given a non-slice run with a local run branch ahead of origin, when re-run, then the leg runs detached and the branch still points at its unpushed commit.
- Given the full supervisor suite, when run, then it passes.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- layers: blind-hunter, edge-case-hunter (no story plan band; both run)
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[low]` `[patch]` the `kept` fixture ended the run with `pr: PR` and `closeout: draft PR` though its real `closeOut` failed at `gh pr create`; now ends with `closeOutDetail(closeout)` and no PR unless passed; both kept tests assert the real record (non-slice: `rerun.pr` null)

## Design Notes

"No slice commit is due" is decided at cut time, before the leg's verdict exists; `isSlice` is the only cut-time signal (a non-slice re-run never commits, `runLeg`). A slice run off `proofCommitDue` still cuts `-B`: whether it commits is known only after the leg.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 900 bun test --timeout 180000 test/hostleg.test.ts` -- expected: all pass
- `cd apps/supervisor && timeout -k 5 1800 bun test --timeout 180000` -- expected: all pass
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: no errors
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-11-08)

- planned: tests for the four listed changes / actual: also a test for the `git worktree list --porcelain` fallback when git's stderr names no path / why: the spec's Always clause requires the fallback and no named test reaches it (git 2.53 names the path) / may affect: none
- planned: the slice decision inside `runLeg`'s catch (a failed definition read → a skipped leg recorded) / actual: decided in `rerunHostLeg`'s try (a failed read → `VerifyFailed`, lease released) / why: the spec requires deciding it once before the cut / may affect: none

DRIFT: an extra test for the porcelain fallback — the Always clause's fallback is otherwise unexercised — affects: none
DRIFT: a definition read failure moves from a skipped `host-verify` to a `VerifyFailed` refusal — slice is decided before the cut per spec — affects: none

## Consult Log

- 2026-11-08T20:47:46Z — trigger: deviation-gt-0 — question: accept the two score-1 deviations (extra porcelain-fallback test; isSlice read moved into rerunHostLeg's try → VerifyFailed)? — ruling: accept-deviation score 1 — do: keep the isSlice read in rerunHostLeg's try, no non-slice fallback; keep the porcelain fallback test; leave both DRIFT lines and continue to review — rule candidate: a computation moved from a leg into its setup follows the setup's failure class (VerifyFailed, lease released), never a path-changing default; record as score-1 drift with no consult

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T202640Z-af3d56` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-117 / TKSTUDIO-221 A. `rerunHostLeg` decides `isSlice` once before the cut and hands it to `runLeg`. A non-slice re-run cuts `git worktree add --relative-paths --detach <path> <tip>` and never reads the local run branch, so a branch held by a close-out's kept worktree or left ahead of origin no longer refuses it. A slice re-run keeps the `-B` cut, the ahead refusal and the held refusal; the held `VerifyFailed` reason names the holder's path from git's stderr, else `git worktree list --porcelain`.

**Files:**
- `apps/supervisor/src/hostleg.ts` — slice-gated cut (`--detach` vs `-B`), `holdingWorktree` porcelain fallback, `runLeg` takes `at.slice`, header's cut paragraph rewritten.
- `apps/supervisor/test/hostleg.test.ts` — `kept` fixture option running the real `closeOut` (fails at `gh pr create`, keeps the worktree, ends with its real record); the hand-made held pin replaced by a slice refusal born from that kept worktree; new detached plain re-run (kept worktree), non-slice ahead detached, porcelain fallback; ahead refusal moved to a slice fixture; non-slice `-B` argv assertions now `--detach`.

**Review:** 1 patch applied (low), 0 deferred, 0 rejected. Follow-up review: false (patched high 0, medium 0, low 1; score 1).

**Verification:** `bun test --timeout 180000 test/hostleg.test.ts` 60 pass / 0 fail; full supervisor suite 2107 pass / 95 skip / 0 fail (with the shell's `TK_ATLASSIAN_*` vars unset — with them exported, 2 pre-existing `guards.test.ts` sbx-argv tests fail on env leakage, unrelated); `bunx tsc --noEmit` clean; lib `unittest discover` 3037 OK (4 skipped); conformance `ok: true`. Matrix rows each covered by a passing test (see Deviation Summary/implementer mapping).

**Residual risks:** a definition read that throws now refuses with `VerifyFailed` instead of recording a skipped leg (consult accepted, score 1). The environment's `TK_ATLASSIAN_*` leak into `guards.test.ts` is pre-existing and not addressed here.

DRIFT: an extra test for the porcelain fallback — the Always clause's fallback is otherwise unexercised — affects: none
DRIFT: a definition read failure moves from a skipped `host-verify` to a `VerifyFailed` refusal — slice is decided before the cut per spec — affects: none

## Reconcile

- 2026-11-08 — score 1; reconcile not required.
- Spec resolution: unit key `dw-hostleg-rerun-detached-cut` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261108-202816-6452 state.json), `spec-dw-117-hostleg-rerun-detached-cut.md`.
- Part B note: this unit is a sweep DW bundle (DW-117), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 hostleg.test.ts:903 (non-slice kept worktree → detached cut, leg recorded, kept worktree untouched) and :131/:966 (`--detach` argv); AC2 :870 (slice kept worktree → `VerifyFailed` naming branch and path, lease released), plus :889 (porcelain fallback); AC3 :939 (non-slice ahead → detached, branch keeps its commit); AC4 per the Auto Run Result (2107 pass / 0 fail, tsc clean, conformance `ok: true`). Not rerun here: `bun` is not on this session's PATH.
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (hostleg.test.ts:870, :889, :903, :939, :966; full suite green per the Auto Run Result)
