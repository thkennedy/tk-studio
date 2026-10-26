---
title: 'The Pin Restarts a Logged-Out Sandbox'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '2e1e6ec23c169f5edec778250abcaa4873deaeb9'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-3.md'
warnings: [oversized]
deferred:
  - summary: >-
      The pin-restart episode is bounded only by claim-refusal-cleared or run start, so a run whose restart healed at its claim cannot be restarted at a later relaunch or resume.
    evidence: |-
      clearClaimRefusals writes claim-refusal-cleared only when refusals were open (queue.ts:2202-2211); openPinRestart then still finds the old pin-restart; the run ends blocked naming the renewal (fail-safe). Consult ruling B, deferral criterion (a).
    location: >-
      apps/supervisor/src/sandbox.ts openPinRestart
    severity: medium
  - summary: >-
      The launch check treats any .pin file as pinned by the supervisor, so a record left by a manual sbx stop, reboot or kept release hides AC2's started-outside warning.
    evidence: |-
      The record is removed only when pin-released stopped the sandbox (Settled shape 3); engine_sandbox_row reads presence only. Proposed: treat a .pin whose supervisor_pid is dead or whose since predates the sandbox start as absent. Consult ruling D, deferral criterion (a).
    location: >-
      plugins/tk-studio/lib/launch.py engine_sandbox_row
    severity: low
  - summary: >-
      Several queued runs on one sandbox that stays logged out (a token no restart heals) restart it once per run, one per drain pass, because guard (d) reads only the gated run's own episode.
    evidence: |-
      openPinRestart reads queue.events(runId) only and the per-pass set is fresh each pass: runs A, B, C queued on S give a stop/start in pass 1 (A), pass 2 (B) and pass 3 (C), each able to cut off an operator's interactive `/login` renewal. Spec-conformant (Settled shape 2 guards (c)/(d) verbatim), so not a patch; deferral criterion (a), AC1's "stops and starts the sandbox once". Proposed: bound guard (d) per sandbox across the queue (any run's open pin-restart on S since S's last healed probe).
    location: >-
      apps/supervisor/src/sandbox.ts openPinRestart / pinWithRestart
    severity: medium
---

<intent-contract>

## Intent

**Problem:** A sandbox started outside the supervisor (a session's `sbx exec` on a stopped sandbox, hole 68) comes up without the Max login. The pin's `sbx run -d --name` leaves a running sandbox as it is, so every claim is refused until an operator stops it.

**Approach:** One shared seam in `apps/supervisor/src/sandbox.ts` that both pin sites call: when the sandbox was already running before the pin and its login probe says not logged in, stop and start it once, probe again, record `pin-restart`, then let the caller's preflight judge. The readiness check warns about a running engine sandbox with no supervisor pin record.

## Acceptance Criteria (transcribed verbatim from epics.md, Story 33.3)

- AC1: **Given** a run on the sbx tier whose sandbox is already running when the pin runs **When** the pin's login probe (`sbx exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`) answers not logged in **Then** the pin stops and starts the sandbox once (`sbx stop`, `sbx run -d --name`), probes again, and only then runs the preflight; both attempts are recorded on the run (`pin-restart {probe_before, probe_after}`); a sandbox still logged out after the restart refuses the claim through 33.2's event naming the renewal; a sandbox the supervisor itself pinned in this pass is never restarted twice
- AC2: **Given** `tk-studio-launch check` (the readiness check) and the runbook **When** the engine sandbox is running with no supervisor pin recorded for it **Then** the check names it as a warning ("started outside the supervisor; the next pin restarts it"), and the runbook's hole-68 row stays the rule for sessions; `bun test` covers the restart, the single-restart rule and the warning with a fake `sbx`

Reading of AC2's "`bun test` covers … the warning" (plan Settled shape 4, not a deviation): the warning is computed by the Python readiness check, so the lib suite (`test_launch.py`) covers the warning text and cases with a fake sbx runner; `bun test` covers the pin record the check reads (written on a pin, written after a restart, removed on release).

## Boundaries & Constraints

**Always:**
- One seam (`pinWithRestart` or similar) in `sandbox.ts`, called by both `pinBeforeClaim` (drained runs, `cli.ts:1277`) and `queueRecorder.pin` (run mode, relaunch, resume, `cli.ts:1703`) in place of the bare `pinSandbox`.
- "Running before the pin" = `sbx ls` row whose first column equals the sandbox exactly and whose status is `running` (the `sandbox_login._listed` rule); a failed `sbx ls` = not running (no probe, no restart).
- Probe = `maxLoginPreflight` / `judgeAuthStatus` (`server.ts:806/819`) with an injectable spawner; same argv as the AC.
- Restart guards (all must hold): (a) running before the pin; (b) probe not logged in; (c) not restarted in this pass (per-pass `Set<string>` owned by `drainQueue`, one per `finishRun` for the drive's recorder); (d) no `pin-restart` for this sandbox in the run's open episode (since its latest `claim-refusal-cleared`, else run start); (e) no other run holds the sandbox `running`/`paused`/`external` and no ended run's engine there is alive (queued holders do not count). Failing (c)/(d)/(e) → no restart, no event; the preflight refuses as 33-2 does.
- `pin-restart` detail `{sandbox, probe_before, probe_after, pass_at}`; probes are `null` or the `judgeAuthStatus` gap text — never stdout or a token. One per sandbox per episode; a repeat patches in place via `queue.patchEventDetail` (the `pin-failed` rule; never a flood).
- A failed `sbx stop`/`sbx run` during restart is a pin failure: same text, same `pin-failed` episode.
- Drained run still logged out after restart → refuses through the existing `recordedRefusal` key `max-login` (`loginResolves` names the renewal). Relaunch/resume still logged out → ends `blocked` through `authPreflight` as today.
- Pin record: `<TK_STUDIO_HOME or ~/.tk-studio>/sandboxes/<safe sandbox>.pin` = JSON `{sandbox, since, run_id, supervisor_pid}`, written on every `pinned` (both sites, and after a restart), removed in `releasePin` when `pin-released` stopped the sandbox (`stop.ok`); never throws (starter-lock pattern, `sandbox.ts:418-452`).
- Extract `releasePin`'s holder computation (`sandbox.ts:144-175`) into an exported helper; `releasePin` behaviour stays identical.
- Readiness check: one advisory row `engine sandbox` after `studio-pipeline plugin` in `launch.py` `check`, never a gap. Detail when running with no pin record: `warning: <sb> started outside the supervisor; the next pin restarts it`; else `pinned by the supervisor`, `not running`, `no engine sandbox configured`, `sbx absent` or `daemon down`. `sbx daemon status` before `sbx ls`. Sandbox names from `sandbox_login.config_sandboxes`.
- Fake sbx defaults keep every existing test's behaviour (no `ls` rows → not running → no probe, no restart). Existing exact event lists do not change.
- House rules: stdlib-only Python via `uv run`; atomic writes; no credential in a file or event; plugin never imports the supervisor.

**Block If:**
- Meeting AC1 needs a new `claim-refused` key, a change to 33-2's `max-login`/`pin-failed:<sb>` keys, or a change to the 0.1.28 Story 33.2 contract text.
- The restart must stop a sandbox another live run holds (guard (e) cannot hold) in a tested case.
- The readiness warning must become a gap or a new activate drift plane (planes fixed at six, ruling C).
- The file list grows past the plan's Files.

**Never:** no new refusal key; no restart of a live engine's sandbox; no more than one restart per sandbox per pass; no edit to `epics.md`, `stories.yaml`, plan files, `.bmad-loop/*.toml`, or `supervision/`; no push, tag or release motion; no live `sbx` in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restart heals | running before pin; probe logged out, then logged in | `sbx stop`, `sbx run -d --name`, re-probe; `pin-restart {probe_before: gap, probe_after: null}`; drained run claimed | none |
| Still logged out | both probes logged out | one `pin-restart`; drained → `claim-refused` key `max-login`; relaunch/resume → `blocked` | as 33-2 |
| Stopped before pin | `sbx ls` shows stopped / absent / ls fails | no probe, no restart, no event; pin as today | — |
| Second run same pass | two queued runs on one sandbox, logged out | first restarts; second does not (guard c) | refuses `max-login` |
| Same episode, later pass | `pin-restart` already in open episode | no restart | refuses `max-login` |
| Live holder | another run `running` on sandbox | no restart, no event | refuses `max-login` |
| Restart fails | `sbx stop` or `sbx run` exits non-zero | `pin-failed` episode (same text) | per 33-2 |
| Check: outside start | sandbox running, no `.pin` | row detail `warning: <sb> started outside the supervisor; the next pin restarts it`; not a gap | — |
| Check: pinned / stopped / none | `.pin` present / not running / no config / no sbx / daemon down | `pinned by the supervisor` / `not running` / `no engine sandbox configured` / `sbx absent` / `daemon down` | never a gap |

</intent-contract>

## Code Map

Paths under `apps/supervisor/` unless stated. Full investigation: `plans/33-3.md` §Code Map (authoritative; read it).

- `src/sandbox.ts:84-85` `pinArgv`/`releaseArgv`; `:127` `pinSandbox`; `:135` `SANDBOX_HOLDING_STATES`; `:144-175` `releasePin` (holder rule to extract; remove pin record on `stop.ok`); `:418-452` `starterLockPath`/`writeStarterLock` (pin-record pattern). Add `lsArgv`, the listing rule, `pinWithRestart`, holder helper, pin-record write/remove.
- `src/cli.ts:1238` `loginResolves`; `:1262` `recordedRefusal`; `:1277` `pinBeforeClaim` (records `pinned` once, `pin-failed` per episode in place); `:1304` `claimGate` → `maxLoginPreflight` (`:1315`); `:1362` `runJob` calls `claimGate`; `:1395` `clearClaimRefusals`; `:903` `drainQueue` (owns per-pass set; thread via `RunOptions`/`ClaimGateDeps`); `:1472-1488` `drive`/`prePinned`; `:1703` `queueRecorder` (`.pin`).
- `src/server.ts:806` `judgeAuthStatus`; `:819` `maxLoginPreflight(spawner, placement)`; `:834` `authPreflight`; `:1115-1121` `invokeSkill` pin then preflight.
- `src/queue.ts:876` `events`; `:1062` `pinOutstanding`; `:2126` `note`; `:2192` `patchEventDetail`; `:2202` `clearClaimRefusals` (episode start).
- `test/fakes.ts:262` `fakeSbx`: add `ls` (header `SANDBOX AGENT STATUS` + rows from state) and `exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json` (answer list consumed per call); `stop`→stopped, `run -d`→running.
- `test/sandbox.test.ts` (pin/claimGate/pinBeforeClaim/release blocks), `test/command-line.test.ts` (drained e2e; exact event lists `:934/1461/1654`), `test/api.test.ts:299`, `test/queue.test.ts:160/1323` (exact lists; must not change).
- `plugins/tk-studio/lib/launch.py:196` `Deadline`, `:217` `_call`, `:344` `check`, `:385` `studio-pipeline plugin` row; `plugins/tk-studio/lib/sandbox_login.py:105` `config_sandboxes`, `:243` `_listed`. If a public helper is added there, mirror to `tools/installer/cli/tk_studio_cli/sandbox_login.py` (byte-identical; `test_installer_bootstrap.py` `SHARED_COPIES`).
- Docs: `apps/supervisor/README.md` (`Pin and hold`, `Claim refusals`); `plugins/tk-studio/contracts/driver-contract.md` 0.1.28 Story 33.2 paragraph (~`:236-262`) → add Story 33.3 paragraph after it (the `pin-restart` event and the pin record, additive); pin it in `plugins/tk-studio/lib/tests/test_driver_contract.py`; `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` check rows; `kb/agent-pc-setup-runbook.md:1362` hole-68 row (keep its session rule; append a clause naming the pin's single restart and the check's warning).

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/sandbox.ts` -- add `lsArgv`, listing rule, exported holder helper (releasePin unchanged in behaviour), `pinWithRestart` (guards a–e, `pin-restart` record/patch, pin-failed on restart failure), pin-record write/remove -- the shared seam
- `apps/supervisor/src/cli.ts` -- `pinBeforeClaim` and `queueRecorder.pin` call the seam; thread the per-pass set from `drainQueue` through `runJob`/`claimGate`; drive recorder gets its own set -- both pin sites
- `apps/supervisor/src/server.ts` -- only if the probe needs an exported seam -- reuse `maxLoginPreflight`
- `apps/supervisor/test/fakes.ts` -- `ls` and `auth status` branches with stateful running/stopped -- fake sbx
- `apps/supervisor/test/sandbox.test.ts` -- restart; single restart per pass and per episode; live-holder guard; still logged out → `max-login` refusal; restart failure → `pin-failed`; pin record written on pin/after restart, removed on release -- AC1, AC2 bun half
- `apps/supervisor/test/command-line.test.ts` -- one drained e2e: logged out → restart → claimed, `pin-restart` recorded -- AC1 end to end
- `plugins/tk-studio/lib/launch.py` + `plugins/tk-studio/lib/tests/test_launch.py` -- advisory `engine sandbox` row and its cases with a fake runner -- AC2 warning
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- Story 33.3 paragraph under 0.1.28 and its pin test -- AD-19
- `apps/supervisor/README.md`, `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`, `kb/agent-pc-setup-runbook.md` -- docs -- AC2 runbook clause

**Acceptance Criteria:**
- Given a drained run whose sandbox runs logged out before the pin, when the drain pass runs and the fake's second probe is logged in, then the run is claimed and carries exactly one `pin-restart` with `probe_before` = gap text and `probe_after` = null.
- Given two queued runs on one logged-out running sandbox in one pass, when the pass runs, then `sbx stop` is called at most once for that sandbox.
- Given a running sandbox with no `.pin` record, when `launch.py check` runs, then the `engine sandbox` row reads `warning: <sb> started outside the supervisor; the next pin restarts it` and the check's gaps are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- layers: blind-hunter, edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 2 (high 0, medium 1, low 1)
- reject: 6 (high 0, medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` a sandbox cold-pinned in this pass was not added to the per-pass set, so a second run in the pass could restart it (AC1 "never restarted twice"; plan "pinned from stopped … not restarted either") — `pinWithRestart` adds it; test "Cold-pinned in this pass"
  - `[low]` `[patch]` restart whose `sbx stop` succeeds and `sbx run` fails left the pin record and was untested (matrix row "Restart fails") — record removed; test "Restart fails at the start" with opt-in fake `pin: "fail-after-stop"`
  - `[low]` `[patch]` the recorder test's title promised a `blocked` end it never asserted — now drives `finishRun`/`invokeSkill` twice and asserts `blocked` with the auth-preflight reason
- deferred (consult ruling, criterion (a)): episode bound misses a healed claim followed by relaunch/resume; a stale `.pin` hides AC2's warning after a manual stop
- rejected: restart on any `judgeAuthStatus` gap (Settled shape 1 verbatim; consult A); failed restart retries each pass as `pin-failed` (spec, 33-2 rule; consult C); unreachable in-place patch branch (the spec says the guards normally prevent it; harmless); resumes in the same pass use the recorder's own set (plan's design; guard (e) blocks a sandbox a resumed run holds); TS/Python pin-path sanitising differ (same regex `[^A-Za-z0-9._\-]`, both under the store root); restart may stop an operator's interactive renewal (only once per episode; the restart restores the same login the renewal would)

### 2026-10-26 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 1 (high 0, medium 1, low 0)
- reject: 1 (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `drainQueue` drove the pass's resumes before creating its restarted set, and each resume's `queueRecorder` had its own set, so a resumed run that restarted S and ended `blocked` let a drained run restart S again in the same pass (AC1 "never restarted twice"; Never "no more than one restart per sandbox per pass"; the first pass's rejection assumed guard (e) would block it, which fails once the resume ends `blocked`). Fix: the set is created before `driveResumes` and threaded through `driveResumes` → `queueRecorder(queue, id, {}, restarted)` (optional params; other callers unchanged). Tests "One set per drain pass…" and its counterfactual. (edge-case-hunter, two findings merged: same claim, same action)
  - `[low]` `[patch]` guard (e) was tested only with a `running` holder — "Live holder" is now `test.each` over `running`/`paused`/`external`, plus "Live engine: an ended run whose engine is alive after its kill → no restart" (Never "no restart of a live engine's sandbox")
- deferred (criterion (a), spec-conformant per Settled shape 2 — the first pass's consult rule candidate): several queued runs on one still-logged-out sandbox restart it once per run across passes
- rejected: a failed restart `sbx stop` leaves no pin record (Boundaries: the record is written on every `pinned`, and a failed stop is a pin failure recorded `pin-failed`; the check's "the next pin restarts it" is then accurate)

## Design Notes

The probe runs only when the sandbox was running before the pin, so a cold pin costs no extra `sbx exec`; existing tests (fake `ls` empty) see no new calls or events. The per-pass set plus the episode check together implement "once": the set guards the same pass across runs, the episode guards later passes of the same run.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- From `apps/supervisor`, each with its own fresh `TMPDIR` removed afterwards, bun at `~/.bun/bin/bun`: `bun test test/sandbox.test.ts`, `TK_STUDIO_ROOT=<root> bun test test/command-line.test.ts`, `bun test test/queue.test.ts`, `bun test test/api.test.ts` -- expected: green except the three known-baseline sbx-tier "worker tiers (Story 21.4)" failures in command-line (compare against baseline)
- `cd apps/supervisor && bun x tsc --noEmit` -- expected: clean
- `cmp` the two `sandbox_login.py` copies if either changed; `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l` does not grow

**Manual checks (unverifiable here):** live restart needs a real engine box: stop the engine sandbox, start it from a session with `sbx exec`, queue a run, and see one `pin-restart` and a claim.

## Deviation Summary

### pass 1 (2026-10-26, implementer)

- planned: existing exact sbx call lists unchanged / actual: two existing tests in `test/sandbox.test.ts` now expect `["ls"]` before `["run","-d","--name",SB]` / why: the seam always reads `sbx ls` before the pin (event lists unchanged) / may affect: none
- planned: pin record written on every pin / actual: not written (nor removed) when `TK_SUPERVISOR_UNDER_TEST=1` and `TK_STUDIO_HOME` is unset; `sandbox.test.ts` gives its deps a throwaway `TK_STUDIO_HOME` / why: suites pinning with `process.env` would otherwise write into the operator's real `~/.tk-studio/sandboxes` (hole-31 notifier-guard idea) / may affect: none
- planned: fake sbx `ls`/auth branches in `test/fakes.ts` only / actual: the separate fake `sbx` inside `command-line.test.ts`'s e2e fixture gained opt-in `ls`/stop/start/logged-out behaviour behind `FAKE_SBX_STATE` (unchanged when unset) / why: the e2e suite uses its own fake / may affect: none
- planned: e2e "logged out → restart → claimed" / actual: asserts the run is claimed with exactly one `pin-restart` (`probe_before` = gap, `probe_after` = null), not a `complete` run / why: the sbx-tier drive after the claim fails at baseline / may affect: none

DEVIATION SCORE: 1

### pass 2 (2026-10-26, implementer, follow-up review patches)

- planned: resumes' recorders keep "one per `finishRun`" sets / actual: inside a drain pass the resumes share `drainQueue`'s set (`driveResumes` and `queueRecorder` gain optional trailing `restarted` params; every other caller keeps its own set) / why: AC1 and the Never list cap restarts at one per sandbox per pass / may affect: none (score 0: stricter reading of the AC, inside Files)
- test-environment notes (not deviations): the drain-pass test sets and restores `process.env.SBX_BIN`/`TK_STUDIO_HOME` because the resume recorder takes no sbx deps (baseline); bun runs need `~/.bun/bin` on PATH for the fake `sbx` shebang.

DRIFT: the seam reads `sbx ls` before every pin, so two existing sbx call-list assertions gain `["ls"]` — the restart rule needs the pre-pin listing — affects: none
DRIFT: the pin record is skipped under `TK_SUPERVISOR_UNDER_TEST=1` without `TK_STUDIO_HOME` — keeps suites out of the operator's real store — affects: none
DRIFT: `command-line.test.ts`'s own e2e fake sbx gained opt-in `FAKE_SBX_STATE` branches — that suite does not use `fakes.ts` — affects: none
DRIFT: the drained e2e asserts claim + one `pin-restart`, not a completed run — the sbx-tier drive fails after the claim at baseline — affects: none

## Consult Log

- 2026-10-26T21:48:19Z — trigger: deviation-gt-0 — question: accept the implementer's four score-1 deviations (pre-pin `sbx ls` in call lists; pin record skipped under TK_SUPERVISOR_UNDER_TEST without TK_STUDIO_HOME; opt-in FAKE_SBX_STATE in command-line's own fake; e2e asserts claim + pin-restart not complete)? — ruling: accept-deviation score 1 — do: keep all four deviations, score 1; keep the `storeUnsafe` guard, pin-record tests keep a throwaway TK_STUDIO_HOME — rule candidate: a production write into the per-user store may skip itself when the test marker is set and TK_STUDIO_HOME is unset (hole-31 pattern); not a deviation, tests set a throwaway TK_STUDIO_HOME
- 2026-10-26T21:53:03Z — trigger: high-severity-finding (triage reading) — question: review findings A restart on any probe gap, B episode bound misses claim/relaunch, C failed restart retries each pass, D stale pin record — ruling: apply — do: A REJECT (any judgeAuthStatus gap is Settled shape 1); B DEFER (a) DW "bound the pin-restart episode also at the run's latest claim/relaunch/resume"; C REJECT (pin-failed per 33-2, per-pass set filled before the steps); D DEFER (a) DW "treat a .pin whose supervisor_pid is dead or whose since predates the sandbox start as absent" — rule candidate: a finding that asks to change a rule the plan's Settled shape states verbatim is DEFER (a) or REJECT without a consult, never PATCH unless the code departs from the text


## Auto Run Result

Status: done
Blocking condition: none

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version), nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Follow-up review pass on the done story (pass 1 recommended it). Both pin sites call one seam, `pinWithRestart` (`apps/supervisor/src/sandbox.ts`). It restarts a running, logged-out sandbox once, probes again, and records `pin-restart`. It writes the supervisor pin record. `tk-studio-launch check` warns about an engine sandbox started outside the supervisor. This pass closed one gap in AC1's single-restart rule: inside a drain pass, the resumes now share `drainQueue`'s restarted set, so a resumed run's restart and a drained run's restart can no longer both happen in one pass. It also completed guard (e)'s tests.

**Files changed (this pass).**
- `apps/supervisor/src/cli.ts`: `drainQueue` creates the pass's set before `driveResumes` and passes it to that function. `driveResumes` and `queueRecorder` take an optional trailing `restarted`. Doc comments updated.
- `apps/supervisor/src/sandbox.ts`: `PinContext.restarted` doc comment only.
- `apps/supervisor/test/sandbox.test.ts`: "Live holder" now covers `running`/`paused`/`external`. Added "Live engine" for an ended run whose engine is still alive, "One set per drain pass…", and its counterfactual without the shared set.

(Files changed by pass 1 are listed in commit 72a18bd: sandbox.ts, cli.ts, fakes.ts, sandbox.test.ts, command-line.test.ts, launch.py, test_launch.py, driver-contract.md, test_driver_contract.py, README, SKILL.md, runbook.)

**Review findings (this pass).** 2 patches applied (high 0, medium 1, low 1), 1 deferred (medium; criterion (a)), 1 rejected. Follow-up review recommended: false (score 3×1 + 1×1 = 4).

**Verification.**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): 2027 tests OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test`, each file under its own fresh `TMPDIR`, with `~/.bun/bin` on PATH and `TK_STUDIO_ROOT` set: sandbox 77/0 (run twice: by the implementer, then by this session), command-line 102/3 (the 3 known baseline "worker tiers (Story 21.4)" failures), queue 98/0 (2 skipped), api 97/0, resume 81/0.
- `bun x tsc --noEmit`: exit 0.
- `/tmp/tk-sup-*` count unchanged (104 → 104).
- The implementer reverted the threading at cli.ts:572 as a counterfactual: the new drain-pass test failed, then passed again once the line was restored.

**Residual risks.**
- The `sbx ls` column layout and the real `claude auth status` exit behaviour come from fakes and have not been verified live.
- The deferred items: the episode bound after a healed claim, a stale `.pin` record, and a restart per queued run across passes on a sandbox that stays logged out.
- The resume recorder in `driveResumes` still takes no sbx deps (baseline behaviour, unchanged here).

Operator follow-up (unverifiable here): on the engine box, stop the engine sandbox, start it from a session with `sbx exec`, run `tk-studio-launch check` (expect the warning row), queue a run, and confirm one `pin-restart` and a claim.

DRIFT: the seam reads `sbx ls` before every pin, so two existing sbx call-list assertions gain `["ls"]` — the restart rule needs the pre-pin listing — affects: none
DRIFT: the pin record is skipped under `TK_SUPERVISOR_UNDER_TEST=1` without `TK_STUDIO_HOME` — keeps suites out of the operator's real store — affects: none
DRIFT: `command-line.test.ts`'s own e2e fake sbx gained opt-in `FAKE_SBX_STATE` branches — that suite does not use `fakes.ts` — affects: none
DRIFT: the drained e2e asserts claim + one `pin-restart`, not a completed run — the sbx-tier drive fails after the claim at baseline — affects: none

## Reconcile

- 2026-10-26 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 33-4-the-host-leg-runs-the-supervisors-suites
