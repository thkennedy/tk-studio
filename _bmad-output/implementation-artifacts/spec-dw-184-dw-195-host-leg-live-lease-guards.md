---
title: 'DW-184, DW-195: the host leg lease carries its deadline; the supervisor preload refuses beside a live leg'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
warnings: ['multiple-goals', 'oversized']
deferred:
  - summary: >-
      A re-run's lease deadline starts at takeVerifyLeg, before the cut and materialise, so the leg's host step can outlive the deadline by the cut time and both guards stop refusing in that tail.
    evidence: |-
      hostleg.ts rerunHostLeg takes the lease (with guard_s) before git fetch / worktree add / materialise; runLeg's host step then gets a fresh guardS. The intent fixes the deadline as lease started-at plus host_verify_seconds, so a margin or a re-noted lease is a follow-up decision (deferral (a): the refusal behaviour the criteria name).
    location: >-
      apps/supervisor/src/hostleg.ts:285
    severity: low
  - summary: >-
      A close-out lease's deadline is one leg guard after the lease, but hostVerify runs up to four steps (host, assets, engine, playable) each under the full guard, so a multi-step leg can outlive its deadline and both guards stop refusing in that tail.
    evidence: |-
      leaseClock(guardS) at apps/supervisor/src/liveleg.ts:33-35 is written by noteCloseOutLease (hostverify.ts:244-249) before hostVerify; steps at hostverify.ts:607/618/640/650 each get guardS. The intent fixes the deadline as lease start plus one leg guard; the later steps (assets, engine, playable) run past it by design, so a whole-leg deadline is a follow-up decision (deferral (a); consult 2026-11-08T21:47:05Z). The host step, which carries the bun drives hole 118 names, lies inside the first guard window.
    location: >-
      apps/supervisor/src/hostverify.ts:244
    severity: low
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: '6b54f6a2d195ac983be3a139bf54c58bc4b01b74'
---

<intent-contract>

## Intent

**Problem:** (DW-184) `tools/verify_host.py` `live_legs` treats every latest `host-verify-leg` lease with an owner and no later `host-verify` as live. The lease records no deadline, so if serve crashes mid-leg, every operator `verify_host.py` run after that refuses with exit 2. (DW-195) A hand `bun test` in `apps/supervisor` has no beside-leg guard. Its contention makes the leg's bounded bun drives read a hang (hole 118).

**Approach:** Every `host-verify-leg` lease carrying an owner records `guard_s` and `deadline` (the lease's start plus the leg guard's seconds, from `legGuard`). A live leg is now a lease with an owner, no later `host-verify`, and either no deadline (a pre-change lease, unchanged behaviour) or a deadline still ahead. Python (`live_legs`) and a new stdlib-free TS module read that same signal. `apps/supervisor/test/preload.ts` uses the TS module to refuse a `bun test` beside a live leg with exit 2, naming the run, unless `TK_VERIFY_BESIDE_LEG=1`. The leg's env and `verify_host.py --beside-leg` both set that variable for their children.

## Boundaries & Constraints

**Always:** No owner pid probe anywhere (on win32 `os.kill` is TerminateProcess). Python stays stdlib-only. Every text-mode open and every `text=True` subprocess names `encoding="utf-8"`. Every `bun test` command written or run names `--timeout`. The queue is read read-only (`mode=ro` in Python; `{ readonly: true }` in `bun:sqlite`). The existing refusal and warning wording stays byte-identical. Leave the deferred-work ledger alone. Amend `driver-contract.md` for the new lease fields and the live-leg rule, with a pinning test in `test_driver_contract.py`, following the existing `0.1.34 (…)` note pattern. No version bump.

**Block If:** The leg guard is not available where `takeVerifyLeg` is called (hostleg.ts:285), so a re-run lease cannot record its deadline without restructuring `rerunHostLeg`.

**Never:** Do not edit `_bmad-output/implementation-artifacts/deferred-work.md`, `epics.md`, plan files or `stories.yaml`. Do not change `_budget.py` bounds. Never treat a lease that has no deadline as stale. Never let the preload refuse when `TK_SUPERVISOR_DB` is unset or its file is absent. Never let it refuse inside the leg's own run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live leg (deadline ahead) | latest lease `{owner, deadline: now+1h}`, no later host-verify | verify_host refuses with exit 2 (wording unchanged); preload exits 2 naming `queue run <id>` | — |
| Stale leg (deadline past) | latest lease `{owner, deadline: now-1s}` | not live: verify_host runs its gates; preload lets tests run | — |
| Pre-change lease | `{owner}` with no deadline | live, as today | — |
| Unparsable deadline | `deadline: "garbage"` | treated as no deadline (live) | no crash |
| Closed/released | later `host-verify`, or `{owner: null}` | not live | — |
| Beside-leg override | live leg + `TK_VERIFY_BESIDE_LEG=1` | preload lets tests run | — |
| Leg's own run | `TK_SUPERVISOR_HOST_LEG` set | preload never reads the queue | — |
| No / unreadable queue | DB unset or absent, or unreadable | preload: no check (unreadable: one stderr note, tests run) | swallow the error |

</intent-contract>

## Code Map

- `tools/verify_host.py:385-449` -- `LIVE_LEGS_SQL`, `live_legs` (filters `owner is None`; add the deadline filter here), `beside_leg_check` (under `--beside-leg`, set `os.environ["TK_VERIFY_BESIDE_LEG"]="1"` so its gates' bun children pass the preload). Module docstring :30-36 describes the live-leg rule, so update it.
- `apps/supervisor/src/hostverify.ts:224-243` -- `legGuard`, `noteCloseOutLease(queue, runId, self)`. Add a guard-seconds param and record `guard_s` and `deadline` (ISO, `Date.now()+guard*1000`). :584 sets `env.TK_SUPERVISOR_HOST_LEG`; also set `env.TK_VERIFY_BESIDE_LEG = "1"` there (verify_host.py strips only `TK_SUPERVISOR_*`, so this variable reaches the bun children).
- Callers of `noteCloseOutLease`: `closeout.ts:483-484`, `closeout.ts:1074-1075`, `worktree.ts:1778-1779`. Each already holds `g = legGuard(...)`, so pass `g.seconds`.
- `apps/supervisor/src/queue.ts:1758` `takeVerifyLeg(runId, self, by?)`. Add an optional guard-seconds param that writes `guard_s` and `deadline` into the lease. `hostleg.ts:285` is the caller: compute `legGuard(queue.definition(run))` there (it is already computed at :365 for the leg).
- New `apps/supervisor/src/liveleg.ts` -- `liveLegs(dbPath, nowMs)` → `{legs: {run_id, by, at}[], error?}`, using the same SQL and rule as Python, plus `besideLegRefusal(env, nowMs): string | null` (the refusal text, or null). It imports only `bun:sqlite` and node builtins, never queue.ts (the preload must stay light).
- `apps/supervisor/test/preload.ts` -- call `besideLegRefusal(process.env, Date.now())`. When non-null, write it to stderr and `process.exit(2)`. Do this before anything else runs.
- Tests: `plugins/tk-studio/lib/tests/test_verify_host.py:575-680` (`TestBesideLeg`, `event()` helper, `OWNER`); `apps/supervisor/test/hostverify.test.ts:1534` (leg env test); `closeout.test.ts:1793` and `worktree.test.ts:1152` (lease detail `toMatchObject`); `queue.test.ts:1879` (takeVerifyLeg); `hostleg.test.ts`.
- `plugins/tk-studio/contracts/driver-contract.md:2686-2711` (38.1 lease and beside-leg refusal text), plus a new note `**0.1.34 (DW-184, DW-195, additive).**` appended just before `## 8. Conformance`. `plugins/tk-studio/lib/tests/test_driver_contract.py` gets the pinning test (pattern at `test_0_1_34_dw_27_dw_128_dw_129_…`).
- `kb/agent-pc-setup-runbook.md:1692` -- the hole-118 row. Its fix cell must state the rule: the preload refuses beside a live leg with exit 2 unless `TK_VERIFY_BESIDE_LEG=1`; a lease past its deadline is stale.
- Bun is at `~/.bun/bin/bun` (not on PATH in this sandbox): `export PATH="$HOME/.bun/bin:$PATH"`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- `noteCloseOutLease(queue, runId, guardS, self?)` records `guard_s` and `deadline`. The leg env carries `TK_VERIFY_BESIDE_LEG=1`. Update the doc comments.
- `apps/supervisor/src/queue.ts`, `hostleg.ts`, `closeout.ts`, `worktree.ts` -- pass the guard seconds through. The re-run lease records `guard_s` and `deadline` too.
- `apps/supervisor/src/liveleg.ts` (new) and `apps/supervisor/test/preload.ts` -- the shared signal reader and the refusal: `bun test: refused: a host leg is live on this box: queue run <id> (by <by>, since <at>)[; …]; a hand test beside the leg slows its bounded drives (hole 118): wait for its host-verify event (GET /runs/<id>), or set TK_VERIFY_BESIDE_LEG=1 to run anyway`.
- `apps/supervisor/test/liveleg.test.ts` (new) -- the matrix rows against a fixture `events` table, plus one spawn of `bun test --timeout 30000 <a probe test file>` with a live-lease DB showing exit 2 and the run id, and showing a pass with `TK_VERIFY_BESIDE_LEG=1`. Update the lease-detail assertions in `closeout.test.ts`, `worktree.test.ts`, `queue.test.ts` and `hostverify.test.ts` (the env carries the variable).
- `tools/verify_host.py` + `plugins/tk-studio/lib/tests/test_verify_host.py` -- the deadline rule, with tests for past, future, absent and unparsable deadlines. A test that `--beside-leg` sets `TK_VERIFY_BESIDE_LEG=1` for children.
- `plugins/tk-studio/contracts/driver-contract.md` + `test_driver_contract.py`; `kb/agent-pc-setup-runbook.md` hole-118 row.

**Acceptance Criteria:**
- Given a queue whose latest lease for run R has an owner and a deadline in the past, when the operator runs `verify_host.py`, then it runs its gates (no exit 2).
- Given a lease with a deadline still ahead, when the operator runs `verify_host.py`, then it refuses with exit 2 and the current wording.
- Given a close-out or re-run leg starting, when its lease is noted, then the event detail carries `guard_s` equal to `legGuard(...).seconds` and an ISO `deadline` equal to start plus `guard_s`.
- Given `TK_SUPERVISOR_DB` naming a queue with a live lease for R, when someone runs a hand `bun test --timeout 30000 <file>` in apps/supervisor, then it exits 2 naming `queue run R` before any test runs. With `TK_VERIFY_BESIDE_LEG=1` set, the same command runs the tests.
- Given the host leg runs its command, then the command's env carries `TK_VERIFY_BESIDE_LEG=1`.

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 1 (high 0, medium 0, low 1)
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` TS (`Date.parse`) and Python (`fromisoformat`) deadline parsers disagreed on zoneless, padded and basic-format values despite the contract's same-rule claim; both now accept only a strict zoned extended ISO timestamp with range-checked fields, the rest reads as no deadline (live); paired tests on both sides
  - `[low]` `[patch]` the unreadable-queue test now captures stderr and asserts exactly one note naming the path
  - `[low]` `[patch]` the paused close-out's lease (`pausedLegs`) now asserts `by`, `guard_s` and `deadline`
  - `[low]` `[patch]` the runbook hole-118 row names each guard's own override (`--beside-leg` vs `TK_VERIFY_BESIDE_LEG=1`)
- deferred (criterion (a)): re-run deadline counted from the lease, not the host step — the intent fixes started-at + guard

### 2026-11-08 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 1 (high 0, medium 0, low 1)
- reject: 4 (high 0, medium 0, low 4)
- addressed_findings:
  - `[low]` `[patch]` liveleg.ts `liveLegs` set no busy timeout (the Python twin waits 5 s), so a busy queue made the preload's check fail open: it now sets `PRAGMA busy_timeout = 5000` on the read-only handle
  - `[low]` `[patch]` liveleg.test.ts: two `writeFileSync` text writes named no encoding: both now pass `{ encoding: "utf-8" }`
  - `[low]` `[patch]` runbook hole-118 row claimed the refusal unconditionally: it now states that the check reads the queue `TK_SUPERVISOR_DB` names (unset or absent: no check)
- deferred: the close-out lease deadline (one guard) vs a multi-step leg (per-step guards): frontmatter `deferred:`, criterion (a), per consult ruling
- rejected (reasons): TS/Python parser parity on years 0001-0099 and sub-ms fractions — the writer emits `toISOString` (ms, current years), and the earlier consult ruled the fraction precision as is; `takeVerifyLeg` guard optional — the one production caller (hostleg.ts:286) passes it, and the optionality is test plumbing; no contract version bump — the intent says "No version bump"; `leaseClock` RangeError past the Date range — needs a guard of over 8.6e12 s in config, not a real input

## Design Notes

The deadline is the lease's start plus one guard, as the intent fixes it. The leg's host step (the one running `verify_host.py`, the heavy contention source) is its first step and is killed at `guardS`. Past the deadline its gates are therefore dead, apart from a re-run's cut time before the step starts, which is small. The later engine and playable steps get their own guard but are not what hole 113/118 guards against. A lease without `deadline` keeps today's behaviour, so leases written before this change still need `--beside-leg` or a re-run to clear.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bun test --timeout 30000 test/liveleg.test.ts test/hostverify.test.ts test/queue.test.ts test/closeout.test.ts test/worktree.test.ts test/hostleg.test.ts` -- expected: 0 fail
- `cd apps/supervisor && PATH="$HOME/.bun/bin:$PATH" bunx tsc --noEmit -p .` -- expected: no errors

## Deviation Summary

### pass 1 (2026-11-08)

- planned: `live_legs(env)` with the deadline filter added inside it / actual: an optional `now: datetime | None` parameter and a small `lease_deadline(detail)` helper in `tools/verify_host.py`, so tests can pin the time / why: deterministic past/future tests; existing callers unchanged / may affect: none
- planned: `liveleg.ts` exports `liveLegs` + `besideLegRefusal` / actual: also exports `leaseClock`, `leaseLive` and the env/SQL constants; `hostverify.ts` and `queue.ts` import `leaseClock` from it to build `{guard_s, deadline}` / why: one source for the deadline maths both lease writers share; `liveleg.ts` still imports nothing from queue.ts / may affect: none

DEVIATION SCORE: 1

DRIFT: `live_legs` gained an optional `now` parameter and a `lease_deadline` helper — deterministic tests of the deadline rule — affects: none
DRIFT: `liveleg.ts` also exports `leaseClock`/`leaseLive`, imported by `hostverify.ts` and `queue.ts` — single source for the lease deadline maths — affects: none

### pass 2 (2026-11-08, review patches)

- planned: the strict regex alone as the shared deadline rule / actual: both parsers also reject impossible field values (hour>23, minute/second>59, nonexistent day, offset >=24h) as no deadline / why: Bun rolls `2026-02-30` over and Python accepts `T24:00`, so the regex alone left the readers disagreeing / may affect: none

DEVIATION SCORE: 1

DRIFT: the lease deadline parsers range-check fields after the strict regex — the runtimes' date constructors disagree on impossible values — affects: none


## Consult Log

- 2026-11-08T21:25:38Z — trigger: deviation-gt-0 — question: accept the implementer's two score-1 deviations (live_legs `now` param + lease_deadline helper; liveleg.ts extra exports incl. leaseClock imported by hostverify.ts/queue.ts)? — ruling: accept-deviation score 1 — do: keep both deviations as implemented, no inlining; liveleg.ts stays a leaf module (bun:sqlite and node builtins only, nothing from queue.ts) — rule candidate: an optional defaulted parameter (e.g. an injected clock) or an extra export from a new leaf module within the spec's import bounds is a score-1 deviation needing no consult when no contract/schema surface changes

- 2026-11-08T21:42:55Z — trigger: deviation-gt-0 — question: accept the field-range checks beyond the strict deadline regex in liveleg.ts and verify_host.py? — ruling: accept-deviation score 1 — do: keep the field checks and paired tests; leave fraction precision (ms vs µs) as is, the writer emits toISOString — rule candidate: when TS and Python share a timestamp rule, validate field ranges explicitly on both sides and pin it with the same bad-input list

- 2026-11-08T21:47:05Z — trigger: halt — question: follow-up pass: is the close-out lease deadline (start + one per-step guard) outliving a multi-step leg an intent_gap (HALT), a defer beside DW-196, or a patch? — ruling: apply — do: triage it as defer (criterion (a)) beside DW-196 with the given reason; leave deferred-work.md and leaseClock/noteCloseOutLease unchanged; finalize with the other findings patched — rule candidate: when a review finding says a deadline/bound the frozen intent states exactly is too short or long and the design notes already name the uncovered tail, triage it as defer (criterion (a)), never intent_gap or patch

## Auto Run Result

Status: done
Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T202640Z-af3d56` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Run:** follow-up review pass (spec entered as `done`, `review_loop_iteration` 0), over base `6b54f6a2d195ac983be3a139bf54c58bc4b01b74` → `843f5e8e53ed1c08d5a0961a5904f79dfe5cc7e7`, code paths only (`apps`, `kb`, `plugins`, `tools`; 897 diff lines). The diff went to both layers as a file path, not inline. The Blind Hunter was told to read nothing else.

**Summary:** The original change is unchanged: every owned `host-verify-leg` lease records `guard_s`/`deadline`, a lease past its deadline is stale for `verify_host.py live_legs` and `liveleg.ts`, and `test/preload.ts` refuses a hand `bun test` beside a live leg unless `TK_VERIFY_BESIDE_LEG=1`. This pass hardened three small points: TS read parity on a busy queue, test encoding hygiene, and the runbook's precondition.

**Files changed (this pass):**
- `apps/supervisor/src/liveleg.ts`: `liveLegs` sets `PRAGMA busy_timeout = 5000` on its read-only handle (`QUEUE_BUSY_TIMEOUT_MS`, parity with verify_host.py `QUEUE_TIMEOUT_S`)
- `apps/supervisor/test/liveleg.test.ts`: the two garbage-file `writeFileSync` calls name `{ encoding: "utf-8" }`
- `kb/agent-pc-setup-runbook.md`: the hole-118 row states that the check reads the queue `TK_SUPERVISOR_DB` names (unset or absent: no check)

**Review:** 8 findings (Blind Hunter 7, Edge Case Hunter 1). 3 patches applied (low 3). 1 deferred (low: the close-out lease deadline vs a multi-step leg, per the consult ruling, criterion (a)). 4 rejected (parser parity edge years and fractions, the optional `guardS`, the version bump, the Date-range overflow; reasons in the triage log).
**Follow-up review:** not recommended (patched: high 0, medium 0, low 3; score 3×0+3 = 3 < 5).
**Verification:** implementer: lib suite 3048 tests OK (4 skipped); conformance `ok: true`; supervisor `bun test --timeout 30000` over the 6 spec files: 576 pass, 5 skip, 0 fail; `bunx tsc --noEmit -p .` clean. Re-checked by this session: `bun test --timeout 30000 test/liveleg.test.ts` 8 pass, 0 fail; `bunx tsc --noEmit -p .` exit 0.
**Residual risks:** The deferred deadline tail. With DW-196, a lease can read stale while a leg's later steps (or a re-run's cut window) are still running. The host step's bun drives lie inside the first guard window. No test pins the busy timeout, because pinning it would need a new export or a 5 s lock-holding test. `_bmad-output/implementation-artifacts/deferred-work.md` carries the orchestrator's uncommitted ledger edits from before this session. They are deliberately left untouched and uncommitted, so the working tree is clean apart from that orchestrator-owned file. The supervisor's serve modules changed, so the operator restarts the supervisor after the merge (unverifiable-here).

## Reconcile

- 2026-11-08 — score 1; reconcile not required.
- Spec resolution: unit key `dw-host-leg-live-lease-guards` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261108-202816-6452 state.json), `spec-dw-184-dw-195-host-leg-live-lease-guards.md`.
- Part B note: this unit is a sweep DW bundle (DW-184, DW-195), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1/AC2 test_verify_host.py:680 (past deadline → gates run), :689 (deadline ahead → exit 2, current wording), :709/:720 (absent/unparsable/strict-format → live); AC3 hostleg.test.ts:168 (re-run lease `guard_s`/`deadline`), worktree.test.ts:1157 (`guard_s` = `legGuard(...).seconds`), liveleg.test.ts:59 (`leaseClock` start + guard); AC4 liveleg.test.ts:126 (spawned `bun test --timeout 30000` exits 2 naming the run; passes with `TK_VERIFY_BESIDE_LEG=1`); AC5 hostverify.test.ts:1534 (leg env carries `TK_VERIFY_BESIDE_LEG=1`); contract pinned by test_driver_contract.py:3827. Rerun here: the spec's 6 supervisor files `bun test --timeout 30000` 576 pass / 5 skip / 0 fail; `tests.test_verify_host` + `tests.test_driver_contract` 151 OK. Two low deferrals (deadline tails) stay in frontmatter `deferred:`; the supervisor restart after merge is unverifiable-here.
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (focused suites rerun green)
