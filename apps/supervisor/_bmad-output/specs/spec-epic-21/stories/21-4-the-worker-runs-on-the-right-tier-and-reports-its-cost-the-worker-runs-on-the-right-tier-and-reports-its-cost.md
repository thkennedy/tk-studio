---
title: 'The Worker Runs on the Right Tier and Reports Its Cost'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
baseline_revision: '6b973d1af7d31b39c5d8601ec4fdd87159982289'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-21/plans/21-4.md'
  - '{project-root}/_bmad-output/specs/spec-epic-21/salvage-findings.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** After 21-1..21-3 the worker always runs on the host: there is no tier, so a job needing bypass cannot run anywhere, and submission-level model/effort overrides cannot reach the worker. Story 21.4 (epics.md, authoritative) requires:

- **AC1:** Given a run on the host tier (the default; the tier comes from the submission or the supervisor's own per-job config, never from the plugin — AD-2), when the worker starts, then `claude -p` runs under the Max login with `--permission-mode auto` (or `acceptEdits` when the job asks), `--output-format json`, the deny list untouched, and the process console-hosted in the logged-on session — never a headless Task Scheduler spawn (runbook §8).
- **AC2:** Given a run on the sbx tier, when the worker starts, then it runs inside a Docker Sandboxes microVM, where bypass is permitted; a bypass request on the host tier is refused before any process starts and the run ends `blocked` naming the refusal.
- **AC3:** Given model and effort from the resolved job or the submission, when the worker starts, then they are forwarded verbatim as contract §5 specifies; the supervisor never chooses a model (AD-14).
- **AC4:** Given the worker's JSON result, when the run ends, then the status block is extracted, `total_cost_usd` is passed to `finish` (Epic 20), and a missing block ends the run with a named conformance failure (AD-11).
- **AC5:** Given the first sbx-tier run on the agent PC, when it completes, then the two runbook §3.5 first-run checks are recorded: bypass works inside the microVM, and `~/.ssh` and cloud-credential folders are not visible inside it.

Binding replans: AC2's "run ends `blocked`" = the submission refused `blocked` (HostBypassRefused, exit 2) with **no queue run minted**. Prompt stays one argv item after `-p` (no stdin, no shell). `deny_profile` is absolute, validated by `validateDenyProfile`, forwarded as `--settings`, never widened. Tier stored on the queue run like `runs.permission_mode` (explicit ?? stored ?? config ?? `host`), re-checked at drive time; caller's host bypass refused before enqueue. `finish` takes `studio_run_id` (never the queue id) with `--total-cost-usd`. Build on `startRun`/`finishRun`/`guardsFor`.

**Approach:** Add a `tier` (`host` | `sbx`) resolved per run from submission ?? queue run ?? supervisor per-job config (`TK_SUPERVISOR_CONFIG`) ?? `host`. The sbx tier wraps the same `claude -p` argv in `sbx exec <sandbox> env -u ANTHROPIC_API_KEY -C <vm-root> claude …` (argv, no shell), with its auth preflight through the same wrapper. Tier, sandbox, model and effort are stored on the queue run and re-validated at drive time; overrides win over `woke.routing`.

## Boundaries & Constraints

**Always:**
- `bypassPermissions` refused (`HostBypassRefused`) whenever the effective tier is `host`, before any process (incl. auth probe, registry `show`, `resolve`) and before enqueue; accepted on `sbx`.
- Default permission mode on both tiers is `auto`; bypass on sbx only when requested (explicit, stored or config).
- Permission mode resolution: explicit ?? stored ?? config ?? `auto`; `acceptEdits` reachable via submission or config.
- Every spawn argv-only, `shell: false`; the prompt is exactly one argv item after `-p` on both tiers.
- Worker env never carries `ANTHROPIC_API_KEY`: host env stripped (`buildWorkerEnv`), and inside the VM via `env -u ANTHROPIC_API_KEY`.
- Model/effort: override (submission) ?? `woke.routing.*` verbatim; neither → no flag. Forwarded both as `--model/--effort` flags and payload fields (existing `invokeSkill` behavior).
- Per-job config is read only from `TK_SUPERVISOR_CONFIG` (unset → no config); never from the plugin or the project's `.tk-studio/`. Unknown key/value → named `SupervisorConfigInvalid` (exit 2, nothing queued).
- VM path is derived mechanically from the host root (`C:\GitHub\p` or `C:/GitHub/p` → `/c/GitHub/p`; an already-POSIX path unchanged) — no hard-coded path (AD-15). Payload `directory` for an sbx run is the VM path.
- sbx needs a sandbox name (submission `--sandbox` ?? stored ?? config); absent → named refusal before enqueue. The VM worker binary is literal `claude` (host `CLAUDE_BIN` is host-only); the host `sbx` binary is `SBX_BIN` ?? `sbx`.
- Queue columns `tier`, `sandbox`, `model`, `effort` are nullable; an existing queue file gains them by `ALTER TABLE … ADD COLUMN` guarded by `PRAGMA table_info` (the `permission_mode` column included if missing).
- Stored values only recorded on `queued` runs, each change writing one `run-options` event.

**Block If:**
- `sbx exec` cannot carry the prompt as one argv item without a shell → HALT naming it (never `bash -lc` with an interpolated prompt).
- The VM cwd cannot be derived from the registry root alone → HALT.
- Files touched beyond the Files list in the plan grow past 10 → HALT `oversize`.

**Never:** `--dangerously-skip-permissions`; bypass on host; choosing, defaulting or escalating a model/effort; reading tier from the plugin/job.schema; a machine path in any tracked file; new runtime dependencies (js-yaml already present); touching `src/tick.ts`, `src/conformance.ts`, the tree-kill (21-5) or resume (21-6); starting a long-lived supervisor or sbx sandbox here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| host default | `run studio-health`, no tier/config | argv `claude -p <prompt> --output-format json --permission-mode auto`, spawned directly (no `sbx`) | — |
| host acceptEdits | config `permission_mode: acceptEdits` or `--permission-mode acceptEdits` | `--permission-mode acceptEdits` | — |
| host bypass | `--permission-mode bypassPermissions` (no tier / `--tier host` / config host) | exit 2, `state: blocked`, `HostBypassRefused`, zero spawns, no queue run | — |
| sbx bypass | `--tier sbx --sandbox claude-p --permission-mode bypassPermissions` | `sbx exec claude-p env -u ANTHROPIC_API_KEY -C /c/GitHub/p claude -p <prompt> --output-format json --permission-mode bypassPermissions …` | — |
| sbx preflight | sbx tier | `sbx exec <sb> env -u ANTHROPIC_API_KEY claude auth status --json`, judged by `judgeAuthStatus` | not logged in → `blocked` MAX_LOGIN_MISSING, nothing queued |
| sbx no sandbox | `--tier sbx`, none configured | exit 2 named refusal, nothing queued | — |
| bad tier | `--tier gpu` or config `tier: gpu` | exit 2 named refusal / SupervisorConfigInvalid | — |
| stored drive | `submit --tier sbx --sandbox s --model m`; later `drain` | driven via sbx with `--model m`; stored values re-validated after claim | invalid stored → run ends `blocked` naming it |
| model/effort | no override, `woke.routing {model: X, effort: high}` | `--model X --effort high` verbatim | — |
| override | `--model Y` + routing X | `--model Y` | — |
| neither | no routing, no override | no `--model`/`--effort` | — |
| deny profile sbx | absolute profile inside the project root | forwarded as its VM path | outside the root → `DenyProfileRefused` (not visible in the VM) |
| cost | worker JSON `total_cost_usd: 0.42` | `finish --run-id <studio_run_id> … --total-cost-usd 0.42` | missing block → `finish --state blocked --reason <MISSING_STATUS_BLOCK>` |

</intent-contract>

## Code Map

- `src/server.ts:230-241` -- `PERMISSION_MODES`, `HOST_PERMISSION_MODE`, `HostBypassRefused`; keep message prefix (cli maps it to `blocked`).
- `src/server.ts:260-283` -- `validateDenyProfile` (absolute, canonical `resolve`); reuse, then map to VM path for sbx.
- `src/server.ts:290-305` -- `buildWorkerCommand`: make bypass check tier-aware (`tier?: "host"|"sbx"`, default host).
- `src/server.ts:307-323` -- `buildWorkerEnv`, `Spawner`, `runClaude(cmd, cwd, …)`: sbx spawn runs with host cwd unset or root (cwd applies to `sbx` itself); the VM cwd comes from `env -C`.
- `src/server.ts:173-209` -- `runProcess` (`windowsHide: true`, `shell:false`). Do not change for this story; AC1's console-hosting is an operator-verified live leg.
- `src/server.ts:512-519` -- `maxLoginPreflight(spawner)`: add a tier/sandbox-aware variant (host unchanged).
- `src/server.ts:520+` -- `authPreflight(skill, payload, root, spawner)`: must use the tier-aware login probe.
- `src/server.ts:683-719` -- `tk_invoke` schema (`additionalProperties:false`) and `InvokeArgs`: add `tier` (enum host|sbx) and `sandbox`.
- `src/server.ts:740-811` -- `invokeSkill`: builds command before preflight (keep order); set `payload.directory` to VM path on sbx; `total_cost_usd` already surfaced via `parseWorkerResult` :467.
- `src/cli.ts:144-172` -- `RunOptions`, `Validated` (add tier, sandbox, model, effort), `guardsFor`.
- `src/cli.ts:310-320` -- `submitJob`: add options; refuse host bypass / bad tier / missing sandbox before enqueue.
- `src/cli.ts:322-382` -- `runJob`: pre-check at :343 (uses explicit mode only today) → resolve tier/mode from explicit + config before any process; preflight on the resolved tier; `enqueue`/`recordPermissionMode` at :354-356 → record all options; effective values explicit ?? stored ?? config ?? default re-checked after claim (:370-371).
- `src/cli.ts:445-452` -- project id derived from `.tk-studio/config.yaml` `project_id` ?? basename(root) with no process — extract a helper so the config key `<project-id>/<job-id>` is known before any spawn.
- `src/cli.ts:484-522` -- `startRun`/`Started` (carry tier, sandbox, overrides through).
- `src/cli.ts:582-649` -- `finishRun`: invoke args (:607-610) → `model: override ?? routing.model`, `effort: override ?? routing.effort`, plus tier/sandbox; `finish` already passes `--run-id <studio runId>` and `--total-cost-usd` (:631-636).
- `src/cli.ts:651-705` -- `USAGE`, `main` flag parsing (`allowed` lists), `HostBypassRefused` → `blocked` exit 2 (:698); extend `blocked` mapping unchanged; header comment :1-60.
- `src/cli.ts:272` -- `drainQueue` calls `runJob(…, undefined, {runId})`; stored options must apply.
- `src/queue.ts:277-307` -- SCHEMA; `runs.permission_mode` :289; add nullable columns + guarded ALTER migration on open.
- `src/queue.ts:420-472` -- `enqueue({permissionMode})`, `recordPermissionMode`, `writePermissionMode`: template for `recordRunOptions` + `run-options` event (queued only).
- `src/tick.ts:224` -- `runJob(job.id, root, undefined, {…})`: read-only; config tier applies automatically.
- `src/env.ts` -- add `supervisorConfigPath()` (`TK_SUPERVISOR_CONFIG`, optional) and `sbxBin()` (`SBX_BIN` ?? `sbx`); update header.
- `src/config.ts` (new) -- load/validate `jobs: {"<project-id>/<job-id>": {tier?, permission_mode?, sandbox?}}` with `js-yaml`; `SupervisorConfigInvalid`.
- Tests pinning today: `test/command-line.test.ts` :21 host argv, :26 forbidden flags, :31 model/effort, :42 HostBypassRefused zero spawns, :51 key stripped, :291 block+cost+job-run, :311 missing block, :338 host bypass exit 2, :749 stored mode; `test/status-block.test.ts` :33-60; `test/preflight.test.ts` :139/:146; `test/queue.test.ts` :159 permission_mode round-trip.
- Runbook (read-only, `$TK_STUDIO_ROOT/kb/agent-pc-setup-runbook.md`): §3.8 `sbx create --name claude-<project> claude C:\GitHub\<project> …`, mount at `/c/GitHub/<project>`, `sbx exec <sb> <argv…>` passes argv (as `provision-engine.sh` usage shows); in-VM `claude auth status --json` reports `authMethod: claude.ai` (verified in this sandbox).

## Tasks & Acceptance

**Execution:**
- `src/env.ts` -- add `supervisorConfigPath()`, `sbxBin()`; header rows -- env-only seams (AD-15).
- `src/config.ts` -- new: `loadSupervisorConfig(path?)`, `jobOptions(cfg, projectId, jobId)`, `SupervisorConfigInvalid`; validates `tier ∈ {host,sbx}`, `permission_mode ∈ PERMISSION_MODES`, `sandbox` non-empty string, no unknown keys -- the supervisor's own per-job config.
- `src/server.ts` -- tier-aware `buildWorkerCommand`; exported `toVmPath(root)` and `buildSbxCommand({sandbox, vmRoot, worker})` returning `{bin: sbxBin(), argv: ["exec", sandbox, "env", "-u", "ANTHROPIC_API_KEY", "-C", vmRoot, "claude", ...worker.argv]}`; sbx deny-profile mapping; sbx login preflight through `sbx exec`; `InvokeArgs`/`tk_invoke` `tier`+`sandbox`; `invokeSkill` uses VM `directory` on sbx -- AC1-AC3.
- `src/queue.ts` -- nullable `tier`, `sandbox`, `model`, `effort` columns; guarded migration; `enqueue` options; `recordRunOptions` + `run-options` event -- stored tier (replan 21-3).
- `src/cli.ts` -- `--tier`, `--sandbox`, `--model`, `--effort` on `run` and `submit`, plus `--permission-mode` on `submit`; resolution + pre-enqueue refusals; carry through `Validated`/`Started`; `finishRun` override ?? routing; post-claim re-check; USAGE/header -- AC1-AC4.
- `test/tier.test.ts` -- new: resolution order; config parse/refusals; host bypass refused / sbx bypass accepted; sbx argv (prompt one item, `--settings`/`--model`/`--effort` inside, VM cwd, env strip); sbx preflight via injected spawner; `acceptEdits` via config and submission; `toVmPath` cases -- matrix.
- `test/command-line.test.ts` -- `finishRun` forwards routing verbatim, override wins, neither → no flags; `--tier`/`--sandbox` on `run`/`submit`; stored tier driven by `drain`; `finish` gets studio run id + cost; host bypass via `submit` refused with no queue run -- AC2-AC4.
- `test/queue.test.ts` -- tier/sandbox/model/effort round-trip (like :159); migration of an old-schema file -- stored options.
- `README.md` -- tier section, `TK_SUPERVISOR_CONFIG` + `SBX_BIN` env rows, config example (placeholders only), new flags, operator commands for AC1/AC5 live legs.

**Acceptance Criteria:**
- Given no tier anywhere, when `run` drives a skill job, then the spawner receives `claude` with `--permission-mode auto --output-format json` and no `sbx`, and the queue run's `tier` reads `host`.
- Given `--permission-mode bypassPermissions` without an sbx tier, when `run` or `submit` is called, then exit 2, `state: blocked`, `HostBypassRefused` in `error`, zero spawns and zero queue runs.
- Given an sbx run with bypass, when the worker starts, then the spawner receives `sbxBin()` with argv beginning `exec <sandbox> env -u ANTHROPIC_API_KEY -C <vm-root> claude -p <prompt>` and `--permission-mode bypassPermissions`.
- Given `woke.routing` and/or submission overrides, when `finishRun` invokes, then model/effort equal override ?? routing verbatim, and are absent when both are absent.
- Given a worker result with `total_cost_usd` and a block, when the run ends, then `finish` receives `--run-id <studio run id>` and `--total-cost-usd <value>`; without a block it receives `--state blocked` with `MISSING_STATUS_BLOCK`.
- AC1 console-hosting and AC5 first-run checks: unverifiable-here; README carries the exact operator commands.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 0
- reject: 1 (medium 1)
- addressed_findings:
  - `[medium]` `[patch]` Tier frozen at enqueue mixed with a live-config permission mode (stored host + config sbx bypass → drain ended a valid run `blocked`). A config entry's `permission_mode` now applies only when the run's effective tier equals the entry's tier. e2e drain test + unit test.
  - `[low]` `[patch]` Config job keys rejected project ids with spaces. The key is now split at the last `/`.
  - `[low]` `[patch]` An underivable sbx VM path (UNC root) was detected only after enqueue and wake. `toVmPath(root)` now runs during option resolution (refused, exit 2, nothing queued).
  - `[low]` `[patch]` `vmDenyProfile` refused `<root>/..deny.json` (prefix `..` test). It now tests for `..` + sep.
  - `[low]` `[patch]` Empty flag values were silently treated as absent. `main` now refuses them (`needs a value`, exit 2).
- rejected: edge-case-hunter "store only submission tier/sandbox" — contradicts the pass-1 consult ruling (the resolved tier is stored so the AC's `tier` reads `host`); the harmful interaction it names is fixed by the first patch.

### 2026-09-28 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4 (high 0, medium 1, low 3)
- defer: 0
- reject: 5 (medium 1, low 4)
- addressed_findings:
  - `[medium]` `[patch]` An sbx deny profile that is a symlink inside the root pointing outside it passed the inside-root check (only `resolve()`d) and was forwarded as a dangling VM path. `vmDenyProfile` now checks on real paths (`realpathSync` of profile and root, root falls back to `resolve`); refused with `DenyProfileRefused`. Test `test/tier.test.ts:274`.
  - `[low]` `[patch]` A whitespace-only flag value (`--sandbox ' '`) dodged `SbxSandboxMissing` and queued a run with a blank sandbox. `main` now refuses a value whose trim is empty (`needs a value`, exit 2). Test `test/command-line.test.ts:81`.
  - `[low]` `[patch]` `resolveWorkerOptions` doc said "a config entry is one unit", contradicting the accepted pass-2 behaviour. Comment now says only `permission_mode` is tier-gated; `sandbox` follows plain precedence.
  - `[low]` `[patch]` README refusal list omitted `VmPathUnderivable` and did not say a config `permission_mode` applies only on its entry's tier. Both added.
- rejected: blind-hunter "config path not placement-checked" — `TK_SUPERVISOR_CONFIG` is an operator-set env seam (AD-15); the supervisor never looks the tier up from the plugin, and bypass stays sbx-only regardless.
- rejected: blind-hunter "`TK_STUDIO_HOME` not forwarded into the VM" — the host `sbx` child does receive it; a host store path is meaningless inside the microVM (the VM worker uses its own store); no criterion names it.
- rejected: blind-hunter "sbx infra failures reported as missing Max login, retried forever in drain" — the reason carries the probe failure text, and a failed probe leaving the run queued is the 21-3 host preflight semantics (a stopped sandbox is transient).
- rejected: blind-hunter "root not realpath'd while profile canonical is" — false: `validateDenyProfile` returns a `resolve()`d path, so both sides matched; the real symlink case is the patched edge-case-hunter finding.
- rejected: blind-hunter "payload `directory` outside the root mapped without a mount check" — the run already ends with a named failure (VmPathUnderivable, or the skill's own block inside the VM); not a criterion-named behaviour, contract or safety rule.

### 2026-09-28 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 6 (medium 2, low 4)
- addressed_findings:
  - `[medium]` `[patch]` The sbx VM root (`env -C`, payload `directory`, deny-profile VM path) came from the caller's `--directory`. `samePath` accepts that spelling case-insensitively on win32 and through junctions. So `c:\github\p` against the registry root `C:\GitHub\p` gave the unmounted `/c/github/p`, contradicting the Block If and README "derived from the registry root". `validate()` now returns `registryRoot`, which is threaded through `Started` to `invokeSkill(…, { vmHostRoot })`. Tests: `test/tier.test.ts:274`, `test/command-line.test.ts:275`, and the e2e symlink run `test/command-line.test.ts:1031`.
  - `[low]` `[patch]` `submit` has its own refusal path, but only its host-bypass refusal was asserted. It now also has tests for `TierRefused`, `SbxSandboxMissing` and `SupervisorConfigInvalid`: each exits 2 with no spawns and no queue run (`test/command-line.test.ts:995-996`, `:1112`).
- rejected: blind-hunter "config `sandbox` applies on every tier and is recorded on host runs": this is the behaviour the pass-2 consult accepted (only `permission_mode` is tier-gated; the stored sandbox wins). The doc comment says the sandbox is *read* only on sbx, which is true.
- rejected: blind-hunter + edge-case-hunter "Jira backend-auth preflight judges the host env on sbx", and blind-hunter "`TK_STUDIO_HOME` not forwarded": out of scope by the intent. Its sbx-preflight row names only the Max-login probe. Docker Sandboxes inject credentials at the proxy, so the VM env is no oracle either. A failing in-VM Jira call ends the run with its own block (AD-11).
- rejected: blind-hunter "a wrong sandbox reads as MAX_LOGIN_MISSING and stays queued": the same claim was rejected in follow-up 1 (21-3 preflight semantics; the reason carries the probe failure).
- rejected: blind-hunter "the supervisor cannot apply a deny profile to its runs": the replan binds only how a supplied `deny_profile` is forwarded (the 21-2 MCP seam). No criterion asks `run`/`submit` to supply one.
- rejected: blind-hunter "a stored model/effort/sandbox cannot be cleared from a queued run": no criterion names it. It matches 21-3's `permission_mode` (cancel and resubmit).
- rejected: edge-case-hunter "payload `directory` outside the root maps to an unmounted VM path": the same claim was rejected in follow-up 1.

## Design Notes

- Why `env -C`: `sbx exec` passes argv to the VM like `docker exec`; `env -C <dir> claude …` sets the cwd and `env -u` strips the key without any shell, so the prompt stays one argv item.
- Tier resolution needs the project id before any process: it is read from the project's `.tk-studio/config.yaml` (file read, no spawn), the same derivation `validate` uses.
- Console hosting (AC1): the host worker is a direct child of the console-hosted supervisor (no Task Scheduler, no `start`); whether libuv's `CREATE_NO_WINDOW` under `windowsHide` matters is checked live — operator records the worker's session id (non-zero).
- `sbx exec` timeout kills the host process only; the VM-side worker may survive (21-5 tree kill, DW-3). Named as a residual risk.

## Verification

**Commands:**
- `bun install --frozen-lockfile` -- expected: no changes
- `bun test` (with `TK_STUDIO_ROOT` set) -- expected: all pass
- `bunx tsc --noEmit` -- expected: clean
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test package.json README.md` -- expected: nothing (test fixtures for `toVmPath` must build such paths without a literal match, e.g. by concatenation)
- `git diff --stat 6b973d1af7d31b39c5d8601ec4fdd87159982289 -- package.json bun.lock` -- expected: empty
- `TK_SUPERVISOR_DB=$(mktemp -d)/q.db bun src/cli.ts run studio-health --directory . --permission-mode bypassPermissions` -- expected: exit 2, `HostBypassRefused`, no queue run

## Deviation Summary

### pass 1 (implementer, 2026-09-28)

- planned: every recorded option change writes one `run-options` event / actual: `run-options` covers tier, sandbox, model, effort; permission mode keeps its `recordPermissionMode` + `permission-mode` event (two events when both change) / why: keeps 21-3 behaviour and tests unchanged / may affect: none
- planned: tier stored "like `runs.permission_mode`" / actual: the queue run stores the resolved tier and sandbox (a run with no tier anywhere reads `host`), permission mode stays explicit-only; a config change after submission does not re-tier a queued run / why: AC "queue run's tier reads host" needs the resolved value stored / may affect: Epic 22 (`POST /jobs` tier), 22.3 `start.ps1`
- planned: stored values re-checked after the claim / actual: also checked before any process against the run to be adopted; such errors are refusals so `drain` ends the run `blocked` before claiming; post-claim re-check kept / why: sbx login preflight must run on the right tier; an invalid stored value never sits queued forever / may affect: none
- planned: `invokeSkill` sets payload `directory` to the VM path on sbx / actual: also maps a caller-supplied absolute `directory` to its VM path / why: a directive's host path would be invisible in the VM / may affect: none
- planned: `HostBypassRefused` message kept / actual: prefix kept, "(bypass is permitted only on the sbx tier)" appended / why: names where bypass is allowed / may affect: none

DEVIATION SCORE: 1

DRIFT: `run-options` event covers tier/sandbox/model/effort; permission mode keeps its own `permission-mode` event — preserve 21-3 behaviour — affects: none
DRIFT: queue run stores the resolved tier and sandbox, not only explicit values — "tier reads host" criterion — affects: Epic 22
DRIFT: stored run options also validated pre-process against the adopted run; invalid stored values end the run `blocked` in drain — sbx preflight on the right tier, never queued forever — affects: none
DRIFT: sbx maps a caller-supplied absolute payload `directory` to its VM path — host path invisible in the VM — affects: none
DRIFT: `HostBypassRefused` message gains "(bypass is permitted only on the sbx tier)" — names where bypass is allowed — affects: none

### pass 2 (review patches, 2026-09-28)

- planned: e2e test that an sbx run on a UNC root is refused with exit 2 and nothing queued / actual: a unit test on `resolveWorkerOptions` with a UNC root; the check runs inside `resolveBeforeStart`, which already maps errors to a pre-enqueue refusal / why: on POSIX, `resolve()` cannot produce a UNC root end to end / may affect: none
- planned: a config entry is one unit / actual: only the config `permission_mode` is tier-gated; a config `sandbox` follows submission ?? stored ?? config and is read only on sbx (the stored sandbox is pinned to win, `test/tier.test.ts:118`) / why: the mode gate exists for the host-bypass safety refusal / may affect: none

DEVIATION SCORE (pass 2): 1 (consult accepted)

DRIFT: UNC sbx refusal pinned by a unit test at resolution, not e2e — POSIX test host cannot produce a UNC root — affects: none
DRIFT: config `sandbox` is not tier-gated (only `permission_mode` is) — a single-tier field; the stored sandbox wins — affects: none

### pass 3 (follow-up 2 review patches, 2026-09-28)

- planned: carry the registry root to the sbx mapping "as an optional internal arg or option" / actual: `Validated.registryRoot` → `Started.registryRoot` → a 5th `invokeSkill` parameter `opts: InvokeOptions` (`vmHostRoot`), kept out of the `tk_invoke` schema. When it is absent, it falls back to the caller root / why: MCP callers cannot supply it / may affect: 21-6 (resume rebuilds `Started`), Epic 22 (POST /jobs)
- planned: e2e test with a symlink to the project as `--directory` / actual: the symlink keeps the project's basename / why: without `project_id`, the project id falls back to basename(root), and a different link name is refused as unregistered before `samePath` runs / may affect: none

DEVIATION SCORE (pass 3): 2 (consult: accept-deviation score 2)

DRIFT: sbx VM root comes from the registry entry root via Validated.registryRoot -> Started.registryRoot -> invokeSkill opts.vmHostRoot (internal, not in the tk_invoke schema); it falls back to the caller root when absent - Block If AC (plans/21-4.md:127) - affects: 21-6, Epic 22
DRIFT: e2e symlink keeps the project basename so the fallback project id still resolves - affects: none

## Consult Log

- 2026-09-28T12:20:48Z — trigger: deviation-gt-0 — question: accept the implementer's 5 deviations, and at what score (resolved tier/sandbox stored on the queue run vs explicit-only like permission_mode)? — ruling: accept-deviation score 2 — do: keep the resolved tier/sandbox storage, explicit-only permission_mode and the drive-time re-check; record "DRIFT: queue run stores the resolved tier and sandbox — affects: 21-6, Epic 22 (POST /jobs tier, 22.3 start.ps1)"; accept the other four at score 1; keep the AC test asserting stored tier reads host — rule candidate: When a replan says "store X like <column>", store the value resolved at enqueue unless the story's AC asserts the column is null when X was not given; a config change never re-resolves a queued run.
- 2026-09-28T12:28:31Z — trigger: deviation-gt-0 — question: accept pass-2 deviations (UNC refusal unit-tested, config sandbox not tier-gated)? — ruling: accept-deviation score 1 — do: keep both; record them; add assertion that a stored sandbox beats config (added at test/tier.test.ts:118) — rule candidate: Gate a config entry's fields by tier only where the value changes the safety refusal; single-tier fields follow the plain precedence chain.
- 2026-09-28T12:44:40Z — trigger: deviation-gt-0 — question: accept pass-3 deviations (registry root threaded via Validated/Started → invokeSkill opts.vmHostRoot; e2e symlink keeps the project basename), and at what score? — ruling: accept-deviation score 2 — do: keep both as implemented; record the vmHostRoot DRIFT with affects 21-6, Epic 22, and the symlink DRIFT with affects none; add a unit assertion that on sbx a registry root differing from root drives the cwd and payload directory (already present at test/tier.test.ts:274, no addition needed) — rule candidate: When a fix adds an optional field to an exported run-state type (Validated/Started) or a defaulted parameter to an exported invoker, and a missing value silently falls back to a less-safe default, score it 2 and name the stories that rebuild that state (resume, the POST /jobs path) in affects.


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review of the already-landed 21-4. The tier behaviour is unchanged: host is the default, bypass is refused on the host before any process and before enqueue, sbx runs through `sbx exec <sb> env -u ANTHROPIC_API_KEY -C <vm-root> claude …`, model and effort are override ?? `woke.routing` verbatim, and `finish` gets the studio run id and `--total-cost-usd`. This pass made two changes:
- The sbx VM root now comes from the registry entry root, as the Block If and the README say, not from the caller's spelling of `--directory`.
- The `submit` path's named refusals are now pinned by tests.

**Files changed (this pass):**
- `src/cli.ts`: `validate()` returns `registryRoot`, which is carried on `Started` and passed by `finishRun` to the invoker as `{ vmHostRoot }`.
- `src/server.ts`: `invokeSkill` takes an internal `opts: InvokeOptions` (`vmHostRoot`, not in the `tk_invoke` schema). The sbx `-C`, payload `directory` and deny-profile VM path use it.
- `test/tier.test.ts`: a unit test that the VM cwd, directory and `--settings` come from `vmHostRoot`, not the caller spelling (`:274`).
- `test/command-line.test.ts`: tests that `finishRun` passes the registry root (`:275`); an e2e symlinked `--directory` sbx run (`:1031`); and `submit` refusals for `TierRefused`, `SbxSandboxMissing` and `SupervisorConfigInvalid` (`:995-996`, `:1112`).

**Files changed (story total since `6b973d1`):**
- `src/config.ts` (new)
- `src/env.ts`, `src/server.ts`, `src/queue.ts`, `src/cli.ts`
- `test/tier.test.ts` (new), `test/command-line.test.ts`, `test/queue.test.ts`
- `README.md`

**Review findings (this pass):** both layers ran (band L).
- Patches applied: 2 (high 0, medium 1, low 1).
- Deferred: 0.
- Rejected: 6.
- Follow-up review recommended: **false**, because the score is 3×1 + 1×1 = 4, which is below 5, and no patch was high.
- The implementer's deviation score was 1. The consult (deviation-gt-0) accepted it at score 2.

**Verification** (re-run by this session after the patches):
- `bun install --frozen-lockfile`: no changes
- `bun test` (with `TK_STUDIO_ROOT` set): 259 pass / 0 fail
- `bunx tsc --noEmit`: clean
- the machine-path `git grep`: nothing
- `git diff --stat 6b973d1 -- package.json bun.lock`: empty
- `TK_SUPERVISOR_DB=<tmp>/q.db bun src/cli.ts run studio-health --directory . --permission-mode bypassPermissions`: exit 2, `state: blocked`, `HostBypassRefused`, `runs` count 0

**unverifiable-here** (operator, agent PC):
- AC1 console hosting: from the console-hosted supervisor window, run `bun src/cli.ts run studio-health --directory <root>`, then record the `claude -p` process's session id (it must be non-zero, not Session 0).
- AC5 first sbx run: run `bun src/cli.ts run studio-health --directory <root> --tier sbx --sandbox claude-<project> --permission-mode bypassPermissions`, then `sbx exec claude-<project> bash -lc 'ls -a ~ ; ls ~/.ssh ~/.aws ~/.azure ~/.config/gcloud 2>&1'`. Record that bypass ran and that the credential folders are absent.

**Residual risks:**
- `registryRoot` lives only in memory. A later story that builds `Started` or calls `invokeSkill` without `validate()` (21-6 resume, Epic 22 POST /jobs) falls back silently to the caller root.
- `env -C` inside the VM needs GNU coreutils ≥ 8.28 (not checked live).
- A timeout of `sbx exec` kills only the host process; the VM worker may survive (21-5 tree kill, DW-3).
- On sbx, the Jira backend-auth preflight judges the host env (out of scope here).
- An sbx probe failure reads as `MAX_LOGIN_MISSING (probe failed: …)`, and `drain` leaves the run queued.

DRIFT: `run-options` event covers tier/sandbox/model/effort; permission mode keeps its own `permission-mode` event — preserve 21-3 behaviour — affects: none
DRIFT: queue run stores the resolved tier and sandbox — the AC's "tier reads host"; 21.6 resumes on the same tier and `POST /jobs` takes a tier (consult: score 2) — affects: 21-6, Epic 22 (POST /jobs tier, 22.3 start.ps1)
DRIFT: stored run options also validated before any process against the adopted run; an invalid stored value ends the run `blocked` in drain — sbx preflight must run on the right tier, and no run stays queued forever — affects: none
DRIFT: sbx maps a caller-supplied absolute payload `directory` to its VM path — host path is invisible in the VM — affects: none
DRIFT: `HostBypassRefused` message gains "(bypass is permitted only on the sbx tier)" — names where bypass is allowed — affects: none
DRIFT: a config `permission_mode` applies only when the run's effective tier equals the config entry's tier — stops a stored host tier from mixing with a config sbx bypass — affects: none
DRIFT: UNC sbx refusal pinned by a unit test at resolution, not e2e — a POSIX test host cannot produce a UNC root — affects: none
DRIFT: config `sandbox` is not tier-gated — a single-tier field, and the stored sandbox wins — affects: none
DRIFT: sbx VM root comes from the registry entry root via Validated.registryRoot -> Started.registryRoot -> invokeSkill opts.vmHostRoot (internal, not in the tk_invoke schema); it falls back to the caller root when absent — Block If (plans/21-4.md:127) — affects: 21-6, Epic 22
DRIFT: e2e symlink keeps the project basename so the fallback project id still resolves — test fixture only — affects: none

## Reconcile

### 2026-09-28 — adjust-stories

- Score: 2 (pass 1 and pass 3 consult-accepted at 2; pass 2 at 1).
- Reasoning: Checked against 21-5, 21-6 and Epic 22. Nothing contradicts an AD (AD-2 tier from `TK_SUPERVISOR_CONFIG`/submission only; AD-14 model/effort verbatim; AD-15 env seams), contract 0.1.18 §4 `finish.total_cost_usd` or §5, or a recorded ruling, and no later acceptance criterion must change. Two score-2 DRIFTs name later work: the queue run stores the *resolved* tier/sandbox (plus model/effort), and the sbx VM root is carried in memory only (`Validated.registryRoot` → `Started.registryRoot` → `invokeSkill(…, {vmHostRoot})`), falling back silently to the caller root. A path that rebuilds `Started` without `validate()` (21-6 resume, 22.1 `POST /jobs`) would lose it. The new sbx tier also puts the worker's process tree and session transcript inside the microVM, which 21-5's guards and 21-6's resume read from the host.
- Affected: 21-5 — "the worker's whole process tree is killed" (a host kill of `sbx exec` does not reach the in-VM worker); "`account` is called with the turns and tokens read from the worker's transcript" (on sbx the transcript is in the VM)
- Affected: 21-6 — "each resumes with `--resume <session-id>` on the same tier and branch" (tier/sandbox/model/effort are on the queue run; the VM root must come from `validate()`'s `registryRoot`)
- Affected: 22-1 — "`POST /jobs` … with optional `base_ref`, `tier`, `model`, and `effort` … queued through Story 21.3's validation" (go through `submitJob`'s resolution and refusals, not a parallel path)
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 21-5-guards-and-the-pacer-are-the-wrappers-job
