---
title: "The Supervisor's Log File"
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_revision: '21cb68afe5497af0e6d23884ad5dcc136c18aa26'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-33/SPEC.md'
warnings: [oversized]
deferred:
  - summary: >-
      tk-studio doctor's "newest log's last stopped/uncaught line" is usually a routine `[tick]`/`[drain] stopped (exit 0)` tee line, so it hides a keeper/serve death while the pacer keeps stepping.
    evidence: |-
      The tee writes `stopped (exit <code>)` around every tick and drain step (src/log.ts), about every 60 s; `_last_end` in doctor.py takes the last line starting with `stopped`/`uncaught`, whatever the tag or code. AC2 names that literal line, so the code meets the criterion; ranking process-level ends (keeper/pacer/serve, or non-zero exits) first needs a planner ruling. The same noise shortens the 20-line /status tail. Meets deferral (a): a defect in behaviour the story's criteria name.
    location: >-
      tools/installer/cli/tk_studio_cli/doctor.py (check_supervisor_log, _last_end)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The supervisor's console is its only log: a Windows Terminal tab that dies takes its cause with it, and a session cannot read the last pass without the screen (hole 66).

**Approach:** Tee every console line of `start.ps1` and its three bun processes (`serve`, `tick`, `drain`) into one stamped, redacted file per UTC day. Serve the tail on `GET /status` and the HTML page (contract 0.1.28, additive). Teach `tk-studio doctor` to read the newest log when the API does not answer.

## Acceptance Criteria (transcribed verbatim from epics.md, Story 33.1)

- **AC1:** **Given** `start.ps1` and the three bun processes it runs (`serve`, `tick`, `drain`) **When** the supervisor runs **Then** every line the console shows is also appended to `<TK_SUPERVISOR_WORK>\supervisor\logs\supervisor-<YYYY-MM-DD>.log` (one file per UTC day, the last 14 kept, each line stamped `<ISO time> [serve|tick|drain|keeper|pacer]`), with explicit `started`, `stopped (<why>)` and `uncaught: <error>` lines from the script and from each process's exit; a line never carries a value of a `TK_SUPERVISOR_*` variable or any token (the page's redaction applies); `GET /status` gains `log {path, last_lines[]}` (the last 20 lines, redacted; contract 0.1.28, additive) and the HTML status page shows them
- **AC2:** **Given** the log **When** `tk-studio doctor` runs **Then** it reports the newest log's last `stopped` or `uncaught` line and its age when the API does not answer, and "no log" when the folder is absent; `bun test` covers the line shape, the rotation and the redaction with a fake clock; the runbook's hole-66 row names the file

## Boundaries & Constraints

**Always:** Studio Python is stdlib-only and runs via `uv run`. Credentials never reach a log line, an event or a tracked file (NFR5); redaction is the page's `redactCredentials`, reused, never copied (Settled shape 2). The contract change is additive (0.1.28) and lands with the conformance runner green (AD-19). The doctor check is read-only: it starts no process and makes no network call. The tee answers the child's exit code, so `$LASTEXITCODE` and the keeper's exit-75 restart rule are unchanged.

**Block If:** the Files list in `plans/33-1.md` must grow (e.g. `office.ts`, `hygiene.ts`, `server.ts`, a web file, `set-supervisor-env.ps1`). The tee cannot keep `$LASTEXITCODE` / the 75-rule semantics without restructuring the keeper's loop. A reviewer reads AC1's "never carries a value of a `TK_SUPERVISOR_*` variable" as stricter than Settled shape 2 (redacting the non-secret `BIND`/`PORT`/`WORK` values). In each case, HALT `blocked` and name the conflict.

**Never:** push, tag, open a PR or bump a package version. Put `log` on the office snapshot. Kill processes by name. Edit `epics.md`, `stories.yaml`, the plan files or `_bmad-output/implementation-artifacts/replan-queue.md`, and never stage that ledger (it carries the gate's pre-existing 33-4 entry).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Line shape | tag `tick`, text `a\nb\r`, fake clock | `<ISO UTC> [tick] a b` | — |
| Day switch | fake clock crosses UTC midnight | the next line goes to the new day's `supervisor-<date>.log` | — |
| Rotation | 16 day files + one foreign file | the newest 14 day files are kept; the foreign file is untouched | — |
| Redaction | child prints the `TK_SUPERVISOR_TELEGRAM_TOKEN` value and `Bearer x` | `[redacted]` in the file and in `last_lines` | — |
| Wrapper | fake script prints to stdout and stderr, exits 3 | both lines echoed and logged; `started`, `stopped (exit 3)`; wrapper exits 3 | a thrown error adds an `uncaught:` line |
| `/status` empty | work folder has no `logs` | `log {path, last_lines: [], note: "no log"}` | `WORK` unset → `path: null`, note `TK_SUPERVISOR_WORK is not set` |
| Doctor | WORK unset / no folder / API up / API down + `stopped (exit 1)` two hours earlier | `skipped` / `warn` "no log" / `pass` (file, age) / `warn` (line verbatim, `2h`, fix `FIX_START`) | the log's mtime is unchanged |

</intent-contract>

## Code Map

The plan's **Code Map** and **Settled shape 1-4** (`_bmad-output/specs/spec-epic-33/plans/33-1.md`) are the investigation. They are binding and not repeated here. I spot-checked the anchors on 2026-10-26 and they hold:

- `apps/supervisor/src/page.ts:155` `tailLines`, `:339` `redactCredentials`, `:23` `PageDeps`, `:74` `PageData` -- reuse; extend `PageData.log` and `PageDeps.now`; add the "Supervisor log" section before the ledger.
- `apps/supervisor/src/env.ts:271` `workDir` -- read-only seam for `logDir`.
- `apps/supervisor/src/api.ts:710-715` `status()` -- add `log: readLogTail(...)`.
- `apps/supervisor/start.ps1` -- 26 `Write-Host`/`Write-Warning` sites become `Write-SupervisorLog`; the four bun invocations are wrapped by `src/log.ts`.
- `apps/supervisor/src/log.ts` (new) -- tee plus the pure helpers (`formatLine`, `appendLine`, `rotateLogs`, `readLogTail`, `runUnderLog`, `main`).
- `apps/supervisor/src/cli.ts`, `src/tick.ts` -- `uncaughtException` / `unhandledRejection` handlers under `import.meta.main`.
- `tools/installer/cli/tk_studio_cli/doctor.py:527` `check_supervisor`, `:941` `run_doctor`, `:488` `check_tailscale_cert` (the `ctx.now` clock), `:60` `FIX_START` -- the new `check_supervisor_log` goes right after `supervisor`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- every `**0.1.27**` header assertion (lines 381, 466, 511, 563, 616, 664, 701, 786, 852, 915, …) becomes `**0.1.28**`.
- `kb/agent-pc-setup-runbook.md:1359` -- the hole-66 row.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/log.ts` -- create per the plan's Code Map -- the single place for the log format, rotation, redaction and the tee.
- `apps/supervisor/start.ps1` -- `Write-SupervisorLog` replaces every host write; add `started`/`stopped (<why>)`/`uncaught:` lines; route the four bun calls through `src/log.ts`; drop `| Out-Host` -- AC1, script half.
- `apps/supervisor/src/cli.ts`, `apps/supervisor/src/tick.ts` -- add the `uncaught:` handlers at entry -- AC1, the processes' own `uncaught` line.
- `apps/supervisor/src/api.ts`, `apps/supervisor/src/page.ts` -- add `log` to `/status` and the page section -- AC1, the surface.
- `apps/supervisor/test/log.test.ts` (new), `test/api.test.ts`, `test/page.test.ts` -- cover every matrix row above with a fake clock -- AC2's `bun test` clause.
- `tools/installer/cli/tk_studio_cli/doctor.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- add the `supervisor-log` check (Settled shape 4) and its four rows plus the read-only assertion -- AC2.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- add the 0.1.28 entry (header, §1 row, change note) and update the header assertions -- AD-19.
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md` -- update the `/status` row, the page bullet, the logon paragraph, the `TK_SUPERVISOR_WORK` rows and the hole-66 row naming the file -- AC2's runbook clause.

**Acceptance Criteria:** AC1 and AC2 above, each proven by a row in Verification.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 2, low 2)
- defer: 1 (high 0, medium 1, low 0)
- reject: 2 (high 0, medium 0, low 2): the PowerShell copy of the line format and rotation (already accepted as a pass-1 deviation, and the format is pinned in `hygiene.test.ts`); the second keeper end line on Ctrl+C (`stopped (keeper tree stopped by the pacer)` is the plan's designed line, and both lines are true)
- addressed_findings:
  - `[medium]` `[patch]` the tee died on Ctrl+C before logging its child's `stopped` line; it now ignores SIGINT/SIGBREAK while the child runs, with a test (`log.test.ts:222`)
  - `[medium]` `[patch]` the script's belt and the doctor's printed line missed Bearer/Basic credentials (both layers raised it); added masking in `start.ps1:122-123` and `doctor.py` `_redact_log_line`, with a doctor test row
  - `[low]` `[patch]` the `cli.ts`/`tick.ts` uncaught handlers were unasserted; added a text pin (`log.test.ts:236`)
  - `[low]` `[patch]` `Add-Content` could collide with the tees' appends; now a ReadWrite-shared append with retries (`start.ps1:131-142`)

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- `cd apps/supervisor && ~/.bun/bin/bun test test/log.test.ts test/api.test.ts test/page.test.ts && ~/.bun/bin/bun test && ~/.bun/bin/bunx tsc --noEmit` -- expected: green and clean. bun 1.4.3 lives at `~/.bun/bin` and is not on PATH. The suites leak `/tmp/tk-sup-*` folders (hole 70): count them before the run and remove only the ones this run created.
- `grep -c "0.1.28" plugins/tk-studio/contracts/driver-contract.md` -- expected: ≥ 3. `grep -n 'supervisor-<date>' kb/agent-pc-setup-runbook.md` -- expected: the hole-66 row.
- `git status --porcelain` -- expected: only the plan's Files.

**Manual checks (attended, `unverifiable-here`):**
- `pwsh -NoProfile -File apps/supervisor/start.ps1` on the agent PC's console tab, then `Get-Content C:\agent-work\supervisor\logs\supervisor-<today>.log -Tail 20` shows the `[pacer]`, `[keeper]`, `[serve]`, `[tick]` and `[drain]` lines; `curl -H "Authorization: Bearer …" http://<bind>:8787/status | jq .log` shows them too.

## Deviation Summary

- Pre-existing gate-session append to `_bmad-output/implementation-artifacts/replan-queue.md` (the 33-4 entry), excluded from this story (consult ruling, score 1): never edited or staged. Update 18:36Z: the operator committed it as `21cb68afe5497af0e6d23884ad5dcc136c18aa26`, the tree is clean, and the exclusion no longer applies. This is not an implementation deviation, so it does not raise deviation_score.

### pass 1 (2026-10-26, implementer)

- planned: Block If, HALT if the Files list must grow / actual: `apps/supervisor/test/hygiene.test.ts` (pins `start.ps1` text: `& $Bun src/cli.ts serve`, `... recover | Out-Host`, `& $Bun @Arguments | Out-Host`, the shortcut-line position, one `throw`, the `finally { Stop-SupervisorKeeper ... }` shape) and `apps/supervisor/test/web.test.ts:198` (pins `/status` as exactly `{ok,counts,live,locks}`) must change; left unedited, 6 tests red / why: both pin the very surfaces this story changes / may affect: 33-4, 33-7
- planned: drop `| Out-Host` after the tee / actual: kept on recover and the pacer steps / why: a native command's output inside a PowerShell function becomes the return value (`$Recovered`) / may affect: 33-7
- planned: `PageData.log` not optional / actual: `log?: LogTail`, always filled by `gatherPage`, renders "no log" if missing / why: `test/auth.test.ts` and `closeout.test.ts` (outside Files) build `PageData` by hand / may affect: none
- planned: `supervisor-log` check right after `supervisor` / actual: after the four cut-over checks / why: the `CutOver` test pins those right after `supervisor` / may affect: none
- planned: `ctx.env["TK_SUPERVISOR_WORK"]` / actual: `apps._var(ctx, ...)` (also reads the Windows User env, like the other checks) / why: consistency / may affect: none
- planned: rotation only in `appendLine` / actual: `Write-SupervisorLog` also keeps the newest 14 on a new day file; `rotateLogs` never deletes today's file / why: a day file the script creates first would otherwise never rotate / may affect: none
- planned: `Write-SupervisorLog` after step 1 / actual: the shortcut lines print after the env import; the step-1 refusals log `uncaught:` + `stopped` through a new `Stop-SupervisorStart` and then throw; `'--'` quoted; warnings logged with a `warning:` prefix / why: the log folder must exist first, and the early refusals are exits too / may affect: 33-7
- planned: `runUnderLog(argv, env, now, io)`; a duplicate `uncaught:` line accepted / actual: an exported `parseTeeArgs`; the tee skips its own `uncaught:` when the child's line already starts with `uncaught:` / why: one parser, and no `uncaught: uncaught:` / may affect: none
- planned: only the header assertions move to 0.1.28 / actual: also removed the 32.x `assertNotIn("**0.1.28**")` asserts, added a 0.1.28 test, and the doctor `AllPassing` test plants a log / why: those asserts would fail once 0.1.28 exists / may affect: none
- planned: `bunx tsc --noEmit` / actual: `bun node_modules/typescript/bin/tsc --noEmit` (clean) / why: `bun install` here cannot make the `.bin` links (EPERM) / may affect: none
- DEVIATION SCORE: 2

DRIFT: two bun suites outside Files (`test/hygiene.test.ts`, `test/web.test.ts`) pin the exact `start.ps1` text and the `/status` JSON this story changes — the plan's Files omitted them — affects: 33-4, 33-7
DRIFT: `| Out-Host` kept on recover and the pacer steps under the tee — needed so the PowerShell function's return value stays intact — affects: 33-7
DRIFT: `start.ps1` startup ordering: the shortcut lines move after the env import, and early refusals log through `Stop-SupervisorStart` — the log folder must be known first — affects: 33-7
DRIFT: `PageData.log` optional — hand-built `PageData` in out-of-Files tests — affects: none
DRIFT: `supervisor-log` check placed after the cut-over checks — the `CutOver` test pins their order — affects: none

### pass 2 (2026-10-26, implementer, per consult 18:53:41Z)

- planned: re-pin only the failing `hygiene.test.ts` asserts / actual: also re-pinned three anchors that had gone vacuous (`indexOf` -1) and the tailscale-warning asserts / why: they pin the changed text; a vacuous anchor guards nothing / may affect: none
- planned: keep "only step 1's refusals throw" / actual: an exact list of throw lines (`throw $Why`, `throw`, `throw`) plus structural checks (the `Stop-SupervisorStart` body, two calls before the keeper branch, bare throws only after `uncaught:` and before `finally`) / why: `start.ps1` now has three throws by design / may affect: 33-7
- planned: none / actual: the "never print a value" regexes now also cover `Write-SupervisorLog`, plus a check that every `& $Bun` runs under the tee / why: keeps NFR5 enforced on the new path / may affect: 33-7
- planned: `log` `{…, note: "no log"}` in `web.test.ts:198` / actual: `{path: null, last_lines: [], note: "TK_SUPERVISOR_WORK is not set"}` / why: the fixture's env has no WORK / may affect: none
- DEVIATION SCORE (pass 2): 1; story score stays 2 (consult ruling)

DRIFT: `apps/supervisor/test/hygiene.test.ts` and `apps/supervisor/test/web.test.ts` joined the story as test-only re-pins of the surfaces the ACs change — the plan's Files omitted the suites that pin them — affects: 33-4, 33-7

### pass 3 (2026-10-26, implementer, review patches)

- P1: the tee ignores SIGINT (and SIGBREAK on win32) only while the child runs, never SIGTERM, so a directed kill still stops it / may affect: none
- P2a: new `hygiene.test.ts` pins for the logger body (661-670); none existed / may affect: 33-7
- P2b: a local `_redact_log_line` in `doctor.py:592-616`, applied to the API-down line the doctor prints. It is a partial Python copy of the page's `redactCredentials`: it covers the `TK_SUPERVISOR_*TOKEN*/*SECRET*` values plus Bearer and Basic, but not credential-named keys or key-shaped strings. Any later story that changes the page's rule must also update it / may affect: any story touching `redactCredentials`
- P3: the `cli.ts`/`tick.ts` uncaught handlers are covered by a text pin, not a spawned throw / may affect: none
- P4: `Write-SupervisorLog` appends via a ReadWrite-shared `File::Open` with 3 retries (a `$written` flag) instead of `Add-Content`; after 4 failures the line is dropped quietly; the host line is always written first / may affect: none
- DEVIATION SCORE (pass 3): 2, per the consult at 2026-10-26T19:14:11Z; the story's score stays 2

DRIFT: `doctor.py` carries a partial Python copy of the page's redaction rule (`_redact_log_line`: secret-name values, Bearer and Basic; no credential-named keys or key shapes) — the installer cannot import the TS rule — affects: any later story changing `redactCredentials`
DRIFT: `Write-SupervisorLog` appends through a ReadWrite-shared `File::Open` with retries instead of `Add-Content` — the pacer/keeper share the day file with up to three tees — affects: none

## Consult Log

- 2026-10-26T18:34:09Z — trigger: halt — question: dirty tree (an uncommitted gate append to replan-queue.md, outside Files) vs step-01's clean-tree HALT, after the operator said to continue — ruling: accept-deviation score 1 — do: proceed; record it in the Deviation Summary; never edit/stage/commit that file, stage the Files by explicit path; Verify step 6 passes if porcelain minus that line names only the Files — rule candidate: exempt gate-owned ledger paths (replan-queue.md) from the step-01 clean-tree check and Verify's porcelain check when they are outside Files and never staged (observe record ok)
- 2026-10-26T18:53:41Z — trigger: halt + file-outside-files + deviation-gt-0 — question: does the plan's "Files must grow" Block If HALT when two existing out-of-Files suites (`test/hygiene.test.ts`, `test/web.test.ts:198`) pin the exact `start.ps1` text and `/status` JSON the ACs change; accept the pass-1 deviations? — ruling: accept-deviation score 2 — do: relaunch the implementer to re-pin only those two test files (keeping the invariants they guard) and add `log` to the expected `/status`; record both as test-only DRIFT; run the whole bun suite to green, then conformance; do not HALT — rule candidate: the planner greps the suites for literal pins of every changed surface and lists them in Files; a Block If's "Files must grow" means production modules only (observe record ok=True)
- 2026-10-26T19:14:11Z — trigger: deviation-gt-0 — question: accept the review-patch pass's deviations (P1-P4, P2b's partial Python copy of the redaction rule), and at what score? — ruling: accept-deviation score 2 — do: accept them as they stand; record P2b's partial copy and what it omits in the deviation notes; no code change — rule candidate: a cross-language subset copy of `redactCredentials` is accepted at score 2 when the deviation notes name the parts it leaves out (observe record ok=True)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version); routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** The supervisor's console now also goes to `<TK_SUPERVISOR_WORK>/supervisor/logs/supervisor-<UTC date>.log`. Each line is stamped `<ISO> [serve|tick|drain|keeper|pacer]` and redacted. The newest 14 day files are kept. Explicit `started`, `stopped (<why>)` and `uncaught:` lines come from `start.ps1` (keeper and pacer) and from each bun process, via the `src/log.ts` tee and the uncaught handlers in `cli.ts`/`tick.ts`. `GET /status` carries `log {path, last_lines[]}` (contract 0.1.28, additive), and the status page shows a "Supervisor log" section. `tk-studio doctor` gains the `supervisor-log` check: skipped when WORK is unset, warn "no log", pass when the API answers, and warn with the last `stopped`/`uncaught` line and its age when the API is down. The runbook's hole-66 row and the `TK_SUPERVISOR_WORK` row name the file.

**Files changed.**
- `apps/supervisor/src/log.ts` (new): line format, day file, rotation, tail read, and the tee.
- `apps/supervisor/start.ps1`: `Write-SupervisorLog` handles every host line; `started`/`stopped`/`uncaught` lines; bun calls run under the tee.
- `apps/supervisor/src/cli.ts`, `apps/supervisor/src/tick.ts`: `uncaught:` handlers that exit 70.
- `apps/supervisor/src/api.ts`, `apps/supervisor/src/page.ts`: `log` on `/status`, and the page section.
- `apps/supervisor/test/log.test.ts` (new), `apps/supervisor/test/api.test.ts`, `apps/supervisor/test/page.test.ts`: the matrix rows under a fake clock.
- `apps/supervisor/test/hygiene.test.ts`, `apps/supervisor/test/web.test.ts`: re-pinned to the new `start.ps1` text and the `/status` shape (outside Files; consult ruling).
- `tools/installer/cli/tk_studio_cli/doctor.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py`: the `supervisor-log` check and 6 tests.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py`: the 0.1.28 entry and the header assertions.
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md`: docs, including the hole-66 row.

**Review findings.** 4 patches applied (2 medium, 2 low), 1 deferred (medium; the doctor's routine-step noise), 2 rejected.

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 2; score 3×2 + 1×2 = 8, which is at least 5.

**Verification.**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests`: 2000 tests OK (2 skipped). `uv run python ../contracts/conformance/runner.py run`: `ok: true`.
- `bun test` on log, api, page, hygiene and web: 223 pass, 8 skip, 0 fail. The whole `bun test` (pass 2): 1260 pass, 26 fail. The 26 are identical by name to the base commit's failures (sbx and closeout tests that cannot run in this sandbox). The patch pass added only to the five files above.
- `tsc --noEmit` (via `bun node_modules/typescript/bin/tsc`, because `bunx` cannot link here): clean.
- `grep -c 0.1.28 driver-contract.md` = 3. The runbook's hole-66 row names `supervisor-<date>.log`. `git status --porcelain` showed only the story's files before commit. `/tmp/tk-sup-*` stayed at 104: the folders these runs created were removed.
- `unverifiable-here` (no pwsh in the sandbox; operator command): `pwsh -NoProfile -File apps/supervisor/start.ps1` on the agent PC's console tab, then `Get-Content C:\agent-work\supervisor\logs\supervisor-<today>.log -Tail 20`, which should show `[pacer]`, `[keeper]`, `[serve]`, `[tick]` and `[drain]` lines, then `curl -H "Authorization: Bearer …" http://<bind>:8787/status | jq .log`. `start.ps1` was checked by eye only and has never been parsed.

**Residual risks.** `start.ps1` has never run or been parsed (no pwsh here). The doctor's last `stopped` line is usually a routine tick or drain step (deferred). The doctor carries a partial Python copy of the redaction rule. The pacer may kill the keeper tree before serve's tee writes its own end line.

DRIFT: two bun suites outside Files (`test/hygiene.test.ts`, `test/web.test.ts`) were re-pinned to the `start.ps1` text and `/status` JSON this story changes — the plan's Files omitted the suites that pin them — affects: 33-4, 33-7
DRIFT: `| Out-Host` kept on recover and the pacer steps under the tee — needed so the PowerShell function's return value stays intact — affects: 33-7
DRIFT: `start.ps1` startup ordering: the shortcut lines move after the env import, and early refusals log through `Stop-SupervisorStart` — the log folder must be known first — affects: 33-7
DRIFT: `PageData.log` optional — hand-built `PageData` in out-of-Files tests — affects: none
DRIFT: `supervisor-log` check placed after the cut-over checks — the `CutOver` test pins their order — affects: none
DRIFT: `doctor.py` carries a partial Python copy of the page's redaction rule — the installer cannot import the TS rule — affects: any later story changing `redactCredentials`
DRIFT: `Write-SupervisorLog` appends through a ReadWrite-shared `File::Open` with retries instead of `Add-Content` — the day file is shared with the tees — affects: none
