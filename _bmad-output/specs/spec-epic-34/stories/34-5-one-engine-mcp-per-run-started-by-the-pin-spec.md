---
title: 'One Engine MCP per Run, Started by the Pin'
type: 'feature'
created: '2026-10-27'
status: done
reconcile_verdict: not-required
baseline_revision: 'c5a212eb8f63d3a28c3e0a31e0c45926f8a33411'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-5.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** A dev session on a game project cannot run the project's tests, verify it, or take a frame from the engine without a human. No engine MCP server has been chosen. Nothing writes one into `.mcp.json`, and nothing starts one for a run.

**Approach:** Three parts:
1. A spike on the box picks one engine MCP per project. The operator runs it through the consult log. Its record is `kb/engine-mcp-godot.md`.
2. The `game-godot` profile names the pick through 34.4's proposal. Only `recommend.py record --mcp`, on confirmation, writes the `.mcp.json` entry.
3. For a run flagged `editor_in_the_loop`, the supervisor snapshots the project, starts the MCP on the host behind the tailnet address with a per-run bearer, passes the URL and the bearer into the sandbox by name, and stops it at release.

The MCP is verify-only in this version.

**User story (epics.md, Story 34.5):** As the loop, I want the engine's MCP server chosen once per project, written into `.mcp.json` only on confirmation, and started on the host for a run that asks for the editor, So that a dev session can run the project's tests, verify it and take a frame from the engine without a human, and nothing more.

**Acceptance criteria (verbatim, authoritative):**
- **AC1**
  - **Given** the three candidates (`beremaran/godot-agent-loop`, `hi-godot/godot-ai`, `gdai-mcp-plugin-godot`)
  - **When** the story's spike compares them on the box against Godot 4.7.2 Mono (install, `run_project_tests`, `verify_project`, `game_screenshot`, Windows status, licence, last release; the installs and the runs are the operator session's step, asked for through the consult log)
  - **Then** `kb/engine-mcp-godot.md` records the table and the pick with evidence, the research ledger gets the seeds, and the `game-godot` profile's recommendation names the pick (through 34.4's proposal) with the `.mcp.json` entry written only by `recommend.py record --mcp` on confirmation, never by detection
- **AC2**
  - **Given** a run whose job sets `editor_in_the_loop: true`
  - **When** the supervisor pins the sandbox
  - **Then** it snapshots the project with `robocopy` to `C:\agent-work\backups\<project>\<run>` (the brief's Phase 1 item 7), starts the engine MCP on the host bound to the tailnet address with a per-run bearer, passes its URL and the bearer to the sandbox by name (`-e`, never a file), and stops it at release; a run without the flag starts nothing; `bun test` covers the start, the stop, the snapshot and the refusals (no `.mcp.json`, no engine)
- **AC3**
  - **Given** the verify-only rule
  - **When** the MCP is wired
  - **Then** its scene-editing tools are not exposed to the dev session in this version (the engine skill says so and the server's allowlist enforces it where the server has one); the runbook names the port and the rule

## Boundaries & Constraints

**Always:**
- The Settled shapes 1-5 of `plans/34-5.md` (mirrored in SPEC.md `## Design notes`, CAP-9 and CAP-10) are the shapes. Each name in them is pinned:
  - `suggests_mcp`, `kind: "mcp"`;
  - `record --mcp`;
  - `TK_ENGINE_MCP_URL`, `TK_ENGINE_MCP_BEARER`, `TK_SUPERVISOR_ENGINE_MCP_PORT` (default 8788);
  - `engine.mcp: {name, start, port}`;
  - the events `engine-mcp-start {name, pid, start, url}` and `engine-mcp-stop {name, pid, why}`;
  - the refusal keys `engine-mcp:no-config|no-mcp-json|no-engine|start-failed`.
- Reuse Story 22.3's submission flag `editor_in_the_loop` and `snapshotOnce` (`src/hygiene.ts`) as they are. Do not rebuild them.
- The bearer is held in memory only and never lands in an event, log, file or argv value. It reaches the sandbox as `-e <NAME>`, with the value in the spawn env.
- The forwarder binds `TK_SUPERVISOR_BIND`. It answers 401 to any request without the exact per-run bearer (sha256 plus `timingSafeEqual`).
- A run without the flag starts nothing and records nothing.
- The plugin side is stdlib-only and its writes are atomic. Each CLI ends in an AD-11 status block. Contract 0.1.29 is extended additively, never bumped.
- Touch only the 24 files in `plans/34-5.md` §Files, plus this spec.

**Block If:**
- The operator's spike answer (the measurements and the pick) is not in this spec's `## Consult Log`. Build the code that does not depend on the pick, the fixture-profile tests and the kb skeleton (every cell `not measured`, the exact measurement commands). Then append the request and HALT `blocked`. This is the expected terminal state of this pass.
- The consult rules that the snapshot folder must move to `C:\agent-work\backups\…`. That would change the recorded operator ruling, operator-decisions §3 of spec-epic-22.
- The pick has no HTTP transport on loopback.
- A file outside `plans/34-5.md` §Files is needed, or the Files list grows.

**Never:**
- Never invent a measurement, a pick, a server port, a seed or a fourth candidate.
- Never add `suggests_mcp` to `game-godot.json` before the ruling exists. Tests use a fixture profile.
- Never let detection or `propose` write `.mcp.json`.
- Never build a JSON-RPC tool filter into the forwarder.
- Never change sbx network policy.
- Never touch TUA.
- Never copy a `repo:` value from `engine-mcps.yaml`. Cite it by path.
- Never kill a process by name pattern. Never git push.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Flagged run, all present | flag (submission OR definition), `engine.mcp` + `.mcp.json` `mcpServers.<name>` at base, `GODOT` file | snapshot (unchanged 22.3 path); child started in the worktree; forwarder on bind:8788; `engine-mcp-start` event (no bearer); `-e TK_ENGINE_MCP_URL -e TK_ENGINE_MCP_BEARER` in the sbx argv, values in the spawn env | none |
| Unflagged run | no flag | nothing started; no engine-mcp event; no `-e TK_ENGINE_MCP_*` | none |
| No config | flag, no or malformed `engine.mcp` | nothing started | refusal `engine-mcp:no-config`; run `blocked` |
| No `.mcp.json` | flag, missing file or entry at base | nothing started | `engine-mcp:no-mcp-json` |
| No engine | flag, `GODOT` unset or not a file | nothing started | `engine-mcp:no-engine` |
| Start fails | child exits, or the port does not answer within the bound | child killed | `engine-mcp:start-failed` |
| Release | terminal run, MCP live, pin kept or released | child stopped, forwarder closed, `engine-mcp-stop {why}` | stop is idempotent |
| Supervisor restart | start event recorded, process lost | recorded pid killed (`killRecordedWorker`), `engine-mcp-stop {why: "supervisor restarted"}`; never re-armed | none |
| Forwarder auth | request with or without the bearer | 200 proxied / 401 | none |
| `record --mcp` | name confirmed and named by a profile `suggests_mcp` | merges `mcpServers.<name> = {"type":"http","url":"${TK_ENGINE_MCP_URL}","headers":{"Authorization":"Bearer ${TK_ENGINE_MCP_BEARER}"}}`; other servers untouched; idempotent; `--dry-run` writes nothing | unknown name or malformed JSON → exit 2, AD-11 block |
| `propose` | confident `game-godot` + profile `suggests_mcp` | `kind: "mcp"` entry, `configured` / `not-configured`; never on an ask outcome; never writes | none |
| Job definition | `editor_in_the_loop` non-boolean | `job.py validate_definition` refuses | as `durable` |

</intent-contract>

## Code Map

The investigation is `plans/34-5.md` §Code Map. The implementer reads it in full and starts from it, with no re-search. Its anchors were checked at `a0c0479`. They were spot-checked again at the baseline `37b0061`: `snapshotOnce` `hygiene.ts:111` (called `cli.ts:1437`), `releasePin` `sandbox.ts:167`, `pinWithRestart` `sandbox.ts:261`, `buildSbxCommand` `server.ts:520`, `propose` `recommend.py:106`, `record` `recommend.py:224`. Where a line has drifted, confirm it with `grep -n`.

Key seams, a summary of the plan:
- **Start:** beside `snapshotOnce` for a drained run (after the claim and `prepareWorktree`), and in `queueRecorder.pin` (`cli.ts` ~1722) after a successful pin. Idempotent per run through its event.
- **Stop:** in `releasePin`, after the `isTerminal` check and before the holders guard.
- **Env:** `-e` names through `buildSbxCommand` and `invokeSkill` (`server.ts` ~1112), merged into the spawn env.
- **Config:** read at base like `verifyCommand` (`hostverify.ts` ~183-221, `git show` plus `loadYaml`, `run.prefix`).
- **Bearer:** `account.ts:117` mints it. `api.ts` ~331/410 shows the check.
- **Recovery:** `respawnHolds`/`killRecordedWorker`.
- **Plugin:**
  - `recommend.py`: the 34.4 skill loop is the pattern; `record` and `main` gain `--mcp`; the atomic JSON writer follows `job.py` `_atomic_write_json`.
  - `detect.py`: `suggests_mcp` passthrough, like `suggests_skills`.
  - `job.py`: copies the `durable` check.
- **Contract:** `driver-contract.md` 0.1.29 extension points (line 5, the stories row, the 34.4 note, the closing "unchanged" sentence). The test template is `test_0_1_29_story_34_4_engine_skill`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/enginemcp.ts` -- new: config and `.mcp.json` read at base, refusals, bearer mint, child start and stop, forwarder, module map keyed by run, recovery -- Settled shape 4
- `apps/supervisor/src/sandbox.ts` -- `releasePin` stops this run's MCP, also on a kept pin -- AC2 stop
- `apps/supervisor/src/cli.ts` -- start on both pin paths; the enqueue ORs the definition's flag; refusal keys through `recordedRefusal` -- AC2
- `apps/supervisor/src/server.ts` -- `-e` names and spawn-env values for a run with a live MCP -- by name, never a file
- `apps/supervisor/src/env.ts` -- `TK_SUPERVISOR_ENGINE_MCP_PORT`, default 8788 -- the port
- `apps/supervisor/test/enginemcp.test.ts` (new), `test/sandbox.test.ts`, `test/tier.test.ts` -- fakes only: start, stop (including a kept pin), no flag, every refusal, restart recovery, the snapshot still taken for a flagged Godot run, forwarder 200/401, nothing left in `/tmp` -- AC2's `bun test` clause
- `apps/supervisor/README.md` -- the editor-in-the-loop section
- `plugins/tk-studio/contracts/job.schema.json`, `lib/job.py`, `lib/tests/test_job.py` -- the `editor_in_the_loop` boolean definition field -- Settled shape 3
- `plugins/tk-studio/lib/recommend.py`, `lib/tests/test_recommend.py` -- the `kind: "mcp"` proposal and `record --mcp`, tested on a fixture profile -- AC1 and Settled shapes 1-2
- `plugins/tk-studio/lib/detect.py`, `lib/tests/test_detect.py` -- `suggests_mcp` passthrough (default `[]`), with shipped-profile validity -- Settled shape 1
- `plugins/tk-studio/skills/tk-studio-detect/profiles/game-godot.json` -- **untouched in this pass** (the ruling is absent)
- `plugins/tk-studio/skills/gds-engine-godot-4/SKILL.md` -- the verify-only rule; rewrite :78 (scenes through the editor, never the MCP); keep the strings `test_engine_pin.py` asserts -- AC3
- `plugins/tk-studio/skills/tk-studio-onboard/SKILL.md` -- the `--mcp` sub-bullet in step 3
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- the 0.1.29 extension for 34.5, `test_0_1_29_story_34_5_engine_mcp`, and the 34.3 and 34.4 stories-line assertions re-pinned (DRIFT, score 1)
- `kb/engine-mcp-godot.md` (new, rank 64, `scope: project`), `kb/index.md` (regenerated, header line restored) -- the Settled shape 5 skeleton: `beremaran/godot-agent-loop` row `not available (repo removed; handoff-phase1-loop-2026-10-09.md:18)`, other cells `not measured`, measurement commands, a pending ruling, seeds pending -- AC1
- `kb/agent-pc-setup-runbook.md` -- the §4.2 `TK_SUPERVISOR_ENGINE_MCP_PORT` row and `### 4.8 The engine MCP` (port 8788, tailnet bind, per-run bearer, the verify-only rule) -- AC3

**Acceptance Criteria (proof):**
- Given the supervisor fakes, when `bun test test/enginemcp.test.ts test/sandbox.test.ts test/tier.test.ts test/hygiene.test.ts test/guards.test.ts` runs, then it covers the start, the stop, the snapshot and the refusals (no `.mcp.json`, no engine), and the full `bun test` plus `bunx tsc --noEmit` are green.
- Given a fixture profile with `suggests_mcp`, when the `test_recommend` tests run, then `propose` names the MCP and never writes, and `record --mcp` alone writes `.mcp.json`.
- Given AC1's on-box spike, then the table, the pick, the seeds and the profile line are `unverifiable-here` until the operator answers in the consult log.

## Spec Change Log

- 2026-10-27, re-drive (pass 3): the operator session's spike answer is in `## Consult Log` (restored verbatim from commit `ee89a42`, where it sat below the pass-2 `## Auto Run Result` that the loop's amend `c5a212e` removed). The first Block If is therefore met. Per plan §Files 17 and Settled shape 5, this pass lands what waited on the ruling (the `game-godot.json` profile line, the kb record and seeds per the answer's items 1 and 4) and fits the pin to the answer's measured launch shape (item 2) and allowlist (item 3). Pass 1 and 2 work stays as committed in `60cbc36`.

## Review Triage Log

### 2026-10-27 — Review pass
Both layers ran (band L): blind-hunter (10 findings) and edge-case-hunter (5). After dedup there were 12.
- intent_gap: 0
- bad_spec: 0
- patch: 12 (high 1, medium 7, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` The forwarder and bearer lived in the one-shot drain process's module map, so a drain-launched run lost the forwarder and the next tick's recovery killed the server (both layers; `start.ps1:31`). The consult ruled Option A (score 2). The forwarder is now a detached child, the bearer is only in its spawn env, both `{pid, start}` are on `engine-mcp-start`, and stop and recovery work across processes, with fakes for each.
  - `[medium]` `[patch]` A release in a later tick process stopped nothing (edge). It now stops the recorded pids from any process. This is folded into the above.
  - `[medium]` `[patch]` The forwarder bind was never checked as a tailnet address (both). `checkBind` now runs before any spawn and refuses with `engine-mcp:start-failed`.
  - `[medium]` `[patch]` `awaitPort` accepted a stale listener (both). The port must be free before the spawn, and the start confirms the child is alive after the port answers.
  - `[medium]` `[patch]` A definition-flagged run skipped Story 22.3's `WorkDirMissing` refusal. The refusal now applies, with an end-to-end `submitJob` test.
  - `[medium]` `[patch]` Nothing tested AC2's definition-flag path. It is now covered by the `submitJob` test above.
  - `[medium]` `[patch]` Nothing tested the drained-run start or refusal in `runJob`. Two end-to-end tests now cover them.
  - `[medium]` `[patch]` An unset `${VAR}` in `.mcp.json` breaks the parse on unflagged sessions. The entry now uses the plan's pre-authorised `${VAR:-}` form (DRIFT).
  - `[low]` `[patch]` A child that exited mid-run stayed live with no event. It now records `engine-mcp-stop {why: "exited"}` and is dropped.
  - `[low]` `[patch]` Recovery recorded a stop even when the kill failed. It now records only once both processes are gone.
  - `[low]` `[patch]` `record --role … --mcp` could half-write. The MCP is now validated before either write.
  - `[low]` `[patch]` The contract sentence lacked `path` (consult ruling 1). Now added to the contract and runbook §4.8, and pinned in the test.
- Verification after the patches: the lib suite is 2227 OK (skipped 2) and conformance is `ok: true`. `bun test` in a clean env gives 1585 pass, 6 skip, 0 fail, and `tsc` exits 0. No orphan forwarder or server remains, and the one known `tk-sup-store-*` fixture leftover was removed.

### 2026-10-27 — Review pass (pass 3 re-drive)
Both layers ran (band L): blind-hunter (7 findings) and edge-case-hunter (1). After dedup there were 7.
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 2, low 4)
- defer: 0
- reject: 1 (low 1)
- addressed_findings:
  - `[medium]` `[patch]` An editor that spawned with a pid but exited before the forwarder was ready still returned `started: true`, so the flagged run went on with no MCP and was never blocked (both layers). The start now stops all three children in order and refuses `engine-mcp:start-failed` ("the editor exited before the MCP was ready"), with a test.
  - `[medium]` `[patch]` The start returns before the editor's add-on adopts the server (about 25 s, `EDITOR_NOT_READY`). The engine skill's verify-only section and runbook §4.8 now name the window and the retry through `editor_state`. There is no readiness poll.
  - `[low]` `[patch]` The server's `--ws-port` is not pre-checked, and an operator-opened editor with the godot-ai add-on holds 8000/9500. Runbook §4.8 now says so: close that editor first.
  - `[low]` `[patch]` The in-process stop order (editor before server, per the contract sentence) was not asserted. A new test logs the kills.
  - `[low]` `[patch]` Stale "both pids" wording, at runbook §4.8 `recover` and the `enginemcp.ts` recovery comment, now reads all three.
  - `[low]` `[patch]` The drain-launched test's argv-secret check left out the editor pid and the capability and WebSocket token. It now covers all three pids and all three secrets.
- rejected: the editor writes Godot's cache and sidecars into the run's worktree. The 34.1 engine gate already runs Godot on the worktree, the project's `.gitignore` governs the cache, and no criterion names it.
- Verification after the patches: lib 2227 OK (skipped 2); conformance `ok: true`; `bun test` 1591 pass, 6 skip, 0 fail; `tsc --noEmit` exit 0. One orphan fake `mcp-server.js` (pid 310602, started 13:44:55 during the patch implementer's own runs) was stopped by pid. The orchestrator's full run left no process and only the known `tk-sup-store-*` fixture, which was removed.

## Design Notes

- **Snapshot path (planned DRIFT, consult).** The AC names `C:\agent-work\backups\<project>\<run>`. The recorded operator ruling, operator-decisions §3 of spec-epic-22, is `<TK_SUPERVISOR_WORK>\snapshots\<project id>\<run id>`, and Story 22.3 shipped it (`TK_SUPERVISOR_WORK` = `C:\agent-work`). Reuse `snapshotOnce` unchanged. Record `DRIFT: snapshot stays <work>\snapshots\… per operator-decisions §3 — affects: none` and consult on it under `deviation-gt-0`.
- **`.mcp.json` variables.** Claude Code expands `${VAR}` in `url` and `headers`. If an unset variable breaks a run without the flag, the `${VAR:-}` form is a DRIFT.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && PATH=$HOME/.bun/bin:$PATH bun test && bunx tsc --noEmit` -- expected: 0 fail, exit 0
- `find /tmp -maxdepth 1 -name 'tk-sup-*' | wc -l` -- expected: 0
- `uv run plugins/tk-studio/lib/kb.py index --directory .` -- expected: no diff apart from the known header line

## Deviation Summary

- PLANNED DRIFT: test_driver_contract 34.3 and 34.4 stories-line assertions re-pinned to include Story 34.5 (score 1, the invocation's gate note).
- PLANNED DRIFT: the snapshot folder stays `<TK_SUPERVISOR_WORK>\snapshots\…` (operator-decisions §3). It goes to consult.

### pass 1 (2026-10-27, implementer)

DEVIATIONS (as reported):
- planned: `engine.mcp: {name, start, port}` / actual: an extra optional `path` (default `/mcp`) builds `TK_ENGINE_MCP_URL` / why: the URL needs the server's endpoint path, and nothing else supplies it / may affect: 34-5 follow-up (TUA's `engine.mcp` line)
- planned: `engine-mcp-start {name, pid, start, url}` / actual: `start` is the child's process start time (the `hold` precedent), not the command line / why: recovery kills by pid plus start / may affect: none
- planned: a drained run's refusal goes through `recordedRefusal` with the key / actual: the run ends `blocked` with the key and its resolves text in the reason; there is no `claim-refused` event / why: `queue.refuseClaim` records only on queued runs, and the MCP starts after the claim / may affect: none
- planned: the removed-repo row cites `handoff-phase1-loop-2026-10-09.md:18` / actual: it cites `:25` / why: the file has changed since the plan / may affect: none
- planned: `buildWorkerEnv` unchanged / actual: it strips any inherited `TK_ENGINE_MCP_*` / why: an unflagged run never carries a stray URL or bearer / may affect: none
- planned: interfaces unchanged / actual: `buildSbxCommand` `opts.extraEnv`; `InvokeOptions` and `RunRecorder` `engineMcpEnv`; a fifth `queueRecorder` deps parameter `mcp`; `record` needs `--role`/`--resources` unless `--mcp` is given alone (`mcp_record` nested when both) / why: the named seams needed carriers / may affect: none
- planned: idempotent per run through its event / actual: a run whose start is recorded but not live in this process starts nothing, even on a later resume / why: the never-re-armed rule / may affect: none
- planned: the `job.schema.json` field shape / actual: it also carries `"default": false` / why: to state the default / may affect: none
- planned: AC2's snapshot to `C:\agent-work\backups\<project>\<run>` / actual: `<TK_SUPERVISOR_WORK>\snapshots\…` through the unchanged `snapshotOnce` / why: operator-decisions §3 / may affect: none
- planned: the 34.3 and 34.4 stories-line assertions / actual: re-pinned to include Story 34.5 / why: the stories row gains 34.5 / may affect: none
- planned: a clean `bun test` and `find /tmp` / actual: 25 failures and 104 `tk-sup-*` leftovers under this console's env / why: both pre-date the change / may affect: none

DEVIATION SCORE: 2

Orchestrator verification of the last item: the baseline `37b0061` run under the same env fails 26 tests, a superset of these 25. With `TK_ATLASSIAN_*` unset and `TK_STUDIO_ROOT` set, the full `bun test` gives 1573 pass, 0 fail. So the failures belong to the box's env, not this change. The pre-existing `/tmp` leftovers are not this story's; the clean run added one `tk-sup-store-*` (a measurement-store fixture, not `enginemcp`), which was removed.

DRIFT: `engine.mcp` gains an optional `path` (default `/mcp`) — `TK_ENGINE_MCP_URL` needs the server's endpoint path — affects: 34-5 (the operator's TUA `engine.mcp` line)
DRIFT: `engine-mcp-start.start` is the process start time, not the command line — pid-plus-start recovery as `hold` — affects: none
DRIFT: a drained run's engine-mcp refusal ends the run `blocked` with the key in the reason, with no `claim-refused` event — the MCP starts after the claim — affects: none
DRIFT: `buildWorkerEnv` strips inherited `TK_ENGINE_MCP_*` — no stray bearer on an unflagged run — affects: none
DRIFT: the snapshot stays `<TK_SUPERVISOR_WORK>\snapshots\…` per operator-decisions §3, not `C:\agent-work\backups\…` — the recorded operator ruling, shipped by 22.3 — affects: none
DRIFT: test_driver_contract 34.3 and 34.4 stories-line assertions re-pinned to include Story 34.5 — the stories row gains 34.5 — affects: none

### pass 2 (2026-10-27, implementer, review patches)

DEVIATIONS (as reported):
- planned: the forwarder is a Bun server inside the supervisor process, with the bearer in memory only (Settled shape 4) / actual: a detached child (`bun src/enginemcp.ts forward`), with the bearer in its spawn env (`TK_ENGINE_MCP_FORWARD_BEARER`) and in the starting process's memory / why: consult ruling 2 / may affect: none
- planned: `engine-mcp-start {name, pid, start, url}` and `engine-mcp-stop {name, pid, why}` / actual: additive `forwarder_pid` and `forwarder_start` on the start, `forwarder_pid` on the stop, and `exited` on a `why: "exited"` stop / why: ruling 2 and patch 4 / may affect: none
- planned: the server is detached off win32 only / actual: detached on every platform / why: a non-detached win32 child dies with its parent's job (unproven on the box) / may affect: none
- planned: `${TK_ENGINE_MCP_URL}` and `${TK_ENGINE_MCP_BEARER}` / actual: `${TK_ENGINE_MCP_URL:-}` and `Bearer ${TK_ENGINE_MCP_BEARER:-}`, with an old-form entry rewritten / why: an unset variable with no default fails Claude Code's `.mcp.json` parse (plan Settled shape 2's fallback) / may affect: none
- planned: no new seams / actual: `EngineMcpDeps.checkBind`, `recordedAlive`, `killRecorded`; `RunOptions.engineMcp`; the test helper `letGoEngineMcp` / why: test seams / may affect: none
- planned: recovery records `engine-mcp-stop` after a kill / actual: only once both processes are gone / why: patch 5 / may affect: none

DEVIATION SCORE: 2 (the consult-ruled forwarder shape; the rest are local)

DRIFT: the engine MCP forwarder is a detached child process (`bun src/enginemcp.ts forward`), with the bearer only in its spawn env, and `engine-mcp-start` carries `forwarder_pid` and `forwarder_start` — tick and drain are separate one-shot processes (consult ruling 2) — affects: none
DRIFT: the `.mcp.json` entry uses `${TK_ENGINE_MCP_URL:-}` and `Bearer ${TK_ENGINE_MCP_BEARER:-}` — an unset variable with no default fails the parse on unflagged sessions (plan Settled shape 2's fallback) — affects: none
DRIFT: the engine MCP server is spawned detached on every platform, win32 included — it must outlive the drain process (unproven on the box) — affects: none

### pass 3 (2026-10-27, implementer, re-drive on the operator's answer)

DEVIATIONS (as reported):
- planned: `engine-mcp-start {name, pid, start, url}` / `engine-mcp-stop {name, pid, why}` (and pass 2's forwarder fields) / actual: added `editor_pid` and `editor_start` on start and `editor_pid` on stop; recovery's "still running" check includes the editor / why: the operator's measured launch shape (consult item 2) needs the editor as a third host process / may affect: none
- planned: Settled shape 4: the forwarder proxies requests and drops the bearer upstream; the server's env is the worker env plus `GODOT` / actual: the server and editor env also get per-run `GODOT_AI_HTTP_CAPABILITY`, `GODOT_AI_WS_TOKEN` and `GODOT_AI_DISABLE_TELEMETRY=1`; the forwarder replaces the bearer with `Bearer <capability>` (new env `TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER`); the godot-ai env names are fixed in the supervisor / why: godot-ai answers 401 `TRANSPORT_AUTH_REQUIRED` without its capability (consult item 2) / may affect: none
- planned: `engine-mcp:start-failed` covers the bind, the port, a child exit, a timeout and the forwarder bind / actual: it also covers no `project.godot` in the worktree (checked before any spawn) and the editor failing to spawn; new test hook `EngineMcpDeps.spawnEditor` / why: the editor needs the project folder for `--path` / may affect: none
- planned: the stop kills the forwarder and server in parallel; a recorded stop kills the server, then the forwarder / actual: in-process the forwarder, editor, then server, one after another; recorded stops kill the editor, server, then forwarder / why: the measured stop is editor before server / may affect: none
- planned: the end-to-end drain test checks `snapshot-skipped` / actual: the project now has `game/project.godot`, a fake `robocopy` is put on PATH, and the test checks `snapshot` / why: the editor needs a Godot project, which makes Story 22.3's snapshot run / may affect: none
- planned: `test_shipped_profiles_propose_no_mcp` / actual: replaced by `test_shipped_profiles_propose_the_ruled_pick` / why: the ruling now exists and the profile names `godot-ai` / may affect: none
- planned: AC1: the research ledger gets the seeds / actual: no seeds written; the kb Seeds section stays the operator's to file with `research.py seed` / why: operator ruling 3b in the consult log / may affect: none

DEVIATION SCORE: 2

DRIFT: the engine MCP start launches the Godot editor as a third detached host process (`$GODOT --editor --path <project.godot folder>`), with `editor_pid`/`editor_start` on `engine-mcp-start` and `editor_pid` on `engine-mcp-stop`, stopped editor before server — the operator's measured launch shape (answer item 2) — affects: none
DRIFT: the supervisor mints per-run `GODOT_AI_HTTP_CAPABILITY` and `GODOT_AI_WS_TOKEN` into the server and editor env (with `GODOT_AI_DISABLE_TELEMETRY=1`), and the forwarder swaps the sandbox bearer for `Bearer <capability>` upstream (spawn env `TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER`); the names are godot-ai's, fixed in the supervisor — godot-ai answers 401 without its capability (answer item 2) — affects: none
DRIFT: `engine-mcp:start-failed` also covers a worktree with no `project.godot` and an editor that fails to spawn — the editor needs `--path` — affects: none
DRIFT: AC1's seeds are not filed; `## Seeds` stays the operator's to write with `research.py seed` — operator ruling 3b — affects: none

### pass 4 (2026-10-27, implementer, review patches)

DEVIATIONS (as reported):
- planned: the new tests for the early-exiting editor and the in-process stop order use the existing `fakeBin` children started by the module's default spawn / actual: they use a test helper (`loggedChild`) that starts the children itself and logs each kill, plus a pure fake for the early-exiting editor / why: the default spawn functions are not exported and the forwarder cannot be swapped out, so this is the only way to observe kill order; a pure fake makes the early exit deterministic / may affect: none (these test children are not detached, unlike production)

DEVIATION SCORE: 1 (story score stays 2)

DRIFT: the early-exit and stop-order tests use a test-owned `loggedChild` helper and a pure editor fake instead of the module's default spawn — the default spawns are not exported and kill order is otherwise unobservable — affects: none

## Consult Log

- **2026-10-27, dev pass 1: request to the operator session (Block If: the spike answer is absent).** The pick-agnostic code, the fixture-profile tests and the kb skeleton are built; `game-godot.json` carries no `suggests_mcp`. Asked of the operator session on TIM-PC-2, against Godot 4.7.2 Mono in a scratch clone of TUA, by the steps in `kb/engine-mcp-godot.md` `## Measurement commands`:
  1. For `hi-godot/godot-ai` and `gdai-mcp-plugin-godot` (`beremaran/godot-agent-loop` is recorded `not available`: the repo is gone): install, `run_project_tests`, `verify_project`, `game_screenshot`, Windows status, licence, last release, and the scene-edit tools with whether the server has a tool allowlist.
  2. The pick, and its `engine.mcp: {name, start, port}` line for TUA's `.tk-studio/config.yaml`, with the server's endpoint path (the supervisor reads an optional `engine.mcp.path`, default `/mcp`) and whether it speaks HTTP on loopback (Block If: stdio only).
  3. The seeds' run id for `research.py seed`, or a ruling that the kb record's `## Seeds` stays the operator's to write.
  4. Whether a fourth candidate (`tugcantopaloglu/godot-mcp`, the session's read-only shortlist) joins the table.
- **2026-10-27, dev pass 1: the snapshot folder (planned DRIFT, `deviation-gt-0`).** DRIFT: snapshot stays `<TK_SUPERVISOR_WORK>\snapshots\<project id>\<run id>` per operator-decisions §3 (spec-epic-22), reused unchanged through `snapshotOnce`, not the AC's `C:\agent-work\backups\<project>\<run>` — affects: none. Asked: confirm the recorded ruling stands (Block If it must move).

- 2026-10-27T12:49Z — trigger: deviation-gt-0 — question: accept the pass-1 deviations (score 2), chiefly the optional `engine.mcp.path` (default `/mcp`) and the snapshot staying `<TK_SUPERVISOR_WORK>/snapshots/…` per operator-decisions §3? — ruling: accept-deviation score 2 — do: keep the optional `engine.mcp.path` (default `/mcp`, must start with `/`) and the snapshot at `<TK_SUPERVISOR_WORK>/snapshots/<project id>/<run id>` through the unchanged `snapshotOnce`, and record both DRIFTs as written; add "(optional `path`, default `/mcp`)" to this story's contract sentence at `driver-contract.md:522-523` to match `apps/supervisor/README.md:298`, and keep the endpoint-path question in `kb/engine-mcp-godot.md:76`; accept the other nine at score 1 and do not change the snapshot folder — rule candidate: When a story AC conflicts with a recorded operator ruling (briefs/ or **/operator-decisions.md), the ruling wins: record a DRIFT affects: none without a consult; escalate only if the story text says it overrides that ruling
- 2026-10-27T12:54Z — trigger: high-severity-finding — question: the forwarder and bearer live in the one-shot drain process's module map, so a drain-launched run-epic run loses the forwarder at drain exit, and the next tick's `recoverEngineMcps` kills the server while the engine runs: A) a detached forwarder child, B) limit to in-process sessions, or C) escalate? — ruling: accept-deviation score 2 — do: take Option A, a detached forwarder child of `enginemcp.ts` (`bun src/enginemcp.ts forward`), with the bearer only in its spawn env (never argv, file, event or log), `{pid, start}` for both the server and the forwarder on `engine-mcp-start`, and a DRIFT against Settled shape 4; in `releasePin`/sweep and `recoverEngineMcps`, stop both recorded pids from any process without a `live` entry, where recovery skips a non-terminal run with `engine_run_id` set only while both pids are alive, and otherwise stops both and never re-arms; add `bun test` fakes (a drain-launched run survives drain exit, the next tick's recovery leaves it alone, a later tick's release stops both, no bearer in argv or events) and name the change in the contract sentence and runbook §4.8 — rule candidate: Plans never keep a resource that must outlive a drain-launched run (a listener, a child, a secret) in supervisor process memory or a module map; record it by {pid, start} on an event so any later tick process can stop it (tick and drain are separate one-shot processes, apps/supervisor/start.ps1:31)
- 2026-10-27T13:19Z — trigger: halt (with the pass-2 deviation-gt-0 locals folded in) — question: HALT blocked for the operator's spike answer, or finish done with AC1 unverifiable-here; commit locally first; accept the pass-2 locals? — ruling: apply — do: HALT `blocked` awaiting the operator's spike answer (measurements, pick, seeds) in the Consult Log, leaving `game-godot.json` without `suggests_mcp` and every kb cell `not measured`; first make one local commit of the reviewed, green work (never push, tag or open a PR); accept the pass-2 deviations at story score 2, keeping the three DRIFT lines (the forwarder shape is the already-ruled score-2 seam; the rest are local, score 1) — rule candidate: When a story Block If names HALT blocked as its expected terminal state, it overrides the customization rule operator action -> unverifiable-here, do not HALT; commit the reviewed green work locally before that HALT

- **2026-10-27T13:2xZ, the operator session's answer (TIM-PC-2, the RDP session, Godot 4.7.2 Mono, the TUA scratch clone; raw notes `C:\agent-work\scratch\mcp-trial\godot-ai-measurements.md`).**
  1. **The table is filled in `kb/engine-mcp-godot.md`** (this commit). `hi-godot/godot-ai` v4.3.1 installed and ran: the release zip extracted to `game/addons/godot_ai/` and enabled in `project.godot`; the add-on starts the PyPI server `godot-ai==4.3.1` through `uvx` and connects over WebSocket in about 25 s; 47 tools; `test_run` covers GDScript suites under `res://tests/` only (on TUA: `No test suites found`, 155 ms — the engine gate stays the test runner); no `verify_project`, but `project_run` had the game live in 4.8 s, `editor_state` 46 to 155 ms, `logs_read source=game` returns the game's lines; `editor_screenshot source=game` returned a 640×360 PNG of the running game in 250 ms; Windows 11 without WSL; MIT; v4.3.1 of 2026-10-24. `gdai-mcp-plugin-godot` is a closed product distributed from gdaimcp.com (the GitHub repository holds a demo and a version file, 0.3.3; no licence file, no releases): not installed. `tugcantopaloglu/godot-mcp` (MIT, v3.1.0, "tested with Godot 4.7", C#-aware) joins the table as an operator-added, read-only row: the live open alternative, not installed.
  2. **The pick: `hi-godot/godot-ai`.** It speaks streamable-HTTP on loopback: endpoint `/mcp` (so `engine.mcp.path` keeps its default), but every request needs `Authorization: Bearer <capability>`: without one the server answers `401 {"error":{"code":"TRANSPORT_AUTH_REQUIRED"}}`. The capability is the `http` token of the record the server publishes at `%LOCALAPPDATA%\godot-ai\capabilities\http-<port>.json` (`{version, http, websocket, instance_nonce}`), and the supervisor can **supply** it at launch: `GODOT_AI_HTTP_CAPABILITY=<urlsafe token, 32 to 128 chars>` and `GODOT_AI_WS_TOKEN=<64 hex>` (both or neither) in the server's environment; proven with `initialize` → `200` and `tools/list` over plain HTTP with that bearer. The measured shape for the pin, in this order:
     - start the server: `uvx --from godot-ai==4.3.1 godot-ai --transport streamable-http --port <port> --ws-port <port+1500> --exclude-domains <csv>` with `GODOT_AI_HTTP_CAPABILITY`, `GODOT_AI_WS_TOKEN` and `GODOT_AI_DISABLE_TELEMETRY=1` in its environment (telemetry is on by default), cwd the project;
     - start the editor on the project (`$GODOT --editor --path <godot dir>`): its add-on (enabled in `project.godot`) adopts the running server (`MCP | adopted external server … authenticated with server`) and the tools go live; without the editor the server answers but every editor tool reports `EDITOR_NOT_READY`;
     - the forwarder adds the bearer to each request; stop = end the editor, then the server (`--owner-pid` is for the add-on-launched case; a supervisor-managed server is simply killed; nothing listens afterwards).
     TUA's line: `engine: {mcp: {name: "godot-ai", start: "uvx --from godot-ai==4.3.1 godot-ai --transport streamable-http --port 8000 --ws-port 9500 --exclude-domains scene,node,script,filesystem,resource,animation,material,particle,camera,audio,tilemap,tileset,gridmap,navigation,csg,ui,theme,signal,autoload,input_map,api,client,custom,batch", port: 8000}}` (the default port 8000 is free on the box; `path` default `/mcp`). The add-on under `game/addons/godot_ai/` and the `[editor_plugins]` line are a TUA PR of the operator's once the story lands (they are untracked in the scratch clone today).
  3. **The allowlist for the verify-only rule:** `--exclude-domains` is the server's own allowlist (also accepted by the attach bridge). With the 22 editing domains and `batch` excluded, the server lists the read-and-run set: `editor_state`, `scene_get_hierarchy`, `node_get_properties`, `project_run`, `project_manage` (stop), `game_manage` (runtime inspection and input), `test_run`, `test_manage`, `logs_read`, `editor_screenshot`, `editor_reload_plugin`, `editor_manage`, `session_activate`, `session_manage` (14 tools; measured 10 when `editor` is excluded as well, which also removes `logs_read` and `editor_screenshot`, so `editor` stays in). No scene, node, script, resource or filesystem tool reaches the dev session.
  4. **Seeds:** the ruling is 3b — `## Seeds` stays the operator's to write; the operator files them with `research.py seed` against the next ecosystem-watch run (none ran today), one anchor per claim as the record says.
  5. **The snapshot folder:** the recorded ruling stands (operator-decisions §3 of spec-epic-22: `<TK_SUPERVISOR_WORK>\snapshots\<project id>\<run id>`); the AC's `C:\agent-work\backups\…` wording yields to it.
  6. **The forwarder's home (your 12:54Z ruling):** accepted as ruled; the in-process-session limit is fine for this version and the runbook names it.
- 2026-10-27T13:41Z — trigger: deviation-gt-0 (pass 3) — question: accept the seven pass-3 deviations (editor as a third detached process with editor_pid/editor_start; per-run godot-ai capability and WS token in server/editor env, forwarder swapping the bearer upstream, names hard-coded; start-failed for no project.godot or editor spawn failure; serialized stop order; drain e2e asserting snapshot; the shipped-pick profile test; seeds left to the operator per 3b) at score 2? — ruling: accept-deviation score 2 — do: accept all seven as reported and keep the four pass-3 DRIFT lines as written; keep the godot-ai env names as named constants in enginemcp.ts, add no keys to engine.mcp, keep the capability and WS token out of argv, events, logs and files; record AC1's seeds as met by operator ruling 3b, not unverifiable-here, and file no seeds — rule candidate: When an operator answer in the Consult Log gives a measured launch or stop shape, the implementer follows it without a consult: record DRIFT lines scored 2 if they change an event or contract field this same story introduced, else 1, and consult only if it touches a surface from an earlier story
- 2026-10-27T13:54Z — trigger: deviation-gt-0 (pass 4) — question: accept the review-patch tests (early-exiting editor refusal; in-process stop order) built on a test-owned `loggedChild` helper and a pure editor fake through `EngineMcpDeps.spawn`/`spawnEditor`, instead of the module's default spawn, at score 1? — ruling: accept-deviation score 1 — do: keep the two loggedChild / pure-editor-fake tests as they are and make no test-driven change to enginemcp.ts; keep the pass-4 DRIFT line as written and leave the story score at 2 — rule candidate: A test that swaps in its own child through an existing deps injection point (spawn/spawnEditor/killRecorded) instead of the module default is not a deviation when no production surface changes: record it as a test note, not a DRIFT, and never export a default implementation only so tests can reach it

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This is a re-drive on the operator's spike answer. It is restored verbatim into `## Consult Log` from `ee89a42`, after the loop's amend `c5a212e` dropped it with the old result. Passes 1 and 2 (commit `60cbc36`) built the pick-agnostic code. Pass 3 lands the pick, `hi-godot/godot-ai`, and its measured launch shape:
- **Launch secrets:** for a run flagged `editor_in_the_loop`, the supervisor mints per-run `GODOT_AI_HTTP_CAPABILITY` and `GODOT_AI_WS_TOKEN`, with telemetry off, into the env of the server and the editor.
- **Start order:** it starts the server from `engine.mcp.start`, waits for the port, then starts the Godot editor (`$GODOT --editor --path <the project.godot folder>`) as a third detached process.
- **Forwarder:** the forwarder swaps the sandbox's per-run bearer for `Bearer <capability>` upstream.
- **Stop order:** at release, and in recovery from any process, the editor stops before the server.
- **Refusals:** `engine-mcp:start-failed` also covers a worktree with no `project.godot`, an editor that fails to spawn, and an editor that exits before the MCP is ready.
- **Pick recorded:** `game-godot.json` now carries `suggests_mcp: ["godot-ai"]`. `kb/engine-mcp-godot.md` holds the ruling, TUA's `engine.mcp` line, and the 14-tool `--exclude-domains` allowlist that enforces verify-only (AC3).
- **Docs:** the contract's 34.5 sentence is extended additively (still 0.1.29). The README, runbook §4.8 (port 8788, the server's own ports, the editor-readiness window) and the engine skill all follow.
- **AC1 seeds:** met by operator ruling 3b. The operator files them with `research.py seed`, by consult ruling.

**Files changed (this pass).**
- `apps/supervisor/src/enginemcp.ts`: capability and WS-token minting; the editor spawn, early-exit refusal and stop order; the forwarder's upstream bearer; three-pid recovery.
- `apps/supervisor/test/enginemcp.test.ts`: tests for the editor's argv and env, the capability arriving upstream, no secret in argv or events (the drain path included), the editor exiting early or late, no `project.godot`, the editor failing to spawn, and the in-process and recorded stop order.
- `apps/supervisor/README.md`: the launch shape.
- `plugins/tk-studio/skills/tk-studio-detect/profiles/game-godot.json`: `suggests_mcp: ["godot-ai"]`.
- `plugins/tk-studio/lib/tests/test_recommend.py`, `test_detect.py`: the shipped pick.
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py`: the editor fields and the stop order in the 34.5 sentence, re-pinned.
- `plugins/tk-studio/skills/gds-engine-godot-4/SKILL.md`: the verify-only allowlist and the `EDITOR_NOT_READY` retry.
- `kb/engine-mcp-godot.md`, `kb/index.md`: the ruling (index regenerated, header line restored).
- `kb/agent-pc-setup-runbook.md`: §4.8 with the launch shape, ports, readiness and three-pid recovery.

**Review.** Both layers ran (band L).
- Patches: 6 (high 0, medium 2, low 4).
- Deferred: 0.
- Rejected: 1.
- Consults this pass: 2, both `deviation-gt-0`: accept at score 2, then accept at score 1.
- Follow-up review recommended: true. The score is 3×2 + 1×4 = 10.

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: `Ran 2227 tests`, OK (skipped=2).
- From `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- From `apps/supervisor`, with `TK_ATLASSIAN_*` unset and `TK_STUDIO_ROOT` set:
  - `bun test`: 1591 pass, 6 skip, 0 fail.
  - `bun node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `kb.py index`: no diff apart from the known header line.
- `/tmp`: the run added only the known `tk-sup-store-*` fixture, which was removed. One orphan fake server from the patch implementer's runs was stopped by pid.
- I/O matrix audit: every row is covered by a test that ran, now including the editor refusals.

**unverifiable-here (operator, agent PC).**
1. TUA's PR: the `engine.mcp` line from `kb/engine-mcp-godot.md`, the `game/addons/godot_ai/` add-on and its `[editor_plugins]` line.
2. File the seeds: `uv run plugins/tk-studio/lib/research.py seed --run-id <id> --file <seeds>`.
3. A flagged TUA run where all of these hold:
   - the editor adopts the supervisor-started server;
   - the dev session lists the 14 tools through the forwarder, with no scene-edit tool;
   - `test_run` and `editor_screenshot` answer;
   - all three processes stop at release.
4. The sandbox reaches `TK_SUPERVISOR_BIND:8788` (sbx network policy).
5. The detached server, editor and forwarder outlive `drain` on win32. Note the console and editor windows a detached Godot opens.

**Residual risks.**
- **Hard-coded names:** the godot-ai env names are fixed in the supervisor, by consult ruling, so another pick needs code.
- **Startup window:** editor tools answer `EDITOR_NOT_READY` for about 25 s after the start. This is documented, with no readiness poll.
- **Ports:** `--ws-port` is not pre-checked, and an operator-opened editor holds 8000/9500. One flagged run at a time can hold 8788.
- **Unreadable start time:** a recorded start time that cannot be read (`start: null`) blocks a safe cross-process kill.
- **Worktree writes:** the editor writes Godot's import cache into the run's worktree.
- **Host tier:** a host-tier flagged run starts no MCP.

DRIFT: `engine.mcp` gains an optional `path` (default `/mcp`) — `TK_ENGINE_MCP_URL` needs the server's endpoint path — affects: 34-5 (the operator's TUA `engine.mcp` line)
DRIFT: `engine-mcp-start.start` is the process start time, not the command line — pid-plus-start recovery as `hold` — affects: none
DRIFT: a drained run's engine-mcp refusal ends the run `blocked` with the key in the reason, with no `claim-refused` event — the MCP starts after the claim — affects: none
DRIFT: `buildWorkerEnv` strips inherited `TK_ENGINE_MCP_*` — no stray bearer on an unflagged run — affects: none
DRIFT: the snapshot stays `<TK_SUPERVISOR_WORK>\snapshots\…` per operator-decisions §3, not `C:\agent-work\backups\…` — the recorded operator ruling, shipped by 22.3 — affects: none
DRIFT: test_driver_contract 34.3 and 34.4 stories-line assertions re-pinned to include Story 34.5 — the stories row gains 34.5 — affects: none
DRIFT: the engine MCP forwarder is a detached child process (`bun src/enginemcp.ts forward`), with the bearer only in its spawn env, and `engine-mcp-start` carries `forwarder_pid` and `forwarder_start` — tick and drain are separate one-shot processes (consult ruling 2) — affects: none
DRIFT: the `.mcp.json` entry uses `${TK_ENGINE_MCP_URL:-}` and `Bearer ${TK_ENGINE_MCP_BEARER:-}` — an unset variable with no default fails the parse on unflagged sessions (plan Settled shape 2's fallback) — affects: none
DRIFT: the engine MCP server is spawned detached on every platform, win32 included — it must outlive the drain process (unproven on the box) — affects: none
DRIFT: the engine MCP start launches the Godot editor as a third detached host process (`$GODOT --editor --path <project.godot folder>`), with `editor_pid`/`editor_start` on `engine-mcp-start` and `editor_pid` on `engine-mcp-stop`, stopped editor before server — the operator's measured launch shape (answer item 2) — affects: none
DRIFT: the supervisor mints per-run `GODOT_AI_HTTP_CAPABILITY` and `GODOT_AI_WS_TOKEN` into the server and editor env (with `GODOT_AI_DISABLE_TELEMETRY=1`), and the forwarder swaps the sandbox bearer for `Bearer <capability>` upstream (spawn env `TK_ENGINE_MCP_FORWARD_UPSTREAM_BEARER`); the names are godot-ai's, fixed in the supervisor — godot-ai answers 401 without its capability (answer item 2) — affects: none
DRIFT: `engine-mcp:start-failed` also covers a worktree with no `project.godot`, an editor that fails to spawn, and an editor that exits before the MCP is ready — the editor needs `--path`, and a dead editor is no MCP — affects: none
DRIFT: AC1's seeds are not filed; `## Seeds` stays the operator's to write with `research.py seed` — operator ruling 3b — affects: none
DRIFT: the early-exit and stop-order tests use a test-owned `loggedChild` helper and a pure editor fake instead of the module's default spawn — the default spawns are not exported and kill order is otherwise unobservable — affects: none
