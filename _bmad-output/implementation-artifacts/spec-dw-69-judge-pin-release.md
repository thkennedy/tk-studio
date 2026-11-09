---
title: 'DW-69: the host-leg re-run judge pins through the recorded pin path and releases it'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_revision: '8e71910c2b9c871793a6fee1fd90457c4fd355dd'
deviation_score: 1
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A host-leg re-run on an ended sbx run (`rerunHostLeg` → `runLeg` → `hostVerify` → playable step) starts the stopped sandbox for the judge through the bare `pinSandbox` in `defaultJudge` (`apps/supervisor/src/hostverify.ts:806-815`). That pin writes no `<studioHome>/sandboxes/<sb>.pin` record and notes no `pinned` event. `releasePin` gates on `queue.pinOutstanding(sb)`, so nothing ever stops the sandbox, and the launch check warns "started outside the supervisor".

**Approach:** When the leg is handed the queue (only `runLeg` does this), the default judge pins through `pinWithRestart(queue, runId, sb, …)`. That path writes the pin record, and the judge notes `pinned`, or `pin-failed` on failure. After the judge returns or throws, if the run is terminal, the judge calls `releasePin(queue, runId, …)`. That stops the sandbox only when `sandboxHolders` finds no other holder, and otherwise notes `pin-kept`.

## Boundaries & Constraints

**Always:** Keep the pin failure path unchanged: `invokeSkill`'s `ran: false, pin` gives `inconclusive`, cause `pin`, and never an `sbx exec` into a stopped sandbox. The release is best effort and never throws into the leg, and the leg's verdict ignores the release outcome. Pin and release go through the same `sbx` seam (`deps.sbx`) and `env` as today, so the tests drive them with fakes. Bun tests name `--timeout`. Text-mode writes name `utf-8`.

**Block If:** The fix needs a new event kind, a contract/schema change in `plugins/tk-studio/contracts/`, or changes to `releasePin`'s holder rule (`sandboxHolders`).

**Never:** Change the close-out callers (`closeout.ts`, `worktree.ts`): they pass no queue and keep today's bare pin. The live run's own claim pin is already recorded. Don't import `cli.ts` into `hostverify.ts`. Don't touch the deferred-work ledger. Don't push, tag, or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Re-run, sole holder | ended run R (sbx, sandbox S, earlier `pin-released`), queue passed, sbx fakes exit 0 | `sbx run -d --name S` before any exec. Pin record written for S naming R. `pinned {sandbox: S}` noted on R. Judge runs. Then `sbx stop S`, `pin-released` noted on R, pin record removed | — |
| Re-run, live holder | as above, plus run Q `running` on S | pin + `pinned` as above, judge runs, no `sbx stop`. `pin-kept {sandbox: S, held_by: [Q]}` noted on R, even when R already has a `pin-kept`/`pin-released` from before this pin | — |
| Pin fails | `sbx run` exits 1 | no exec, `pin-failed {sandbox, error}` noted, playable `inconclusive` cause `pin`, no pin record | release still attempted (a no-op when no pin is outstanding) |
| Judge throws | default judge's worker throws after the pin | the release still runs (finally) | the leg's existing `infra(… "sbx" …)` path |
| No queue (close-out) | `hostVerify` without `deps.queue` | today's bare `pinSandbox`, no events, no release | — |

</intent-contract>

## Code Map

- `apps/supervisor/src/hostverify.ts:224-228` -- `Deps` type: add an optional `queue?: Queue` (type already imported at :139).
- `apps/supervisor/src/hostverify.ts:806-815` -- `defaultJudge`: the bare `pin: (sb) => pinSandbox(...)` passed to `invokeSkill`. This is the site to change. It needs the run id, so pass `run` (or `run.run_id`) into `defaultJudge` from `playableStep` (call at ~:983, `(deps.judge ?? defaultJudge(deps))(cwd, …)`). `Run` already carries an optional `run_id` (:216).
- `apps/supervisor/src/hostverify.ts:144` -- import `pinSandbox` from `./sandbox`. Add `pinWithRestart` and `releasePin` there (no cycle: `sandbox.ts` doesn't import hostverify; verify with grep).
- `apps/supervisor/src/sandbox.ts:285` -- `pinWithRestart(queue, runId, sb, deps, ctx)`: `sbx ls`, the pin, an optional restart, then `writePinRecord`. Returns null when pinned. It notes no `pinned` event itself; the caller does (see `cli.ts:1431-1449` `pinBeforeClaim` for the pattern, but don't import cli).
- `apps/supervisor/src/sandbox.ts:185-216` -- `releasePin`. Its terminal gate, `pinOutstanding` gate and `sandboxHolders` → `pin-kept` stay as they are. The `own` filter at :204 ("named once per run") counts any earlier `pin-kept`/`pin-released` on the run, which suppresses `pin-kept` for a re-run's fresh pin. Scope `own` to events after the run's latest `pinned` (no `pinned` = all events, today's behaviour).
- `apps/supervisor/src/sandbox.ts:397-423` -- `pinRecordPath` / `writePinRecord` / `removePinRecord`. Under bun tests they need `TK_STUDIO_HOME` in env (`storeUnsafe`).
- `apps/supervisor/src/hostleg.ts:360-369` -- `runLeg` calls `hostVerify({ ...run, worktree: path }, g.seconds, deps, …)`. Pass `{ ...deps, queue }` here; `run.run_id` is already on the run.
- `apps/supervisor/test/hostverify.test.ts:1095-1150` -- existing default-judge pin tests (`pinOk` sbx fake, `judgeSpawner`, `recorder`, `fixture`, `legEnv`, `route`). Model the new tests on these.
- `apps/supervisor/test/sandbox.test.ts:661-830` -- release/`pin-kept` tests and their queue fixtures (`q`, `SB`).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- add `queue?: Queue` to `Deps`. Give `defaultJudge` the run id. When `deps.queue` and a run id are present, the `pin` callback calls `pinWithRestart` and notes `pinned {sandbox}` or `pin-failed {sandbox, error}` (note wrapped in try). After `invokeSkill` returns or throws, call `releasePin(queue, runId, sandboxDeps)` in a `finally`, swallowing errors. `releasePin` itself only acts on a terminal run. Without a queue, behaviour is unchanged. Update the `defaultJudge` doc comment and the header's judge paragraph.
- `apps/supervisor/src/sandbox.ts` -- in `releasePin`, scope the once-per-run `pin-kept` check to events after the run's latest `pinned`. Update its doc comment.
- `apps/supervisor/src/hostleg.ts` -- `runLeg` passes `queue` in the deps it hands `hostVerify`.
- `apps/supervisor/test/hostverify.test.ts` -- with a real `Queue` holding an ended sbx run, sbx/spawner fakes and `TK_STUDIO_HOME` set to a temp dir, add three tests: (1) sole holder: pin, `pinned`, record, judge, `sbx stop`, `pin-released`, record gone; (2) another `running` run on the sandbox: no stop, `pin-kept` naming it; (3) no queue: no events, no stop (today's path).
- `apps/supervisor/test/sandbox.test.ts` -- `releasePin` on an ended run that already has `pin-released`, then a new `pinned`, while a live holder exists, notes a second `pin-kept`. A repeat release with no new `pinned` adds none.
- `apps/supervisor/test/hostleg.test.ts` -- only if a seam check is cheap: `runLeg`/`rerunHostLeg` forwards the queue to `hostVerify`. Otherwise this is covered by the hostverify tests.

**Acceptance Criteria:**
- Given an ended sbx run re-run through the host leg with a queue, when the playable judge runs, then the pin is recorded (pin record file plus a `pinned` event) and after the judge returns the sandbox is released via `releasePin`: `sbx stop` with no other holder, `pin-kept` with one.
- Given a `hostVerify` call without a queue, when the judge runs, then the pin argv and outcome match the existing tests unchanged (existing hostverify suite green).
- Given the full supervisor suite and the tk-studio verify gate, when they run, then both are green.

## Spec Change Log

### 2026-11-09 — review patch (consult-ruled, not a bad_spec loopback)
- Trigger: both review layers found that concurrent host-leg re-runs of two ended runs on one sandbox let one judge's release stop the sandbox, or its pin restart it, under the other judge.
- Amended: `apps/supervisor/src/queue.ts` (outside Files) gains the read-only `Queue.verifyLegLive`. `defaultJudge` seeds `pinWithRestart`'s `restarted` and skips its `releasePin` while another run on the sandbox has a live verify-leg lease. Consult ruling: accept-deviation score 1.
- Known-bad state avoided: `sbx stop`/restart under a live judge, which would leave that judge's verdict `inconclusive`.
- KEEP: `sandboxHolders`/`releasePin`'s holder rule untouched; close-out callers keep the bare pin; the release lives in the judge's `finally`.

## Review Triage Log

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 1 (low 1): `queue.note('pinned')` throwing after `pinWithRestart` wrote the record. It only throws when the run is gone mid-leg, and removing the record would just bring back the "started outside the supervisor" warning, so the change gains nothing.
- addressed_findings:
  - `[medium]` `[patch]` Concurrent re-runs on one sandbox: one judge's release or restart ran under the other judge. Fixed via `Queue.verifyLegLive` plus a skipped release/restart in `defaultJudge` (consult: accept-deviation 1). Test added.
  - `[low]` `[patch]` No test proved `runLeg` forwards the queue to `hostVerify`. Added a `hostleg.test.ts` re-run test asserting `pinned` → `pin-released` and `stop tk-sbx`; it fails when the forward is removed.

## Design Notes

The release lives in the default judge's wrapper, not in `runLeg`, because only that wrapper knows a pin happened. `releasePin` already refuses non-terminal runs, so it's a no-op if a future caller passes a queue for a live run. Scoping `releasePin`'s once-per-run guard to "since the run's latest `pinned`" keeps its original purpose (repeated releases after one pin don't duplicate `pin-kept`). It also lets a new pin episode on the same ended run report its own `pin-kept`.

Residue (consult ruling): if two concurrent re-runs' judges both finish before either lease closes, both skip the release and the sandbox stays pinned. The pin record is written and the pin is outstanding, so the next `releasePin` on that sandbox stops it. This is a safe failure.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 900 bun test --timeout 120000 test/hostverify.test.ts test/sandbox.test.ts test/hostleg.test.ts` -- expected: all pass
- `cd apps/supervisor && timeout -k 5 1800 bun test --timeout 120000` -- expected: all pass
- `cd apps/supervisor && bunx tsc --noEmit -p .` (if a tsconfig exists) -- expected: no errors
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-11-09)

DEVIATIONS: none
DEVIATION SCORE: 0

### pass 2 (2026-11-09) — matrix test audit (rows: pin fails, judge throws)

DEVIATIONS: none
DEVIATION SCORE: 0

## Consult Log

- 2026-11-09T11:06:10Z — trigger: file-outside-files — question: concurrent host-leg re-runs of two ended runs on one sandbox — the judge's release stops S under the other judge; fix needs a read-only Queue.verifyLegLive in queue.ts (outside Files) — ruling: accept-deviation score 1 — do: add read-only public Queue.verifyLegLive(runId, self = selfOwner()) using takeVerifyLeg's latest-lease test, nothing else in queue.ts; in defaultJudge, when another run recording sb has a live verify-leg lease, skip the finally releasePin and pass ctx.restarted = new Set([sb]) to pinWithRestart; sandboxHolders/releasePin untouched; one test (live lease on a second ended run on S → no sbx stop, no restart); record the outside-Files file and the residue (both judges finish before either lease closes → both skip, S stays pinned until the next releasePin) in Spec Change Log/Design Notes — rule candidate: When a fix needs a new read-only query method on Queue (no new event kind, no schema change, no change to existing methods), the session may add it outside the spec's Files without a consult, logged as a score-1 deviation.

### pass 3 (2026-11-09) — review patches
- planned: changes confined to the spec's Files / actual: added the read-only public `Queue.verifyLegLive(runId, self)` to `apps/supervisor/src/queue.ts` / why: consult ruling accept-deviation score 1 (concurrent re-run race) / may affect: none (new read-only method, no event kind or schema change)
- planned: the DW-69 test fixture owner `{pid, hostname(), nonce}` / actual: `me.host` = `${hostname()}-dw69-peer` / why: same host+pid with a different nonce reads as a dead predecessor in `ownerLive` / may affect: none
DEVIATION SCORE: 1

DRIFT: `apps/supervisor/src/queue.ts` gains read-only `Queue.verifyLegLive` (outside Files) — the concurrent re-run guard needs lease-owner liveness, and `ownerLive` is private — affects: none
DRIFT: DW-69 hostverify test fixture owner host suffixed `-dw69-peer` — needed for a live peer lease in-process — affects: none

## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261109T095041Z-480ca3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-69 is resolved. A host-leg re-run's default playable judge now pins through the supervisor's recorded pin path: `pinWithRestart` writes `<studioHome>/sandboxes/<sb>.pin`, and the judge notes `pinned`, or `pin-failed` on failure. After the judge returns or throws, it calls `releasePin`. On a terminal run that stops the sandbox when nothing else holds it, otherwise it notes `pin-kept`. While another run on the same sandbox has a live re-run, the judge neither restarts nor releases it. The close-out callers keep the bare pin.

**Files changed:**
- `apps/supervisor/src/hostverify.ts` — `Deps.queue`; `defaultJudge` does the recorded pin, the release in its `finally`, and the peer-lease guard; doc comments updated.
- `apps/supervisor/src/sandbox.ts` — `releasePin`'s once-per-run `pin-kept` is now once per pin episode (counted since the run's latest `pinned`).
- `apps/supervisor/src/hostleg.ts` — `runLeg` passes the queue to `hostVerify`.
- `apps/supervisor/src/queue.ts` — read-only `verifyLegLive` (score-1 deviation, consult-ruled).
- `apps/supervisor/test/hostverify.test.ts` — DW-69 tests: sole holder released, live holder `pin-kept`, no queue unchanged, pin fails, judge throws, peer lease live.
- `apps/supervisor/test/sandbox.test.ts` — a new pin episode reports its own `pin-kept`; a repeat release adds none.
- `apps/supervisor/test/hostleg.test.ts` — a re-run through `rerunHostLeg` records `pinned` → `pin-released`.

**Review:** two patches applied (1 medium, 1 low), 0 deferred, 1 rejected. Follow-up review recommendation: false (patched: high 0, medium 1, low 1; score 3×1 + 1×1 = 4 < 5).

**Verification:**
- Supervisor `bun test --timeout 120000`: 2141 pass, 85 skip, 0 fail.
- `bunx tsc --noEmit -p .`: clean.
- Lib suite: 3077 tests OK (4 skipped).
- Conformance `runner.py run`: `ok: true`.
- Matrix audit: every row is covered by a passing test.

**Residual risks:** if two concurrent re-runs' judges both finish before either lease closes, the sandbox stays pinned until the next `releasePin`. The pin record exists in that case, so the launch check raises no warning. None of this was verified on the Windows host leg.


## Reconcile

- 2026-11-09 — score 1; reconcile not required.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle DW-69, unit `dw-judge-pin-release` has no stories.yaml entry; ACs spot-checked as met: DW-69 tests in hostverify/sandbox/hostleg suites, Auto Run Result gates green)
