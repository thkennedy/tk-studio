---
id: SPEC-epic-33
companions:
  - ../../planning-artifacts/architecture/architecture-tk-studio-2026-07-26/ARCHITECTURE-SPINE.md
  - ../../../plugins/tk-studio/contracts/driver-contract.md
  - ../../../kb/agent-pc-setup-runbook.md
sources:
  - ../../planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Epic 33: Loop Hygiene, What Epics 31 and 32 Taught the Loop

## Why

A pain to solve. While Epics 31 and 32 ran, the agent PC's observation ledger recorded loop deficiencies (holes 59, 62 to 69, and 52), each with its fix to make, and each cost hours of a day: the supervisor died with no log (66), its Max-login refusal reached only the console while a run sat queued (68, 69), a resumed engine's graceful stop ended runs `partial` (59), a stale sandbox view halted a story (65), the roster gate lived only on the host leg (62), the supervisor's own suites ran only by hand and leaked ninety thousand temp folders (63, 64), and a red host leg could only be re-run by hand (52). This epic turns each recorded fix into a story. The rules it keeps: the supervisor runs only in its console tab (or the `tk-studio supervisor` task) and never from a session; secrets never reach a worker, a log line, an event or a file; the engine's upstream BMad skills are never forked (fixes for upstream behaviour live on the supervisor's side); every surface change is additive on the contract (0.1.28). Holes 43, 45 and 48 stay open for a later pass. Repo: tk-studio (`apps/supervisor` and `start.ps1`, `tools/verify_host.py`, `plugins/tk-studio/lib` and skills, the contract, `kb/`); one story per run with a graceful stop after each, as EP-32 ran; an `apps/supervisor` change means the per-file suites by hand until 33.4 lands, then the host leg carries them.

## Capabilities

- **CAP-1** (33.1)
  - **intent:** The supervisor's console reaches a file on disk, so a dead tab leaves its cause behind.
  - **success:** Given `start.ps1` and the three bun processes it runs (`serve`, `tick`, `drain`), every line the console shows is also appended to `<TK_SUPERVISOR_WORK>\supervisor\logs\supervisor-<YYYY-MM-DD>.log` (one file per UTC day, the last 14 kept, each line stamped `<ISO time> [serve|tick|drain|keeper|pacer]`), with explicit `started`, `stopped (<why>)` and `uncaught: <error>` lines from the script and from each process's exit; a line never carries a value of a `TK_SUPERVISOR_*` variable or any token (the page's redaction applies); `GET /status` gains `log {path, last_lines[]}` (the last 20 lines, redacted; contract 0.1.28, additive) and the HTML status page shows them.
- **CAP-2** (33.1)
  - **intent:** A session reads the last pass without the screen.
  - **success:** `tk-studio doctor` reports the newest log's last `stopped` or `uncaught` line and its age when the API does not answer, and "no log" when the folder is absent; `bun test` covers the line shape, the rotation and the redaction with a fake clock; the runbook's hole-66 row names the file.
- **CAP-3** (33.2)
  - **intent:** A run that cannot be claimed says why in its record and in the owner's inbox, never only on the console.
  - **success:** Given a queued run the drain cannot claim (the Max-login preflight refuses, the pin fails, the placement is refused, the checkout lock is held by a live holder), on each drain pass the run stays `queued` and gains one queue event `claim-refused {reason, pass_at}` per distinct reason (a repeated reason updates `pass_at` on the same event, never a flood); the notifier sends one line per new reason with the run id and what resolves it; `GET /runs/{id}`, `GET /status`'s live list and the office's `problems[]` carry the latest reason (contract 0.1.28, additive); the claim proceeds on the next pass once the reason clears, recorded as `claim-refusal-cleared`.
- **CAP-4** (33.2)
  - **intent:** An expiring sandbox login is warned about a week ahead, with the renewal steps.
  - **success:** Given the engine sandbox's Max login (the global `anthropic` sbx secret, renewed from inside the sandbox with `/login`), `tk-studio doctor` and the activate drift check read `refreshTokenExpiresAt` from the sandbox's `~/.claude/.credentials.json` through `sbx exec` (never the tokens) and warn from 7 days before expiry, naming the renewal steps (`sbx run --name <sandbox>` → `/login` → `/exit`); an expired login is a failed check; `bun test` and the lib suite cover the events, the notifier line, the doctor reading and the warning window with fakes.
- **CAP-5** (33.3)
  - **intent:** A running sandbox without a Max login is restarted once by the pin, so a sandbox started outside the supervisor never blocks every claim.
  - **success:** Given a run on the sbx tier whose sandbox is already running when the pin runs, when the pin's login probe (`sbx exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`) answers not logged in, the pin stops and starts the sandbox once (`sbx stop`, `sbx run -d --name`), probes again, and only then runs the preflight; both attempts are recorded on the run (`pin-restart {probe_before, probe_after}`); a sandbox still logged out after the restart refuses the claim through CAP-3's event naming the renewal; a sandbox the supervisor itself pinned in this pass is never restarted twice.
- **CAP-6** (33.3)
  - **intent:** The readiness check names a sandbox the supervisor did not start.
  - **success:** When the engine sandbox is running with no supervisor pin recorded for it, `tk-studio-launch check` names it as a warning ("started outside the supervisor; the next pin restarts it"); the runbook's hole-68 row stays the rule for sessions; `bun test` covers the restart, the single-restart rule and the warning with a fake `sbx`.
- **CAP-7** (33.4)
  - **intent:** The host leg runs the supervisor's suites when `apps/supervisor` changed, so a Windows-only failure is caught by the gate.
  - **success:** Given a run whose diff touches `apps/supervisor`, `verify_host.py` adds a `supervisor` gate after `conformance`: each `test/*.test.ts` file but the e2e command-line suite in its own `bun test` under a per-file timeout (420 s), with every `TK_SUPERVISOR_*` variable stripped from its environment and `TMPDIR`/`TEMP` pointing at a per-run folder under the run's worktree that the gate removes afterwards, then `bunx tsc --noEmit -p apps/supervisor`; the gate's lines name each file's pass/fail counts and the slowest file; an unchanged `apps/supervisor` skips it like the studio-web gate; the recipe the handoff carried (holes 51/56) retires.
- **CAP-8** (33.4)
  - **intent:** The suites stop leaking temp folders.
  - **success:** A shared helper `apps/supervisor/test/tmp.ts` owns `mkdtemp`, the queues opened inside it and the removal in `afterAll` (queues closed first, hole 63); every suite uses it; a run of the whole gate leaves no `tk-sup-*` folder behind; `tk-studio doctor` warns when the user's Temp holds more than 500 `tk-sup-*` folders and names the cleanup; the runbook's hole-64 row is updated.
- **CAP-9** (33.5)
  - **intent:** The verify command that runs the lib roster gate inside the engine lives in the repository, not in a hand-edited overlay.
  - **success:** Given the engine policy the launch materialises into every run worktree (`.bmad-loop/policy.toml`, a gitignored operator overlay), when the launch's readiness check runs the `[verify] commands` list is reconciled from a tracked source (`plugins/tk-studio/pipeline/verify-commands.toml`, or the project's `.tk-studio/config.yaml` `engine.verify_commands`): a missing command is added, an operator's extra commands are kept, and the reconciliation is reported in the check's result; the tracked list carries `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` for tk-studio; a project without the list is unchanged; conformance covers the reconciliation and the lib suite covers the merge rules.
- **CAP-10** (33.5)
  - **intent:** A story that adds a skill without its roster row fails in the engine on every box.
  - **success:** When the engine's verify runs after a clean review, the command fails, bmad-loop routes the failure to a dev fix session, and the host leg never sees the roster miss; the runbook's hole-62 row points at the tracked source.
- **CAP-11** (33.6)
  - **intent:** The one halt that is the sandbox's stale view of a freshly rendered skill snapshot is recognised and resumed without an operator.
  - **success:** Given a run paused on a CRITICAL escalation whose reason says the skill render failed and names the snapshot folder under `_bmad/render/`, when the paused-run pass runs and the host sees that folder complete (every file the manifest names is present and non-empty), the pass removes the snapshot folder and the dev session's untracked `blocked` spec draft, resumes the run once (`POST /runs/{id}/resume`'s path), records `auto-resume {reason: stale-render-view, snapshot, attempt: 1}` and notifies one line; a second such pause on the same story is left for the operator with the reason naming the first attempt; the upstream skills are untouched (no fork).
- **CAP-12** (33.6)
  - **intent:** The recognition and its single-attempt rule are pinned by tests.
  - **success:** `bun test` covers the recognition (the reason text, the folder check), the single-attempt rule and the untouched other pauses with fixtures; the runbook's hole-65 row names the behaviour.
- **CAP-13** (33.7)
  - **intent:** A resumed or relaunched engine's graceful stop ends `complete`, so `partial` means something went wrong.
  - **success:** Given a run whose engine was resumed (`POST /runs/{id}/resume`) or relaunched by the paused-run pass and then ends `stopped` after a `story-done` for the story it was driving, the engine-end sweep ends the run `complete` exactly as a first engine's graceful stop does (`reason: null`, the PR not a draft), and `partial` is reserved for an engine that stopped before its story landed; `bun test` covers both paths on resumed and relaunched engines.
- **CAP-14** (33.7)
  - **intent:** The pacer's slow passes are visible.
  - **success:** Given the pacer (`start.ps1`: tick, drain, sleep), each pass's duration and exit code are logged (CAP-1's file) and the last ones are served in `GET /status` as `pacer {last_tick_ms, last_drain_ms, last_pass_at}` (contract 0.1.28, additive); a pass longer than 10 minutes is logged as a warning naming the pass and the run it was driving; the status page shows the pacer line; the runbook's supervisor table gains the pacer's shape.
- **CAP-15** (33.8)
  - **intent:** An ended run's host leg is re-run on its pushed branch through the supervisor, never by hand.
  - **success:** Given an ended run with a pushed branch and a PR (`partial` with `host_verify: red`, or any ended run), when `POST /runs/{id}/verify` arrives (the bearer only) or the cli verb `verify <run id>` runs, the supervisor cuts a fresh worktree from the branch's tip, runs the project's `verify.host` there exactly as the close-out does, records a new `host-verify` event with the result, removes the worktree, and on green marks a draft PR ready and ends the run's `host_verify` state `green` (the run's terminal state is unchanged; the plan pull-back sees the PR as before); a live run, an external run or a run with no branch is a 409 by name; a leg already running for the run is 409 `VerifyRunning`; contract 0.1.28 names the route.
- **CAP-16** (33.8)
  - **intent:** The verb is pinned by tests and documented where the operator looks.
  - **success:** `bun test` covers the worktree, the recorded event, the draft-to-ready flip and every refusal with fakes; the README's route table and the runbook's "when a host leg is red" steps name it.

## Constraints

- Rules in force: the supervisor runs only in its console tab or the `tk-studio supervisor` task, never from a session; a secret never reaches a worker, a log line, an event or a file (every `TK_SUPERVISOR_*` value and every token is redacted or stripped: CAP-1, CAP-4, CAP-7); the engine's upstream BMad skills are never forked, fixes for upstream behaviour live on the supervisor's side (CAP-11); every surface change is additive on one contract bump, 0.1.28 (AD-2: a supervisor route is a supervisor surface, never a plugin surface; AD-3: tokens in the environment or the per-user store, never a file the worktree carries; AD-11: every headless surface ends on the status block).
- One event per cause, never a flood: `claim-refused` is one event per distinct reason with `pass_at` updated in place; the notifier sends one line per new reason, per auto-resume and per pacer warning; a sandbox is restarted at most once per pin pass and a stale-render auto-resume happens at most once per story.
- Gates: the operator overlay `.bmad-loop/policy.toml` stays gitignored and machine-local; its `[verify] commands` is reconciled from a tracked source by the readiness check, never edited into the plan by hand; the host leg's `supervisor` gate runs each test file in its own `bun test` under a 420 s timeout with a per-run `TMPDIR` the gate removes; `bun` is not on the launch host's PATH, so a dev session runs `bun test` in the engine sandbox or records the gate `unverifiable-here` with the attended command (EP-29 to EP-32 precedent).
- Repo and cadence: tk-studio (`apps/supervisor`, `start.ps1`, `tools/verify_host.py`, `plugins/tk-studio/lib` and skills, the contract, `kb/agent-pc-setup-runbook.md`); one story per run with a graceful stop after each; until 33.4 lands an `apps/supervisor` change means the per-file suites by hand; every `sbx`, Atlassian, clock and planner in a test is a fake, no live call; the loop never pushes, tags or runs the release motion.

## Non-goals

- Holes 43, 45 and 48 (open for a later pass; they did not recur).
- The vertical-slice pack (EP-34 in the plan; §10's "EP-33").
- A fork of any upstream BMad skill.
- A second contract version within the epic (0.1.28 carries every additive change).
- Running the supervisor from a session.
- Breaking a story into sub-tasks (a unit is a whole story).
- Changing a run's terminal state on re-verify (CAP-15 changes `host_verify` only).

## Success signal

- On the agent PC a supervisor tab that dies leaves `supervisor-<date>.log` with its `stopped` or `uncaught` line, which `tk-studio doctor` reports when the API is down; a run the drain cannot claim shows `claim-refused` with its reason on `GET /runs/{id}`, in the office's `problems[]` and in one notifier line, and clears itself on the next pass; a sandbox started without its login is restarted once by the pin; a diff under `apps/supervisor` runs every suite file in the host leg with no `tk-sup-*` folder left behind; a skill without its roster row fails inside the engine; a stale render view resumes itself once; a resumed engine's graceful stop ends `complete`; the pacer's last pass is on `GET /status`; a red host leg is re-run with `POST /runs/{id}/verify` and a green result flips the draft PR ready; the lib suite, conformance and `bun test` are green.

## Assumptions

- One contract bump, 0.1.28, carries every additive change of the epic under one entry (`log` and `pacer` on `GET /status`; the `claim-refused`, `claim-refusal-cleared`, `pin-restart`, `auto-resume` and `host-verify` events; the latest claim reason on `GET /runs/{id}`, the live list and `problems[]`; `POST /runs/{id}/verify`), extending as EP-32 did at 0.1.27; 33.1 opens the entry.
- The runbook the stories name is `kb/agent-pc-setup-runbook.md` (§8's hole-62, -64, -65, -66 and -68 rows and §4's supervisor table); the handoff is `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-09.md`; the README's route table is `apps/supervisor/README.md`.
- `<TK_SUPERVISOR_WORK>` is the supervisor's work root as `start.ps1` reads it today (`C:\agent-work` on the agent PC, so the log folder is `C:\agent-work\supervisor\logs`, as the runbook's hole-66 row anticipates); the `keeper` and `pacer` tags name `start.ps1`'s own loop roles.

## Open Questions

- CAP-9's tracked source: the story offers two (`plugins/tk-studio/pipeline/verify-commands.toml`, or `.tk-studio/config.yaml` `engine.verify_commands`); which is authoritative when both exist, and does the plugin's file apply only to tk-studio itself or to every served project? The planner reads the plugin file as the tk-studio default and the config key as a per-project override.
- CAP-7 excludes "the e2e command-line suite" from the `supervisor` gate by name; which file is it (the stories do not name it), and does the gate still type-check it under `bunx tsc`?
- CAP-11's "dev session's untracked `blocked` spec draft": its path (`stories/<key>-*.md` in the spec folder of the run worktree, untracked) is the planner's reading; the pass acts on the host over the engine's worktree, so is a sandbox-side file ever involved?
- CAP-4 reads the sandbox credentials file through `sbx exec` from the host; when no engine sandbox exists (a project on the host tier only), is the check skipped or failed?

## Design notes (settled shape, planner, 2026-10-26)

- CAP-1 — `GET /status` `log`: optional entry: `log {path, last_lines[]}` always present, `path` the newest UTC day file (today's, else the newest present; `null` with `TK_SUPERVISOR_WORK` unset), `last_lines` the last 20 lines each redacted, plus `note` (`"no log"` | `"TK_SUPERVISOR_WORK is not set"`) only when `last_lines` is empty for that reason — per `apps/supervisor/README.md` §HTTP API `GET /status`, `plugins/tk-studio/contracts/driver-contract.md` §1 "Supervisor surfaces the web consumes" (0.1.28)
- CAP-1 — a log line's redaction: named placeholder rule: the page's `redactCredentials` (every `TK_SUPERVISOR_*TOKEN*`/`*SECRET*` value, `Bearer`/`Basic` credentials, values under credential-named keys, key-shaped strings → `[redacted]`) applied before the append and again on read; `start.ps1`'s own lines name variables, never values (NFR5); a non-secret `TK_SUPERVISOR_*` value a child prints (`serve`'s listening URL) is not a leak under this rule — per `apps/supervisor/README.md` §Environment (the `TOKEN`/`SECRET` redaction rule)
- CAP-2 — the doctor check: named placeholder rule: check `supervisor-log` `{check, status, detail, fix}`: `skipped` (`TK_SUPERVISOR_WORK` unset), `warn` `"no log"` (folder or files absent), `pass` (the API answers; the newest file and the age of its last `stopped`/`uncaught` line), `warn` (the API does not answer; that line verbatim and its age; fix: start the supervisor) — per `tools/installer/cli/tk_studio_cli/doctor.py` (Story 25.5's check shape), `plugins/tk-studio/contracts/conformance/manifest.json` `cli-doctor-json`
- CAP-5 — `pin-restart` event: named placeholder rule: `pin-restart {sandbox, probe_before, probe_after, pass_at}`. Each probe is the `judgeAuthStatus` answer: `null` when logged in with claude.ai, else its gap text; never stdout or a token. There is one per sandbox per refusal episode of the run (since its latest `claim-refusal-cleared`), and a repeat patches it in place. A restart happens only when the sandbox ran before the pin, the probe says logged out, this pass and this episode have not restarted it, and no other run holds it running, paused or external — per `plugins/tk-studio/contracts/driver-contract.md` §1 0.1.28 (Story 33.2's in-place rule), `_bmad-output/specs/spec-epic-33/plans/33-3.md` §Settled shape
- CAP-6 — the supervisor's pin record: named placeholder rule: `<TK_STUDIO_HOME or ~/.tk-studio>/sandboxes/<sandbox>.pin` = `{sandbox, since, run_id, supervisor_pid}`, written on every `pinned` and removed when `pin-released` stops the sandbox. `tk-studio-launch check` warns about a running engine sandbox that has no record. The row is advisory and never a gap. `bun test` covers the record and the lib suite covers the warning — per `plugins/tk-studio/contracts/driver-contract.md` §4 "Starter lock (0.1.23, Story 28.6)"
- CAP-7 — the e2e suite the `supervisor` gate excludes: named placeholder rule: `apps/supervisor/test/command-line.test.ts` (the suite spawning `bun src/cli.ts`), excluded by exact name; every other `test/*.test.ts` joins by glob; `tsc` still type-checks it through `tsconfig.json` `include` — per `_bmad-output/specs/spec-epic-33/plans/33-4.md` §Settled shape 1 (answers Open Question 2)
- CAP-7 — the gate's per-run temp folder: named placeholder rule: `<worktree>/.verify-tmp/supervisor-<UTC yyyymmddThhmmssZ>-<pid>/`, `TMPDIR`/`TEMP`/`TMP` set to it, removed in a `finally` (a failed removal fails the gate), `/.verify-tmp/` in the root `.gitignore` — per `plans/33-4.md` §Settled shape 2
- CAP-8 — `apps/supervisor/test/tmp.ts`: named placeholder rule: `tempDir(prefix)`, `track(closable)`, `cleanupTemp()` (tracked closed first, then folders removed with retries), registered once as a global `afterAll` in `test/preload.ts` plus a `process.on("exit")` fallback; no `mkdtempSync` in `test/` outside it — per `plans/33-4.md` §Settled shape 4
- CAP-8 — the doctor's Temp check: named placeholder rule: check `supervisor-temp` `{check, status, detail, fix}`: `warn` above 500 `tk-sup-*` folders directly under the user's temp (detail `"<n> tk-sup-* folders in <temp>"`, fix names the PowerShell and Linux cleanup), else `pass`; `skipped` when unreadable; never `fail`, never deletes — per `tools/installer/cli/tk_studio_cli/doctor.py` `check_stale_slots` (shape), `plans/33-4.md` §Settled shape 5
