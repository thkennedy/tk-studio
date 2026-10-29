---
title: 'DW bundle launch-check-advisories: a live pin record and an inode row in launch check (DW-57, DW-59)'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: 'aff62df8188c553794b2d25b60ec12bdd7bea1dd'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [multiple-goals]
deferred: []
---

<intent-contract>

## Intent

**Problem:** `launch.py check`'s advisory `engine sandbox` row (`engine_sandbox_row`, launch.py:741) reads any `.pin` file as "pinned by the supervisor". A record left by a manual `sbx stop`, a reboot or a kept release therefore hides the "started outside the supervisor" warning (DW-57). Separately, `check` has no inode reading for the engine sandbox, so a `/tmp` that fills up again (hole 70: 1.3 M inodes) shows only when the engine fails to write (DW-59).

**Approach:** Parse the pin record `{sandbox, since, run_id, supervisor_pid}`. Treat it as absent when it is unreadable, when its `supervisor_pid` is not a live process on this host, or when its `since` predates the sandbox's start, read as host-now minus `sbx exec <sb> cat /proc/uptime`. Add a new advisory row, `engine sandbox inodes`, immediately after `engine sandbox`. For each running engine sandbox it reads `sbx exec <sb> df -i /` and warns below 50,000 free inodes. Like every advisory row, it is never a gap.

## Boundaries & Constraints

**Always:** Both rows stay `ok: true` and never add to `gaps`. Every sbx call goes through `run_sbx` via `sandbox_login._call`, argv-only, under a `sandbox_login.Deadline` budget. A spent budget, timeout, failed or unparseable `sbx exec` never raises. For the pin, an unknowable start leaves the pid verdict alone (the record counts as live if its pid is alive). For inodes, it reads `<sb>: inodes unknown`. Stdlib only. The pid check reuses `jobrun._pid_alive` and does not reimplement it. Tests inject a fake `run_sbx`; no live sbx.

**Block If:** The `/proc/uptime` read is the only path to the sandbox start, and it cannot be used without changing the supervisor (`apps/supervisor`).

**Never:** Edit `apps/supervisor`, the pin record's format or writer, `driver-contract.md` (the 0.1.27 note stays a historical record and no contract version bump happens), or the deferred-work ledger. Never stop, start or prune a sandbox. Do not add `sbx exec` to the pin check when no pin record exists or its pid is already dead.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| live pin | running; record pid alive; `since` after start (uptime) | `pinned by the supervisor` | — |
| dead pid | running; record `supervisor_pid` not alive | OUTSIDE_WARNING; no `sbx exec` call | — |
| pin older than start | running; pid alive; `since` < now − uptime | OUTSIDE_WARNING | — |
| bad record | running; record not JSON / missing or non-int `supervisor_pid` / unparseable `since` | OUTSIDE_WARNING | no raise |
| uptime unreadable | running; pid alive; `sbx exec … cat /proc/uptime` fails or is garbage | `pinned by the supervisor` | no raise |
| inodes ok | one running sandbox, `df -i /` IFree 900000 | `engine sandbox inodes`: `900000 free inodes on /` | — |
| inodes low | IFree 12000 | `warning: <sb> has 12000 free inodes on / (below 50000); the engine may fail to write` | — |
| inodes unknown | df fails, IFree `-`, or output unparseable | `<sb>: inodes unknown` | no raise |
| not running / none / absent / down | same states as the engine sandbox row | `not running`, `no engine sandbox configured`, `sbx absent`, `daemon down` | no raise |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/launch.py:722-790` -- `ENGINE_SANDBOX_CHECK`, `OUTSIDE_WARNING`, `pin_record_path`, `engine_sandbox_row`. The presence-only test is `elif pin_record_path(sb).is_file()` at :780. The row's call pattern (config → `config_sandboxes` → `Deadline` → `daemon status` → `ls` → `_listed`) is the template for the inode row.
- `plugins/tk-studio/lib/launch.py:251-262` -- `run_sbx(args, timeout)`. It is module-level so tests can swap it.
- `plugins/tk-studio/lib/launch.py:1229-1231` -- `check()` appends `engine_sandbox_row()`. The new row is appended right after it, before `playable_path_row`.
- `plugins/tk-studio/lib/launch.py:52-57` -- module docstring for the engine sandbox row. Its claim "no other sbx command runs" must be updated.
- `plugins/tk-studio/lib/sandbox_login.py` -- `config_sandboxes`, `Deadline`, `BUDGET_S=20`, `_call(run, args, deadline)` → `(proc, why)`, `_Spent`, `_listed`. Reuse these and do not change them.
- `plugins/tk-studio/lib/jobrun.py:177` -- `_pid_alive(pid)`, cross-platform (win32 uses OpenProcess). jobrun does not import launch, so there is no import cycle.
- `apps/supervisor/src/sandbox.ts:311-320` -- read-only. It writes the record as pretty JSON `{sandbox, since: ISO-8601 Z, run_id, supervisor_pid: number}`.
- `plugins/tk-studio/lib/tests/test_launch.py:151-171` -- `_FakeSbx` handles `daemon status` and `ls` only. Extend it to script `exec <sb> cat /proc/uptime` and `exec <sb> df -i /`. Tests at :1095-1160 use `_engine_row`. The existing pinned test writes `supervisor_pid: 1`, which must become a live pid (`os.getpid()`), and `since` must postdate the faked start.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md:59` -- prose for the advisory row. Update it to cover the live-record rule, the new row and its exact texts.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/launch.py` -- Add a helper (e.g. `_pin_live(sb, deadline)`) that reads and parses the record (returns `None` when it is absent or unreadable), checks the pid with `jobrun._pid_alive`, and then compares `since` with the start read from `/proc/uptime`. `engine_sandbox_row` uses it in place of `is_file()`. Add `INODE_FLOOR = 50000`, `ENGINE_INODES_CHECK = "engine sandbox inodes"` and `engine_sandbox_inode_row(env=None)`, and wire the row into `check()` after the engine sandbox row. Update the docstrings and module docstring. -- DW-57 and DW-59.
- `plugins/tk-studio/lib/tests/test_launch.py` -- Extend `_FakeSbx`, fix the existing pinned test, and add one test per I/O matrix row. Assert the row order, `ok: true` and no gap for the new row, and that no `sbx exec` runs for a dead-pid record. -- proof.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- Document the live-record rule and the `engine sandbox inodes` row with its texts. -- the operator-facing surface.

**Acceptance Criteria:**
- Given a running engine sandbox with a pin record whose `supervisor_pid` is dead, or whose `since` predates the sandbox start, when `launch.check` runs, then the `engine sandbox` row reads `warning: <sb> started outside the supervisor; the next pin restarts it`.
- Given a running engine sandbox whose root has fewer than 50,000 free inodes per `sbx exec <sb> df -i /`, when `launch.check` runs, then the `engine sandbox inodes` row, right after `engine sandbox`, reads the low-inode warning, and `result["ok"]` and `gaps` are unaffected.
- Given the VERIFY GATE, when both commands run from `plugins/tk-studio/lib`, then the suite is green and conformance reports `ok: true`.

## Design Notes

Start time: `start = now_utc - float(first token of /proc/uptime)`. The record is stale when `since < start − PIN_SKEW_S` (120 s; guest uptime can lag the host across a VM pause or boot) (parse `since` with `datetime.fromisoformat`, accepting `Z`). Uptime is relative, so any clock skew between host and VM does not matter. The supervisor runs on the host, so `supervisor_pid` is a host pid.

`df -i /` parse: take the last non-empty line's columns, IFree is `cols[-3]` (Filesystem, Inodes, IUsed, IFree, IUse%, Mounted on). This survives a wrapped filesystem name. A non-integer IFree reads as unknown.

With several sandboxes, the inode row names each one the way the engine sandbox row does (`<sb>: …`, joined by `; `). Its warnings stand unprefixed: `warning: <sb> has …`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`

## Deviation Summary

- planned: change only the existing pinned test among the existing engine-sandbox tests / actual: three more existing assertions changed (daemon-down call list now `[["sbx","daemon","status"]] * 2`; the no-pin warning test checks the first two calls plus one `df -i` exec; the playable-path order assertion now follows `engine sandbox inodes`) / why: the new row runs its own `daemon status`/`ls`/`df` and sits between `engine sandbox` and `playable path` / may affect: none
- planned: `_pin_live` "returns None when absent or unreadable" / actual: returns a bool (False when absent, unreadable or stale) / why: the row needs only a live/not-live verdict; behaviour matches the matrix / may affect: none
- planned: add `INODE_FLOOR`, `ENGINE_INODES_CHECK`, `engine_sandbox_inode_row` / actual: also a `LOW_INODES_WARNING` text constant and a `_free_inodes` parse helper / why: mirrors `OUTSIDE_WARNING`; keeps the df parse testable / may affect: none

DRIFT: existing engine-sandbox/playable test assertions adjusted for the new row's sbx calls and position — the new row necessarily adds calls and shifts order — affects: none
DRIFT: `_pin_live` returns bool rather than the record-or-None — only a verdict is consumed — affects: none
DRIFT: added `LOW_INODES_WARNING` and `_free_inodes` helpers — local structure, same pattern as `OUTSIDE_WARNING` — affects: none

consult: accepted, score 1

### pass 2 (2026-10-29, review patches)

- planned: stale when `since` < now − uptime / actual: stale only when more than 120 s older (`PIN_SKEW_S`) / why: a live pin falsely warned after VM pause or boot jitter / may affect: none
- planned: SKILL.md wording limited to the stated rule / actual: also names the 120 s tolerance and that a kept pin under a live supervisor stays legitimate / why: doc matches code and the review's correction / may affect: none
- planned: fix a "kept release" claim in launch.py docstrings / actual: none existed; docstrings updated only to mention the tolerance / why: accuracy after the tolerance patch / may affect: none

consult: accepted, score 1

DRIFT: pin staleness uses a 120 s tolerance (`since < start − PIN_SKEW_S`) — a zero-margin comparison falsely warned on live pins across VM pause/boot jitter — affects: none
DRIFT: SKILL.md and launch.py docstrings name the tolerance — keep docs aligned with the code — affects: none


## Consult Log

- 2026-10-29T18:41:17Z — trigger: deviation-gt-0 — question: accept the three implementer deviations (re-pinned engine-sandbox/playable-order test assertions, bool `_pin_live`, extra private helpers) at score 1, or higher/escalate given driver-contract 0.1.27 text? — ruling: accept-deviation score 1 — do: keep all three deviations; leave driver-contract.md unedited; record "consult: accepted, score 1" and continue to review — rule candidate: inserting an advisory launch-check row at a named position and re-pinning neighbour adjacency asserts is score 0 when the contract's "after <row>" wording still holds; contract-text changes about launch-check rows are a separate contract-bump item
- 2026-10-29T18:48:31Z — trigger: deviation-gt-0 (review patch pass) — question: accept the 120 s pin skew tolerance, the df Inodes-0 unknown fallback and the SKILL.md wording at score 1 given the matrix row 'since < now − uptime'? — ruling: accept-deviation score 1 — do: keep the three patches and leave intent-contract untouched; amend Design Notes stale rule to name PIN_SKEW_S; add a Deviation Summary bullet and DRIFT line — rule candidate: on an advisory never-gap launch-check row, a bounded tolerance or unknown fallback that only reduces false warnings is score 1, recorded in Deviation Summary and Design Notes, never in the intent-contract

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` the `since` vs sandbox-start comparison had no margin, so a live pin read OUTSIDE_WARNING after a VM pause or boot jitter. Added `PIN_SKEW_S = 120` and a within-tolerance test.
  - `[low]` `[patch]` `df -i` with total Inodes 0 (btrfs-style dynamic inodes) gave a false low-inode warning. `_free_inodes` now returns unknown, with a test.
  - `[low]` `[patch]` SKILL.md claimed a kept-release record reads as the warning, which is wrong under a live supervisor. Reworded to the actual rule.
- rejected:
  - the inode row repeats `daemon status`/`ls` under its own budget. Rejected: each advisory row is bounded, the spec requires only a Deadline budget per row, and the extra cost appears only when sbx hangs.
  - pid reuse after a supervisor exit could read a dead supervisor's record as live. Rejected: pid liveness is the ledger's proposed rule; the since-vs-start check covers the reboot case where reuse is likeliest.

### 2026-10-29 — Review pass (follow-up, fresh review of done spec)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` `_pin_live` computed `start - timedelta(seconds=PIN_SKEW_S)` outside the `OverflowError` guard, so a garbage-but-finite guest uptime that put `start` within 120 s of `datetime.min` made `launch.check` raise. The floor is now computed inside the guard (an overflow keeps the pid verdict), and `test_engine_sandbox_uptime_near_datetime_min_keeps_the_pid_verdict` is added. It was confirmed red against the old code.
  - `[low]` `[patch]` Two docstring lines (module docstring and `_pin_live`) ran past the wrap width. Re-wrapped with the wording unchanged.
- rejected:
  - each sandbox row repeats `daemon status`/`ls` under its own budget. Rejected for the same reason as the prior pass: per-row bounded budgets are the spec's rule, and the cost appears only when sbx hangs.
  - the `/proc/uptime` start depends on how the sandbox is isolated (container vs. VM pause). Rejected: the intent-contract Approach names this exact source, and `PIN_SKEW_S` covers pause jitter.
  - a huge `supervisor_pid` raises `OverflowError`. Rejected: `jobrun._pid_alive` catches `OverflowError` on POSIX, and the win32 path catches `Exception`.
  - `launch` depends on the private `jobrun._pid_alive`. Rejected: the intent-contract requires reusing it.
  - a naive `since` is read as UTC. Rejected: the record writer (`apps/supervisor/src/sandbox.ts`) always emits a `Z` instant, and the case is outside the matrix.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261029T174706Z-da84bd` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** This was a follow-up review of the done DW-57/DW-59 change (a live pin record in the `engine sandbox` row, plus the new `engine sandbox inodes` advisory row), covering the whole diff since `aff62df8188c553794b2d25b60ec12bdd7bea1dd`. Both layers ran: blind-hunter and edge-case-hunter. The pass closed one never-raises gap: an extreme guest uptime could overflow the `PIN_SKEW_S` floor and make `launch.check` raise. It also re-wrapped two docstring lines.

**Files changed (this pass):**
- `plugins/tk-studio/lib/launch.py`: `_pin_live` now computes the skew floor inside the `OverflowError` guard; two docstring paragraphs are re-wrapped.
- `plugins/tk-studio/lib/tests/test_launch.py`: adds `test_engine_sandbox_uptime_near_datetime_min_keeps_the_pid_verdict`.

**Review findings:** 2 patches applied (0 high, 0 medium, 2 low). 0 deferred, 5 rejected. Follow-up review recommended: false (patched high 0, medium 0, low 2; score 3×0 + 2 = 2).

**Verification:** from `plugins/tk-studio/lib`, `uv run python -m unittest discover tests` ran 2542 tests, OK (4 skipped), and `uv run python ../contracts/conformance/runner.py run` reported `ok: true`. Both were run after the patch, by the implementer and again by this session.

**Deviations:** none this pass. deviation_score stays 1, from the prior passes.

**Residual risks:**
- The residual risks recorded in the prior run still stand: up to two extra sbx calls per sandbox with a 20 s budget per row, pid reuse, a manual stop/start within 120 s, and the driver-contract 0.1.27 note left unchanged.
- `_bmad-output/implementation-artifacts/deferred-work.md` was already modified by the orchestrator before this run (DW-57/DW-59 status). Per the invocation, this run neither touched nor committed it, so it remains the only uncommitted file.

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Part B note: this unit is a sweep DW bundle (DW-57, DW-59), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 `test_engine_sandbox_pin_record_with_a_dead_pid_is_a_warning_with_no_exec`, `test_engine_sandbox_pin_record_older_than_the_sandbox_start_is_a_warning`; AC2 `test_engine_sandbox_inodes_low_is_a_warning_never_a_gap` plus the row order after `engine sandbox` (`launch.py` `ENGINE_INODES_CHECK`, SKILL.md:59); AC3 per the Auto Run Result (2542 OK, conformance `ok: true`), and this session's rerun of `tests.test_launch` (126 OK). Live sbx behaviour (real `/proc/uptime` and `df -i` on the engine box) can't be checked here.
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met, and live sbx readings can't be checked here
