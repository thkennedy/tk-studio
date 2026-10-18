---
title: "The Plugin Side Honours the Queue's Starter Lock"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_revision: '54ec83d91abb6f3ef4a2a9d425be3b3523a61a4c'
review_loop_iteration: 0
deviation_score: 1
reconcile_verdict: not-required
followup_review_recommended: false
context: []
warnings: [oversized]
deferred:
  - summary: >-
      On darwin the supervisor case-folds the starter lock's checkout (foldCase folds win32 and darwin) while jobrun.py folds only on win32, so a mixed-case macOS root never matches and a live lock never refuses there.
    evidence: |-
      apps/supervisor/src/queue.ts foldCase lowercases on win32 and darwin; the story (AC1) pins the plugin's compare as "case-folded on Windows", so folding darwin would extend the story. Supervisor hosts are the Windows agent PC and the Linux engine today. DEFERRAL DISCIPLINE (a): AC1's checkout match. Edge-case-hunter, review pass 2026-10-17.
    location: >-
      plugins/tk-studio/lib/jobrun.py checkout match / apps/supervisor/src/queue.ts foldCase
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 27.2 made the supervisor write an advisory `starter.lock` per served project (`~/.tk-studio/projects/<key>/starter.lock`: `{starter, checkout, since, supervisor_pid}`), but `jobrun.py submit`/`wake` ignore it, so a hand start on a checkout the queue serves goes through silently; and the supervisor never refreshes the lock between ticks, so a pass driving a run for hours lets it look stale.

**Approach:** `jobrun.py` judges the lock before it mints and refuses under a live queue lock unless forced; the supervisor passes `--force-starter` on the verbs it runs itself and rewrites every served project's lock from `serve` every 60 s; the driver contract bumps to 0.1.23.

Story 28.6 acceptance criteria, transcribed verbatim from `_bmad-output/planning-artifacts/epics.md`:

- **AC1.** **Given** a project whose store holds `projects/<key>/starter.lock` with `"starter": "tk-studio-supervisor queue"` and a `checkout` equal to the project's root (compared as canonical absolute paths, case-folded on Windows), and the lock is live (the third criterion) **When** `jobrun.py submit --id <job>` or `jobrun.py wake --job-id <job>` runs without `--force-starter` and without `TK_STUDIO_IGNORE_STARTER_LOCK=1` **Then** the verb mints nothing (no run record, no `job-run` event, no directive) and answers in its own §4 shape: `submit` with `{job_id, run_id: null, accepted: false, reason}` and `wake` with `{woken: false, run_id: null, reason}`, the reason being `StarterLocked: tk-studio-supervisor's queue is the only starter on this checkout (since <since>, supervisor pid <pid>) — submit the job to the supervisor (POST /jobs or bun src/cli.ts submit)`; the MCP `tk_job` surface inherits the refusal because it calls the same verbs; every other refusal and every other verb is unchanged
- **AC2.** **Given** the same live lock **When** the verb runs with `--force-starter` or with `TK_STUDIO_IGNORE_STARTER_LOCK=1` **Then** it mints as today and its answer carries `"starter_lock": "forced"`; the supervisor records the run `external` on its next tick, as Story 27.2 built
- **AC3.** **Given** a lock file the verb judges **When** it decides whether the lock is live **Then** the lock is live when (a) `supervisor_pid` is a running process on this host, probed on POSIX with `os.kill(pid, 0)` (success or `PermissionError`) and on Windows with `OpenProcess` plus `GetExitCodeProcess` equal to `STILL_ACTIVE` through `ctypes` — never `os.kill(pid, 0)` on Windows, which terminates the process — or (b) `since` is less than `STARTER_LOCK_STALE_S` (900 s) before now; a lock meeting neither is stale: the verb mints as today and adds `"starter_lock": "stale"` to its answer; an unreadable or malformed lock (bad JSON, a missing `starter`, `checkout` or `supervisor_pid`, an unparsable `since`), a `starter` that is not the queue's, or a `checkout` that is not this project's root is treated as no lock and never refuses; the lib suite pins live-by-pid (the test's own pid), live-by-`since`, stale, forced by flag and by variable, malformed, another checkout, the case-folded match on win32, both verbs, and (win32 only) that probing a live pid terminates nothing
- **AC4.** **Given** the supervisor up (`serve` under the keeper) and a pacer pass that drives a run for hours **When** `jobrun.py` judges the served project's lock at any point of that **Then** the lock is live: `serve` rewrites every served project's lock on a timer (every 60 s, the certificate tick's pattern in `cli.ts`, with `setInterval` and `now` injectable), so `supervisor_pid` names a process that is alive and `since` is at most a minute old while the supervisor is up, and the lock goes stale within `STARTER_LOCK_STALE_S` of the supervisor going down; the tick's and the claim's writes of Story 27.2 stay; `bun test` from `apps/supervisor` pins the timer and the file it writes
- **AC5.** **Given** the verbs the supervisor runs itself for a claimed run (`runJobVerb` callers in `apps/supervisor/src/cli.ts`: the run's `wake` or `submit`) **When** the supervisor executes one **Then** `--force-starter` is on that command line and the run is never refused by its own lock; the MCP `tk_job` route the supervisor serves passes nothing (a start through it is a hand start and is refused like one); `bun test` pins both; the driver contract takes a minor bump (0.1.23) documenting under §4 the `--force-starter` flag, the `TK_STUDIO_IGNORE_STARTER_LOCK` variable, the `StarterLocked` refusal and the `starter_lock` answer field, with conformance green; runbook §3.8's "Hand starts" row says `jobrun.py` refuses under a live lock and names the override; DW-6 is closed in `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md`

## Boundaries & Constraints

**Always:**
- The lock check runs after every existing refusal of the verb (definition problems, `wake` on a one-shot, stop conditions), so those answer exactly as today, and before anything is minted (`create_run`, `execute_core`, the directive) — for every trigger, recurring `submit` included.
- Lock path: `storelib.store_root() / "projects" / joblib.project_key(root) / "starter.lock"` (the same key the run records use; `TK_STUDIO_HOME` honoured).
- Checkout match: canonical absolute paths (`os.path.realpath`) of the lock's `checkout` and the project root, compared case-folded when the platform is win32 (`ntpath.normcase`); the platform is injectable so the win32 rule is unit-testable on Linux.
- Pid probe by platform: POSIX `os.kill(pid, 0)` (success or `PermissionError` = alive; `ProcessLookupError`/`OSError` = not); win32 `ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)` + `GetExitCodeProcess == STILL_ACTIVE (259)`, handle closed, any failure = not alive. `os.kill` is never reached on win32 (a Linux test with platform forced to win32 and `os.kill` patched to fail pins it). A non-int or non-positive pid is malformed.
- `STARTER_LOCK_STALE_S = 900` a module constant; override = `--force-starter` on `submit` and `wake` only, or env `TK_STUDIO_IGNORE_STARTER_LOCK` exactly `"1"`.
- `starter_lock` answer field: `"forced"` only when a live lock was overridden; `"stale"` when the matching lock is stale (forced or not); absent when there is no (valid, matching) lock. The run record is not changed.
- The refusal text is the AC1 string verbatim with `<since>` and `<pid>` from the lock.
- Supervisor: `startRun`'s verb argv (`cli.ts` ~:1446-1448) gains `--force-starter`; the MCP `tk_job` handler (`src/server.ts`) is untouched. The serve timer follows `watchCertificate` (`cli.ts` :2109-2148): an exported `watchStarterLocks(deps)` with injectable `env`, `open`, `now`, `setInterval`, `clearInterval`, `log`; writes at once and every `STARTER_LOCK_REFRESH_MS = 60_000`; never throws; started from `main`'s `serve` branch beside `watchCertificate`. The timer's write stamps `since` = `now()` (fresh); the 27.2 tick (`recoverQueue` :616) and claim (:1059) writes keep their since-preserving behaviour unchanged.
- House rules: stdlib only, atomic writes untouched, JSON status block on every path (AD-11), no network in tests, nothing in the plugin imports the supervisor (AD-2).
- Verify gate: from `plugins/tk-studio/lib` `uv run python -m unittest discover tests` green and `uv run python ../contracts/conformance/runner.py run` `ok: true`; from `apps/supervisor` `bun test` and `bun run typecheck` green.

**Block If:**
- Honouring the lock needs a change to the run record, `job.schema.json`, a conformance schema or the MCP `tk_job` handler → HALT (AD-19).
- The Files below must grow beyond them → HALT and record (consult `file-outside-files`).

**Never:**
- Use `os.kill` on win32; kill or signal anything in a test; refuse on a malformed, foreign-starter or other-checkout lock.
- Change `writeStarterLock`'s default since-preserving behaviour, the 27.2 tick/claim call sites, `recordExternal`, or the starter lock's path or fields.
- Add `--force-starter` to `status`/`resolve`/`cancel`/`account`/`finish`, or to the MCP route.
- Push, tag, release, bump the gate x3 versions, or edit `epics.md`, `stories.yaml`, routing/policy files or anything under `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live by pid | lock pid = test's own pid, `since` 1 h old | `submit`: `accepted:false, run_id:null`, StarterLocked reason; `wake`: `woken:false`; no run dir, no `job-run` event, no `directive` | refusal is an answer, exit 0 |
| Live by since | dead pid, `since` 60 s ago | refused as above | — |
| Stale | dead pid, `since` 901 s+ ago | mints as today + `"starter_lock":"stale"` | — |
| Forced (flag / env) | live lock + `--force-starter` or `TK_STUDIO_IGNORE_STARTER_LOCK=1` | mints + `"starter_lock":"forced"` | env other than `"1"` does not force |
| Malformed | bad JSON; missing `starter`/`checkout`/`supervisor_pid`; unparsable `since` | no lock: mints, no `starter_lock` field | never raises |
| Foreign / other checkout | `starter` ≠ queue's; `checkout` another dir | no lock | — |
| win32 case-fold | platform win32, `checkout` = root in other case | match (live → refused); same input on linux → no match | — |
| win32 probe | win32 host, live pid probed | answers alive, the process keeps running (win32-only test, skipped elsewhere) | — |
| No lock file | absent | unchanged behaviour, no field | — |
| Other refusal first | definition problems / stop condition / one-shot wake under a live lock | today's answer and reason | — |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/jobrun.py` -- `submit` :307-353 (insert the check after `evaluate_stop` :318-322, before `_job_routing`/`create_run`); `wake` :432-467 (after `evaluate_stop` :447-449); `main` argparse :550-578 (`--force-starter` on `submit` and `wake`, `store_true`), dispatch :584-595; `_parse_iso` :88 (reuse for `since`); `_now` :84 (patch point for tests); module docstring CLI block :38-52 (add the flag + env). Imports: `storelib` is reachable as `joblib.storelib`/`ledger`'s `_store` — prefer importing `store as storelib` as `job.py` does.
- `plugins/tk-studio/lib/job.py` :423-430 -- `project_key`, `runs_root` (read-only; the lock lives beside `runs/`).
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- `JobRunTestCase` :33-107 (temp project + `TK_STUDIO_HOME` fixture to reuse); add a starter-lock test class covering every matrix row and the CLI flag (`jobrun.main([...])` capturing stdout, as `test_cli_submit_and_status` :455 does).
- `plugins/tk-studio/contracts/driver-contract.md` -- header version cell :5 (`**0.1.22**` → `**0.1.23**`, append a 0.1.23 clause to the history); §4 table/guarantees :220-260 (document flag, variable, `StarterLocked` refusal, `starter_lock` field under §4).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` :96-100 -- pins `\*\*0\.1\.22\*\*`; move it to 0.1.23 and pin the §4 text (flag, variable, refusal, field). Required by the bump AC5 names (AD-19: the contract and its pins move together).
- `apps/supervisor/src/sandbox.ts` -- header :26-27; `STARTER` :408; `writeStarterLock` :419-441 (add an optional fresh-`since` option, default unchanged); `writeStarterLocks` :443-455 (pass `now`/fresh through); add `STARTER_LOCK_REFRESH_MS = 60_000`.
- `apps/supervisor/src/cli.ts` -- header :88; import :125; `startRun` verb argv :1444-1448 (`--force-starter`); `CertWatchDeps`/`watchCertificate` :2109-2148 (pattern to mirror); `main` `serve` :2158-2172 (start `watchStarterLocks()` beside `watchCertificate`).
- `apps/supervisor/src/server.ts` :887-935 -- MCP `tk_job` handler, READ-ONLY: builds `[verb, "--directory", root, ...]` with no override (a test pins that argv carries no `--force-starter`).
- `apps/supervisor/test/sandbox.test.ts` (~:829 existing starter-lock pins stay green), `apps/supervisor/test/command-line.test.ts` (~:519), `apps/supervisor/test/fakes.ts` (fake verb runners may match exact argv — update expectations for `--force-starter`).
- `kb/agent-pc-setup-runbook.md` :923 -- §3.8 "Hand starts" row: replace "a planned tk-studio story" with the refusal under a live lock and the override (`--force-starter` / `TK_STUDIO_IGNORE_STARTER_LOCK=1`).
- `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md` :42-50 -- DW-6 `status: open` → `status: closed — story 28-6, 2026-10-17: …` (format of :91), `Previously: open`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/jobrun.py` -- add `STARTER_LOCK_STALE_S`, the queue's starter string, a lock reader/judge (`starter_lock_state(root, *, now, platform) -> (state, lock)` with `None|"live"|"stale"`), the per-platform pid probe, the checkout match; gate `submit`/`wake` with a `force` argument; CLI flag + env -- AC1-AC3.
- `plugins/tk-studio/lib/tests/test_jobrun.py` -- one test per matrix row, both verbs, flag and env via the CLI, win32 case-fold and the "never `os.kill` on win32" pin on Linux, plus a `skipUnless(win32)` live-probe-terminates-nothing test (spawn a child, probe, assert it still runs, then end it) -- AC3's pin list.
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.23 bump and §4 text, pinned -- AC5.
- `apps/supervisor/src/sandbox.ts` -- fresh-`since` option and refresh constant -- AC4.
- `apps/supervisor/src/cli.ts` -- `--force-starter` in `startRun`; `watchStarterLocks` + serve wiring -- AC4, AC5.
- `apps/supervisor/test/*` -- pin: the timer writes at once and on each injected interval tick with `since` = injected now and `supervisor_pid` = `process.pid`; stop clears it; `startRun`'s wake and submit argv carry `--force-starter`; the MCP `tk_job` submit/wake argv carries none -- AC4, AC5.
- `kb/agent-pc-setup-runbook.md`, `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md` -- the row and DW-6 -- AC5.

**Acceptance Criteria:**
- Given the verify gate, when it runs from `plugins/tk-studio/lib` and `apps/supervisor`, then the lib suite, conformance (`ok: true`), `bun test` and `bun run typecheck` are green.
- Given AC2's "the supervisor records the run `external` on its next tick", when the story closes, then it holds by reference to Story 27.2's `recordExternal` (unchanged; its existing tests stay green).

## Spec Change Log

## Review Triage Log

### 2026-10-17 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 1 (high 0, medium 0, low 1)
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[low]` `[patch]` No test judged a lock in the supervisor's own format (`toISOString()` millisecond `Z` since, `checkoutKey` checkout): added live and stale cases for both verbs in `StarterLockTests`; both passed without a jobrun.py change.
  - `[low]` `[patch]` `since` changed meaning (heartbeat under the serve timer) undocumented: `sandbox.ts` header and `writeStarterLock` doc comment, and one sentence in contract §4 "Starter lock (0.1.23)".
  - `[low]` `[patch]` `wake` docstring did not name the starter-lock gate and `force`: updated.
- rejected (one line each): `--force-starter` breaks an older plugin — the supervisor runs jobrun.py from `$TK_STUDIO_ROOT`, the same repository tree, and AC5 mandates the flag; pid reuse keeps a lock live — AC3 defines live as pid alive OR since < 900 s; future `since` stays live — AC3's "less than 900 s before now" plus clock skew between host and VM makes live the safe reading, and the override exists; MCP refusal untested end-to-end — inherited by construction (same verbs, answers ok:true like every other refusal), AC5's pin is the argv test; project-key parity between `projectKeyOf` and `project_key` — pre-existing 27.2 key rule, not changed here; pid reuse (edge-case-hunter duplicate) — as above.

## Design Notes

- `since` freshness (AC4): `writeStarterLock` keeps `since` while one supervisor process rewrites the lock (27.2), which would let `since` age past 900 s during a long pass. AC4 requires `since` at most a minute old while up, so the serve timer's write stamps `since` fresh; the tick and claim writes keep their 27.2 behaviour (they still run). This matters because the engine may run `jobrun.py` inside a microVM where the Windows `supervisor_pid` is not a process on that host — there `since` is the only liveness signal.
- Placement after the existing refusals keeps AC1's "every other refusal unchanged": a stop-condition or invalid-definition answer is never masked by `StarterLocked`.
- Files: the story's Repo list plus `test_driver_contract.py`, which pins the contract version the AC5 bump moves; no plan file exists for 28-6, so this spec's Code Map is the boundary.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && timeout -k 5 1500 uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && timeout -k 5 900 uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`
- `cd apps/supervisor && timeout -k 5 1500 bun test` -- expected: 0 fail
- `cd apps/supervisor && timeout -k 5 300 bun run typecheck` -- expected: exit 0

## Deviation Summary

### pass 1 (2026-10-17, implementer)

- planned: §4 documents the flag, the variable, the `StarterLocked` refusal and the `starter_lock` field / actual: also updated the §4 table cells to `submit` → `{job_id, run_id, accepted: bool, reason?, starter_lock?}` and `wake` → `{woken: bool, run_id?, reason?, starter_lock?}` (adds the `reason?` `wake` already returned), and added "Story 28.6" to the contract's Story / rulings row / why: keep the published response shape matching the new field / may affect: none
- planned: Code Map lists `test/fakes.ts` as possibly needing argv updates / actual: `fakes.ts` untouched; the MCP argv test uses the existing `fakeBin` helper with a fake `uv` on PATH under the real connector (`src/client.ts` imported from a test) / why: the `tk_job` handler's argv cannot be injected without editing `server.ts`, which the spec forbids / may affect: none
- planned: the verify gate runs `bun run typecheck` / actual: `bun node_modules/typescript/bin/tsc --noEmit` (exit 0) / why: `node_modules/.bin/tsc` absent, `bun install` EPERM in the sandbox / may affect: none

DEVIATION SCORE: 1

DRIFT: driver-contract §4 table cells for submit/wake gain `starter_lock?` (and wake's existing `reason?`), header row names Story 28.6 — keep the published response shape matching the new field — affects: none
DRIFT: typecheck run as `bun node_modules/typescript/bin/tsc --noEmit` instead of `bun run typecheck` — node_modules/.bin not linkable in the sandbox — affects: none

## Consult Log

- 2026-10-17T23:11:59Z — trigger: deviation-gt-0 — question: accept or reject the implementer's three score-1 deviations (§4 table cells + Story row; fakes.ts untouched with MCP argv pinned via real connector; tsc via package entry point) — ruling: accept-deviation score 1 — do: Keep all three entries as implemented; revert nothing. / Record the deviation as score 1 with the spec's Deviation Summary lines as evidence. — rule candidate: documenting optional response fields an AC introduces (or a verb already returns) in the §4 verb table and Story/rulings row is part of the AC's bump; bun node_modules/<pkg>/bin/<tool> equals the bun run <script> gate when .bin links are unavailable — observe record: {"ok": true, "ledger": "/home/agent/.tk-studio/measurements/agent-claude-tk-studio.jsonl", "envelope": {"ts": "2026-10-17T23:11:59.531+00:00", "event": "observation", "user": "agent", "machine": "claude-tk-studio", "project": "tk-studio", "payload": {"source": "other", "description": "consult: trigger=deviation-gt-0 story=28-6-the-plugin-side-honours-the-queues-starter-lock ruling=accept-deviation score 1 rule_candidate=documenting optional response fields an AC introduces (or a verb already returns) in the §4 verb table and Story/rulings row is part of the AC's bump; bun node_modules/<pkg>/bin/<tool> equals the bun run <script> gate when .bin links are unavailable", "evidence": "/c/agent-work/worktrees/tk-studio/q-run-epic-28-20261017T224859Z-c9b76e/_bmad-output/specs/spec-epic-28/stories/28-6-the-plugin-side-honours-the-queues-starter-lock-spec.md#consult-log"}}}

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** `jobrun.py submit` and `wake` judge the store's `projects/<key>/starter.lock` after every existing refusal and before minting. A live queue lock (pid alive — POSIX `os.kill(pid, 0)`, win32 `OpenProcess`/`GetExitCodeProcess` via ctypes, never `os.kill` — or `since` < `STARTER_LOCK_STALE_S` = 900 s) on this checkout (realpath, case-folded on win32) refuses with the verbatim `StarterLocked` reason in each verb's §4 shape and mints nothing. `--force-starter` or `TK_STUDIO_IGNORE_STARTER_LOCK=1` mints with `"starter_lock": "forced"`, and a stale lock mints with `"stale"`. A malformed, foreign-starter or other-checkout lock counts as no lock. The supervisor's `startRun` passes `--force-starter` on its `wake`/`submit`, and the MCP `tk_job` route is untouched (it passes nothing). `serve` runs `watchStarterLocks`, which rewrites every served project's lock at once and every 60 s with a fresh `since`; the 27.2 tick and claim writes are unchanged. The driver contract is at 0.1.23 with §4 "Starter lock". Runbook §3.8's "Hand starts" row is updated, and DW-6 is closed.

**Files changed:**
- `plugins/tk-studio/lib/jobrun.py`: the lock judge, the per-platform pid probe, the checkout match, the gate in `submit`/`wake`, and the CLI flag and variable.
- `plugins/tk-studio/lib/tests/test_jobrun.py`: `StarterLockTests`, one test per matrix row plus the supervisor-format lock cases.
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.23 bump and the §4 Starter lock text and table cells.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: the version pin moved and the 0.1.23 §4 text pinned.
- `apps/supervisor/src/sandbox.ts`: `STARTER_LOCK_REFRESH_MS` and the `{ fresh }` option on `writeStarterLock(s)`, with `since` documented.
- `apps/supervisor/src/cli.ts`: `--force-starter` in `startRun`, plus `watchStarterLocks` wired into `serve`.
- `apps/supervisor/test/sandbox.test.ts`: pins for the timer and the file it writes.
- `apps/supervisor/test/command-line.test.ts`: pins that `startRun`'s argv carries the flag and the MCP `tk_job` argv carries none.
- `kb/agent-pc-setup-runbook.md`: the §3.8 "Hand starts" row.
- `apps/supervisor/_bmad-output/implementation-artifacts/deferred-work.md`: DW-6 closed.

**Review:** two layers ran (blind-hunter, edge-case-hunter). 3 low patches were applied, 1 low finding was deferred under (a) (darwin case-fold), and 6 were rejected with reasons in the Review Triage Log. Follow-up review: patched high 0, medium 0, low 3; score 3 × 0 + 3 = 3 < 5, so `false`.

**Verification** (after the patches):
- `uv run python -m unittest discover tests` from `plugins/tk-studio/lib`: 1411 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test` from `apps/supervisor`: 881 pass, 5 skip, 0 fail.
- `bun node_modules/typescript/bin/tsc --noEmit`: exit 0. `bun run typecheck` exits 127 because `node_modules/.bin/tsc` is not linked in the sandbox.

Matrix audit: every row is covered by a test that ran and passed, except the win32 live-probe row. That row is win32-only by the matrix, so it is unverifiable here.

**unverifiable-here:**
- The win32 probe test. On the agent PC, from `C:\GitHub\tk-studio\plugins\tk-studio\lib`, run `uv run python -m unittest tests.test_jobrun.StarterLockTests -v`; `test_win32_probing_a_live_pid_terminates_nothing` must pass, not be skipped.
- AC2's "recorded `external` on the next tick" holds by reference to Story 27.2's `recordExternal`, which is unchanged and whose tests are green.

**Residual risks:**
- The Windows ctypes path has not run on a real host.
- A reused pid keeps a lock live, by AC3's rule.
- Darwin case-fold is deferred.

DRIFT: driver-contract §4 table cells for submit/wake gain `starter_lock?` (and wake's existing `reason?`), header row names Story 28.6 — keep the published response shape matching the new field (consult accepted, score 1) — affects: none
DRIFT: typecheck run as `bun node_modules/typescript/bin/tsc --noEmit` instead of `bun run typecheck` — node_modules/.bin not linkable in the sandbox (bun install EPERM) — affects: none

## Reconcile

- 2026-10-17 — score 1; reconcile not required.

Gate: Part A not-required; Part B epic complete: no next story (28-6 accepted; AC1–AC5 met; win32 live-probe test on the agent PC unverifiable-here)
