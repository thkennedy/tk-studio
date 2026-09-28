---
title: 'The Lift Drives the Studio at the Current Contract'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
baseline_revision: '742706d6a0ba22ad42c2da21a458601521b8e4c1'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-21/plans/21-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-21/salvage-findings.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The ClaudeOS driver that ran studio jobs was retired on 2026-09-26. Nothing in this repo can wake, invoke, and finish a studio job, and the retired code bypasses permissions on the host, treats `ANTHROPIC_API_KEY` or `claude --version` as proof of auth, and reads the registry file directly.

**Approach:** Lift the four ClaudeOS files (byte-verified, staged under `.bmad-loop/cache/claudeos-salvage/`) into `src/` as a Bun/TypeScript library and CLI. Strip the ClaudeOS coupling. Fix the `server.ts` defects this story owns: host bypass, auth proof, raw registry and job reads. Add a `run <job-id> --directory <root>` CLI doing wake → invoke → finish.

**User story (verbatim, epics.md Story 21.1):** As the operator, I want the ClaudeOS driver code lifted into the supervisor repo and brought current, so that one job can be woken, invoked headless, and finished from the command line on the agent PC.

## Boundaries & Constraints

**Always:**
- Drive the studio only through its published invocations (AD-2): `uv run $TK_STUDIO_ROOT/plugins/tk-studio/lib/registry.py show --project-id <key>`, `uv run …/lib/jobrun.py <verb> --directory <root> …`, and `claude -p "/tk-studio:<skill> <payload JSON>"`. Never import, copy or patch plugin internals.
- Resolve the studio root (`TK_STUDIO_ROOT`), plugin root (`$TK_STUDIO_ROOT/plugins/tk-studio`), store (`TK_STUDIO_HOME` passed through to children, never hard-coded) and worker binary (`CLAUDE_BIN`, default `claude`) from the environment only (AD-15). A missing `TK_STUDIO_ROOT` fails with a named error.
- Host default `--permission-mode auto`. Never pass `--dangerously-skip-permissions`, `--settings`, `--permission-prompt-tool` or any flag that overrides `~/.claude/settings.json` `permissions.deny`.
- Always use `--output-format json` for the worker; extract the status block from the result's `result` text; forward `total_cost_usd` to `finish --total-cost-usd` when present.
- `finish` emits the `job-run` ledger event; the supervisor never emits it (AD-12).
- Every headless run ends with a status block. A missing block is a named conformance failure (AD-11): the run is finished `blocked` (or `partial`) with that name in `--reason`.
- `js-yaml` is the only runtime dependency. `conformance.ts` and the tick are lifted as-is apart from the coupling strip and what is needed to compile.

**Block If:**
- `.bmad-loop/cache/claudeos-salvage/PROVENANCE.txt` is absent, or any file's `git hash-object` differs from its recorded blob SHA → HALT `lift source unverified: <file>`. Never reconstruct from memory.
- The Max-login check has no real, non-billing signal (currently verified present: `claude auth status --json` → `{loggedIn, authMethod, apiProvider, …}`).
- Non-lifted new or rewritten lines grow past about 300, or a file outside the Files list below is needed.

**Never:**
- Clone ClaudeOS, vendor anything else from it, or name `claudeos-mcp-connector`, `.mcp.json` registration or the Mission Watchdog in `src/`, `package.json` or `README.md`. The README provenance table may name the ClaudeOS repo and tag.
- Read `~/.tk-studio/registry/projects.yaml` or `.tk-studio/jobs/*.json` directly.
- A machine path (`/c/`, `C:\`, `/home/`, `/Users/`) in any tracked file.
- SQLite, locks, tiers, sbx, guards, the pacer, resume, `account`, fixing `conformance.ts` or the tick (Stories 21.2–21.6). No `git push`, no long-lived supervisor process.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Skill job happy path | `run studio-health`; login ok; worker prints `--output-format json` result whose `result` text ends with a status block | `resolve` → `wake` (`state: queued`, directive `invoke-skill`) → spawn `claude -p "/tk-studio:tk-studio-activate <payload>" --output-format json --permission-mode auto` → `finish --state <from block> --status-block <json> [--total-cost-usd N]` | none |
| Core job | `run maintenance-conformance` | `wake` runs the core and answers a terminal state; no worker spawned, no `finish`; CLI calls `status --job-id … --run-id …` and reports that outcome | non-zero/terminal-failed outcome is reported, not hidden |
| Host bypass | permission mode `bypassPermissions` requested on host | named error (e.g. `HostBypassRefused`) thrown before `Bun.spawn`; run finished `blocked` naming it | no process started |
| API key in parent env | `ANTHROPIC_API_KEY=sk-…` set | worker env built without `ANTHROPIC_API_KEY` | — |
| Login absent/expired | `claude auth status --json` non-zero, unparseable, `loggedIn !== true`, or not the claude.ai subscription login | run ends `blocked`, reason names the missing Max login; worker never spawned; `--version` never consulted as proof | finish `blocked` if a run was woken |
| Worker 401 | worker JSON result `is_error` with an auth/401 message | run finished `blocked` naming the missing/expired Max login | never silent |
| Missing block | worker output has no balanced JSON object with string `status` and `intent` | named conformance failure (AD-11) in the finish reason | — |
| Unregistered project / bad job | registry `show` or `resolve` answers `ok:false` or `problems[]` | CLI exits non-zero naming the problem; nothing woken | — |

</intent-contract>

## Code Map

- `.bmad-loop/cache/claudeos-salvage/` (gitignored, read-only input) -- `PROVENANCE.txt` holds repo `github.com/thkennedy/ClaudeOS`, tag `retired-as-driver-2026-09-26`, commit `2b9fd3e0a203028395d6d59ead7e7234ddbdf6f6`, and blob SHAs: `connectors/tk-studio/server.ts` 34db6408… (705 lines), `client.ts` 4fd36363… (96), `conformance.ts` 089172e9… (453), `scripts/studio-jobs-tick.ts` 3ac45353… (307). All four verified MATCH at planning (2026-09-28).
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/jobrun.py:552-578` -- verbs `submit|status|resolve|cancel|wake|account|finish`, all with `--directory`; `status --job-id [--run-id]`; `finish --run-id --state <TERMINAL_STATES> [--reason] [--status-block JSON] [--total-cost-usd]`. Skill targets: `wake` → `state: queued` + `directive{kind: invoke-skill, skill, payload, knowledge, then}`. Core targets execute inside `wake` (`execute_core`, ~`:453`).
- `$TK_STUDIO_ROOT/plugins/tk-studio/lib/registry.py:260` -- `show [--project-id]` → `{ok, project_id, entry{root,…}}`.
- `$TK_STUDIO_ROOT/plugins/tk-studio/contracts/driver-contract.md` -- §1 invocation and auth preflight (lines 43–96), §3 status block (150), §4 job verbs (170), §5 model/effort (231). `contracts/status-block.schema.json`, `contracts/job.schema.json`.
- `$TK_STUDIO_ROOT/plugins/tk-studio/jobs/maintenance-conformance.json` -- core target `contracts/conformance/runner.py run`; `resolve` answers it with `source: type`. `jobs/research-ecosystem.json` -- example of a skill-target job shape for `studio-health.json`.
- `claude` 2.1.283 -- `auth status --json` exists (keys `loggedIn`, `authMethod` = `claude.ai` for the subscription login, `apiProvider`); `--permission-mode` choices include `auto`, `acceptEdits`; `--output-format json`; `--model`, `--effort` exist.
- Repo today: `README.md` (2 lines), `.gitignore` (already ignores `.bmad-loop/cache/`), `.tk-studio/` config. No `package.json`, `tsconfig.json`, `src/` or `test/`.

## Tasks & Acceptance

**Execution:**
- `src/server.ts`, `src/client.ts`, `src/conformance.ts`, `src/tick.ts` -- copy from the staged folder (tick from `scripts/studio-jobs-tick.ts`) after re-verifying blob SHAs; strip MCP stdio registration, watchdog chaining and driver-name residue; fix imports. In `server.ts`/`client.ts`: host default `auto`, refuse host bypass with a named error before spawn, strip `ANTHROPIC_API_KEY` from the worker env, replace the `--version`/API-key auth proof with the Max-login preflight, read projects via registry `show` and jobs via `resolve`; forward model/effort verbatim when present. Export pure builders (command line, worker env, status-block extraction, preflight) so tests can pin them with a mocked spawn.
- `src/env.ts` -- environment-only resolution of studio root, plugin root, `TK_STUDIO_HOME` passthrough, `CLAUDE_BIN`.
- `src/cli.ts` -- `run <job-id> --directory <root>`: preflight → registry → resolve → wake → (skill: invoke + finish | core: status) → print a JSON summary; non-zero exit on failure.
- `.tk-studio/jobs/studio-health.json` -- one-shot job (valid against `job.schema.json`) targeting skill `tk-studio-activate`, read-only. Must `resolve` with no `problems`.
- `package.json`, `bun.lock`, `tsconfig.json`, `.gitignore` (`node_modules/`) -- Bun + TS scaffold; runtime dep `js-yaml` only; dev deps `typescript`, `@types/bun`, `@types/js-yaml`.
- `test/command-line.test.ts`, `test/status-block.test.ts`, `test/preflight.test.ts` -- pin every I/O-matrix row that runs without a live login, plus an end-to-end wake → invoke → finish with a faked `CLAUDE_BIN` printing a `--output-format json` result.
- `README.md` -- purpose, provenance table (repo, tag, commit, source path, target path, blob SHA), env vars, the operator commands.

**Acceptance Criteria (verbatim from epics.md Story 21.1):**
- AC1: Given the four source files at the tag, when they are lifted, then the repo carries them with their provenance (tag, path, commit) in its README, `js-yaml` as the only runtime dependency beyond Bun, no ClaudeOS registration, watchdog, or driver-name residue, and no machine path in any tracked file (AD-15): the studio root, store, and plugin root resolve from the environment.
- AC2: Given the worker invocation, when the lifted code builds the `claude -p` command line, then the host default permission mode is `auto`, a bypass request on the host is refused with a named error before any process starts, the `permissions.deny` list in `~/.claude/settings.json` applies untouched, and the worker's environment never carries `ANTHROPIC_API_KEY` (ruling 3: the Max login pays).
- AC3: Given the auth preflight, when the Max login is absent or expired, then the run ends `blocked` naming the missing login — never a silent 401, and never passed on the strength of `claude --version` alone.
- AC4: Given a job id for a registered project, when it is submitted, then the project is read through the contract's registry read path and the job through the `resolve` verb (0.1.12), never from raw `.tk-studio/jobs/*.json` files.
- AC5: Given a declared one-shot job whose target is the read-only `tk-studio-activate` surface (the story adds it to this repo as `.tk-studio/jobs/studio-health.json`), when it runs `wake` → invoke → `finish` from the CLI, then the status block is captured from the worker's JSON output, `finish` records it, and a `job-run` event lands in the agent PC's ledger.
- AC5b: Given the shipped core-target `maintenance-conformance` job, when the supervisor wakes it, then `wake` runs the core itself and ends the run (no worker session, no `finish`), and the supervisor records the run's outcome from `status`.
- AC6: Given the repo's test suite, when `bun test` runs, then command-line building, status-block extraction (the last balanced JSON object with string `status` and `intent`), and the missing-block case (a named conformance failure, AD-11) are pinned and green.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter, edge-case-hunter (band L; both ran)
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 6, low 4)
- defer: 0
- reject: 3: (low 3): `max_turns` guard not enforced / `account` unexposed (Story 21.5 guards); connector `tk_job` finish cannot carry cost (Story 21.4 cost capture); effort-forwarding e2e through routing (Story 21.4)
- addressed_findings:
  - `[high]` `[patch]` a failure after a run exists (finish/status refused, no JSON, wake timeout) was reported as not-started with `run_id: null`, losing the run: split into startRun/finishRun; once a run id exists the CLI reports it with exit 1; timeout recovery looks the run up via `status`
  - `[medium]` `[patch]` CLI skipped the contract version pin: `requireCompatible` is exported and called before any verb
  - `[medium]` `[patch]` registry answer was discarded, so an unregistered directory could pass: the entry `root` must equal `--directory`; an unreadable config is a start failure
  - `[medium]` `[patch]` `total_cost_usd` dropped on error envelopes with no `result`: cost read before the type check
  - `[medium]` `[patch]` auth regex ran on healthy output (false `blocked`): gated on `is_error` or a non-zero exit
  - `[medium]` `[patch]` a 401 with a worker block already `blocked` did not name the Max login: the reason always leads with MAX_LOGIN_MISSING
  - `[medium]` `[patch]` no CLI-level test that a host bypass exits 2 with no process (not even the auth probe) and no run: test added
  - `[low]` `[patch]` bad-invocation errors exited 1 against the README's 2: every pre-run error is a StartError → exit 2; README and cli.ts header reworded per consult
  - `[low]` `[patch]` `finishStateFor` passed `cancelled` through, outside the status-block schema enum (complete|partial|blocked): now maps to `partial`. The spec's Design Note listed `cancelled`; the contract schema governs
  - `[low]` `[patch]` "nothing woken" tests asserted nothing about the store: shared `expectNothingWoken` check
  - `[low]` `[patch]` orphaned `lastJsonObject` comment, duplicate plugin-root resolver: comment restored; server.ts uses env.ts `pluginRoot`; unused `studioHome()` removed

## Design Notes

- Status-block extraction: scan the worker's `result` text for balanced `{…}` objects (string-aware brace matching), parse each, and keep the **last** one whose `status` and `intent` are strings. None → the named conformance failure.
- Finish state mapping: block `status` in `complete|partial|blocked|cancelled` passes through; anything else → `partial` with the block recorded.
- AC5's live `claude -p` leg is `unverifiable-here` (needs the Max login on the agent PC host tier). Operator command: `bun src/cli.ts run studio-health --directory <this repo>`. AC5b runs for real here.
- Splitting `server.ts` further under `src/` is allowed and recorded as a score-1 deviation.

## Verification

**Commands:**
- `bun install --frozen-lockfile` (or `bun install` first time, commit `bun.lock`) -- expected: success
- `bun test` -- expected: all green
- `bunx tsc --noEmit` -- expected: no errors
- `git grep -n -i -E "claudeos-mcp-connector|mcp\.json|watchdog" -- src package.json` -- expected: nothing (README only in the provenance table, if at all)
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test package.json README.md .tk-studio/jobs` -- expected: nothing
- `uv run $TK_STUDIO_ROOT/plugins/tk-studio/lib/jobrun.py resolve --directory . --job-id studio-health` -- expected: `ok: true`, `problems: []`
- `timeout -k 5 960 bun src/cli.ts run maintenance-conformance --directory .` -- expected: wake runs the core, no worker spawned, outcome reported from `status`

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: CLI does `wake` → invoke → `finish` for the one-shot `studio-health` / actual: CLI uses `submit` for one-shot jobs and `wake` for recurring ones / why: `jobrun.py wake` refuses one-shots ("wake applies to recurring jobs — submit runs a one-shot"); `submit` returns the same invoke-skill directive and run id / may affect: 21-3, 21-6
- planned: strip MCP stdio registration from `server.ts` / actual: only the ClaudeOS registration and names removed; the stdio JSON-RPC loop stays / why: `client.ts`, `conformance.ts` and `tick.ts` drive `server.ts` over stdio and must stay as lifted / may affect: 21-2, 21-3
- planned: host bypass request ends with the run finished `blocked` / actual: CLI refuses before preflight and before any wake, so no run exists to finish (reports `state: blocked`, `HostBypassRefused`, exit 2); `invokeSkill` still throws before spawn and the CLI finishes `blocked` if reached there / why: AC2 requires refusal before any process starts, and the auth probe is a process / may affect: 21-4
- planned: lifted worker call (prompt on stdin, shell retry on ENOENT) / actual: prompt passed as the argument after `-p`; shell retry removed / why: matches the spec's command line; a shell retry with the prompt in argv allows injection / may affect: 21-4
- planned: "thrown before `Bun.spawn`" / actual: lifted `node:child_process` spawn kept behind an injectable spawner the tests mock / why: keeps the lifted spawn and kill-tree code / may affect: none
- planned: none / actual: `studio-health` uses `stop: {max_runs: 1000}` / why: schema requires a stop condition; `on_status: [blocked]` would lock the health check after one blocked run / may affect: none
- planned: not named / actual: CLI reads `project_id` from `.tk-studio/config.yaml` via the lifted `readProjectConfig` (else directory basename); `CONSUMED_CONTRACT` 0.1.12 → 0.1.18; `SERVER_INFO.name` → `tk-studio-supervisor`; CLI `--permission-mode` flag / why: `show --project-id` needs a key; contract is current; the bypass row needs a way to be requested / may affect: none
- planned: Block If when non-lifted new or rewritten lines pass ~300 / actual: ~380 new `src` lines plus ~290 test lines / why: finishing every AC with tests needed it; no file outside the Files list added / may affect: none

DEVIATION SCORE: 2

DRIFT: one-shot jobs start via `submit`, not `wake` — `jobrun.py wake` refuses one-shots; AC5's "wake" is only reachable as `submit` — affects: 21-3, 21-6
DRIFT: stdio JSON-RPC loop kept in `server.ts` (only ClaudeOS registration/names stripped) — lifted `client.ts`/`conformance.ts`/`tick.ts` drive it over stdio — affects: 21-2, 21-3
DRIFT: host bypass refused before any wake, so no run is finished `blocked` — refusal must precede every process, including the auth probe — affects: 21-4
DRIFT: worker prompt moved from stdin to the `-p` argument; shell ENOENT retry removed — spec command line; shell retry is an injection risk — affects: 21-4
DRIFT: lifted `node:child_process` spawn kept behind an injectable spawner instead of `Bun.spawn` — keep lifted kill-tree code — affects: none
DRIFT: `studio-health` stop condition `max_runs: 1000` — schema requires a stop; `on_status: [blocked]` would lock it — affects: none
DRIFT: CLI reads `project_id` via lifted config reader; contract pin bumped to 0.1.18; server name renamed; CLI `--permission-mode` flag — needed for registry key, currency and the bypass row — affects: none
DRIFT: non-lifted src lines ~380 vs ~300 plan budget (Block If) — every AC plus tests needed it — affects: none

### pass 2 (2026-09-28, implementer: matrix-audit test for the Core job row)

DEVIATIONS: none (score 0; test-only change in `test/command-line.test.ts`)

### pass 3 (2026-09-28, implementer: review patches)

- planned: remove unused env.ts exports, or have server.ts use env.ts's `pluginRoot` / actual: server.ts uses env.ts's `pluginRoot`; unused `studioHome()` removed / why: one resolver (AD-15), no dead export / may affect: none
- planned: README not in the patch list / actual: README exit-code sentence updated / why: must match the new exit rules / may affect: none
- planned: wake-timeout run lookup / actual: adopts only runs started within 2s before the CLI began, newest first / why: never pick up an earlier run of a recurring job / may affect: 21-3, 21-6

DEVIATION SCORE: 1

DRIFT: wake/submit-timeout recovery adopts only a run started within 2s before the CLI's own start — never report or finish a run the CLI did not start — affects: 21-3, 21-6

### pass 4 (2026-09-28, implementer: consult-directed exit-code wording)

- planned: exit 1 for every declined wake/submit / actual: docs state that a wake/submit answered without waking gives `not-woken`/exit 1, while an outright verb refusal (`ok:false`) or a failure with no run found exits 2 / why: describes the code as it is (no code changed) / may affect: none

DEVIATION SCORE: 1

DRIFT: README/cli.ts exit-rule wording splits a declined wake/submit (not-woken → 1) from an outright refusal (→ 2) — the docs match the code — affects: none

## Consult Log

- 2026-09-28T09:24:58Z — trigger: deviation-gt-0 (incl. plan Block-If line-budget tripwire) — question: accept the pass-1 deviation set, and does the ~380-line src overrun require a HALT? — ruling: accept-deviation score 2 — do: Do not HALT; continue to review with the full Deviation Summary accepted as one set, keeping the overrun DRIFT line as written. / Reviewer checks the refused-bypass path starts no process and creates no run (src/cli.ts:138-140), and one-shots go through submit, recurring through wake (src/cli.ts:63-64). / Carry the drift to the 21-3, 21-4 and 21-6 planners: one-shots start via submit, the stdio loop stays in server.ts, a refused bypass creates no run to finish. — rule candidate: plan template states the non-lifted line budget counts src only and an overrun with no new files is a record-and-continue DRIFT; routing states one-shot jobs start via jobrun submit (wake = recurring only). — observe record: ok
- 2026-09-28T09:34:10Z — trigger: deviation-gt-0 (review-patch pass) — question: accept the pass-3 deviations, and is exit 1 for login-absent consistent with README's exit-2 rule? — ruling: accept-deviation score 1 — do: Accept all three and keep login-absent at blocked/run_id null/exit 1. / Reword README.md:16 and the src/cli.ts header: exit 2 = invocation or setup refused before a run exists; a missing Max login (blocked) and a declined wake/submit (not-woken) end without a run id but exit 1 as run outcomes. / Tell 21-3 and 21-6 planners that timeout recovery adopts only a run started within 2s before the CLI's own start. — rule candidate: customization states the CLI exit rule (0 complete; 1 any run outcome incl. pre-run blocked/not-woken; 2 invocation/setup refused before a run exists); timeout recovery never adopts a run older than the CLI. — observe record: ok

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** The four ClaudeOS driver files (blob-verified against `PROVENANCE.txt`) are lifted into `src/`, with the ClaudeOS registration, watchdog and driver-name residue stripped. `server.ts` is brought current:
- host default `--permission-mode auto`; a host bypass throws `HostBypassRefused` before any process starts
- `ANTHROPIC_API_KEY` stripped from the worker env
- Max-login preflight via `claude auth status --json` (`loggedIn` + `claude.ai`), never `--version`
- projects read via `registry.py show` (root must match `--directory`), jobs via `resolve`
- `--output-format json`, with the status block taken as the last balanced object with string `status`/`intent`
- `MISSING_STATUS_BLOCK` named on a missing block (AD-11), and cost forwarded to `finish`

`src/cli.ts run <job-id> --directory <root>` drives submit/wake → invoke → finish for skill jobs. For core jobs it drives wake → status.

**Files changed:**
- `src/server.ts`: lifted library core plus the 21.1 fixes (auth, bypass, env, registry/resolve, block extraction, finish mapping)
- `src/client.ts`, `src/conformance.ts`, `src/tick.ts`: lifted; coupling stripped, imports fixed (conformance and tick otherwise as-is for 21.2/21.3/21.5)
- `src/env.ts`: environment-only resolution (`TK_STUDIO_ROOT`, plugin root, `TK_STUDIO_HOME` passthrough, `CLAUDE_BIN`)
- `src/cli.ts`: the `run` CLI
- `.tk-studio/jobs/studio-health.json`: one-shot job, skill `tk-studio-activate` (resolves with no problems)
- `test/command-line.test.ts`, `test/status-block.test.ts`, `test/preflight.test.ts`: 42 tests, including e2e against real `jobrun.py` verbs with a throwaway store and a fake `CLAUDE_BIN`
- `package.json`, `bun.lock`, `tsconfig.json`: Bun + TS scaffold; `js-yaml` is the only runtime dependency
- `README.md`: purpose, provenance table (repo, tag, commit, paths, blob SHAs), env vars, commands, exit rule

**Review findings:** 11 patches applied (high 1, medium 6, low 4), 0 deferred, 3 rejected (out-of-story: 21.4/21.5). Follow-up review recommended: true. Patched high 1, medium 6, low 4; score 3×6+4 = 22 ≥ 5, and one high.

**Verification:**
- `bun install --frozen-lockfile` ok
- `bun test` 42 pass / 0 fail
- `bunx tsc --noEmit` clean
- residue grep and machine-path grep: nothing
- `jobrun.py resolve --job-id studio-health`: ok, no problems
- AC5b live: `bun src/cli.ts run maintenance-conformance --directory .` → `target: core`, `state: complete`, 18 surfaces / 116 checks / 0 failures, exit 0 (runs recorded in this machine's store)

**unverifiable-here (AC5 live leg):** the real `claude -p` worker needs the Max login on the agent PC host tier. It is proven end to end with a faked worker (block, cost and exactly one `job-run` event recorded). Operator command: `bun src/cli.ts run studio-health --directory <this repo>`.

**Residual risks:**
- The Windows `claude.cmd` shell fallback was removed, so on the agent PC `CLAUDE_BIN` must name a real executable if `claude` is an npm shim.
- The wake-timeout and status-failed recovery paths have no automated tests (they need an injected job runner).
- `max_turns` in `studio-health.json` is declared but unenforced until 21.5.

DRIFT: one-shot jobs start via `submit`, not `wake` — `jobrun.py wake` refuses one-shots; AC5's "wake" is only reachable as `submit` — affects: 21-3, 21-6
DRIFT: stdio JSON-RPC loop kept in `server.ts` (only ClaudeOS registration/names stripped) — lifted `client.ts`/`conformance.ts`/`tick.ts` drive it over stdio — affects: 21-2, 21-3
DRIFT: host bypass refused before any wake, so no run is finished `blocked` — refusal must precede every process, including the auth probe — affects: 21-4
DRIFT: worker prompt moved from stdin to the `-p` argument; shell ENOENT retry removed — spec command line; shell retry is an injection risk — affects: 21-4
DRIFT: lifted `node:child_process` spawn kept behind an injectable spawner instead of `Bun.spawn` — keep lifted kill-tree code — affects: none
DRIFT: `studio-health` stop condition `max_runs: 1000` — schema requires a stop; `on_status: [blocked]` would lock it — affects: none
DRIFT: CLI reads `project_id` via lifted config reader; contract pin bumped to 0.1.18; server name renamed; CLI `--permission-mode` flag — needed for registry key, currency and the bypass row — affects: none
DRIFT: non-lifted src lines ~380 vs ~300 plan budget (Block If; consult accepted, record-and-continue) — every AC plus tests needed it — affects: none
DRIFT: wake/submit-timeout recovery adopts only a run started within 2s before the CLI's own start — never report or finish a run the CLI did not start — affects: 21-3, 21-6
DRIFT: README/cli.ts exit-rule wording splits a declined wake/submit (not-woken → 1) from an outright refusal (→ 2) — the docs match the code — affects: none
