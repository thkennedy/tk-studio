---
title: 'The Supervisor Starts Itself at Logon'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_revision: '3810a2776515cb5bedeb8cf0244e85baac5d4484'
review_loop_iteration: 0
deviation_score: 2
followup_review_recommended: true
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-22/operator-decisions.md'
  - '{project-root}/_bmad-output/specs/spec-epic-22/plans/22-3.md'
warnings:
  - oversized
  - multiple-goals
deferred:
  - summary: >-
      Every worker inherits TK_SUPERVISOR_TELEGRAM_TOKEN and TK_SUPERVISOR_NTFY_URL, because buildWorkerEnv strips only ANTHROPIC_API_KEY and TK_SUPERVISOR_TOKEN.
    evidence: |-
      start.ps1 exports the notifier variables to the supervisor, and the workers the tick and drain spawn get buildWorkerEnv(process.env), where an agent can read them with `env`. Deferral class (c): a credential rule is at risk. The consult ruled the story's NFR5 list (logs, events, errors, API answers, start.ps1 output) does not name the worker env, and the fix file is outside the 11-file cap. Fix: add both variables to the delete list in buildWorkerEnv, with one assertion in its existing test.
    location: >-
      src/server.ts:533
    severity: high
---

<intent-contract>

## Intent

**Problem:** The supervisor does not come back after a reboot of the agent PC, and the box's run hygiene (an editor-in-the-loop snapshot before a Godot run, a notification on every terminal run, a per-run transcript copy) is manual. Its CLI end-to-end suites never run on win32, the production host (DW-5, DW-10).

**Approach:** Add `start.ps1` (console-hosted at logon through a `shell:startup` shortcut), have the supervisor itself take the snapshot, send the notification and copy the transcript, and make the CLI e2e suites runnable on win32.

Story 22.3 (epics.md, authoritative), transcribed:

As the operator, I want the supervisor console-hosted at logon with the box's run hygiene built in, so that it is always up after a reboot and never runs under the conditions that hang `claude -p`.

- **AC1** Given `start.ps1` in the repo, when it runs, then it reads the bind address and token from the user environment, starts the sbx daemon from `$HOME` when it is not already running (so the "Docker Sandboxes daemon" sign-in task can later be retired by the operator), and starts the API and the pacer.
- **AC2** Given the logon path, when the story hands it over, then the operator receives the exact command for the `shell:startup` shortcut (`wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1`, runbook §4); nothing registers a "run whether user is logged on or not" task, and nothing starts the supervisor from a Claude desktop-app session.
- **AC3** Given a run flagged as editor-in-the-loop on a Godot project, when it is about to start, then a `robocopy /E` snapshot (never `/MIR`) of the project lands in the work folder and its path is recorded on the run.
- **AC4** Given any terminal run, when it ends, then a notification goes out (ntfy or Telegram, chosen by the environment) naming the run, its status, its reason, and its PR when there is one, and the run's session transcript is copied to the backup folder (the nightly task remains the catch-all).
- **AC5** Given a reboot of the agent PC, when auto-logon completes, then `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status` from another device answers.

Dispatch notes (binding):
- **21-6:** `start.ps1` sets `TK_SUPERVISOR_TRANSCRIPT_BACKUP` to the nightly backup's `claude-projects` folder and starts the supervisor through the path that calls `recoverWithResume`, once, before the pacer's first tick.
- **Operator (DW-5, DW-10):** enable the CLI e2e suites on win32 (`canRunE2E`, the process-start probe) so they can be made green on the Windows host, including kill-and-restart and backup-restore. The sandbox is Linux: write the win32 paths so they run here; list what only the Windows host can confirm under `unverifiable-here`. Close neither DW entry.

## Boundaries & Constraints

**Always:**
- Operator decisions §1–§5 are decided: env names `TK_SUPERVISOR_NOTIFY` (`ntfy`|`telegram`|unset), `TK_SUPERVISOR_NTFY_URL`, `TK_SUPERVISOR_TELEGRAM_TOKEN`, `TK_SUPERVISOR_TELEGRAM_CHAT`, `TK_SUPERVISOR_WORK`; port default 8787; the flag is `editor_in_the_loop: true` (API) / `--editor-in-the-loop` (CLI `submit`, no value), stored on the queue run like `tier`; Godot = `project.godot` in the root or a first-level folder; snapshot target `<TK_SUPERVISOR_WORK>/snapshots/<project id>/<queue run id>/`; a flagged submit with no `TK_SUPERVISOR_WORK` is refused before `enqueue` with a named error; a flagged non-Godot run takes no snapshot and records why in `events`; unset notifier ⇒ an event records that none was configured; a selected notifier missing its variables is a named start error; the per-run transcript goes to `TK_SUPERVISOR_TRANSCRIPT_BACKUP` in the nightly layout (`<backup>/<slug>/<sid>.jsonl` + `<sid>/subagents/`).
- The snapshot runs once per queue run, after the claim and before `wake`/`submit`, through `runProcess` with `robocopy <root> <target> /E`; exit codes 0–7 are success. An adopted or resumed run that already has a snapshot takes none.
- Notification + transcript copy run for every terminal end (complete, partial, blocked, cancelled, orphaned), outside any queue transaction, at most once per run across processes. A send or copy failure is recorded as an event and never fails the run or changes its state.
- Runs already terminal when the queue file gains the new column are never notified (no history flood).
- The PR is a GitHub pull-request URL taken from the status block's `artifacts[]`; omitted when absent.
- Credentials (API token, Telegram token and its Bot API URL) never appear in logs, events, errors, API answers or `start.ps1` output (NFR5).
- `start.ps1` reads each variable from the User scope (`[Environment]::GetEnvironmentVariable(<name>,'User')`) falling back to the process value, exports it to its children, fails loudly naming (never printing) a missing `TK_SUPERVISOR_BIND`/`TK_SUPERVISOR_TOKEN`, keeps its console, runs `bun src/cli.ts recover` once, then starts `serve` and a foreground pacer loop (`bun src/tick.ts`, then `bun src/cli.ts drain`, then sleep), and prints the exact `shell:startup` command.
- win32 test fakes run through a test-side shim (`.cmd` or `bun <script>`); on Linux the same helper produces the shebang form so the suites still run here.

**Block If:**
- Driving API-submitted runs needs a new long-lived CLI verb or a change to the tick's scope.
- The notification would need a new status-block field or a driver-contract change (AD-2).
- Copying an sbx transcript out of the microVM needs an `sbx` command shape beyond `sbx exec` (host-tier copies only; for sbx record the skip).
- win32 e2e enablement needs a change to the production spawn path (e.g. `shell: true`).
- The Files list must grow past the plan's 11 files.

**Never:**
- `/MIR`; `Register-ScheduledTask`; `-LogonType Password|S4U`; `Start-Process -WindowStyle Hidden`; starting the supervisor as a long-lived process in this session; `git push`.
- Removing the tick's own start-of-tick recovery.
- Network I/O inside a queue transaction.
- Out of scope: the runbook text (22.4), retiring the sbx sign-in task, DW-15, DW-11, changes to 22.1/22.2 routes beyond the submit field.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flagged submit, no work folder | `--editor-in-the-loop` / `editor_in_the_loop:true`, `TK_SUPERVISOR_WORK` unset | Nothing queued | Named error (CLI non-zero; `POST /jobs` 400 naming it) |
| Flagged Godot run | `project.godot` at root, or in `game/` | `robocopy <root> <work>/snapshots/<pid>/<run>/ /E` before `wake`; `snapshot` event with `{path}` | robocopy exit ≥8 ⇒ recorded; decided in Design Notes |
| Flagged non-Godot run | no `project.godot` at depth ≤1 | No robocopy; event records why | — |
| Terminal end, ntfy | NOTIFY=ntfy, URL set | One POST to the topic URL naming run id, state, reason, PR URL if any | Failure ⇒ event; run state unchanged |
| Terminal end, telegram | NOTIFY=telegram, token+chat set | One `sendMessage` call with the same content | Failure ⇒ event without the token/URL |
| No notifier | NOTIFY unset | Event: no notifier configured | — |
| Notifier misconfigured | NOTIFY=telegram, token missing | Named start error; token never in message | Refuse start |
| Transcript copy (host tier) | run has `session_id`, transcript exists | `<backup>/<slug>/<sid>.jsonl` (+ `subagents/`); `ensureTranscript` restores from it | Missing backup var / file ⇒ event |
| Transcript copy (sbx) | sbx tier | No copy; event records VM-resident skip | — |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-22/plans/22-3.md`, "Code Map") is the investigation; its anchors were re-checked on 2026-09-29 and still hold. Key anchors:

- `src/env.ts` -- `apiBind`/`apiPort`/`apiToken` :91-112, named-error pattern `ApiTokenMissing` :83. Add notifier + work getters and named errors here.
- `src/transcript.ts` -- `locateTranscript` :103, `transcriptBackupRoot` :158 (reuse), `ensureTranscript` :167 (restore inverse), `sbxTranscriptExists` :208.
- `src/cli.ts` -- `projectIdOf` :267, `recoverWithResume` :403, `recoverQueue` :435, `drainQueue` :459, `submitJob` :501 (refusal site, like `HostBypassRefused`), `cancelRun` :574, `runJob` :659 (claim + validation, snapshot goes before `startRun`), `drive` :739, status-block `artifacts` read :781, `finishRun` :1350, `main` :1553 (flag parser expects values; add a valueless flag).
- `src/queue.ts` -- `processStartTime` :170, `RunOptionsRecord`/`RUN_OPTION_KEYS` :454-455, runs DDL ~:558, column migration ~:582/:652, `enqueue` :801, `end` ~:1200, `writeEnd` :1215 (transactional), recover orphaned end :1425.
- `src/api.ts` -- `SubmitBody` :57, `SUBMIT_FIELDS` :81, `NAMED_REFUSALS` :85, `checkSubmitBody` :93, submit wiring :134.
- `src/server.ts` -- `killTree` ~:169, `runProcess` ~:270 (injected spawn for robocopy).
- `src/tick.ts` -- `main` ~:246, recovers at every tick start (keep).
- `test/command-line.test.ts` -- `canRunE2E` :308, fakes ~:323-:385, fake `uv` ~:1198, suites :427-:1190. `test/api.test.ts` -- `canRunE2E` :780, `fixture()` :36. `test/queue.test.ts` -- `fakeProbes` :18-40, Linux probe :650, win32 injection :862.
- `src/page.ts` -- already redacts `/bot<token>`.

## Tasks & Acceptance

**Execution:**
- `src/env.ts` -- add `notifier()` (validated `ntfy`|`telegram`|none, with named errors for a missing URL/token/chat that never carry a value) and `workDir()` -- AD-15 single env surface.
- `src/queue.ts` -- add `editor_in_the_loop` run option (DDL, migration, `enqueue`), plus a nullable notified-marker column whose migration marks already-terminal runs as done and an atomic claim (`UPDATE … WHERE notified IS NULL`) so one process handles each end -- once-per-run, no history flood.
- `src/hygiene.ts` (new) -- `isGodot(root)`, `snapshot(...)` (robocopy `/E` via injected runner, 0–7 ok), `notify(...)` (ntfy POST / Telegram `sendMessage`, injected `fetch`, PR URL from `artifacts[]`), `copyTranscript(...)` (nightly layout; sbx skip) -- the hygiene units.
- `src/cli.ts` -- `--editor-in-the-loop` on `submit`, refusal before `enqueue`; snapshot in `runJob` after the claim, before start, once per queue run; an after-end sweep (notify + copy for claimed terminal runs) called after each end in the driving process, after `cancelRun`, and in `recoverQueue`/`drainQueue`; validate the notifier at start of `serve`/`recover`/`drain`/`run`.
- `src/tick.ts` is NOT in Files: reach the tick's ends through the `runJob`/recover paths in `src/cli.ts` it already calls.
- `src/api.ts` -- `editor_in_the_loop` (boolean) in `SubmitBody`/`SUBMIT_FIELDS`; its refusal in `NAMED_REFUSALS` ⇒ 400.
- `start.ps1` (new) -- per Always; parameter `-IntervalSeconds` (default 60) for the pacer loop; `sbx` probe (non-zero exit of a read-only `sbx` listing ⇒ `Push-Location $HOME; sbx daemon start -d`); prints the AC2 command with `<repo>` resolved from `$PSScriptRoot`.
- `test/hygiene.test.ts` (new) -- every I/O-matrix row except the CLI/API refusal.
- `test/api.test.ts` -- the field, its 400 refusal; `canRunE2E` without the win32 exclusion.
- `test/command-line.test.ts` -- a fake-bin helper (shebang+chmod on POSIX, `.cmd` shim on win32); `canRunE2E` without the win32 exclusion; CLI refusal; a flagged Godot e2e asserting robocopy argv before `wake` when a fake robocopy is injectable, else unit-level.
- `test/queue.test.ts` -- new column + migration marking; a real PowerShell `processStartTime` case under `test.skipIf(process.platform !== "win32")`.
- `README.md` -- `start.ps1`, the Startup shortcut command, the new variables, hygiene behaviour.

**Acceptance Criteria:**
- Given the verify gate, when run in the sandbox, then `bun install --frozen-lockfile`, `bun test` and `bunx tsc --noEmit` all pass.
- Given `start.ps1`, when grepped, then it has no `/MIR`, no `Register-ScheduledTask`, no `-LogonType Password|S4U`, no `-WindowStyle Hidden`, and contains the exact AC2 command; where `pwsh` exists its parser reports 0 errors.
- Given any terminal path, when a test drives it with an injected fetch, then exactly one notification is sent naming run id, state, reason, and the PR URL when the status block has one.
- unverifiable-here (operator-decisions §5): logon start via the shortcut; AC5 smoke `curl`; sbx daemon start from `$HOME`; a real `robocopy /E`; the win32 e2e suites green on the Windows host incl. kill-and-restart and backup restore (DW-5, DW-10); a real ntfy/Telegram delivery.

## Spec Change Log

## Review Triage Log

### 2026-09-29 — Review pass
- layers: blind-hunter, edge-case-hunter (L-band story); diff handed to both as a file (/tmp/22-3.diff, 137 KB), not inline
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 1, medium 6, low 1)
- defer: 1 (high 1)
- reject: 2 (medium 1, low 1)
- addressed_findings:
  - `[high]` `[patch]` start.ps1 ended on the first serve/recover failure at logon (Tailscale not yet bound), so neither the API nor the pacer ran → failures warn and retry with back-off, and the pacer never stops
  - `[medium]` `[patch]` the API was down while recover drove resumed runs → serve starts before the one recover pass
  - `[medium]` `[patch]` a crash between the claim and the send lost the notification → a lease marker with stale re-claim (consult 3)
  - `[medium]` `[patch]` a long reason broke Telegram's 4096-char limit → text capped at 3800 bytes, only the reason truncated
  - `[medium]` `[patch]` the ntfy URL (a secret) could land in notify-failed events → URL, userinfo, auth, topic and host+path scrubbed
  - `[medium]` `[patch]` e2e suites on the Windows host would inherit the operator's notifier variables and send real notifications → cleared per suite
  - `[medium]` `[patch]` the named notifier start error was untested on run/recover/drain → e2e tests for all three
  - `[low]` `[patch]` start.ps1 printed a blank serve exit code → the process handle is cached
- deferred: `[high]` workers inherit the Telegram token / ntfy URL (src/server.ts:533, outside the Files cap; consult 2, class c)
- rejected: the printed shell:startup command is unquoted for a repo path with spaces (AC2 fixes the exact command verbatim); win32 `.cmd` fakes may not resolve by bare name under a shell-less spawn (only the Windows host can confirm this; recorded under unverifiable-here and residual risks)

### 2026-09-29 — Review pass
- follow-up review (review_loop_iteration 0); layers: blind-hunter, edge-case-hunter (L-band story); diff since `3810a2776515cb5bedeb8cf0244e85baac5d4484` (162 KB, excluding `_bmad-output/`) handed to both as a file (/tmp/review-22-3.diff), not inline
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 0
- reject: 2 (high 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` nothing drove the end sweep through `recoverQueue`/`drainQueue` (deleting either `sweepEnds` call left every test green, against the "any terminal path" criterion) → e2e tests drive both with an injected fetch; each fails when its sweep is removed
  - `[medium]` `[patch]` `cancelRun` swept every unclaimed end inside `POST /runs/{id}/cancel`, so the answer (even a 404) waited on unrelated runs' notifications → `sweepEnds` takes an optional run-id filter; cancel sweeps only its own run
  - `[medium]` `[patch]` the snapshot used robocopy's default retries (1,000,000 × 30 s), so one locked file held the run and its checkout lock until the 3600 s cap → `/E /R:3 /W:5`
  - `[low]` `[patch]` `GITHUB_PR` accepted an unbounded suffix, which could push the notice past `NOTICE_MAX_BYTES` → the PR is reduced to canonical `https://github.com/<owner>/<repo>/pull/<n>`
  - `[low]` `[patch]` a `TK_SUPERVISOR_WORK` equal to or inside the project root made robocopy copy the snapshot into itself → refused before robocopy runs; the run ends `blocked` through `SnapshotFailed`
- rejected: workers inherit the Telegram token / ntfy URL (already deferred as DW-17; not re-filed); an ntfy URL with no scheme passes the start check (the intent's I/O matrix makes a send failure an event with the run unchanged)

### 2026-09-29 — Review pass
- follow-up review (review_loop_iteration 0); layers: blind-hunter, edge-case-hunter (L-band story); diff since `3810a2776515cb5bedeb8cf0244e85baac5d4484` (177 KB, excluding `_bmad-output/`) handed to both as a file (/tmp/review-22-3-p3.diff), not inline
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 1, medium 3, low 2)
- defer: 0
- reject: 5 (medium 2, low 3)
- addressed_findings:
  - `[high]` `[patch]` `serve` was restarted only once per synchronous pacer pass, so a failed logon bind left `/status` (AC5) down for a whole recover/tick/drain-driven run → a same-console `-ServeOnly` keeper loops serve with back-off, independent of the pacer (consult 5)
  - `[medium]` `[patch]` `recover`'s stdout leaked into `Invoke-SupervisorRecover`'s return, so `$Recovered` was always truthy: the back-off retry never ran and the report never reached the console → `| Out-Host` (also on `Invoke-PacerStep`)
  - `[medium]` `[patch]` an unbounded `sbx ls` could hang the script before the API and the pacer → a 30 s-bounded probe that kills only itself
  - `[medium]` `[patch]` a bare `%` in the ntfy userinfo made `decodeURIComponent` throw, skipping the `auth` value and topic redaction (NFR5) → each part decoded in its own `try`; unit test
  - `[low]` `[patch]` a swallowed `queue.note` failure still finalised the lease `done` with no outcome event → `endHygiene` reports it and `sweepEnds` leaves the lease to go stale; test
  - `[low]` `[patch]` README and header said no startup failure ends the script, against the required loud failure on a missing `TK_SUPERVISOR_BIND`/`TK_SUPERVISOR_TOKEN` → only step 1's checks end it
- rejected: the tick's notifier check and end sweep are unverified (the tick calls `recoverQueue`, which checks the notifier and sweeps, src/tick.ts:258, src/cli.ts:453-462); no drain-driven snapshot test (drain drives through `runJob`, where the snapshot sits, src/cli.ts:493, :766: plumbing); a flag sent to an already-running run is dropped (the same rule as the permission mode and run options on a live run; a running run is past "about to start"); `serve` validates `notifier(env)` while cancel sweeps read `process.env` (identical in production); start.ps1 is only text-tested (pwsh is absent here; its runtime behaviour is `unverifiable-here`, and the defect this surfaced is patched)

## Design Notes

- **Notification hook = bounded sweep** (the plan's second option): a claim column survives a crash between the end and the send, works across the drive/serve/recover processes, and the migration marking bounds it to ends after this story shipped.
- **Snapshot failure** (robocopy exit ≥8 or spawn error): the run ends `blocked` naming `snapshot failed: <exit>` before `wake` — the editor-in-the-loop guarantee is that no flagged Godot run starts without its snapshot.
- **Pacer cadence** is a `start.ps1` parameter, not an env var (plan Risks); record it as a DRIFT.
- **`TK_SUPERVISOR_TRANSCRIPT_BACKUP`** comes from the User environment like the other variables (AD-15 forbids a machine path in the script); when unset `start.ps1` warns naming the variable and continues (restore then fails with 21-6's own named error).

- **End-hygiene marker is a lease** (review pass 1, consult 3): `runs.notified` goes `lease <ISO> pid …` → `done <ISO> pid …`, re-claimable after `END_LEASE_STALE_MS` (10 min). One live claimant at a time; after a crash a notification can repeat once, only if the crash falls between a send and its recording event. This is how "at most once per run across processes" and "survives a crash between the end and the send" both hold.
- **`serve` starts before the single `recover` pass** (review pass 1, consult 3): `serve` never drives or claims a run, and `recover` can hold the console for a whole resumed run, so `/status` answers meanwhile. The pacer's first tick waits for a recover pass; a failed `serve` or `recover` warns and retries with back-off (5 s doubling to 600 s).
- **`serve` lives in its own keeper process** (follow-up review pass 3, consults 5–6): the pacer's steps block for whole runs, so a once-per-pass restart left `/status` down for hours after a failed logon bind. `start.ps1 -ServeOnly`, started in the same console right after step 1, loops `serve` with the back-off; the main script only checks the keeper each pass and stops its tree (known pid, never by name) on exit. Run order: env, keeper, sbx probe (bounded 30 s), recover, pacer.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no lockfile change
- `bun test` -- expected: all green
- `bunx tsc --noEmit` -- expected: exit 0
- `grep -nE '/MIR|Register-ScheduledTask|LogonType|WindowStyle Hidden' start.ps1` -- expected: no match
- `command -v pwsh && pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('start.ps1',[ref]\$null,[ref]\$e) | Out-Null; \$e.Count"` -- expected: `0` where `pwsh` exists

## Deviation Summary

### pass 1 (implementer, 2026-09-29)

- planned: a `notified` column claimed with `UPDATE … WHERE notified IS NULL` / actual: the terminal-immutability trigger is now `BEFORE UPDATE OF <every column except notified>` (rebuilt on open) plus a `runs_notified_once` trigger (set once, terminal runs only) / why: the old trigger blocked the migration marking and the claim / may affect: none
- planned: the PR from the status block's `artifacts[]` / actual: `mirror` records it as `pr` on the `ended` event; the sweep reads it there / why: the sweep may run later in another process and the status block is not stored in the queue / may affect: none
- planned: hygiene recorded as events / actual: new event kinds `snapshot`/`snapshot-skipped` (before the run starts, from_state `queued`) and `notified`, `notify-failed`, `notify-skipped`, `transcript-copied`, `transcript-copy-failed`, `transcript-copy-skipped` (after every `ended`/`orphaned` event); existing tests filter only the six post-end kinds (`END_HYGIENE_EVENTS`) with a `lifecycle()` helper / why: 21 assertions expected the ending event last / may affect: 22-4
- planned: named errors for a missing URL/token/chat / actual: one `NotifierConfigMissing` naming the variable, plus `NotifierUnknown`, `WorkDirMissing`, `SnapshotFailed` / why: one class covers all three, never carries a value / may affect: none
- planned: failed snapshot ends the run `blocked` / actual: also surfaces as a post-claim StartError (CLI exit 2) / why: existing post-claim failure pattern / may affect: none
- planned: notifier validated at the start of `serve` in `src/cli.ts` / actual: in `src/api.ts` `serve()` beside bind/port/token / why: validated before the queue opens / may affect: none
- planned: `--editor-in-the-loop` on `submit` / actual: `submit` only; on `run` it is an unknown argument / why: the spec names only `submit` / may affect: none
- planned: `start.ps1` starts `serve` / actual: `Start-Process -NoNewWindow` in the same console, restarted with a warning if it exits; `-IntervalSeconds` default 60, bounded 5–86400 / why: console hosting without a hidden window; keep the API up for AC5 / may affect: 22-4
- planned: `test/hygiene.test.ts` covers the matrix / actual: also holds the `start.ps1` grep test and a `pwsh` parser test skipped when `pwsh` is absent / why: regression guard for AC2 / may affect: none
- planned: a fake-bin helper / actual: the fake sbx runs the fake worker as `bun <script>` / why: works under the win32 shim; test-only / may affect: none
- Implementer risk: on win32 the fake worker's parent is the `.cmd` shim's `cmd.exe`, so the kill-and-restart e2e likely kills the shim, not the supervisor (DW-5 follow-up, Windows host).

DRIFT: the pacer cadence is a `start.ps1` parameter `-IntervalSeconds` (default 60, 5–86400), not an environment variable — operator-decisions names no cadence; the plan directs a parameter — affects: 22-4
DRIFT: new `runs.notified` column with a replaced terminal-immutability trigger and a `runs_notified_once` trigger — the once-per-run claim must update a terminal run — affects: none
DRIFT: new event kinds (snapshot* before the start; notif*, transcript-copy* after the `ended`/`orphaned` event), and the PR URL is recorded as `pr` on the `ended` event — hygiene is recorded on the run and the sweep runs out of process — affects: 22-4
DRIFT: named errors `NotifierConfigMissing`, `NotifierUnknown`, `WorkDirMissing`, `SnapshotFailed` — operator-decisions requires named errors without fixing names — affects: 22-4

## Consult Log

- 2026-09-29T00:42:59Z — trigger: deviation-gt-0 — question: accept or reject the implementer's deviation set (trigger rewrite, `pr` on `ended`, new event kinds + `lifecycle()` filter, `-IntervalSeconds`, named errors), and at what score — ruling: accept-deviation score 2 — do: accept all five; carry the three `affects: 22-4` DRIFT names into 22-4's context; add to test/hygiene.test.ts "every terminal path" test an assertion that every event after `ended`/`orphaned` is in `END_HYGIENE_EVENTS` and none of them precede it; fix the spec deviation line (snapshot events come before the start) — rule candidate: When an implementer adds a script parameter, env var, event kind or error name that a later docs story will describe, score the deviation 2; when existing tests exclude new event kinds, add a positive test pinning where those events appear.
- 2026-09-29T00:49:00Z — trigger: high-severity-finding + file-outside-files — question: workers inherit TK_SUPERVISOR_TELEGRAM_TOKEN / TK_SUPERVISOR_NTFY_URL via buildWorkerEnv (src/server.ts:533, outside the 11-file cap): touch server.ts, strip from process.env in cli.ts, defer, or halt? — ruling: apply (option 3) — do: do not touch src/server.ts nor strip process.env; record a class-c deferral with the two-line buildWorkerEnv fix; flag it for the operator; confirm transcript copy, notifier errors/events and start.ps1 output never print the token, ntfy URL or Bot API URL — rule candidate: When a story adds a secret environment variable, its plan's Files must include src/server.ts (buildWorkerEnv) and its test.
- 2026-09-29T00:58:49Z — trigger: deviation-gt-0 (review patch pass) — question: accept the pass-2 deviation set (lease marker with stale re-claim, serve before the one recover pass with back-off retries, claimEnd/finishEnd, 3800-byte notice cap, e2e env clearing, ntfy topic scrubbing)? — ruling: accept-deviation score 2 — do: accept all six; add two Design Notes bullets (lease reading; serve-before-recover) and DRIFT lines affects 22-4; fix the start.ps1 header (first tick waits only for a recover that succeeds; a failed recover is retried; each tick recovers at its start) — rule candidate: When a spec pins both "at most once" and "survives a crash" for one side effect, write "one live claimant, lease re-claim after staleness, at-least-once across crashes"; pin startup invariants, not literal sequences.
- 2026-09-29T01:14:24Z — trigger: deviation-gt-0 (follow-up review patch pass) — question: accept the pass-3 deviation set (robocopy `/E /R:3 /W:5`, canonical PR URL, cancel sweeps only its own run, work folder inside the root refused) and at what score? — ruling: accept-deviation score 2 — do: keep all four patches; record them with score 2; note for 22-4 that the runbook gives `robocopy <root> <target> /E /R:3 /W:5`, that a cancel sweeps only the run it cancelled, and that a work folder equal to or inside the project root is refused with `SnapshotFailed` — rule candidate: A deviation that only adds flags or scoping to a pinned command, and keeps its named invariant (e.g. `/E`, never `/MIR`), is accepted at score 2 when a docs-as-built story follows, else at score 1, with no consult needed.
- 2026-09-29T01:23:09Z — trigger: high-severity-finding (follow-up review pass 3) — question: serve is restarted only once per synchronous pacer pass (start.ps1:175-180), so a serve that fails its logon bind stays down for a whole recover/tick/drain-driven run (AC5): patch with a same-console `-ServeOnly` keeper inside start.ps1, defer, or reject? — ruling: accept-deviation score 2 — do: apply option 1 inside start.ps1 only (keeper via `Start-Process (Get-Process -Id $PID).Path -ArgumentList -NoProfile,-File,$PSCommandPath,-ServeOnly -NoNewWindow -PassThru` after the env import, before the sbx probe and recover; the `-ServeOnly` branch skips sbx, recover, the pacer and the AC2 print and loops serve with the existing back-off, reset after a serve that stayed up, warnings naming exit codes only); the main loop only checks the keeper is alive, restarts it with a warning, stops it in `finally`; fix header steps 3-5, the retry paragraph and README; replace the pass-2 DRIFT with a keeper DRIFT affects 22-4; keep the grep and parser tests green — rule candidate: When a script must keep a long-lived service up while it runs blocking foreground work, the service's retry loop runs in its own process (same console, never hidden), never from the foreground loop's once-per-pass check; such a finding is a score-2 patch, not a deferral.
- 2026-09-29T01:33:35Z — trigger: deviation-gt-0 (follow-up review pass 3 patch set) — question: accept the implementer's pass-4 deviations (steps renumbered to run order env, keeper, sbx, recover, pacer; the keeper's script path quoted; `| Out-Host` also on `Invoke-PacerStep`; `Get-Command -CommandType Application` for the bounded sbx probe; `endHygiene` → `Promise<boolean>`) at the reported score 1? — ruling: accept-deviation score 2 — do: keep all four deviations and the `endHygiene` change at score 2; replace the pass-2 DRIFT (serve before the one recover pass) with one keeper DRIFT affects 22-4, and add one DRIFT affects 22-4 for the order env, keeper, sbx probe, recover, pacer, the 30 s-bounded then killed `sbx ls` probe, and only step 1's checks ending the script; note for 22-4 that `SBX_BIN` must name an executable application, not a `.ps1` wrapper, and that tick/drain output reaches the console through `Out-Host` — rule candidate: A step renumbering or wording change that follows an already-accepted reorder, plus a narrowing to an executable path or console routing (`| Out-Host`) that keeps the Always/Never invariants, is accepted with no consult: score 2 when a docs-as-built story follows, else score 1. The session carries out every DRIFT edit an earlier consult ordered before it asks for the next consult.

### pass 2 (review patches, 2026-09-29)

- planned: at most once via a single `UPDATE … WHERE notified IS NULL` claim / actual: a lease re-claimed after 10 min and finalised to `done`; recorded stages skipped on re-claim; a crash between a send and its event can repeat one notification / why: review patch (never lose a notification on a crash after the claim) / may affect: 22-4
- planned: `recover` once, then `serve`, failing loudly / actual: `serve` first; serve/recover/tick/drain failures warn and retry with back-off; one recover pass before the first tick / why: review patches (Tailscale may be unbound at logon; `/status` must answer while recover runs) / may affect: 22-4
- planned: `claimEnd` returns a boolean / actual: `claimEnd(runId, by?, at?)` returns the lease or null; new `finishEnd`, `END_LEASE_STALE_MS` / why: the lease needs a finalise step / may affect: none
- planned: notification text uncapped / actual: capped at 3800 UTF-8 bytes (`NOTICE_MAX_BYTES`), only the reason truncated / why: review patch (Telegram 4096-char limit) / may affect: none
- planned: operator variables cleared per child env / actual: cleared from `process.env` per e2e suite, restored after / why: in-process paths read `process.env` / may affect: none
- planned: scrub ntfy URL, userinfo, `auth` / actual: also the topic name and host+path (may over-redact) / why: the topic is ntfy's secret / may affect: none

DRIFT: the end-hygiene marker is a lease (`lease …` → `done …`, stale re-claim after 10 min), at-least-once across crashes — the story pins both "at most once" and "survives a crash between the end and the send" — affects: 22-4
DRIFT: `serve` is kept up by a same-console `-ServeOnly` keeper process (`start.ps1` re-invoked with `-NoNewWindow`, never hidden) that restarts it with back-off (5 s doubling to 600 s, reset after 60 s up), independent of recover, tick and drain; failures after step 1 warn and retry instead of exiting — Tailscale may be unbound at logon, and `/status` (AC5) must answer while recover, tick and drain drive runs for hours (replaces the pass-2 "serve before the one recover pass" DRIFT; consult 5) — affects: 22-4


### pass 3 (follow-up review patches, 2026-09-29)

- planned: `robocopy <root> <target> /E` / actual: `robocopy <root> <target> /E /R:3 /W:5` (`SNAPSHOT_RETRIES`) / why: review patch (robocopy's default 1,000,000 retries × 30 s held the run and its checkout lock until the 3600 s cap on one locked file) / may affect: 22-4
- planned: the PR is the GitHub pull-request URL from `artifacts[]` / actual: reduced to canonical `https://github.com/<owner>/<repo>/pull/<n>` (`canonicalPr`; owner, repo and number length-limited), also for raw values already on `ended` events / why: review patch (keep the PR line bounded under `NOTICE_MAX_BYTES`) / may affect: none
- planned: a sweep after `cancelRun` (over every unclaimed end) / actual: `sweepEnds(queue, deps, only?)`; a cancel sweeps only the run it cancelled, and an unknown id sweeps nothing / why: review patch (`POST /runs/{id}/cancel` waited on unrelated runs' notifications, even on a 404) / may affect: 22-4
- planned: a snapshot fails on robocopy exit ≥8, a spawn error or no work folder / actual: it also fails, before robocopy spawns, when `TK_SUPERVISOR_WORK` is the project root or lies inside it (`isWithin`, case-insensitive on win32) / why: review patch (robocopy `/E` would copy the snapshot into itself without end) / may affect: none
- consult 4: accept-deviation score 2. For 22-4: the runbook gives `robocopy <root> <target> /E /R:3 /W:5`, a cancel sweeps only the run it cancelled, and a work folder equal to or inside the project root is refused with `SnapshotFailed`.

DRIFT: the snapshot argv is `robocopy <root> <target> /E /R:3 /W:5`, not bare `/E` — robocopy's default retries hold the run and its checkout lock for up to the 3600 s cap on one locked file — affects: 22-4
DRIFT: a cancel sweeps only the run it cancelled (`sweepEnds` gains a run-id filter) — the API cancel answer waited on unrelated runs' notifications — affects: 22-4
DRIFT: the notified PR is reduced to canonical `https://github.com/<owner>/<repo>/pull/<n>` — an unbounded suffix could break the 3800-byte notice cap — affects: none
DRIFT: a `TK_SUPERVISOR_WORK` equal to or inside the project root is refused with `SnapshotFailed` before robocopy runs — the copy would nest into itself — affects: none

### pass 4 (follow-up review patches, 2026-09-29)

- planned: `serve` restarted from the pacer loop once per pass / actual: a same-console `start.ps1 -ServeOnly` keeper loops `serve` with the back-off (reset after 60 s up); the main loop only checks the keeper and stops its tree in `finally` / why: review patch, consult 5 (AC5 failed for a whole run after a failed logon bind) / may affect: 22-4
- planned: header/README steps env, sbx, serve, recover, pacer / actual: run order env, keeper, sbx probe, recover, pacer / why: the keeper starts before the sbx probe / may affect: 22-4
- planned: `& $Sbx ls *> $null` / actual: `Test-SbxDaemon` through `System.Diagnostics.Process`, output read and dropped, 30 s bound, then only that probe is killed and the daemon taken as not running; `Get-Command $Sbx -CommandType Application` / why: review patch (a blocked `sbx ls` hung the script before the API and the pacer); the probe needs an executable path / may affect: 22-4 (`SBX_BIN` must name an executable, not a `.ps1` wrapper)
- planned: `& $Bun src/cli.ts recover` / actual: `… recover | Out-Host`, and `& $Bun @Arguments | Out-Host` in `Invoke-PacerStep` / why: review patch (native output leaked into the function's return, so `$Recovered` was always truthy: the retry never ran and the report never reached the console) / may affect: 22-4
- planned: the keeper argv `@('-NoProfile','-File',$PSCommandPath,'-ServeOnly')` / actual: the script path is quoted (`$Self`) / why: `Start-Process` joins `-ArgumentList` unquoted, so a repo path with a space would break / may affect: none
- planned: `endHygiene` returns nothing / actual: returns whether every outcome note was recorded; `sweepEnds` skips `finishEnd` otherwise (the lease goes stale and is re-claimed) / why: review patch (a swallowed note failure finalised the lease `done` with no outcome) / may affect: none
- planned: `notifierSecrets` decodes userinfo inside the one `try` / actual: each part is decoded in its own `try` / why: review patch (a bare `%` skipped the `auth` value and topic, NFR5) / may affect: none
- planned: "A startup failure never ends the script" / actual: only step 1's checks (a missing `TK_SUPERVISOR_BIND`/`TK_SUPERVISOR_TOKEN`, no `bun`) end it / why: review patch (the wording contradicted the required loud failure) / may affect: 22-4
- consult 6: accept-deviation score 2. For 22-4: `SBX_BIN` must name an executable application; tick/drain output reaches the console through `Out-Host`.

DRIFT: `start.ps1` runs env, the `-ServeOnly` keeper, a 30 s-bounded `sbx ls` probe (killed on timeout, daemon then taken as not running), recover, the pacer; only step 1's checks end the script — the keeper must precede blocking work, and a hung `sbx ls` blocked every later step — affects: 22-4


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review of story 22-3. It covered the change set since `3810a2776515cb5bedeb8cf0244e85baac5d4484`, and HEAD was `4eca0b310c9bee5de92a4922727a585dec192bc7` when the review started. The story's scope is unchanged. `start.ps1` hosts the supervisor in a console at logon. The supervisor takes the editor-in-the-loop snapshot, and on every terminal run it sends one notification and copies the transcript. The CLI e2e suites can run on win32.

This pass hardened six things:
- `serve` now runs in a same-console `-ServeOnly` keeper process, restarted with back-off and independent of the blocking recover/tick/drain steps (AC5).
- `recover`'s output no longer leaks into the function's return value, so the retry runs and the report reaches the console.
- The `sbx ls` probe is bounded to 30 s.
- ntfy userinfo with a bare `%` no longer skips redaction of the `auth` value and the topic.
- A failed outcome note leaves the lease to go stale instead of finalising it.
- The startup-failure wording is now accurate.

**Files changed (this pass):**
- `start.ps1` -- the `-ServeOnly` serve keeper (started after step 1, stopped by known pid in `finally`); `recover`/pacer output through `Out-Host`; `Test-SbxDaemon`, a 30 s-bounded `sbx ls`; run order env, keeper, sbx, recover, pacer; header rewritten
- `src/hygiene.ts` -- per-part `decodeURIComponent` in `notifierSecrets`; `endHygiene` returns whether every outcome was recorded, and `sweepEnds` finalises only then
- `test/hygiene.test.ts` -- the bare-`%` userinfo redaction test, the failed-note lease test, and the keeper, `Out-Host`, bounded-probe and single-`throw` text pins
- `README.md` -- the start-up steps in run order, the keeper, and "only step 1's checks end the script"

**Review findings:**
- patches applied: 6 (high 1, medium 3, low 2)
- deferred: 0
- rejected: 5
- The existing DW-17 deferral (workers inherit the notifier secrets) is untouched.

**Follow-up review recommendation:** true. Patched high 1, medium 3, low 2; a high was patched, and the score 3 × 3 + 1 × 2 = 11 is at least 5.

**Consults:** 2 this pass (consults 5 and 6), both accept-deviation score 2. See `## Consult Log`.

DRIFT: `serve` is kept up by a same-console `-ServeOnly` keeper process that restarts it with back-off, independent of recover, tick and drain (replaces the pass-2 "serve before the one recover pass" DRIFT) — the pacer's steps block for whole runs, so AC5 failed for hours after a failed logon bind — affects: 22-4
DRIFT: `start.ps1` runs env, keeper, a 30 s-bounded `sbx ls` probe, recover, pacer; only step 1's checks end the script — the keeper must precede blocking work, and a hung `sbx ls` blocked every later step — affects: 22-4
DRIFT: the pacer cadence is a `start.ps1` parameter `-IntervalSeconds` (default 60, 5–86400), not an environment variable — operator-decisions names no cadence; the plan directs a parameter — affects: 22-4
DRIFT: new `runs.notified` column with a replaced terminal-immutability trigger and a `runs_notified_once` trigger — the once-per-run claim must update a terminal run — affects: none
DRIFT: new event kinds (snapshot* before the start; notif*, transcript-copy* after the `ended`/`orphaned` event), and the PR URL is recorded as `pr` on the `ended` event — hygiene is recorded on the run and the sweep runs out of process — affects: 22-4
DRIFT: named errors `NotifierConfigMissing`, `NotifierUnknown`, `WorkDirMissing`, `SnapshotFailed` — operator-decisions requires named errors without fixing names — affects: 22-4
DRIFT: the end-hygiene marker is a lease (`lease …` → `done …`, stale re-claim after 10 min), at-least-once across crashes — the story pins both "at most once" and "survives a crash between the end and the send" — affects: 22-4
DRIFT: the snapshot argv is `robocopy <root> <target> /E /R:3 /W:5`, not bare `/E` — robocopy's default retries hold the run and its checkout lock for up to the 3600 s cap on one locked file — affects: 22-4
DRIFT: a cancel sweeps only the run it cancelled (`sweepEnds` gains a run-id filter) — the API cancel answer waited on unrelated runs' notifications — affects: 22-4
DRIFT: the notified PR is reduced to canonical `https://github.com/<owner>/<repo>/pull/<n>` — an unbounded suffix could break the 3800-byte notice cap — affects: none
DRIFT: a `TK_SUPERVISOR_WORK` equal to or inside the project root is refused with `SnapshotFailed` before robocopy runs — the copy would nest into itself — affects: none

**For 22-4 (runbook):**
- `SBX_BIN` must name an executable application, not a `.ps1` wrapper.
- The tick/drain output reaches the console through `Out-Host`.
- `serve` runs in a `start.ps1 -ServeOnly` keeper in the same tab.
- The snapshot is `robocopy <root> <target> /E /R:3 /W:5`.
- A cancel sweeps only the run it cancelled.

**Verification** (run by this session after the patches, in the Linux sandbox):
- `bun install --frozen-lockfile`: exit 0, no changes
- `bun test`: 558 pass, 2 skip (the pwsh parser test and the win32-only `processStartTime` case), 0 fail, 12 files
- `bunx tsc --noEmit`: exit 0
- the forbidden-pattern grep on `start.ps1`: no match
- `pwsh` is absent, so `start.ps1` was neither parsed nor run here

**unverifiable-here** (operator, on the Windows host):
- the logon start via `wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1`
- the AC5 smoke `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status` from another device after a reboot, including a first bind failing at logon while a resume runs
- `pwsh -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('start.ps1',[ref]$null,[ref]$e) | Out-Null; $e.Count"` ⇒ `0`
- sbx daemon start from `$HOME`
- a real `robocopy /E /R:3 /W:5`
- the win32 e2e suites green, including kill-and-restart and backup restore (DW-5, DW-10)
- a real ntfy/Telegram delivery

**Residual risks:**
- None of the `start.ps1` PowerShell has been executed. Unconfirmed on Windows:
  - it parses under StrictMode Latest;
  - `Process.Kill($true)` stops the keeper and its `bun serve`;
  - Ctrl+C stops both in the one console;
  - the discarded-output `sbx ls` probe never blocks;
  - `| Out-Host` never waits on a grandchild holding stdout (consult 6 found supervisor spawns pipe their own stdio).
- A keeper killed from outside can leave its `bun serve` holding the port. The replacement then backs off with warnings.
- The main loop checks the keeper only once per pacer pass. The keeper itself only exits on a step-1 failure or an outside kill.
- `sbx daemon start -d` stays unbounded.
- The win32 `.cmd` fakes' parent is `cmd.exe`, so the kill-and-restart e2e may kill the shim (DW-5 follow-up).
- Workers still inherit `TK_SUPERVISOR_TELEGRAM_TOKEN`/`TK_SUPERVISOR_NTFY_URL` (DW-17, deferred, the orchestrator's).

## Reconcile

### 2026-09-29 — adjust-stories

- Score: 2
- Reasoning: No later entry remains in `stories.yaml`; every DRIFT line that names later work names 22-4, the runbook story built in tk-studio kb (no manifest entry here). 22-4's acceptance criteria still hold: they ask the runbook to describe the supervisor as built, and the drifts (keeper, run order, `-IntervalSeconds`, the lease, robocopy flags, cancel-scoped sweep, named errors, new event kinds) are facts it must describe, not criteria that change. All drifts keep AC2/AC3's invariants (same console, never hidden, no scheduled task, `/E` never `/MIR`) and operator-decisions §1–§5; none touches an AD, the driver contract, or the 2026-09-26 rulings. DW-17 (workers inherit the notifier secrets) is a recorded deferral, not a deviation, and stays with the operator.
- Affected: 22-4 (runbook) — "it names … the environment variables (bind address, token, database path, notification target), `start.ps1`, the Startup shortcut, the retirement of the sbx sign-in task, and the smoke test … §8 gains a row for each supervisor failure mode met while building it" (still holds; the as-built `start.ps1` behaviour it must describe changed)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted; epic complete: no next story (22-4 is built in tk-studio kb; its replan-queue entry stays open)
