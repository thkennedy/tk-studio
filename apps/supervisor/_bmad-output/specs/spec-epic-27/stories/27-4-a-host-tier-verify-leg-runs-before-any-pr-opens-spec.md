---
title: 'A Host-Tier Verify Leg Runs Before Any PR Opens'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_revision: '11befecc1f1f581567ec5c97418af7443b35ab4d'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-27/plans/27-4.md'
  - '{project-root}/_bmad-output/specs/spec-epic-27/operator-decisions.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A cancel that stops an sbx engine can lose the close-out take to the engine-end sweep, which then runs the host verify leg on the cancelled run.
    evidence: |-
      src/cli.ts:772 stops the engine (status 'stopped') and only reaches takeForCloseOut at src/cli.ts:827 after
      further awaits (the studio ender verb, the worker probe). A sweep tick in that window sees phase 'ended',
      not paused, not killed, takes the close-out (src/worktree.ts sweepEngines) and runs the leg, which the
      spec's Block-If says never runs on the cancel path. The sweep-vs-cancel race predates story 27.4 (the
      sweep already opened a PR there); a fix needs a cancel marker that src/worktree.ts can read, and
      src/cli.ts is outside the story's Files. Deferral criterion (a): behaviour the story's Block-If names.
    location: >-
      src/worktree.ts sweepEngines leg condition; src/cli.ts:772-827
    severity: medium
  - summary: >-
      A cancel of a run whose leg already recorded red (its transition and close-out record lost, the run still running) adopts the red draft and marks it ready.
    evidence: |-
      src/cli.ts closeOutNow (the cancel path) calls closeOut with no verify input, so an adopted PR gets plain
      `gh pr ready`, and the red result is dropped from the end (now cancelled). The sweep's main path and its late
      close-out now reuse the recorded host-verify (this pass, P2/P3); the cancel path needs src/cli.ts, outside the
      story's Files (Block-If: growing Files past 8 HALTs). Narrow window: between a lost transition and the next
      sweep tick. Deferral criterion (a): AC2's red PR stays a draft.
    location: >-
      src/cli.ts closeOutNow (cancelQueueRun path)
    severity: low
---

<intent-contract>

## Intent

**Problem:** An sbx-tier run's engine runs on Linux in the microVM, so Windows-only defects reach branches unless an operator runs the suite on the host before each PR (holes 11, 12, 22).

**Approach:** When an sbx-tier engine completes, the supervisor runs the project's own `verify.host` command (read from its tracked `.tk-studio/config.yaml` at the base, never from the plugin, AD-2) on the host, in the run's worktree, under a host-tier worker's guards, and records a `host-verify` event before the PR opens. Red ends the run `partial` naming the command, still pushes, opens the PR as a draft carrying the failures; no `verify.host` records a skip with its reason.

User story (epics.md, Story 27.4): As the operator, I want the project's own verify command run on the Windows host, in the run's worktree, after the engine completes and before the PR opens, so that Windows-only defects stop reaching branches (holes 11, 12 and 22).

Acceptance criteria (verbatim transcription):

- **AC1:** Given a project's tracked `.tk-studio/config.yaml` with `verify.host: <command>` (tk-studio: the lib suite and conformance; the supervisor: `bun test`; the-universe-awaits: its verify script), when an sbx-tier run's engine completes, then the supervisor runs that command on the host tier in the worktree, console-hosted, under the same guards as a host-tier worker, and records its exit, duration and the last lines of output on a `host-verify` event; the command comes from the project's config, never from the plugin (AD-2).
- **AC2:** Given a red host verify, when the PR would open, then the run ends `partial` naming the failing command, the branch is still pushed, the PR opens as a draft whose body carries the host failures, and the notification names them.
- **AC3:** Given a project with no `verify.host`, when a run ends, then the PR opens as before and the event says the leg was skipped with the reason.
- **AC4:** Given the supervisor's test suite and the runbook, when the story closes, then green, red and absent commands are pinned on both hosts, and runbook §3.8 retires the "attended host run before each PR" rule in favour of this leg.

## Boundaries & Constraints

**Always:**
- Settled shape of `plans/27-4.md` is binding: `verify: {host: "<one command line>"}`; split into argv on whitespace with `"…"`/`'…'` grouping, backslashes literal; never a shell. Missing key/block → skipped `no verify.host`; wrong type or empty → skipped `verify.host is not a non-empty string`.
- The command is read with `git show <base_ref>:.tk-studio/config.yaml` in `run.root` (never the worktree), parsed with the same js-yaml loader. Absent → skipped `no .tk-studio/config.yaml at <base_ref>`; unparseable → skipped `config unreadable: <error>`.
- The leg runs only on the sweep's main path, engine `phase === "ended"`, not paused, not `killed`, worktree present, `run.tier === "sbx"`. Other tier → skipped `host-tier run: the worker ran on the host`; gone worktree → skipped `worktree gone`. Exactly one `host-verify` event per completed-engine close-out, written before `closeOut`; a pending record replayed later never re-runs it. Paused and killed stops run no leg and write no `host-verify` event.
- Guard: wall clock `run.worker_guard_s ?? (Number(queue.definition(run)?.guards?.max_wall_clock_seconds) || 600)`, trip text `guard: max_wall_clock_seconds (<n>s)`. Spawn through `runner(deps)`/`runProcess` (argv, `windowsHide`, never `detached` on win32, tree kill) with `buildWorkerEnv()` as env.
- Event detail when ran: `{command, argv, cwd, exit: number|null, duration_ms, guard?, error?, green, stdout_tail, stderr_tail}`; tails = last 20 lines, each clipped to 300 chars with URL userinfo redacted (`clip` rule). Skipped: `{skipped: true, reason}`. Green = exit 0; timeout, spawn failure or non-zero = red.
- Red: state `partial`, reason ``host verify red: `<command>` <exited <n> | timed out (<guard>) | failed to start: <error>>; last lines: <last 5 stderr lines, else stdout, joined " | ">``; overrides whichever end the sweep computed (`launched.end` or `engineEndState`) for both `ended` and `finishStudio` (so `jobrun finish --state partial`). Push as before; new PR `gh pr create --draft`; existing PR: no `gh pr ready`, `gh pr edit <pr> --body-file <file>` with the regenerated body. Worktree removed as for any ended run.
- Green or skipped: PR opens / is marked ready exactly as today; body has a `## Host verify` section (green: command, duration; skipped: reason; red: command, exit or guard, duration, fenced tails).

**Block If:**
- Files would grow past the plan's 8 → HALT, record for `bmad-correct-course`.
- A named project's verify needs a shell (`&&`, pipe) to be one command line → do not add a shell; record it and propose a single entry-point script in the tk-studio-side section.
- A path other than the sweep's completed-engine branch is found to open a PR for an engine that completed on its own → record it; do not run the leg on cancel, drive-failure, mirror or late close-out paths.

**Never:** `shell: true` or a `bash -c`/`cmd /c` wrapper; reading `verify.host` from the plugin or the worktree; importing `src/cli.ts` from `src/worktree.ts`/`src/hostverify.ts`; force-push or merge; push, PR or remote actions by this loop session; editing tk-studio (runbook text is proposed only in the hand-over file); changing `src/hygiene.ts` or `src/page.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Green | sbx run, engine ended, base config `verify.host` exits 0 | `host-verify` green event; PR created ready (no `--draft`); end as computed | — |
| Red exit | command exits 3 | event `green:false, exit:3`; `ended` partial with reason naming command + last lines; pushed; `gh pr create --draft` body carries tails; `finish --state partial` | — |
| Red timeout | command outlives guard | event `exit:null, guard:"guard: max_wall_clock_seconds (<n>s)"`; red as above | tree killed |
| Red spawn | command not found | event `error`, red, reason `failed to start: …` | — |
| Absent | no `verify` key | skipped `no verify.host`; PR as before | — |
| Bad type | `verify.host: 5` or `""` | skipped `verify.host is not a non-empty string` | — |
| No config at base | file absent at `base_ref` | skipped `no .tk-studio/config.yaml at <base_ref>` | — |
| Branch edits config | run commit changes `verify.host` | base command still used | — |
| Host tier | `run.tier !== "sbx"` | skipped `host-tier run: …` | — |
| Paused / killed | paused stop, or `st.detail.killed` | no leg, no event; paused draft stays draft | — |
| Red on existing draft | resumed/relaunched run with paused draft PR | no `gh pr ready`; `gh pr edit <pr> --body-file`; red overrides `engineEndState` | — |

</intent-contract>

## Code Map

Anchors verified at HEAD `11befec`.

- `src/worktree.ts:550` `sweepEngines` -- main branch `:586-646`: probe, `takeForCloseOut` (`:597`), `launched` (`:601`), `closeOut` (`:606`), state/reason (`:609-619`), `finishStudio` (`:620`, def `:513`), `applyTransition`. Leg goes between take and `closeOut`; red overrides state/reason before `finishStudio`. Late close-out (`:565`) and pending replay (`:574-583`) run no leg.
- `src/worktree.ts:339` `closeOut` (never throws) -- push `:372`, PR adoption `:382`, `gh pr ready` unless paused `:389`, `prBody` (`:310`) to `--body-file`, `gh pr create` `--draft` only when paused `:401`. Add `input.verify`. `closeOutDetail` (`:468`) gains `host_verify: "green"|"red"|"skipped"`.
- `src/worktree.ts:89` `runner(deps)`; `src/server.ts:270` `runProcess` (timeout rejects "`<cmd>` timed out after Ns (process tree killed)"); `src/server.ts:537` `buildWorkerEnv`; `src/server.ts:744` `readProjectConfig` (js-yaml loader to reuse).
- `src/queue.ts:882` guard derivation; `src/cli.ts:175,181` `guardReason`/`wallClockGuard` text (format locally, no cli import); `src/queue.ts:1787` `queue.note`.
- `src/hygiene.ts:156,188` notice prints the run `reason` -- a reason naming the command and last lines satisfies "the notification names them"; no change.
- Other `closeOut` callers with no completed engine (no leg): `src/cli.ts:1154` `closeOutNow` via `:836`, `:987`, `:1121`.
- Tests: `test/worktree.test.ts` `fixture` `:20-57`, sweep tests `:275-468`; `test/closeout.test.ts:662-750` resumed/relaunched ends; `test/fakes.ts` `fakeGh` `:120`, `gitRepo`/`testGit` `:251,:277`, `fakeBin` `:33`. Verify commands in tests: `process.execPath` with `-e` scripts so they run on both hosts.
- `README.md:122` "Worktrees and PRs" (bullets `:131-136`); `.tk-studio/config.yaml` (no `verify` block yet); `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` (add `## Story 27.4`); runbook §3.8 step 5 (`kb/agent-pc-setup-runbook.md:785` in tk-studio) is where the leg's row goes.

## Tasks & Acceptance

**Execution:**
- `src/hostverify.ts` (new) -- `verifyCommand(run, deps)` (base read, split, skip reasons), `hostVerify(run, guardS, deps)` (spawn, tails, green), red reason text, PR-section text -- isolates the leg.
- `src/worktree.ts` -- sweep main path runs the leg (sbx, ended, not killed), notes `host-verify`, red override of state/reason before `finishStudio`; `closeOut` `input.verify` (draft create; existing PR: no ready, `gh pr edit --body-file`); `prBody` `## Host verify`; `closeOutDetail.host_verify` -- the wiring.
- `test/hostverify.test.ts` (new) -- split rules, base read ignoring a branch edit, green/red/timeout/spawn-failure/absent/non-string/empty/no-config/unparseable, tails and redaction, host tier skip.
- `test/worktree.test.ts` -- sweep pins: green → ready PR; red → `partial` naming command, pushed, `--draft` with failures in body, `finish --state partial` argv, reason names failures; red on paused run's existing draft → no `gh pr ready`, `gh pr edit`; absent → PR as before + skipped event; paused/killed → no event; relaunched/resumed red overrides `engineEndState`.
- `test/fakes.ts` -- only if `fakeGh` needs a `pr edit` answer.
- `.tk-studio/config.yaml` -- add `verify:\n  host: bun test`.
- `README.md` -- the leg in "Worktrees and PRs", the `host-verify` event, the red rule.
- `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` -- `## Story 27.4`: runbook §3.8 row retiring the attended host run before each PR; proposed `verify.host` for tk-studio and the-universe-awaits (`bash scripts/verify.sh`).

**Acceptance Criteria:**
- Given the I/O matrix, when `bun test test/hostverify.test.ts test/worktree.test.ts test/closeout.test.ts` runs, then every row is pinned by a named test (Linux here; the win32 run and console-hosted leg are `unverifiable-here`, operator-decisions §5).
- Given the hand-over file, when the story closes, then `## Story 27.4` carries the runbook §3.8 retirement row and the two proposed `verify.host` keys (`unverifiable-here`, operator-decisions §4).

## Spec Change Log

## Review Triage Log

### 2026-10-16 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 2 (medium 2): the leg blocks the sweep tick for up to the guard (the plan places the leg inline in `sweepEngines`, and AC1 asks for the worker's guard); a fresh worktree has no `node_modules` for `bun test` (Bun auto-installs when there is none, and the console-hosted run under operator-decisions §5 confirms it)
- addressed_findings:
  - `[medium]` `[patch]` a guard timeout lost stderr and most of stdout. The command now runs under a `CAPTURE` wrapper that writes both streams to files, so both tails survive a hang.
  - `[medium]` `[patch]` a red result on an adopted PR that was already ready left the PR ready. It now runs `gh pr ready <pr> --undo` before `gh pr edit`; a failure is recorded, never thrown.
  - `[medium]` `[patch]` after a crashed or lost close-out, the leg ran again or was skipped as `worktree gone`, so a red draft could be marked ready. The sweep now reuses a `host-verify` recorded after the latest `launched` and writes no second event.
  - `[low]` `[patch]` a fractional guard was reported as `failed to start`. The timeout match is now `[\d.]+s`.
  - `[low]` `[patch]` added a test for a red result overriding a resumed run's end.

### 2026-10-16 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 1, low 7)
- defer: 1 (medium 1): a cancel that stops the engine can lose the close-out take to the sweep, which then runs the leg on the cancel path (pre-existing sweep-vs-cancel race; the fix needs `src/cli.ts`, outside Files) — deferral criterion (a)
- reject: 1 (low 1): read the gate from a recorded base sha rather than `<base_ref>` — the intent contract pins `git show <base_ref>:.tk-studio/config.yaml` (Boundaries), and a run moving the shared base branch is outside this story
- addressed_findings:
  - `[medium]` `[patch]` a green or skipped verify on an existing PR (a resumed or relaunched run) left the body without `## Host verify`. closeOut now runs `gh pr ready` then `gh pr edit --body-file` when a verify result is passed; with no verify input it runs only `gh pr ready`, as before (consult 3: score 1).
  - `[low]` `[patch]` a command killed by a signal (not the guard) was recorded `exit: null` with no cause, and its reason read "exited null". The ran event now carries `signal?`, and the reason and PR section say `killed by <signal>` (consult 3: score 1).
  - `[low]` `[patch]` with the worktree gone and no pending record, the sweep ran the leg for an engine the supervisor had killed. It now checks `killedEngine` there, and a hit means no leg and no event; the end computation is unchanged.
  - `[low]` `[patch]` a throw from `gh pr edit` on the red existing-PR path overwrote an earlier `--undo` failure. Each call now has its own try/catch, and both failures are recorded.
  - `[low]` `[patch]` no test asserted the guard the sweep passes to the leg. Two sweep tests now pin `worker_guard_s`, then the definition's `max_wall_clock_seconds`.
  - `[low]` `[patch]` the docs did not say that a command whose first token is quoted must be YAML-quoted whole; otherwise the leg is skipped `config unreadable`. The README, the config comment and the hand-over now say so.
  - `[low]` `[patch]` the hand-over's host checks now cover a bare `bash` resolving to the WSL launcher, and `.cmd`/`.bat` shims, which cannot start without a shell. The README has a short clause saying the same.
  - `[low]` `[patch]` the no-config skip depended on git's English messages. `git show` now runs with `LC_ALL=C`.

### 2026-10-16 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 1 (low 1): a cancel (src/cli.ts closeOutNow) after a recorded red host-verify whose transition and record were lost adopts the red draft and runs plain `gh pr ready` — the fix needs `src/cli.ts`, outside Files — deferral criterion (a)
- reject: 2 (medium 1, low 1): the leg blocks the sweep tick for up to the guard (already ruled in the first pass: the plan places the leg inline and AC1 asks for the worker's guard); a verify command that dirties the worktree makes `git worktree remove` keep it (fails safe, recorded `kept: git worktree remove …` on the close-out; a forced clean could discard the engine's uncommitted work)
- addressed_findings:
  - `[medium]` `[patch]` an engine the supervisor killed that handled TERM and wrote a terminal status probed `ended`, so the leg ran on it and a red result replaced the guard-trip end. The main path now consults `killedEngine` for every non-paused end not already marked killed (it subsumes `goneKilled`); a hit runs no leg and writes no event, the end computation unchanged.
  - `[low]` `[patch]` the kill check ran before the reuse of a recorded `host-verify`, so a recorded red was dropped when a later `engine-kill` said `not running`. A `recordedVerify(events)` helper (after the latest `launched`) is read first and reused whenever present; paused stops still carry none.
  - `[low]` `[patch]` the late close-out of a terminal run passed no verify, so a red draft was marked ready. It now passes the recorded `host-verify` (never runs the leg; the terminal state unchanged): `gh pr ready --undo` and `gh pr edit --body-file`; no recorded verify behaves as before.
  - `[low]` `[patch]` a tail line holding ``` closed the PR section's fence early. The fence is now one backtick longer than the longest backtick run in the fenced lines (at least three).

## Design Notes

Reading the command from the base (not the worktree) means a run cannot weaken the gate that judges it. `closeOut` stays the only PR writer; the verify result is an input, so the late close-out and the CLI callers keep today's behaviour unchanged. `unverifiable-here`: win32 `bun test`; the console-hosted leg on the Windows host; the tk-studio runbook §3.8 change and the `verify.host` keys in tk-studio and the-universe-awaits.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: ok (EPERM on the `/c` mount is environmental: record, never touch `bun.lock`)
- `bun test` -- expected: all green
- `bunx tsc --noEmit` -- expected: no errors
- `grep -nE '"(bash|sh|cmd|powershell|-c|-lc|/c)"|shell: *true' src/hostverify.ts` -- expected: no hits

## Deviation Summary

### pass 1 (2026-10-16, implementer)

- planned: `test/hostverify.test.ts` pins host-tier, killed and paused skips / actual: host-tier pinned in both test files; killed and paused pinned only in `test/worktree.test.ts` sweep tests / why: killed/paused are decided in the sweep, not in `hostverify.ts`; `closeout.test.ts` would be a 9th file / may affect: none
- planned: `closeOutDetail` gains `host_verify` / actual: nested in the close-out record (`detail.closeout.host_verify`) / why: level unspecified; it sits with the other close-out fields / may affect: 27-5
- planned: listed skip reasons / actual: a non-missing `git show` failure is skipped `config unreadable: git show exited <n>: …`; a red reason with no output ends `last lines: (none)` / why: unspecified cases, spec wording reused / may affect: none
- planned: red on existing PR → no `gh pr ready`, `gh pr edit` / actual: done; close-out records the PR as draft even if the adopted PR was never a draft / why: the expected case is the paused run's draft; no reconversion to draft / may affect: none
- planned: sbx-tier sweep tests / actual: tests set `tier = 'sbx'` directly in the in-memory queue DB after the launch return / why: an sbx launch return would call real `sbx`; the fixture has no fake `sbx` / may affect: none
- planned: tk-studio `verify.host` = lib suite + conformance / actual: Block-If hit recorded; single entry-point `tools/verify_host.py` (`uv run python tools/verify_host.py`) proposed in the hand-over / why: two commands in two dirs cannot be one command line without a shell / may affect: none (operator follow-up in tk-studio)
- note (environment, not a deviation): the implementer removed stale `/tmp/tk-sup-*` test temp folders older than 60 min because `/tmp` ran out of inodes.

DRIFT: killed/paused skip pinned in the sweep tests, not `test/hostverify.test.ts` — decided in the sweep; avoids a 9th file — affects: none
DRIFT: `host_verify` nested under the close-out record (`detail.closeout.host_verify`) — level unspecified, kept with the close-out fields — affects: none
DRIFT: two unlisted texts (`config unreadable: git show exited <n>: …`, `last lines: (none)`) — unspecified cases — affects: none
DRIFT: red adoption of a non-draft open PR is recorded as draft — no reconversion; expected case is the paused draft — affects: none
DRIFT: sweep tests set `tier='sbx'` in the in-memory DB — no fake `sbx` in the fixture — affects: none
DRIFT: tk-studio `verify.host` needs a single entry-point script (`tools/verify_host.py`, proposed in the hand-over) — Block-If's prescribed handling, no shell — affects: none

### pass 2 (2026-10-16, implementer, review patches)

- planned: spawn the command directly through `runProcess` (`runner(deps)`) / actual: it runs under a `CAPTURE` wrapper (`<bun> -e CAPTURE <spec.json>` via `runProcess`; the wrapper `cp.spawn`s the argv, not detached, `windowsHide`, with stdout/stderr to temp files and a status file) / why: `runProcess` returns only a 400-char stdout slice on timeout and its kill helpers are not exported; keeping both tails of a hung command without touching `src/server.ts` needs the wrapper / may affect: none (consult 2: score 1). Known limits: (a) on POSIX a grandchild that outlives the command is not waited on or guard-killed, since the leg ends at the command's exit; (b) the wrapper needs `process.execPath` to be bun or node; win32 console hosting unverifiable-here
- planned: README unchanged by the patches / actual: its host-verify paragraph updated (`--undo`, reuse of a recorded result, the wrapper) / why: keep docs true / may affect: none

DRIFT: the verify command runs under a `CAPTURE` wrapper spawned by `runProcess`, not directly — `runProcess` keeps no stderr on a timeout, and `src/server.ts` is outside Files — affects: none

### pass 3 (2026-10-16, implementer, follow-up review patches)

- planned: ran event detail `{command, argv, cwd, exit, duration_ms, guard?, error?, green, stdout_tail, stderr_tail}`; red reasons `exited <n> | timed out (<guard>) | failed to start: <error>` (spec :41-42) / actual: optional `signal?` (only when non-null) and a `killed by <signal>` variant in `redReason` and `prSection` / why: a signal-killed command read "exited null" with no cause / may affect: none (no later epic-27 plan reads these fields; consult 3: score 1)
- planned: green or skipped on an existing PR is "marked ready exactly as today" AND its "body has a `## Host verify` section" (spec :43) / actual: `gh pr ready <pr>` then `gh pr edit <pr> --body-file` when a verify result is passed; no verify input → `gh pr ready` only / why: the two halves of :43 conflict for an existing PR; the existing "paused … then ended" sweep test now also expects `pr edit` / may affect: none (consult 3: score 1)
- planned: red on an existing PR → "no `gh pr ready`" (spec :42) / actual: `gh pr ready <pr> --undo` (reconvert to draft, a no-op on a draft), added by the pass-2 review patch / why: an adopted PR an earlier close-out marked ready would stay ready on red / may affect: none (logged per consult 3)

DRIFT: optional `signal?` on the `host-verify` event and a `killed by <signal>` red reason variant — a signal-killed command read "exited null" — affects: none
DRIFT: green/skipped on an existing PR also runs `gh pr edit --body-file` — spec :43's "as today" and "body has the section" conflict for an existing PR (consult 3: score 1) — affects: none
DRIFT: red on an existing PR runs `gh pr ready --undo` despite spec :42 "no `gh pr ready`" — an adopted ready PR must not stay ready on red — affects: none

## Consult Log

- 2026-10-16T07:16:22Z — trigger: deviation-gt-0 — question: accept the six pass-1 deviations, and is `detail.closeout.host_verify` (nested) a seam for 27-5? — ruling: accept-deviation score 1 — do: keep `host_verify` nested and record all six at score 1, drop the "may affect: 27-5" flag; list the tk-studio entry-point script (`tools/verify_host.py`) in the hand-over as tk-studio-side work, no `shell: true` — rule candidate: when a plan says a field "may carry" something and names no level, place it beside related fields in the existing record; score 1 unless a later story's plan or epic greps to that key path.
- 2026-10-16T07:26:19Z — trigger: deviation-gt-0 — question: does the `CAPTURE` wrapper (`<bun> -e CAPTURE <spec.json>` via `runProcess`, which keeps both tails on a timeout) satisfy "console-hosted, under the same guards" and the no-shell rule, and what score does it get? — ruling: accept-deviation score 1 — do: keep the wrapper and record it at score 1, "may affect: none"; name the two known limits (POSIX grandchild not waited on or guard-killed; execPath must be bun or node), win32 unverifiable-here; do not touch `src/server.ts`, no `shell: true` or `-c`/`/c`, the spec grep stays at no hits — rule candidate: an argv-only `<execPath> -e <fixed script>` wrapper spawned through the shared helper (not detached, `windowsHide`) counts as within the "spawn through runProcess" rule; score 1, list the lost wait-for-grandchild as a known limit.
- 2026-10-16T07:42:00Z — trigger: deviation-gt-0 — question: accept the follow-up pass's two deviations (optional `signal?` + `killed by <signal>` red reason against spec :41-42; `gh pr edit --body-file` after `gh pr ready` on an existing PR for green/skipped against spec :43 "as today")? — ruling: accept-deviation score 1 — do: keep both patches; record each citing :41/:42 and :43; log the red path's `gh pr ready --undo` as a third deviation against :42, not removed — rule candidate: when a story requires PR-body content and also "existing PR as today", regenerate the body with `gh pr edit --body-file` alongside the ready/draft call; additive optional event-detail fields that leave pinned texts unchanged are score 1 unless a later plan reads them.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was the second follow-up review of the host verify leg (the spec was `done` with `followup_review_recommended: true`). Both layers ran (band L). The pass applied 4 patches:
- An engine the supervisor killed now runs no leg even when its status reads ended (it handled TERM), so a red result never replaces the guard-trip end.
- A `host-verify` recorded for the completion is reused before the kill check.
- The late close-out of a terminal run passes the recorded verify, so a red draft is never marked ready there.
- The PR section's code fence is longer than any backtick run in the tails.

**Files changed (this pass):**
- `src/worktree.ts`: the `recordedVerify(events)` helper, `killedEngine` consulted for every non-paused end (replacing `goneKilled`), the recorded verify read first, and passed to the late close-out's `closeOut`.
- `src/hostverify.ts`: the `fence` helper in `prSection` sizes the fence past the longest backtick run.
- `test/worktree.test.ts`: the P1 (killed, status `stopped`/`interrupted`), P2 (recorded red, worktree gone, later kill) and two P3 (late close-out with and without a recorded verify) tests.
- `test/hostverify.test.ts`: the fence test.
- `README.md`: the Story 27.4 paragraph updated for the four changes.

**Review:** 4 patches applied (medium 1, low 3), 1 deferred (low: the cancel path `src/cli.ts` closeOutNow can mark a recorded red draft ready; criterion (a)), 2 rejected (the sweep blocking for the guard, already ruled; a dirtied worktree is kept, which fails safe). Follow-up review recommendation: true. The score is 3×1 + 1×3 = 6, which is 5 or more.

**Verification:**
- `bun test`: 799 pass, 4 skip, 0 fail. The session re-ran it independently.
- `bunx tsc --noEmit`: exit 0.
- The no-shell grep on `src/hostverify.ts`: no hits.
- `bun install --frozen-lockfile`: EPERM linking js-yaml/typescript on the `/c` mount. This is environmental; `bun.lock` was not touched.
- The implementer checked that the P1, P2, P3 (red) and P4 tests fail against the pre-patch code.

**unverifiable-here** (unchanged, operator-decisions §4 and §5):
- the win32 `bun test` run;
- the console-hosted leg against a real sbx run on the Windows host;
- the tk-studio runbook §3.8 change and the `verify.host` keys in tk-studio and the-universe-awaits.

**Residual risks:**
- The deferred cancel-path draft-ready case (this pass) and the deferred cancel-vs-sweep race (DW-31).
- On POSIX, a grandchild process that outlives the verify command is not waited on.
- The leg holds the sweep tick for up to the guard.
- A verify command that dirties the worktree leaves it kept after the close-out.

## Reconcile

- 2026-10-16 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 27-5-the-plan-follows-the-run-and-the-deferred-work-is-paid
