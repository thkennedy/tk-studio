---
title: "The Host Leg's Own Guard and Its Measure"
type: 'feature'
created: '2026-11-07'
status: 'done'
baseline_revision: 'f89f6d94beac36d9cf60b17ffdc00c521a5c5e28'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-38/plans/38-1.md'
  - '{project-root}/AGENTS.md'
warnings: [oversized]
deferred:
  - summary: >-
      A stale host-verify-leg lease (serve died mid-leg, or a crash between noteCloseOutLease and host-verify with no later leg) makes every operator verify_host.py refuse with exit 2 until --beside-leg, and the refusal's "wait for its host-verify event" remedy never resolves.
    evidence: |-
      live_legs treats any latest host-verify-leg with a non-null owner and no later host-verify as live (tools/verify_host.py:398-418); the lease records no guard or deadline (apps/supervisor/src/hostverify.ts:238-242); no pid probe by design (plan Settled shape 7: os.kill on win32 is TerminateProcess). Meets deferral (a): the refusal is behaviour AC3 names. A re-run of the leg (takeVerifyLeg takes over a dead owner) or --beside-leg clears it today. Raised by both review layers.
    location: >-
      tools/verify_host.py:398-449
    severity: medium
  - summary: >-
      On the Windows host a guard's tree kill (taskkill /F /T) may kill a gate's child before verify_host.py itself, letting it print "== <suite>: FAILED rc=1" so a guard-cut leg reads red instead of inconclusive (guard).
    evidence: |-
      guardInconclusive requires redSuites empty (apps/supervisor/src/hostverify.ts:970-971); a FAILED gate line printed by the parent after its child was killed would count as red. Unproven on the host (kill order is not guaranteed); the first real guard trip on the box shows it. Meets deferral (a): the inconclusive (guard) verdict is behaviour AC2 names.
    location: >-
      apps/supervisor/src/hostverify.ts:970-971
    severity: medium
deviation_score: 1
reconcile_verdict: not-required
---

> **Serve process changes.** `closeout.ts`, `worktree.ts`, `hostleg.ts`, `hostverify.ts` and `cli.ts` run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge. 38.1's own leg runs under the code before it (the run's submit-time snapshot carries the 7200 interim).

<intent-contract>

## Intent

**Problem:** The host verify leg runs under the engine's worker guard (`run.worker_guard_s ?? guards.max_wall_clock_seconds ?? 600`), which its own green legs exceed; it records no per-suite time, reports a guard expiry as red, and an operator's own `tools/verify_host.py` can start beside a live leg and halve both (AI-1; DW-174; hole 113; retrospective C2, C4).

**Approach:** Transcribed verbatim from `epics.md` §Story 38.1 (authoritative; the user story: "As the operator, I want the host verify leg to run under a guard of its own, sized to the host gate and recorded per suite, a leg that ends on the guard with every verdict so far green to read `inconclusive (guard)`, and an operator's own gate to refuse to start beside a live leg, So that the epic's largest stage is bounded by its own history and never by the engine's clock, and a time bound is never reported as a fault"). The planner's settled shapes (plan §Settled shape 1-9, SPEC design notes CAP-1..CAP-3) fix every either/or.

## Boundaries & Constraints

**Always:**
- AC1-AC3 below are the contract, word for word; plan §Settled shape 1-9 gives their exact texts (guard text, reason, PR block, durations line, refusal/warning lines, exit 2).
- All three leg callers (`closeout.ts` boundary, `worktree.ts` sweep tail, `hostleg.ts` re-run) read `legGuard(queue.definition(run))`; `queue.ts sbxDeadline` and `worker_guard_s` stay the worker's.
- `guards` merge key-wise on type extension (instance keys win); `host_verify_seconds` does not satisfy the at-least-one rule.
- Stdlib-only Python via `uv run`; atomic writes; every text-mode open names `encoding="utf-8"`; every `bun test` names `--timeout`; the sqlite URI from `Path.as_uri()`; never `os.kill` on win32 (no pid probe).
- Contract 0.1.34 (additive) opens here; DW-174 closes `by Story 38.1`, never `by this story's PR`.

**Block If:**
- The key-wise merge breaks a pinned resolution other than `test_job.py:366, :414` → consult `deviation-gt-0`; never keep the interim to dodge it.
- A reader other than `takeVerifyLeg` treats a non-terminal run's `host-verify-leg` as a re-run lease → consult (`bad_spec`).
- A test the story must keep contradicts the "at least one gate-level verdict" reading of `inconclusive (guard)` → consult (`bad_spec`).
- The Files list must grow past the plan's 25 files → `halt` consult.

**Never:** Narrow the leg to a diff's suites (Tim's question, recorded only); change the worker-trip pins (`guards.test.ts`, `resume.test.ts`, `sandbox.test.ts`, `page.test.ts`); add a conformance drive; edit `epics.md`, `stories.yaml`, the canonical plan files, `routing.toml`/`policy.toml`, or anything under `supervision/`; push, tag or release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Leg's own guard | guards `{max_wall_clock_seconds:50, host_verify_seconds:1}`, `worker_guard_s` 50, hanging host | trips `guard: host_verify_seconds (1s)` in all three callers | red (HANG prints no suite line) |
| Pre-38.1 snapshot | guards `{max_wall_clock_seconds:1}` | trips `guard: max_wall_clock_seconds (1s)` | red |
| No definition | absent | `legGuard` → `{600, max_wall_clock_seconds}`; non-positive/non-number key falls through | — |
| Guard, all green so far | host step trips after ≥1 gate-level ok line, none red | `inconclusive (guard)`: run `partial`, reason `host verify inconclusive (guard): timed out (guard: host_verify_seconds (<N>s)) with every verdict so far green; unrun: <suites|none>`; PR `**Timed out:**`, no "failed"/"Red" outside fences; re-run exit 1 | no flip, draft PR |
| Guard, no verdict | generic hang | stays red | today's pins hold |
| Durations | any leg that ran | `== durations: lib suite=3s, …` immediately before final `verify_host: ok|FAILED`; event `suite_durations`; PR `Durations:` | guard kill: fallback to gate-level `ok|FAILED … in Ns` lines before first tail header; absent when none |
| Live leg | `TK_SUPERVISOR_DB` holds a latest `host-verify-leg` with owner, no later `host-verify` | exit 2, refusal names run id, `GET /runs/<id>`, `--beside-leg`; no gate runs | `--beside-leg`: WARNING line, gates run |
| Leg's own run | `TK_SUPERVISOR_HOST_LEG` set | no queue read | — |
| No/unreadable queue | var unset or file absent / garbage | silent / one `was not read (…); running without the beside-leg check` line, gates run | — |

</intent-contract>

**AC1.** **Given** `closeout.ts:481` and `hostleg.ts:331` (`guardS = run.worker_guard_s ?? guards.max_wall_clock_seconds ?? 600`) and the shipped `run-epic` and `run-vertical-slice` types' `guards` **When** the close-out or the re-run verb starts the leg **Then** the guard is the job's `guards.host_verify_seconds` (the shipped types carry 7200; an instance may override; a job without one gets its type's), read by both callers in place of `worker_guard_s`, validated by `job.py validate` and `job.schema.json`; the `host-verify` event names `guard: host_verify_seconds (Ns)`; the supervisor suites pin both callers from one table; `run-epic-38.json` drops its interim `max_wall_clock_seconds 7200` by this story's PR so the engine's clock returns to the type's figure; the contract (0.1.34, additive) names the key

**AC2.** **Given** `verify_host.py`'s suite lines (`== lib suite: … in Ns`, the per-file supervisor lines, conformance, the studio web) **When** the leg ends green, red or on the guard **Then** the script prints one `== durations:` summary line (suite to seconds) at its end and the leg records `suite_durations` on the `host-verify` event beside `verdicts`, the PR body's `## Host verify` lists them, and a leg ended on the guard with every verdict so far green is reported `inconclusive (guard)` (Story 35.3's shape): the run ends `partial` with the reason naming the guard and the suites still unrun, the PR body says "timed out", never "failed", and the re-run verb's exit 1 covers it; `test_verify_host` and `hostleg.test` pin each

**AC3.** **Given** an operator's own `tools/verify_host.py` on the box while a leg is live (hole 113: two gates on one box halve each other) **When** the script starts **Then** it reads the queue read-only (a live `host-verify-leg` lease or a run in its close-out, `queue.db` under `mode=ro` at the configured path, or `GET /runs`) and refuses to start naming the lease's run id and the remedy, `--beside-leg` overriding with a printed warning; the runbook's hole-113 row reads fixed with the rule in code; the retrospective's open question (a leg narrowed to the suites a diff can affect, the whole leg at the epic's end) is recorded in the handoff as Tim's, with the per-suite durations this story measures as its evidence, not decided here

## Code Map

The investigation is `_bmad-output/specs/spec-epic-38/plans/38-1.md` §Code Map and §Settled shape (anchors re-read at `17a6f3f2`, spot-checked at `f89f6d94`). Key anchors:

- `apps/supervisor/src/hostverify.ts` -- `HostVerifyRan` :125-150 (`verdicts` :136), `SUITE_LINE` :323, `GATE_VERDICT` :325, `TAIL_HEADER` :340, `verdictLines` :345-358, `redSuites` :361-368, `wallClockTrip` :382, `runStep` :438-484, `hostVerify` :492-562 (`buildWorkerEnv` :497, host step :511), `isInconclusive` :879, `isRed` :883, `inconclusiveReason` :886, `legVerdict` :925, `prSection` :950-1000. New: `legGuard`, `suiteDurations`, `LEG_SUITES`, `guardInconclusive`, `env.TK_SUPERVISOR_HOST_LEG = run.run_id`.
- `apps/supervisor/src/closeout.ts:481` (boundaryLeg), `apps/supervisor/src/worktree.ts:1242`, `apps/supervisor/src/hostleg.ts:331` -- the three `guardS` expressions; the two close-out callers also note `host-verify-leg {owner, by: "close-out"}` (owner `deps.self ?? selfOwner()`, `queue.ts:212`, shape `ownerDetail` :830) before `hostVerify`.
- `apps/supervisor/src/cli.ts verifyVerb` :2837-2862 -- adds `suite_durations` to JSON; exit 1 already covers inconclusive.
- `apps/supervisor/test/fakes.ts` -- `LEG_GUARD_ROWS` (never import one test file from another). Flips: `hostverify.test.ts:285-287, :295-298, :304-307, :640-644`; `worktree.test.ts:1055-1077` rewritten as table rows; `closeout.test.ts` Story 36.3 fixture :1547-1560; `hostleg.test.ts` `fixture` :32.
- `tools/verify_host.py` -- `main` :374-418, `GATES` :54-57, `STUDIO_WEB_GATE` :59, `supervisor_env` :138-147 (strips `TK_SUPERVISOR_*` from bun children). New: durations collection, `live_legs`, `--beside-leg`, docstrings. Events schema `queue.ts:665-668` (WAL :875).
- `plugins/tk-studio/lib/tests/test_verify_host.py` -- `VerifyHostCase` :66-116; patch `vh.live_legs` in setUp; `TestDurations`, `TestBesideLeg`; `lines[-1]` pins hold.
- `plugins/tk-studio/lib/job.py` -- `GUARD_KEYS` :72, `_validate_guards` :186-198, `resolve_instance` :336-375 (wholesale guards :371-372 → key-wise), docstring :11-14.
- `plugins/tk-studio/contracts/job.schema.json` :10, :44-49; `plugins/tk-studio/jobs/{run-epic,run-vertical-slice,run-sweep}.json`; `.tk-studio/jobs/run-epic-38.json`.
- `plugins/tk-studio/contracts/driver-contract.md` lines 5-6, 0.1.33 paragraph :2659-2673, `## 8. Conformance` :2675; `plugins/tk-studio/lib/tests/test_driver_contract.py` (48 `**0.1.33**` flips, the guard :3422 deleted, `test_0_1_33_dw_170_…` :3418-3450 re-bounded, new `test_0_1_34_story_38_1_…`).
- Docs: `apps/supervisor/README.md:226`; `kb/agent-pc-setup-runbook.md:1687`; handoff top update; `deferred-work.md` DW-174 :1458-1465.

## Tasks & Acceptance

**Execution:** exactly the plan's §Files list (25 files, none new), each with the action written there:
- `apps/supervisor/src/hostverify.ts`, `closeout.ts`, `worktree.ts`, `hostleg.ts`, `cli.ts` -- the guard, lease, durations, inconclusive, env -- AC1, AC2, AC3 seam
- `apps/supervisor/test/fakes.ts`, `hostverify.test.ts`, `hostleg.test.ts`, `closeout.test.ts`, `worktree.test.ts` -- the one table and the pins -- AC1, AC2
- `tools/verify_host.py`, `plugins/tk-studio/lib/tests/test_verify_host.py` -- durations line, beside-leg gate -- AC2, AC3
- `plugins/tk-studio/lib/job.py`, `contracts/job.schema.json`, `jobs/run-epic.json`, `jobs/run-vertical-slice.json`, `jobs/run-sweep.json`, `lib/tests/test_job.py`, `.tk-studio/jobs/run-epic-38.json` -- the key, merge, interim dropped -- AC1
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- 0.1.34 -- AC1
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md`, `handoff-phase1-loop-2026-10-09.md`, `deferred-work.md` -- records -- AC3

**Acceptance Criteria:** AC1-AC3 above, each proven by a test or a command output (see Verification).

## Spec Change Log

## Review Triage Log

### 2026-11-07 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 2 (high 0, medium 2, low 0)
- reject: 2 (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` Blind Hunter: a guard-inconclusive leg's PR body still read `Engine gate: skipped (verify.host red)` (and `Assets: skipped (verify.host red)` on a slice) outside the fences. Fixed: a guard-tripped host gives the skip reason `verify.host timed out` (`hostverify.ts`); the prSection test asserts no /failed/i or /red/i outside the fences; the 0.1.34 contract paragraph names the new skip reason and `test_0_1_34_story_38_1_…` pins it (AD-19).
  - `[low]` `[patch]` Blind Hunter: the `hostverify.ts` header `result` paragraph lacked `suite_durations?` and still called every timeout red. Fixed.
- rejected: Blind Hunter "the reverse order of hole 113 (a leg starting beside a running operator gate) is unguarded yet the runbook reads fixed": AC3 asks exactly for the start-time refusal and for the row to read fixed with the rule in code. Edge Case Hunter "the event should always record the guard used": consult ruling (Consult Log) keeps the trip-only reading.
- deferred: the stale-lease refusal (both layers, deduplicated) and the win32 kill-order FAILED line, each meeting (a); see frontmatter `deferred`.

## Design Notes

Settled by the planner (plan §Settled shape; SPEC design notes): the queue read is `queue.db` (the API has no `GET /runs` list); the close-out legs write the lease that makes "a run in its close-out" visible; `inconclusive (guard)` needs ≥1 gate-level verdict so generic hangs stay red; `run-sweep` carries the key by the run-epic shape pin; the third caller (`worktree.ts:1242`) is the ordinary close-out leg.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --no-project python plugins/tk-studio/lib/job.py validate --id run-epic-38 --directory .` (and `run-epic`, `run-vertical-slice`, `run-sweep`) -- expected: ok; run-epic-38 resolves `{max_turns: 80, max_wall_clock_seconds: 3600, host_verify_seconds: 7200}`
- `uv run --no-project python tools/verify_host.py --help` -- expected: names `--beside-leg`
- `cd apps/supervisor && bun test --timeout 30000 test/hostverify.test.ts test/hostleg.test.ts test/closeout.test.ts test/worktree.test.ts test/sweep.test.ts test/board.test.ts`, then `bun test --timeout 30000`, `bunx tsc --noEmit -p .` -- expected: green; `unverifiable-here` with the exact command when bun is absent

**Manual checks (operator, after merge and restart):** 38.2's leg names `suite_durations` and `guard: host_verify_seconds`; `uv run python tools/verify_host.py` started while a leg is live exits 2 naming the run.

**Results (operator, 2026-11-08, on 38.2's leg — run `q-run-epic-38-20261107T230900Z-cc0a55`, the first under this story's code):** (1) the leg's `host-verify` event (seq 6569, 02:00:58Z, green in 3859.8 s = 54 % of 7200) names `suite_durations` `{"lib suite": 2072, "conformance": 418, "supervisor": 1370}` and the stdout tail's `== durations: lib suite=2072s, conformance=418s, supervisor=1370s` line sits before `verify_host: ok`; `guard: host_verify_seconds (<N>s)` is a trip-only field and this leg did not trip, so it stays pinned by `hostleg.test` alone until a leg does. (2) At 00:56:48Z, nine seconds into the leg (lease seq 6568, owner pid 47144, `by: close-out`), `uv run python tools/verify_host.py` started from `C:\GitHub\tk-studio` exited 2 in 0.3 s naming the run and the remedy (`GET /runs/<id>`, `--beside-leg`), and no gate ran. Both checks pass; hole 113's rule is proven in use.

## Deviation Summary

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261107T203050Z-966fd1` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-11-07, implementer)

- planned: 48 `**0.1.33**` pins flip in `test_driver_contract.py` / actual: 49; the 49th is a regex pin in `test_carries_its_own_semver_and_change_policy` (:113) / why: the plan's count matched only the `assertIn` form / may affect: 38-2 (later bumps: 49 pins)
- planned: only the named `hostverify.test.ts` guard-text pins flip / actual: the Story 37.2 FAKE_LEG section pin also gains the `Durations:` line / why: Durations sits between Verdicts and the fences on red legs, as the plan places it / may affect: none
- planned: close-out callers call `queue.note(…, "host-verify-leg", …)` directly with an `ownerDetail`-shaped owner / actual: exported helper `noteCloseOutLease` in `hostverify.ts`; `worktree.ts` reads `self` by a cast (`WorktreeDeps` has no `self`) / why: `ownerDetail` is private to `queue.ts`, outside Files / may affect: none
- planned: `runStep` takes the guard key as a parameter / actual: the key travels on hostverify's internal `Deps` (`guardKey`) from `opts.guardKey` / why: reaches every step without widening each helper / may affect: none
- planned: helpers `legGuard`, `suiteDurations`, `LEG_SUITES`, `guardInconclusive` / actual: also exports `gateVerdicts`, `unrunSuites`; `guardInconclusive` returns boolean / why: shared by reason and PR section; type check / may affect: none
- planned: `env.TK_SUPERVISOR_HOST_LEG = run.run_id` / actual: `run.run_id ?? "host-leg"`, `run_id` optional on hostverify's `Run` / why: callers/tests without an id still exempt / may affect: none
- planned: `live_legs` plus the check in `main` / actual: separate `beside_leg_check`; `test_verify_host.run_main` gains `env`/`argv` and clears `TK_SUPERVISOR_HOST_LEG` / why: testability; the suite itself runs inside a live leg / may affect: none
- planned: run bun suites and `bunx tsc` / actual: unverifiable here (bun absent); types checked with tsc 5.9.3 + `@types/bun` from a temp dir / why: bun absent on this host / may affect: 38-2

DEVIATION SCORE: 1

DRIFT: 49 contract-version pins flipped, not 48 (a regex pin at test_driver_contract.py:113) — the plan's count missed the regex form — affects: 38-2
DRIFT: Story 37.2 FAKE_LEG prSection pin gains the Durations line — Durations sits between Verdicts and fences per the settled shape — affects: none
DRIFT: close-out lease written through new helper noteCloseOutLease (hostverify.ts) with a cast for self in worktree.ts — ownerDetail is private to queue.ts outside Files — affects: none
DRIFT: guard key carried on hostverify Deps, not a runStep parameter — reaches every step without widening helpers — affects: none
DRIFT: extra exported helpers gateVerdicts, unrunSuites; guardInconclusive returns boolean — shared by reason and PR text — affects: none
DRIFT: TK_SUPERVISOR_HOST_LEG falls back to "host-leg" when run_id is absent — exemption must hold for id-less callers — affects: none
DRIFT: beside-leg check factored as beside_leg_check; test run_main gains env/argv — testability inside a live leg — affects: none
DRIFT: bun suites and bunx tsc unverifiable here — bun absent on the launch host — affects: 38-2

Dev record (consult ruling): the 49th flip is the `assertRegex` pin at `test_driver_contract.py:113`, so 38-2's bump flips 49 pins, not 48. The bun suites and `bunx tsc --noEmit` were not checkable on this host and are left to the host leg.


### pass 2 (2026-11-07, implementer: verify-fix)

bun was found at `~/.bun/bin` (1.4.3), so the supervisor suites ran here after all (pass 1's last DRIFT is superseded: `bun test --timeout 30000` and `bunx tsc --noEmit -p .` were run). Three `hostleg.test.ts` 38.1 cases threw `RunTerminal: a terminal queue run is immutable` (the post-terminal `UPDATE runs SET worker_guard_s`); `fixture()` now takes `workerGuardS` set before `queue.end`, each row asserting the value stuck. DEVIATIONS: none. DEVIATION SCORE: 0.

Verify after pass 2: lib suite 2930 OK (4 skipped); conformance `ok: true`; `bun test --timeout 30000` 1998 pass / 2 fail — the 2 are `guards.test.ts` "sbx: the in-VM wall-clock guard rides the argv", untouched by this story, env-dependent (this shell exports `TK_ATLASSIAN_*`; with them unset `guards.test.ts` is 57 pass / 0 fail); `bunx tsc --noEmit -p .` clean. Matrix audit: every row covered (`hostverify.test.ts` legGuard/suiteDurations/guardInconclusive; `LEG_GUARD_ROWS` through `worktree.test.ts`, `closeout.test.ts`, `hostleg.test.ts`; `test_verify_host.py` TestDurations, TestBesideLeg).

## Consult Log

- 2026-11-07T21:24:33Z — trigger: deviation-gt-0 — question: accept the implementer's eight local deviations (score 1)? — ruling: accept-deviation score 1 — do: Accept all eight deviations at score 1 and continue; do not change the code. | Record that the 49th flip is the assertRegex pin at test_driver_contract.py:113 (38-2 flips 49) and that bun suites and bunx tsc are left to the host leg. — rule candidate: When a plan gives a pin-flip count, it counts every form of the literal (grep -c on the escaped and unescaped text, every assert method), not one assert form.
- 2026-11-07T21:42:02Z — trigger: reading choice (review finding E3) — question: does AC1's "the host-verify event names guard: host_verify_seconds (Ns)" mean the trip text (A) or a guard field on every leg (B)? — ruling: apply — do: Keep Reading A (the trip-only guard field reads guard: <key> (<N>s)). | Reject the Edge Case Hunter's finding; add no guard_s/guard_key fields and leave the 0.1.34 paragraph. — rule candidate: When an AC quotes an existing event field's literal text with only a key or value changed, read it as changing that field's text under its existing write condition.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-07T20:38:28Z | 2026-11-07T21:02:55Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-07T21:03:21Z | 2026-11-07T21:51:30Z | 28985d50-a57c-4a69-8003-1c8eaaaeb0db | claude-opus-5-5 | medium | 29466392 | 175105 | 14.3533 | completed |
| gate | 1 | 2026-11-07T21:51:31Z | 2026-11-07T21:55:15Z | a0e30952-787d-435f-92e4-df01cedcda98 | claude-opus-5-5 | medium | 1762011 | 14005 | 1.3871 | completed |
| host-leg | 1 | 2026-11-07T21:55:25Z | 2026-11-07T22:57:52Z | — | — | — | — | — | — | green |
| close-out | 1 | 2026-11-07T22:57:52Z | 2026-11-07T22:58:00Z | — | — | — | — | — | — | PR |
| merge | — | 2026-11-07T23:00:45Z | 2026-11-07T23:00:45Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-38-20261107T203050Z-966fd1` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** The host verify leg now runs under its own guard, `guards.host_verify_seconds` (7200 on run-epic, run-vertical-slice and run-sweep; guards merge key-wise on type extension; `job.py validate` and `job.schema.json` admit the key, which does not satisfy the at-least-one rule). All three leg callers (close-out boundary, sweep tail, re-run) read `legGuard`, never `worker_guard_s`, pinned from one table (`LEG_GUARD_ROWS`). A trip reads `guard: host_verify_seconds (Ns)`. `tools/verify_host.py` prints `== durations:` before its verdict; the event records `suite_durations`; the PR body lists `Durations:`. A guard trip after at least one gate-level verdict, none red, is `inconclusive (guard)`: `partial`, the reason naming the guard and the unrun suites, the PR body `**Timed out:**`, re-run exit 1. The close-out legs write a `host-verify-leg` lease; an operator's `verify_host.py` reads `queue.db` (`mode=ro`) and refuses with exit 2 beside a live leg, `--beside-leg` overriding with a warning. `run-epic-38.json` dropped its interim (resolves 3600 / 7200). Contract 0.1.34 (additive). Runbook hole-113 row fixed; handoff records the narrowed-leg question as Tim's; DW-174 resolved by Story 38.1.

**Files changed (25, all in the plan's Files):**
- `apps/supervisor/src/hostverify.ts` -- legGuard, keyed guard text, suiteDurations, LEG_SUITES, guardInconclusive, reason/PR text, close-out lease helper, TK_SUPERVISOR_HOST_LEG, `verify.host timed out`
- `apps/supervisor/src/closeout.ts`, `worktree.ts`, `hostleg.ts` -- legGuard; the close-out lease (closeout, worktree)
- `apps/supervisor/src/cli.ts` -- verify answer carries suite_durations
- `apps/supervisor/test/fakes.ts`, `hostverify.test.ts`, `hostleg.test.ts`, `closeout.test.ts`, `worktree.test.ts` -- the one table and pins
- `tools/verify_host.py`, `plugins/tk-studio/lib/tests/test_verify_host.py` -- durations line, beside-leg gate
- `plugins/tk-studio/lib/job.py`, `contracts/job.schema.json`, `jobs/run-epic.json`, `jobs/run-vertical-slice.json`, `jobs/run-sweep.json`, `lib/tests/test_job.py`, `.tk-studio/jobs/run-epic-38.json` -- the key, merge, interim dropped
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- 0.1.34
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md`, `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- records

**Review:** 2 patches applied (1 medium, 1 low), 2 deferred (medium), 2 rejected. Follow-up review: false (patched high 0, medium 1, low 1; score 3x1+1x1 = 4 < 5).

**Verification:**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2930 tests OK (4 skipped)
- `uv run python ../contracts/conformance/runner.py run`: ok: true
- `job.py validate` run-epic-38 / run-epic / run-vertical-slice / run-sweep: ok; run-epic-38 resolves `{max_turns: 80, max_wall_clock_seconds: 3600, host_verify_seconds: 7200}`
- `verify_host.py --help`: names `--beside-leg`
- `bun test --timeout 30000` (apps/supervisor, bun 1.4.3 at ~/.bun/bin): 2000 pass / 0 fail with this shell's `TK_ATLASSIAN_*` unset; with them set, 2 `guards.test.ts` sbx argv cases fail (env-dependent, untouched by this story, pre-existing)
- `bunx tsc --noEmit -p .`: clean

**Residual risks:** the serve process changes (stop the supervisor tab before building `apps/supervisor`, restart through the scheduled task after the merge); the two deferrals above; unverifiable-here (operator, after merge and restart): 38.2's leg names `suite_durations` and `guard: host_verify_seconds`, and `uv run python tools/verify_host.py` started while a leg is live exits 2 naming the run.

DRIFT: 49 contract-version pins flipped, not 48 (a regex pin at test_driver_contract.py:113) — the plan's count missed the regex form — affects: 38-2
DRIFT: Story 37.2 FAKE_LEG prSection pin gains the Durations line — Durations sits between Verdicts and fences per the settled shape — affects: none
DRIFT: close-out lease written through new helper noteCloseOutLease (hostverify.ts) with a cast for self in worktree.ts — ownerDetail is private to queue.ts outside Files — affects: none
DRIFT: guard key carried on hostverify Deps, not a runStep parameter — reaches every step without widening helpers — affects: none
DRIFT: extra exported helpers gateVerdicts, unrunSuites; guardInconclusive returns boolean — shared by reason and PR text — affects: none
DRIFT: TK_SUPERVISOR_HOST_LEG falls back to "host-leg" when run_id is absent — exemption must hold for id-less callers — affects: none
DRIFT: beside-leg check factored as beside_leg_check; test run_main gains env/argv — testability inside a live leg — affects: none
DRIFT: a guard-tripped host's skipped engine/assets reason reads `verify.host timed out` (a new skip reason, named in the 0.1.34 paragraph) — AC2's "timed out, never failed" on the PR body (review patch) — affects: none

## Reconcile

- 2026-11-07 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 38-2-a-run-that-does-no-work-says-so (plan refreshed in place: 38.1's moved anchors, the no-changes skip placed before noteCloseOutLease, 49-pin note, bun at ~/.bun/bin; plan stage rows ok)
