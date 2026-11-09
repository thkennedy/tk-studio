---
title: 'DW-193: a ready override on a paused sweep drops its `wip:` commit before the leg'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_revision: 'de49aaa9d902cc4b133df2054955dd46542afcd1'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
deviation_score: 2
reconcile_verdict: no-impact
---

<intent-contract>

## Intent

**Problem:** A paused sweep's close-out commits `wip: sweep bundle <key> paused (run <id>)` (`worktree.ts wipCommit`) onto the run branch, and `POST /runs/{id}/verify {ready: true}` (`hostleg.ts rerunHostLeg` → `runLeg`) re-runs the leg at that tip and marks the PR ready — merging the paused bundle's spec for work that never landed (the operator dropped it by hand in c58958f6).

**Approach:** In the re-run, when the run is a sweep (`isSweep(queue.definition(run))`), the re-run carried `ready: true`, and the cut tip's subject starts `wip: sweep bundle `, revert that commit in the `.verify` worktree and push the revert to the run branch on origin (never forced) *before* the leg runs, so the leg, the body and the ready flip all see the landed bundles only. Record it on the event as `rerun.wip_drop`.

## Boundaries & Constraints

**Always:**
- Revert with `git revert --no-edit <tip sha>` in the `.verify` worktree, then `git push origin HEAD:refs/heads/<branch>` (works for the detached non-slice cut and the `-B` slice cut alike; never `--force`). On success the leg's `head` (used by the slice proof-commit rollback and the `host-verify` record of what was verified) becomes the revert's sha; `rerun.head` stays the cut tip.
- `rerun.wip_drop` on success: `{ wip: <wip sha>, subject: <clipped subject>, revert: <revert sha>, pushed: <branch> }`. On any failure (revert, rev-parse, push): `"error: <clipped>"`, the worktree reset to the cut tip (`git reset --hard <head>`, best effort; a failed reset appended as in `sliceCommit`), the leg still runs at the cut tip, and the green ready flip is held: `pr_ready: "held: the WIP commit not dropped (<error>)"`, `ready_override` unset.
- Only the tip commit is considered (one WIP commit, as `wipCommit` makes); a tip that is not `wip: sweep bundle …` changes nothing (no `wip_drop` key).
- Without `ready: true`, or on a non-sweep run, nothing changes: Story 37.5's hold (`held: the tip is a WIP commit (…)`) stands.
- Never throws out of the drop helper; a thrown error is the `"error: …"` form.
- Update the `hostleg.ts` module header (the `the PR` / `result` paragraphs) and `HostLegRerun` doc for `wip_drop`; update `apps/supervisor/README.md`'s `POST /runs/{id}/verify` row with one sentence.

**Block If:** satisfying the gate requires changing `sweep.ts`'s paused close-out, `worktree.ts wipCommit`, the API body schema (`{ready?: boolean}`), or a driver-contract schema.

**Never:** force-push; revert anything but the tip `wip: sweep bundle ` commit; touch the run's state, its `ended` event or the engine; edit the deferred-work ledger; touch files beyond `apps/supervisor/src/hostleg.ts`, `apps/supervisor/test/hostleg.test.ts`, `apps/supervisor/README.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paused sweep, ready override | sweep record (a landed, b not), origin tip = one `wip: sweep bundle dw-b paused (run <id>)` commit adding `half.txt`; `{ready: true}` | origin branch tip is a revert of the WIP whose parent is the WIP; `half.txt` absent at origin tip; `rerun.wip_drop` `{wip, subject, revert, pushed}`; `pr_ready: "marked"`, `ready_override: true`; the recorded `host-verify` event carries `wip_drop` | none |
| Push refused | same, `git push` fails | `wip_drop: "error: git push …"`; origin tip still the WIP; no `gh pr ready`; `pr_ready` starts `held: the WIP commit not dropped`; no `ready_override` | worktree reset to the cut tip |
| No override | same, no `ready` | unchanged 37.5 behaviour: `held: the tip is a WIP commit (…)`, no revert, no push, no `wip_drop` | none |
| Override, tip not WIP | sweep, `{ready: true}`, ordinary tip | unchanged: marked, `ready_override: true`, no `wip_drop`, no push | none |

</intent-contract>

## Code Map

- `apps/supervisor/src/hostleg.ts:276-327` -- `rerunHostLeg`: cut (`--detach` non-slice, `-B` slice), then `materialise`. The drop runs HERE, after the successful `worktree add` and BEFORE `materialise` (the worktree still clean), when `opts.ready === true && isSweep(queue.definition(run))`; it never refuses (a failed drop is recorded, never thrown into `VerifyFailed`); its result is handed to `runLeg` in `at` (e.g. `at.drop`). Update the DW-117 cut paragraph of the header: a ready-overridden sweep re-run commits a revert from the detached cut.
- `apps/supervisor/src/hostleg.ts:358-415` -- `runLeg`: reads `at.drop`: sets `rerun.wip_drop`; a successful drop's `revert` becomes the local `head` for `sliceCommit` (:370, its `tip` arg) and `sweepReadyHold` (:404); a failed one holds the green flip (before :406-408).
- `apps/supervisor/src/hostleg.ts:330-341` -- `sweepReadyHold`: reads the tip subject (`git log -1 --format=%s`); reuse its `wip: ` detection pattern but match `wip: sweep bundle ` (`worktree.ts:778` uses that prefix).
- `apps/supervisor/src/hostleg.ts:204-226` -- `sliceCommit`'s push/reset-on-failure pattern: mirror it for the revert push (`git push origin …`, 300s; `git reset --hard <tip>`, 60s; `failed()`, `clip()`).
- `apps/supervisor/src/hostleg.ts:97-118` -- `HostLegRerun`: add `wip_drop?: {wip: string; subject: string; revert: string; pushed: string} | string`.
- `apps/supervisor/src/hostleg.ts:41-67` -- header: document the drop.
- `apps/supervisor/test/hostleg.test.ts:1051-1114` -- Story 37.5 (B3) describe: `sweepRun` fixture and the "tip a `wip:` commit" test (:1088) show how to push a WIP commit to origin with `testGit`; add the matrix tests here. Push failure can be injected by wrapping `fx.deps` runner (see how other tests wrap `fx.deps.uv`/runner) to fail `git push`.
- `apps/supervisor/README.md:56` -- `POST /runs/{id}/verify` row.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostleg.ts` -- add a `dropWipTip` helper, call it in `rerunHostLeg` before `materialise` and hand its result to `runLeg` as above; extend `HostLegRerun` and the header -- DW-193.
- `apps/supervisor/test/hostleg.test.ts` -- add the four matrix rows as tests in the 37.5 (B3) describe; the happy path asserts against origin (`git log -1 --format=%P%x00%s` on the bare/remote, `half.txt` absent in `git ls-tree` of the origin tip) and the recorded event -- pins the fix.
- `apps/supervisor/README.md` -- one sentence on the drop in the verify row.

**Acceptance Criteria:**
- Given a paused sweep whose origin tip is one `wip: sweep bundle` commit, when `rerunHostLeg(..., {ready: true})` runs green, then origin's run branch tip is a revert of that WIP, the PR is marked ready with `ready_override: true`, and the `host-verify` event records `rerun.wip_drop` with both shas.
- Given the revert's push fails, when the same re-run runs green, then the PR is not marked ready and `rerun.wip_drop` is an `error:` string.

## Spec Change Log

- 2026-11-09 — trigger: review pass 1 (blind-hunter, medium, bad_spec): the drop ran in `runLeg` after `materialise`, so a failed drop's `git reset --hard <cut tip>` discarded `materialise`'s uncommitted tracked-path install and the leg ran on a drifted base. Amended: Code Map (drop moved into `rerunHostLeg` before `materialise`, result handed via `at`), Tasks, Design Notes (placement rule, body not filtered, held-text prefix, comment gutter). Known-bad state avoided: a re-run leg recorded on an un-materialised worktree. KEEP: `dropWipTip` itself (tip-subject check, `revert --no-edit`, `rev-parse`, `push origin HEAD:refs/heads/<branch>` never forced, reset-on-failure with the appended reset error, never throws); the `HostLegRerun.wip_drop` type and doc; the `held: the WIP commit not dropped (…)` hold in `runLeg`; the four DW-193 tests (adjust only what the move requires); the README sentence minus the body claim. The pass-1 diff is at `/tmp/dw193-pass1-keep.patch` (apply it, then move the call).

## Review Triage Log

### 2026-11-09 — Review pass
- skipped-layer: edge-case-hunter — S-band story
- intent_gap: 0
- bad_spec: 1 (high 0, medium 1, low 0)
- patch: 3 (high 0, medium 0, low 3) — moot this pass (code re-derived); carried into the amended Design Notes
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[bad_spec]` a failed WIP drop's `reset --hard` after `materialise` discards the install; the spec now places the drop before `materialise` in `rerunHostLeg`, loopback to step 3

### 2026-11-09 — Review pass (iteration 1)
- layers: blind-hunter, edge-case-hunter (153 new lines: past the S band)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 2, low 1)
- defer: 0
- reject: 1 (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` a drop pushed before `materialise` threw was recorded nowhere: `VerifyFailed` detail now appends `; the WIP <sha12> already dropped: revert <sha12> pushed to <branch>` (unclipped), header + README, new test
  - `[medium]` `[patch]` driver-contract 0.1.32 B3 clause stale (`ready: true` marks ready whatever the record says): amended in place under 0.1.34, phrases pinned in test_driver_contract.py (consult: accept-deviation score 2)
  - `[low]` `[patch]` header/README now say the drop's revert and push run before the `202`
- rejected: a failed tip-subject read on an override holds the draft — fail-closed by the spec's "any failure holds" rule

### 2026-11-09 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (186 new lines across 5 files: past the S band)
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[low]` `[patch]` the contract's "On a sweep run (DW-193)" gate was pinned by no test: added `DW-193: a non-sweep run with \`ready: true\` on a \`wip: sweep bundle …\` tip: nothing reverted or pushed, no \`wip_drop\`` (hostleg.test.ts:1199-1208)
- rejected:
  - a failed tip-subject `git log` on an override holds the draft as "the WIP commit not dropped" (both layers): fail-closed by the spec's "any failure holds" rule, the same posture as `sweepReadyHold`'s `held: the tip unreadable`; the error text names `git log`; consult-accepted in pass 1
  - a red or skipped override re-run still pushes the revert: the intent places the push before the leg; the contract's DW-193 clause says "before the leg", and the 0.1.28 "red or skipped never touches the PR" rule is already superseded (driver-contract.md:1611)
  - a failed reset after a failed drop leaves the leg on the reverted tree: the spec says the reset is best effort, with the failure appended as in `sliceCommit`; the flip is held either way
  - a drop pushed before a later `VerifyFailed` is recorded only in the refusal detail: pass 2 patched this as specified; a queue event would touch the run's state (Never)
  - the slice re-run after a drop is untested: plumbing (the `sliceCommit` rollback tip), not named by the criteria
  - no contract version marker on the DW-193 text: the consult ruled an in-place amendment under 0.1.34 with no bump

## Design Notes

Chosen of the two options the intent offers: the re-run revert (not keeping the WIP off the branch in `sweep.ts`). The WIP commit is the resume artifact of record and DW-68's reading, and the drop only happens on the operator's explicit `ready: true`, which is the act of declining the resume. Reverting (not resetting) keeps origin fast-forward only.

The drop precedes `materialise`: `materialise` may rewrite tracked paths (`install_base.py` → `_bmad/_config/**`, `.claude/skills/**`), and a failed drop's `git reset --hard` must never discard that install. The PR body is not filtered: its commit list (`git log <base_ref>..HEAD`) shows the WIP and its `Revert "wip: …"`, and its `## Sweep` section still names the paused bundle not landed — the truthful record; only the tip the leg verifies and the flip are WIP-free. Docs must say so (never "the body sees the landed bundles only"). The held text interpolates the drop error without its `error: ` prefix (consult, accepted). Every inserted header line keeps the ` * ` comment gutter.

## Verification

**Commands:**
- `cd apps/supervisor && bun test --timeout 120000 test/hostleg.test.ts` -- expected: all pass.
- `cd apps/supervisor && bunx tsc --noEmit -p .` (if the package has a tsconfig) -- expected: no errors.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

- planned: on a failed drop, the worktree is reset to the cut tip / actual: no reset when the failure is the initial `git log` read of the tip subject / why: nothing has been changed in the worktree at that point; reverts, rev-parse failures and push failures all still reset / may affect: none
- planned: the `held: the WIP commit not dropped (<error>)` text (prefix handling unspecified) / actual: `<error>` is the drop error without its `error: ` prefix, clipped to 200 characters / why: avoids `(error: …)`; the spec only pins the start of the string / may affect: none

DRIFT: no reset on a failed tip-subject read — the worktree is untouched at that point — affects: none
DRIFT: held reason strips the `error: ` prefix of the drop error — avoids a doubled prefix; spec pins only the start — affects: none

### pass 2 (2026-11-09)

- planned: on any failed drop, the worktree is reset to the cut tip / actual: no reset when the first `git log` read of the tip subject fails / why: the worktree is untouched then (consult-accepted in pass 1, carried) / may affect: none
- planned: held text `held: the WIP commit not dropped (<error>)` / actual: the drop error without its `error: ` prefix, clipped to 200 / why: avoids a doubled prefix (consult-accepted in pass 1, carried) / may affect: none

DRIFT: (pass 2) no reset on a failed tip-subject read — the worktree is untouched at that point — affects: none
DRIFT: (pass 2) held reason strips the `error: ` prefix of the drop error — avoids a doubled prefix; spec pins only the start — affects: none

### pass 3 (2026-11-09, review patches)

- planned: files boundary apps/supervisor/{src/hostleg.ts,test/hostleg.test.ts,README.md} / actual: also plugins/tk-studio/contracts/driver-contract.md (0.1.32 B3 clause amended in place, no bump, no schema) and plugins/tk-studio/lib/tests/test_driver_contract.py (phrase pins) / why: AD-19 — the published clause said `ready: true` marks ready whatever the record says; consult ruled accept-deviation score 2 (de49aaa9 precedent) / may affect: none planned; the contract seam operators read

DRIFT: driver-contract.md 0.1.32 B3 clause amended in place (DW-193 drop, `rerun.wip_drop`, the failed-drop hold) with a test pin, outside the spec's files — AD-19 requires the contract to move with the behaviour — affects: none

## Consult Log

- 2026-11-09T12:22Z — trigger: deviation-gt-0 — question: accept the implementer's two score-1 deviations (no reset on a failed tip-subject read; held text strips the drop error's `error: ` prefix)? — ruling: accept-deviation score 1 — do: keep both deviations as implemented; keep the two DRIFT lines; confirm the push-refused test pins `held: the WIP commit not dropped (git push`, `wip_drop` starting `error: git push`, and the reset — rule candidate: In SPEC design notes, when a held/error reason wraps another field's `error: …` value, state whether the prefix is kept; list reset-on-failure steps as "steps after the first worktree mutation".
- 2026-11-09T12:40Z — trigger: file-outside-files — question: AD-19 requires the published 0.1.32 B3 contract clause (`ready: true` marks ready whatever the record says) to change with DW-193, but the spec's Never-list fences driver-contract.md/test_driver_contract.py out — extend, defer or escalate? — ruling: accept-deviation score 2 — do: extend the boundary to plugins/tk-studio/contracts/driver-contract.md and plugins/tk-studio/lib/tests/test_driver_contract.py, recorded as a score-2 deviation (AD-19, de49aaa9 precedent); amend the 0.1.32 B3 clause in place under 0.1.34, no bump (revert+push of a tip `wip: sweep bundle …`, `rerun.wip_drop`, the failed-drop hold, the body not filtered); pin the phrases beside the B3 pins, no *.json schema touched, conformance `ok: true` — rule candidate: when a change alters behaviour driver-contract.md describes, the planner puts driver-contract.md and test_driver_contract.py inside the files boundary up front and Block If names only *.schema.json.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261109T095041Z-480ca3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A follow-up review pass of DW-193 (committed in 0980ee7d): on `POST /runs/{id}/verify {ready: true}` of a sweep run whose cut tip is the paused close-out's `wip: sweep bundle …` commit, the re-run reverts that commit and pushes the revert to the run branch (never forced) before `materialise` and the leg, and records `rerun.wip_drop`. A failed drop holds the flip. This pass adds one test pinning the contract's sweep-only gate.

**Files changed (this pass):**
- `apps/supervisor/test/hostleg.test.ts` — a non-sweep run with `ready: true` on a `wip: sweep bundle …` tip: nothing reverted or pushed, origin's tip unchanged, no `wip_drop` on the result or the `host-verify` event, `pr_ready: "marked"`.

**Review:** follow-up pass with both layers: 1 patch applied (low), 0 deferred, 6 rejected (reasons in the Review Triage Log). Follow-up review recommended: false (patched high 0, medium 0, low 1; score 3×0+1 = 1).

**Verification:** `bun test --timeout 120000 test/hostleg.test.ts` 68 pass / 0 fail; `bunx tsc --noEmit -p .` exit 0; `uv run python -m unittest discover tests` OK (3077, skipped 4); `runner.py run` `ok: true`.

DRIFT: no reset on a failed tip-subject read — the worktree is untouched at that point — affects: none
DRIFT: held reason strips the `error: ` prefix of the drop error — avoids a doubled prefix; spec pins only the start — affects: none
DRIFT: driver-contract.md 0.1.32 B3 clause amended in place (DW-193 drop, `rerun.wip_drop`, the failed-drop hold) with a test pin, outside the spec's files — AD-19 requires the contract to move with the behaviour — affects: none

**Repository note:** `_bmad-output/implementation-artifacts/deferred-work.md` (the DW-193 ledger entry marked done) was modified by the orchestrator before this run and is left uncommitted and untouched, because the orchestrator owns the ledger. Every other file is committed.

**Residual risks:** the drop's revert and push run before the `202` (up to ~6 min worst case) and whatever the leg's verdict; a failed tip-subject read on an override holds the draft under the "WIP commit not dropped" label; the slice re-run after a drop is untested.

## Reconcile

### 2026-11-09 — no-impact

- Score: 2
- Spec resolution: unit key `dw-paused-sweep-wip-off-pr` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261109-095200-b439 state.json), `spec-dw-193-paused-sweep-wip-off-pr.md`.
- Reasoning: Two of the deviations stay inside `hostleg.ts`: no reset on a failed tip-subject read, and the held text dropping the drop error's `error: ` prefix. The score-2 deviation amends the 0.1.32 Story 37.5 B3 clause of `driver-contract.md` in place, with a pin in `test_driver_contract.py`. That keeps the published clause matching the behaviour (AD-19), as the consult ruled, following the de49aaa9 precedent. The API body (`{ready?: boolean}`) is unchanged, `rerun.wip_drop` is a new optional field, and no `*.schema.json` changed. Two stories in `stories.yaml` are unstarted. 38-7 edits the contract's 0.1.32 Story 37.1 paragraph and adds an order note before 0.1.33, never the 37.5 B3 clause. Its Code Map line anchors after `:2581` move by +4, which is a re-grep, not a broken sentence. 24-3 and 24-4 (trial records) touch nothing here. Epic 37.5's "B3: ready only when every bundle landed or the operator passes `ready: true`" still holds, because that condition is necessary, not sufficient. No open replan-queue entry names this surface.
- Affected: none
- Invariant: none (AD-19 upheld: the contract moved with the behaviour)
- Part B note: this unit is a sweep DW bundle (DW-193), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. I spot-checked the spec's ACs instead. AC1: `hostleg.test.ts:1131` checks that origin's tip is a `Revert "wip: …"` whose parent is the WIP, with `half.txt` absent, the push never forced, `pr_ready: "marked"`, `ready_override: true`, and `wip_drop` on the result and on the `host-verify` event. AC2: `:1150` checks `wip_drop: "error: git push …"`, origin still at the WIP, `held: the WIP commit not dropped (…)`, no `ready_override`, no `gh pr ready`, and the reset. The matrix rows are at `:1180`, `:1190` and `:1199`. I did not rerun them here because `bun` is absent from this gate's shell; the Auto Run Result reports 68 pass / 0 fail. This session reran `tests.test_driver_contract`: 99 OK.

Gate: Part A no-impact (score 2); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (hostleg.test.ts:1131, :1150; contract pins 99 OK; bun suite not rerun here)
