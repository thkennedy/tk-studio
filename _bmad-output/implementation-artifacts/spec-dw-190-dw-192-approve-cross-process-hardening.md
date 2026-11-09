---
title: 'DW-190/DW-192: approve cross-process hardening — a per-project lock around the DW-49 wait and append; the kept worktree''s superseded keys dropped before removal'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_revision: '8b3bb4ad34373b05049e696d6a4bdb3118d2c728'
review_loop_iteration: 0
followup_review_recommended: false
context: ['{project-root}/AGENTS.md']
warnings: ['oversized']
deferred: []
deviation_score: 0
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** (DW-190) `approveStep` (`apps/supervisor/src/approve.ts:1066`) holds only the per-engagement `takeLock(<worktree>.lock)`, so two engagements of one project starting their first append in separate supervisor processes (serve vs run/drain) can both find no `openPrHolder` and both `plansync sync`, minting the same EP/ST ids (AD-4). (DW-192) The fresh path of `worktreeSteps` (`:782-783`) removes a kept worktree before the cut; when an earlier cycle's sync promoted Jira issues but its commit/push never landed (no origin branch, so no onBranch drop), the kept worktree is the only copy of those keys and they are orphaned.

**Approach:** (DW-190) Take a per-project lockfile (same `takeLock`) around the DW-49 wait check and the whole `worktreeSteps` call whenever this cycle has no ok `append` yet, so check-then-append is atomic across processes. (DW-192) Before the fresh path removes a kept worktree of an earlier cycle, read its superseded keys with `supersededKeys` and move them to `DNI` with `dropSuperseded`, exactly as the onBranch path does; a failure keeps the worktree and fails `append`.

## Boundaries & Constraints

**Always:**
- Project lock path: `join(dirname(worktreePath(work, project, id)), "approve.lock")` (i.e. `<TK_SUPERVISOR_WORK>/worktrees/<sanitised project>/approve.lock`), taken with the existing `takeLock` (live holder → null; dead pid / stale unreadable → reclaimed). Taken AFTER the per-engagement lock and the `NotApproved` check, only when `!okStep(…, "append")`; held through the wait check and the `worktreeSteps` call; released in a `finally`. Contended (null): return silently — no event, engagement in none of `done`/`refused`/`failed` (as the engagement lock does). A cycle with an ok `append` never takes it. `work` unset: no lock (no-op release), as today.
- Kept-worktree drop (DW-192) runs in `worktreeSteps`' fresh branch, before `removeWorktree()`, only when: no ok `append` since this approve line (`!appendOk`), `existsSync(wt)`, `jiraBound(t.root)`, and `git rev-parse --abbrev-ref HEAD` in `wt` answers `engagement/ENG-NNN` (else: remove as today, no drop). Keys = `supersededKeys(deps, wt, prefix, defaultRef, id)` read from the kept worktree's files. Non-empty → `dropSuperseded` with the same reason text as the onBranch path (`${id} re-approved after revise (approve ${since}): the earlier plan this issue came from is replaced wholesale`).
- On a kept-worktree read failure → `fail("append", "DropFailed: …")`; on a `dropSuperseded` failure → `fail("append", d.reason)` (`DropFailed:`/`DropRefused:`). In both cases the kept worktree is NOT removed (it holds the only copy of the keys) and the next pass retries.
- When both drops apply (kept worktree AND onBranch cut), the onBranch call drops only keys not already dropped; no call when none remain. The ok `append` detail `dropped` is the sorted, deduped union (omitted when empty).
- `supersededKeys` answers `[]` when `epics.md` is absent (ENOENT) instead of throwing; every other read failure still throws.
- Driver contract header's `0.1.34 (DW-51, additive)` clause names both additions (no version bump, no new note): the drop also runs "before a kept worktree of an earlier cycle whose push never landed is removed, from that worktree (DW-192)" and "(DW-190) the wait check and the `append` run under a per-project lockfile, `<TK_SUPERVISOR_WORK>/worktrees/<project>/approve.lock`, so the check-then-append holds across supervisor processes"; both phrases pinned in `test_0_1_34_dw_51_…` in `test_driver_contract.py`.
- Every text-mode open names `encoding="utf-8"`; every `bun test` names `--timeout`; paths via `join` (Windows host).

**Block If:**
- Making the project lock hold across processes requires a blocking/waiting lock or a new queue/store primitive rather than the existing `takeLock` lockfile.

**Never:**
- No edit to `deferred-work.md`, `epics.md`, plan files, `stories.yaml`, `.bmad-loop/*.toml`.
- No change to `openPrHolder`, `reservedEpics`, the commit/pr/queued steps, the `WaitOpenPr` event shape, `track.py`, or the onBranch drop's key rule.
- No new `APPROVE_STEPS` entry, no new `ApproveResult` field, no contract version bump.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Project lock held | `approve.lock` held by a live pid; ENG-002 approved, no ok append | no event, no plansync call, result all empty; the lock file untouched | next pass |
| Stale project lock | `approve.lock` with a dead pid | reclaimed; the pass runs append…pr; `approve.lock` absent afterwards | — |
| Lock spans append | ENG-001 fresh cycle | `approve.lock` exists when `plansync sync` is invoked | — |
| Resumed cycle | ENG-001 has ok append (kept worktree), `approve.lock` held live | ENG-001 still proceeds (no project lock needed) | — |
| Kept-worktree drop | bound; cycle 1 sync ok, push failed (worktree kept, plan keys TKS-101/TKS-102 in it, no origin branch); revise + re-approve | `track.py drop --engagement ENG-001 --issue TKS-101 --issue TKS-102 --reason "…re-approved after revise…"` before the second `plansync sync`; ok `append` `dropped: [TKS-101, TKS-102]`; the kept worktree replaced | — |
| Kept drop fails | same, track answers `retry: true` or `blocked` | `append` false `DropFailed:`/`DropRefused:`; no second sync; kept worktree still exists with its keys | retried next pass |
| Unbound kept | same, project not Jira-bound | no track drop call; behaviour as before | — |
| Not ours | `wt` exists but HEAD is not `engagement/ENG-001` | removed as before, no drop | — |

</intent-contract>

## Code Map

- `apps/supervisor/src/approve.ts:1066-1106` -- `approveStep`: engagement lock at :1073; insert the project lock after the `NotApproved` refusal (:1083-1087), wrapping the DW-49 wait (:1088-1099) and the `worktreeSteps` call (:1100) when `!okStep(…,"append")`.
- `apps/supervisor/src/approve.ts:505-507` -- `worktreePath`; derive the project lock beside the engagement worktrees.
- `apps/supervisor/src/approve.ts:666-698` -- `takeLock(path)`: reuse unchanged.
- `apps/supervisor/src/approve.ts:706` -- `appendOk` in `worktreeSteps` (scoped to `since`).
- `apps/supervisor/src/approve.ts:766-800` -- `removeWorktree`, the fresh branch (`if (existsSync(wt)) await removeWorktree();` at :783) and the onBranch drop (:788-799) whose shape to mirror; `dropped` declared at :781; the HEAD check pattern at :774-777.
- `apps/supervisor/src/approve.ts:597-599` -- `supersededKeys`' `readFileSync(epics.md)`: answer `[]` on ENOENT.
- `apps/supervisor/src/approve.ts:8-40,108-111` -- header doc: add DW-190 lock and DW-192 kept-worktree drop; :110 "across processes the approve pass holds its per-engagement lockfile" → also the per-project one.
- `apps/supervisor/test/approve.test.ts:99-123` -- `approveDeps`: inject `uv` wrappers through `extra`/`fx.deps.uv` to observe the lock during `plansync sync`; `track` answers injected.
- `apps/supervisor/test/approve.test.ts:715-757` -- H2 push-failure kept-worktree test (template for DW-192: push fails, `servedRepo({bound: true})`, stamp `external.jira.key` into the kept worktree's `plan/EP-034.md` and add an `ST-300.md` with `source: epics.md#story-41.1`, then revise/go/approve as `reapproval()` does at :1007-1013) and the H2 lock test (template for the project-lock tests).
- `apps/supervisor/test/approve.test.ts:942-1141` -- DW-51 describe: `drops(fx)`, `syncIndexes(fx)` helpers; add the DW-192 tests here.
- `apps/supervisor/README.md:153` -- approve-pass description: name the per-project lockfile beside the per-engagement one, and the kept-worktree drop.
- `plugins/tk-studio/contracts/driver-contract.md:5` -- DW-51 clause in the header; `plugins/tk-studio/lib/tests/test_driver_contract.py:3913-3940` -- its pinning test.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/approve.ts` -- project lock in `approveStep`; kept-worktree drop in `worktreeSteps`; ENOENT in `supersededKeys`; header doc -- DW-190, DW-192.
- `apps/supervisor/test/approve.test.ts` -- pin every matrix row.
- `apps/supervisor/README.md` -- approve-pass description.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- the two header phrases and their pins (AD-19).

**Acceptance Criteria:**
- Given `approve.lock` held by a live process, when the approve pass runs for an engagement with no ok `append`, then no approve event is recorded and `plansync` is not called; given it stale, the pass completes and the lock file is gone.
- Given a fresh cycle, when `plansync sync` is invoked, then `<work>/worktrees/p/approve.lock` exists.
- Given a bound kept worktree from a cycle whose push never landed, when the engagement is re-approved, then `track.py drop` receives its keys before the second `plansync sync` and the ok `append` lists `dropped`; given the drop fails, then the kept worktree still exists.
- Given the verify gate (below), when run, then every command passes.

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 4 (medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` A kept-worktree drop followed by a later append failure in the same pass lost the record of the dropped keys (the next pass has no kept worktree): every later `append` failure now carries `dropped: [keys]`; test added.
  - `[low]` `[patch]` Driver-contract DW-190 phrase said the lock covers only the wait check and `append` (the code holds it through `commit`), and the DW-192 phrase omitted the failure behaviour: reworded and re-pinned.
- rejected (one line each): `supersededKeys` ENOENT → `[]` on the onBranch path — by the provenance rule a tree with no `epics.md` has no `## Epic N` of this engagement, so no keys; `prefix` comes from `rev-parse`. Silent stall on a held project lock — same posture as the existing per-engagement lock, which the spec sets. DW-192 clause should list every condition — the README and header doc carry them, and the contract clause now names the failure. Version bump — the spec's Never rule; DW-51 rides the open 0.1.34 entry.

## Deviation Summary

### pass 1 (2026-11-09)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 2 (2026-11-09, review patches)

DEVIATIONS: none
DEVIATION SCORE: 0

## Design Notes

Lock ordering is always engagement → project and both are non-blocking (`takeLock` answers null), so no deadlock across processes. Holding the project lock through all of `worktreeSteps` (not just the `append` emit) is deliberate: once the ok `append` lands, `openPrHolder` holds every other engagement anyway, so the longer hold costs nothing and needs no callback into `worktreeSteps`.

## Verification

**Commands:**
- `cd apps/supervisor && bun test --timeout 120000 test/approve.test.ts` -- expected: all pass.
- `cd apps/supervisor && bunx tsc --noEmit -p .` (if a tsconfig exists; else skip) -- expected: no errors.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Auto Run Result

Status: done
Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261109T095041Z-480ca3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-190: `approveStep` takes a per-project lockfile (`<work>/worktrees/<project>/approve.lock`, via `takeLock`) after the engagement lock and the `NotApproved` check, only for a cycle with no ok `append`, holding it through the DW-49 wait and `worktreeSteps`; held elsewhere → silent, retried next pass. DW-192: before the fresh path removes a kept worktree from an earlier cycle (bound, on `engagement/ENG-NNN`, no ok append this cycle), its superseded keys are read with `supersededKeys` and moved to DNI via `dropSuperseded`; a failure keeps the worktree and fails `append`; `dropped` is the union with the onBranch drop, and any later append failure in the pass records the kept keys.

**Files changed:**
- `apps/supervisor/src/approve.ts` — project lock in `approveStep`; kept-worktree drop in `worktreeSteps`; `supersededKeys` ENOENT → `[]`; header doc.
- `apps/supervisor/test/approve.test.ts` — 8 tests (3 DW-190, 5 DW-192) covering every matrix row plus the review patch.
- `apps/supervisor/README.md` — approve-pass description names the project lock and the kept-worktree drop.
- `plugins/tk-studio/contracts/driver-contract.md` — DW-190/DW-192 phrases in the 0.1.34 (DW-51, additive) header clause (no bump).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` — pins those phrases.

**Review:** 2 patches applied (medium 1, low 1), 0 deferred, 4 rejected. Follow-up review: false (patched high 0; score 3×1 + 1×1 = 4 < 5).

**Verification:** `bun test --timeout 120000 test/approve.test.ts` — 86 pass, 3 skip, 0 fail; `bunx -p typescript tsc --noEmit -p .` — clean; `uv run python -m unittest discover tests` — 3077 OK (4 skipped); conformance `runner.py run` — `ok: true`.

**Residual risks:** a hung but live supervisor process holding `approve.lock` stalls every starting cycle of that project silently (same staleness rule as the engagement lock). If the onBranch drop fails after a successful kept drop, the next pass re-drops keys already in DNI, relying on `track.py drop`'s documented already-dropped skip.

## Reconcile

- 2026-11-09 — score 0; reconcile not required.
- Spec resolution: unit key `dw-approve-cross-process-hardening` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261109-095200-b439 state.json), `spec-dw-190-dw-192-approve-cross-process-hardening.md`.
- Part B note: this unit is a sweep DW bundle (DW-190, DW-192), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `approve.test.ts:759` (live-held lock waits; dead pid reclaimed and released); AC2 `:779` (lock held when `plansync sync` runs); AC3 `:1227` (kept keys dropped before the second sync, `dropped` listed) and `:1243` (a failed drop keeps the worktree); AC4 Auto Run Result (bun 86 pass/3 skip, tsc clean, unittest 3077 OK, conformance `ok: true`). Not rerun here: `bun` is absent from this gate's shell.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle, no stories.yaml entry); ACs spot-checked as met.
