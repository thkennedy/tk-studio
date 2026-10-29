---
title: 'The Engine MCP Before the First Flagged Run'
type: 'bugfix'
created: '2026-10-29'
status: 'done'
baseline_revision: '865f4e5c9d6ed879a8c78dcfc70b8a220e3e2b7e'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-4.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 34.5's per-run engine MCP takes fixed ports (server `engine.mcp.port`, 8000 on TUA; forwarder `TK_SUPERVISOR_ENGINE_MCP_PORT`, default 8788), so a second flagged run on one box fails `engine-mcp:start-failed`. It also records the start only after `unref`-ing its three children and swallows a failed record, which leaves orphans. Nothing warns when `engine.mcp.start` lacks the verify-only allowlist, and the sandbox-to-forwarder reachability was never proven (the retrospective's B6, B7, AI-5; DW-83's 34.5 debt).

**Approach:** Transcribed from epics.md §Story 35.4 and bound by the SPEC's CAP-7/CAP-8 design notes:
- per-run ports (`port: 0` resolved, `{port}`/`{ws_port}` substituted; the forwarder binds `:0` when the env is unset);
- the start recorded before the `unref`s, with a failed note killing all three children and failing the pin;
- `engine_mcp` named on the release events;
- an `engine mcp` advisory in `launch.py check` and on the pin;
- the contract's 0.1.30 Story 35.4 paragraph;
- the TUA reachability proof asked of the operator through the consult log.

User story: As the loop, I want the per-run engine MCP (34.5) to take per-run ports, record its start before it lets go of its children, kill them on a failed note, warn when a project's `engine.mcp.start` carries no `--exclude-domains`, and prove that the sandbox reaches the forwarder, so that the first editor-in-the-loop run on The Universe Awaits starts clean and verify-only.

**Acceptance criteria (verbatim, epics.md §Story 35.4):**

- **AC1.** **Given** a flagged run's pin **When** the MCP starts **Then** the forwarder and the server take free per-run ports (`port: 0` resolved, `{port}` substituted into `engine.mcp.start`; `env.ts:117-124`, `enginemcp.ts:410`), two flagged runs on one box no longer serialise into `start-failed`, the start is recorded in the queue before the three children are `unref`'d (`enginemcp.ts:447-449`), a failed `queue.note` kills them and ends the pin with the reason, and the release stops them and the event says so
- **AC2.** **Given** a project's tracked config **When** `tk-studio-launch check` or the pin reads an `engine.mcp.start` without `--exclude-domains` (or the server's equivalent filter) **Then** an advisory names the verify-only rule (`kb/engine-mcp-godot.md`) and the run proceeds; the contract (0.1.30, additive) names the per-run ports and the advisory
- **AC3.** **Given** TUA on the box **When** the operator runs one flagged run at the engine's request through the consult log **Then** the sandbox's call reaches `127.0.0.1:<port>/mcp` through the forwarder behind the per-run bearer (the reachability proof the 34.5 spec left open) and `kb/engine-mcp-godot.md` records it; the supervisor suites cover the ports, the record-before-unref and the kill with fakes

## Boundaries & Constraints

**Always:**
- Settled shape (SPEC design notes CAP-7/CAP-8, binding):
  - A positive `engine.mcp.port` keeps its 34.5 meaning: pre-checked, and `{port}` is replaced with it when present.
  - `port: 0` resolves a free `127.0.0.1` port (and `{ws_port}` only when the start line carries it).
  - A set `TK_SUPERVISOR_ENGINE_MCP_PORT` keeps the forwarder fixed. Unset or blank means bind `:0`, with the port read from `engine-mcp-forwarder ready <port>`.
  - `engine-mcp-start`/`-stop` gain `port`, `forwarder_port` and `ws_port?`. `engine-mcp-start` also gains `advisory?`.
  - `pin-released`/`pin-kept` gain `engine_mcp?: "stopped" | "stop pending"`, only when the run has an `engine-mcp-start`.
  - Optional `engine.mcp.filter`, default `--exclude-domains`. It matches a token `<filter>` or `<filter>=…`.
  - The `engine mcp` launch row comes after `story plans`, is never a gap, and uses exactly the three texts of the CAP-8 note.
- `port: 0` with no `{port}` in `engine.mcp.start` is `engine-mcp:no-config` (`engine.mcp.start has no {port} for port: 0`).
- `queue.note(ENGINE_MCP_START)` runs before `live.set`, the `onExit` hooks and the three `unref?.()` calls. On a throw: `killInOrder` all three, then `failed("the start could not be recorded: <clipped>")`.
- The `portAnswers` pre-check and `awaitPort`'s other-listener detection stay as race guards.
- House rules: lib is stdlib-only via `uv run`, writes are atomic, headless surfaces end in a status block, no credential lands in an event or a file, and the plugin never imports a driver.
- Contract change is additive only: a new `**0.1.30 (Story 35.4, additive).**` paragraph after 35.3's, a header clause, and `Story 35.4` in the Stories row. The 0.1.29 Story 34.5 sentences stay untouched.

**Block If:**
- Making two concurrent real runs work would need a WebSocket-port env var for the godot-ai add-on that nothing documents. In that case, consult; do not invent one. The fakes' two-run test is the AC's bar, and the gap is recorded in the kb and the 35.4 paragraph as `measured on the box only`.
- Moving the note before `unref` breaks the `recoverEngineMcps` consult-ruling-2 tests (`enginemcp.test.ts` ~:535-610) in a way that needs changed recovery semantics.

**Never:**
- Write to TUA (its config edit is the operator's).
- Change sbx network policy.
- Fall back silently to a fixed port.
- Refuse or ignore a fixed port.
- Refuse a start for the advisory.
- Expose scene-editing tools.
- Touch DW-100/DW-101 (`board.ts`/`planstatus.ts`).
- Push, tag, or run the release motion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| per-run | `port: 0`, start has `{port}`, env port unset | free server port substituted; forwarder on `:0`; URL and event carry the real ports | none |
| ws_port | start also has `{ws_port}` | second free port substituted; `ws_port` on events | none |
| fixed | `port: 8000`, start has `{port}` or a literal | pre-checked; `{port}`→8000; `port: 8000` on event | port busy → `start-failed` as today |
| no `{port}` | `port: 0`, no `{port}` token | nothing spawned | `engine-mcp:no-config` |
| two runs | two flagged pins on one fake box | both start, distinct ports | none |
| note throws | `queue.note` throws | all three killed, no unref, no `live` entry | `start-failed`: `the start could not be recorded: …`; pin fails / `StartError` |
| no filter | start lacks `--exclude-domains` (or `filter`) | start proceeds, `advisory` on `engine-mcp-start` | never refused |
| release | run with `engine-mcp-start` | `engine_mcp: "stopped"` or `"stop pending"` on `pin-released`/`pin-kept` | absent when no MCP started |
| launch row | no `engine.mcp` / filter present / missing / fixed port / flow-style YAML | CAP-8 texts; flow style → `warning: .tk-studio/config.yaml unreadable by the lib's YAML subset (<err>); write engine.mcp in block style` | `ok` always true |

</intent-contract>

## Code Map

The plan's Code Map (`plans/35-4.md`) is the investigation; anchors verified at baseline (+2 drift in `enginemcp.ts`):
- `apps/supervisor/src/enginemcp.ts`:
  - header :1-51 (update the `config`/`start`/`events`/`stop` paragraphs);
  - `EngineMcpConfig` :97 (+`filter`); `EngineMcpDeps` :103 (+`freePort?`);
  - `parseEngineMcp` :183 (admit `port: 0`, `filter`);
  - `spawnForwarder` :259 (`ready` must carry the bound port);
  - `portAnswers` :284, `awaitPort` :296;
  - `forwardMain` :345 (admit 0);
  - `killInOrder` :378;
  - `startEngineMcp` :387-476 (`engineMcpPort` :408, pre-check :410, argv `{worktree}` ~:413, `awaitPort` :422, `spawnForwarder` :435, `unref` :447-449, `queue.note` :469 in a swallowing try);
  - `openStart` :478, `stopDetail` (gains the ports), `stopEngineMcp` :511, `recoverEngineMcps` :531.
  - New `freeLoopbackPort()` via `node:net` `listen(0,"127.0.0.1")`.
  - Use `splitCommand` from `hostverify.ts` for the advisory token check.
- Callers of `startEngineMcp` (read-only): `cli.ts` ~:1458 (drained path → `StartError`) and ~:1757 (the recorder's pin fails on a refusal).
- `apps/supervisor/src/env.ts`: `DEFAULT_ENGINE_MCP_PORT` :117 and `engineMcpPort` :121-124. Unset or blank returns `0`; keep the constant for docs.
- `apps/supervisor/src/sandbox.ts`: `releasePin` :168-195. `stopEngineMcp` :176 currently ignores the bool. Record `engine_mcp` on `pin-kept` :183 and `pin-released` :191 only if an `engine-mcp-start` event exists.
- `plugins/tk-studio/lib/launch.py`: rows are built at :1060-1069. Add `engine_mcp_row(root)` after `story_plans_row` (:977, called :1069), following the `playable_path_row` (:774) pattern of `CONFIG_REL` + `miniyaml.load`. Use `shlex.split(posix=True)`. The docstring advisory list is at :50-95. `miniyaml` refuses flow collections (`miniyaml.py:111`).
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md`: the check rows.
- `plugins/tk-studio/contracts/driver-contract.md`: header line :5 (clause after 35.3's), Stories row :6, the 35.3 paragraph :1767, `## 8. Conformance` :1826.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: model `test_0_1_30_story_35_3_slice_hardened` :2617. Pin 35.3 < 35.4 and relax 35.3's exact Stories-row check only to admit 35.4.
- Tests: `apps/supervisor/test/enginemcp.test.ts` (fakes `deps.spawn`/`spawnEditor`/`checkBind`/`startTimeoutMs`, blocks :155-747), `apps/supervisor/test/sandbox.test.ts`, `plugins/tk-studio/lib/tests/test_launch.py`.
- Docs:
  - `kb/engine-mcp-godot.md`: :94-107 TUA's line becomes block style with `port: 0` and `--port {port} --ws-port {ws_port}`. Add a new `## Reachability proof (Story 35.4)` section reading `pending: asked through 35-4's consult log`, plus the add-on WebSocket-port gap `measured on the box only`.
  - `kb/agent-pc-setup-runbook.md`: :1087 env row and §4.8 :1362-1414. Ports are per run by default. A set env or a fixed `engine.mcp.port` means one flagged run at a time. If the sbx policy allows by host:port, set `TK_SUPERVISOR_ENGINE_MCP_PORT`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/env.ts` -- `engineMcpPort` unset/blank → 0 -- CAP-7 forwarder per run
- `apps/supervisor/src/enginemcp.ts` -- parse 0 and `filter`; `freePort` dep; resolve and substitute `{port}`/`{ws_port}`; `no-config` for port 0 without `{port}`; forwarder `:0` reporting its bound port; note before `live.set`/`unref` with kill-on-throw; `port`/`forwarder_port`/`ws_port?`/`advisory?` on events; header -- AC1, AC2
- `apps/supervisor/src/sandbox.ts` -- `engine_mcp` on release events -- AC1 "the event says so"
- `apps/supervisor/test/enginemcp.test.ts` -- the plan's eight cases (parse; substitution; two runs distinct ports; fixed pre-check; forwarder `:0` URL; note-before-unref call order; throwing note kills three + refuses; advisory with/without filter) -- AC1, AC3 fakes
- `apps/supervisor/test/sandbox.test.ts` -- `engine_mcp` on `pin-released`/`pin-kept`, absent without a start -- AC1
- `plugins/tk-studio/lib/launch.py` + `plugins/tk-studio/lib/tests/test_launch.py` + `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- the `engine mcp` row in every state of the matrix, docstring and skill row -- AC2
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.30 Story 35.4 paragraph (per-run ports, fixed-port rule, event fields, record-before-unref/kill, `engine.mcp.filter`, both advisories, ws-port gap measured on the box only), header clause, Stories row, `test_0_1_30_story_35_4_engine_mcp_ports` -- AC2
- `kb/engine-mcp-godot.md` + `kb/agent-pc-setup-runbook.md` -- block-style TUA line, reachability-proof section (pending), §4.8 and env row -- AC3

**Acceptance Criteria:**
- Given `port: 0` and an unset forwarder env, when two flagged runs pin on one fake box, then both `engine-mcp-start` events carry distinct `port`/`forwarder_port` and neither is `start-failed`.
- Given a fake child recording call order, when the MCP starts, then `queue.note(engine-mcp-start)` precedes every `unref`; given a throwing note, all three children are killed and the result is `start-failed` with `the start could not be recorded`.
- Given a run with an `engine-mcp-start`, when its pin is released or kept, then the event carries `engine_mcp`.
- Given a config whose start lacks the filter, when `launch.py check` runs or the pin starts, then the advisory names `kb/engine-mcp-godot.md`, and both the status block and the start proceed.
- Given the contract, when conformance and `test_driver_contract` run, then the 35.4 paragraph is pinned after 35.3 and `ok: true`.
- AC3's TUA proof is `unverifiable-here`: it is asked through `## Consult Log`, and the kb section reads `pending`.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 3, low 3)
- defer: 0
- reject: 1: (low 1)
- addressed_findings:
  - `[medium]` `[patch]` `launch.py engine_mcp_row` reads `port per-run`/`fixed None`/the default filter for configs `parseEngineMcp` refuses (`port: 0` without `{port}`, missing/non-int port, malformed `filter`): the row must not report a config the pin refuses as fine. Mirror the pin's refusal as a warning naming `engine-mcp:no-config` (edge-case + blind)
  - `[medium]` `[patch]` 0.1.30 Story 35.4 contract paragraph says unset means `:0`, but not that this supersedes 0.1.29's default `8788`. Add the supersession and the by-hand-allowed-8788 note (blind)
  - `[medium]` `[patch]` `kb/engine-mcp-godot.md`: TUA's line uses `--ws-port {ws_port}` while the add-on's adoption of a non-default ws port is unmeasured. Name the fallback for the operator's proof step (a literal `--ws-port 9500`, one flagged run at a time, if the editor never adopts the server) (blind)
  - `[low]` `[patch]` `launch.py`: a `shlex.split` ValueError (unbalanced quote) reads as a missing filter while the pin's `splitCommand` tolerates it. Fall back to a quote-tolerant split (edge-case)
  - `[low]` `[patch]` `enginemcp.ts`: the forwarder bind-failure reason prints the requested `:0`. Name the per-run request truthfully (blind)
  - `[low]` `[patch]` the contract-named `null` ports on a stop of a pre-0.1.30 start are untested. Add one test via a recorded start without ports (blind)
- rejected: forwarder `unref` unobserved in the order test — already ruled accept-deviation score 1 (consult 08:31:57Z)

### 2026-10-29 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both run); the 211 KB diff (`865f4e5..` minus `_bmad-output/`) was handed to both layers as a file path, not inline. The contract's single-line paragraphs make it too large to inline.
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 4: (low 4)
- addressed_findings:
  - `[low]` `[patch]` 0.1.30 Story 35.4 contract paragraph lists the `engine mcp` row's values but omits `warning: <the pin's reason>; the pin refuses engine-mcp:no-config`, which `launch.py` and SKILL.md emit. Added to the contract and pinned in `test_0_1_30_story_35_4_engine_mcp_ports` (blind)
  - `[low]` `[patch]` `startFailedResolves` hint read `serve on 127.0.0.1:0` (or a random resolved port) for `port: 0`, and named `TK_SUPERVISOR_ENGINE_MCP_PORT` when it is unset. The hint now follows the configured port (per-run `{port}` wording) and whether the variable is set. Tests cover per-run before and after resolution, fixed+set (unchanged text) and fixed+unset (blind; consult 09:01:08Z)
  - `[low]` `[patch]` `engineMcpPort` unset/blank → 0 is a contract statement but was never called directly in a test. Added unset, blank, whitespace, valid and invalid cases (blind)
  - `[low]` `[patch]` `launch.py _split_command` tried `shlex.split` first, so a backslash (`srv \--exclude-domains`) read as filter-present in the row while the pin's `splitCommand` (no escapes) warned. Now always the `splitCommand`-equivalent tokenizer; `import shlex` dropped; backslash test added (edge-case)
- rejected: unset `TK_SUPERVISOR_ENGINE_MCP_PORT` now per-run, not 8788 — the AC's intent ("the forwarder and the server take free per-run ports"), the contract's supersession and the runbook name it
- rejected: advisory/row `port per-run` ignores a fixed forwarder — the contract pins the row's `port <per-run|fixed <n> …>` as `engine.mcp.port`; the forwarder's port is the supervisor env's, recorded as `forwarder_port`, and `launch.py check` cannot see it
- rejected: no pre-check on the resolved `{ws_port}` — a taken ws port fails the server's bind and surfaces as `start-failed` with the children killed; the HTTP pre-check guards against a foreign listener passing for the server, which has no ws analogue
- rejected: `## Reachability proof (Story 35.4)` reads `pending` — AC3 is `unverifiable-here` by design, asked of the operator through the consult log

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && bun test test/enginemcp.test.ts test/sandbox.test.ts && bunx tsc --noEmit` -- expected: green
- `cd apps/supervisor && bun test` -- expected: no new failure against the pre-existing set

## Deviation Summary

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T080802Z-a5350e` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-10-29, implementer)

- planned: relax only 35.3's exact Stories-row check to admit 35.4 / actual: also relaxed the Stories-row regexes in `test_0_1_30_story_35_2_plans_and_records` and `test_0_1_30_story_35_8_stage_log` (same file) / why: both already pinned the row and broke once `Story 35.4` was appended / may affect: 35-5
- planned: `{ws_port}` resolved under `port: 0` only when the start line carries it / actual: `{ws_port}` resolved whenever the start line carries it, also with a fixed positive port / why: otherwise a literal `{ws_port}` reaches the server's argv / may affect: none
- planned: the test that the record precedes every unref / actual: fakes observe the server's and editor's `unref`; the forwarder (no injectable seam) is checked by its port no longer answering after the kill / why: `spawnForwarder` has no seam and the spec named none to add / may affect: none
- planned: `filter` optional, default `--exclude-domains` / actual: a present but empty, non-string or multi-token `filter` is `engine-mcp:no-config` (`engine.mcp.filter is not one flag`) / why: a malformed optional key follows the existing malformed-config refusal / may affect: none
- planned: `engine-mcp-stop` gains `port`/`forwarder_port`/`ws_port?` / actual: a stop of a pre-35.4 start carries `port`/`forwarder_port: null`; the contract paragraph says so / why: old start events hold no ports / may affect: none

DEVIATION SCORE: 1

DRIFT: Stories-row regexes in the 35.2 and 35.8 contract tests relaxed too — both pinned the row exactly and broke on `Story 35.4` — affects: 35-5
DRIFT: `{ws_port}` substituted with a fixed port too — a literal `{ws_port}` would otherwise reach the server argv — affects: none
DRIFT: forwarder's unref order not observed directly; its kill checked by its port going silent — no forwarder seam — affects: none
DRIFT: malformed `engine.mcp.filter` refused `engine-mcp:no-config` — existing malformed-config rule — affects: none
DRIFT: stop of a pre-35.4 start carries `port`/`forwarder_port: null` — old start events hold no ports — affects: none

### pass 2 (2026-10-29, review-patch implementer)

- planned: the row mirrors the pin's port and filter refusals / actual: it mirrors every `parseEngineMcp` no-config check; a null or non-mapping `engine.mcp` now reads `warning: engine.mcp is not a mapping; the pin refuses engine-mcp:no-config` (was `not configured`) / why: the pin refuses that config (`enginemcp.ts:207`) / may affect: none
- planned: contract wording "only sets the variable to `8788`" / actual: "needs only to set `TK_SUPERVISOR_ENGINE_MCP_PORT` to `8788`" / why: clearer sentence, same meaning / may affect: none

DEVIATION SCORE: 1

DRIFT: `engine mcp` row mirrors every pin no-config check, null `engine.mcp` included — the pin refuses it, so `not configured` would promise a run that blocks — affects: none
DRIFT: 0.1.30 Story 35.4 supersession sentence reworded — clarity, meaning unchanged — affects: none

### pass 3 (2026-10-29, follow-up review-patch implementer)

- planned: a fixed port keeps today's `start-failed` resolves text / actual: the forwarder half follows whether `TK_SUPERVISOR_ENGINE_MCP_PORT` is set, so a fixed server port with the variable unset reads the per-run forwarder wording; fixed+set is byte-identical / why: the brief's "keep today's text" and "forwarder half accurate when unset" conflict in that case; the contract pins no `resolves` text / may affect: none (consult 09:01:08Z: accept-deviation score 1)

DEVIATION SCORE: 1

DRIFT: `start-failed` resolves forwarder half follows whether TK_SUPERVISOR_ENGINE_MCP_PORT is set, fixed+unset included — the old text names an unset variable — affects: none

## Consult Log

- 2026-10-29 — operator ask (AC3, tier ask, `unverifiable-here`): on the box, apply TUA's block-style `engine.mcp` (`port: 0`, `--port {port} --ws-port {ws_port}`) through a TUA PR or the operator's own step, then submit one flagged run. From the sandbox, run `curl -sS -X POST "$TK_ENGINE_MCP_URL" -H "Authorization: Bearer $TK_ENGINE_MCP_BEARER" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"editor_state","arguments":{}}}'`. Expect a 200 answer through the forwarder on `TK_SUPERVISOR_BIND:<forwarder_port>`, which reaches `127.0.0.1:<port>/mcp`, and a 401 without the bearer. Record both, with the ports from `engine-mcp-start`, under `kb/engine-mcp-godot.md` `## Reachability proof (Story 35.4)`. Also note whether the add-on followed `{ws_port}`.
- 2026-10-29T08:31:57Z — trigger: deviation-gt-0 — question: accept or reject the implementer's five score-1 deviations (35.2/35.8 Stories-row regexes relaxed, {ws_port} with a fixed port, forwarder unref unobserved, malformed filter refused no-config, null ports on a pre-35.4 stop)? — ruling: accept-deviation score 1 — do: accept all five as recorded, keep DEVIATION SCORE 1 | at 35.5 dev pass, widen the same three Stories-row regexes by one optional (, Story 35\.5)? group | no code changes for 2–5 — rule candidate: contract tests pinning the 0.1.30 Stories row use one prefix regex with a trailing optional-later-stories group so appending a story is never a deviation
- 2026-10-29T08:48:04Z — trigger: deviation-gt-0 — question: accept or reject the patch pass's score-1 deviations (row mirrors every pin no-config check incl. null engine.mcp; contract sentence reworded)? — ruling: accept-deviation score 1 — do: keep the row as is (null/non-mapping mcp → `warning: engine.mcp is not a mapping; the pin refuses engine-mcp:no-config`) | keep `not configured` for no file, no engine mapping, no mcp key | keep the contract wording; add a test pinning the null-mcp case (added: `test_engine_mcp_null_reads_the_pins_not_a_mapping_refusal`) — rule candidate: a launch advisory row for a pin-side config reads `not configured` only where the pin's parser returns null; every pin refusal reads `warning: <pin reason>; the pin refuses <class>`
- 2026-10-29T09:01:08Z — trigger: deviation-gt-0 — question: follow-up review patch pass: accept or reject the score-1 deviation where `startFailedResolves`'s forwarder half follows whether TK_SUPERVISOR_ENGINE_MCP_PORT is set, so a fixed server port with the variable unset no longer keeps today's exact text (brief "fixed port keeps today's text" vs "forwarder half accurate when unset")? — ruling: accept-deviation score 1 — do: keep `startFailedResolves` as written (server half follows `engine.mcp.port`, forwarder half follows whether the variable is set) | add an assertion in the "start-failed resolves" test for a fixed server port with the variable unset, expecting `127.0.0.1:<p>` plus the per-run forwarder wording | record the deviation as score 1, affects: none; read "keep today's text" as the fixed-port-with-variable-set case — rule candidate: when a brief's "keep today's exact text" conflicts with "make it accurate" in a `resolves` hint the driver contract does not pin, keep the text exact only where its facts still hold, accurate elsewhere, scored 1 with no consult

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-29T06:22:38Z | 2026-10-29T06:26:02Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-29T08:09:48Z | 2026-10-29T08:48:55Z | 0e99d1cc-7e30-4eee-89d3-125b1d27854f | claude-opus-5-5 | medium | 17936888 | 125051 | 9.9986 | completed |
| review | 1 | 2026-10-29T08:48:55Z | 2026-10-29T09:03:08Z | f4dbbe9b-fae6-4bda-936b-d16f6b52ee3b | claude-opus-5-5 | medium | 4893405 | 57428 | 4.6150 | completed |
| gate | 1 | 2026-10-29T09:03:08Z | 2026-10-29T09:17:32Z | bd5cc1fd-f1b6-49e2-b941-8ba1d3476c13 | claude-opus-5-5 | medium | 9167818 | 73728 | 5.6072 | completed |


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory <root>` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass on the landed 35.4 change (a47abe8). The 35.4 change itself gave the per-run engine MCP:
- per-run ports;
- the start recorded before the children are let go, and killed on a failed note;
- `engine_mcp` on the release events;
- the `engine mcp` verify-only advisory;
- the contract's 0.1.30 Story 35.4 paragraph.

This pass applied four low-severity patches:
- The contract now names the row's pin-refusal value.
- The `start-failed` hint is accurate for `port: 0` and for an unset forwarder variable.
- `engineMcpPort` unset/blank → 0 is unit-tested.
- The launch row tokenizes `start` exactly as the pin's `splitCommand` does (no backslash escapes).

**Files changed (this pass):**
- `apps/supervisor/src/enginemcp.ts`: `startFailedResolves(configured, env)` follows the configured port and whether `TK_SUPERVISOR_ENGINE_MCP_PORT` is set.
- `apps/supervisor/test/enginemcp.test.ts`: two new tests. The resolves test covers per-run before and after resolution, fixed+set and fixed+unset. The `engineMcpPort` test covers unset, blank, valid and invalid values.
- `plugins/tk-studio/lib/launch.py`: `_split_command` always uses the `splitCommand`-equivalent tokenizer; `import shlex` dropped; docstrings updated.
- `plugins/tk-studio/lib/tests/test_launch.py`: `test_engine_mcp_backslash_is_not_an_escape_as_in_the_pin`.
- `plugins/tk-studio/contracts/driver-contract.md`: the Story 35.4 advisory paragraph names `warning: <the pin's reason>; the pin refuses engine-mcp:no-config`.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: `test_0_1_30_story_35_4_engine_mcp_ports` pins it.

**Review:** one follow-up pass, both layers run (band L).
- Patches: 4 applied (high 0, medium 0, low 4).
- Deferred: 0.
- Rejected: 4 (low): the per-run default is intended; the row's `port` is contract-pinned as `engine.mcp.port`; a ws-port bind failure surfaces as `start-failed`; AC3 is operator-only.
- Follow-up review score: 3×0 + 1×4 = 4 < 5, and no high finding, so `followup_review_recommended: false`.

**Verification:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: Ran 2443, OK (skipped=4). Re-run by this session.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`. Re-run by this session.
- `bun test test/enginemcp.test.ts test/sandbox.test.ts`: 118 pass, 6 skip, 5 fail. The 5 are the pre-existing `release: sbx stop …` cases, which also fail at baseline `865f4e5`. Re-run by this session.
- `bunx tsc --noEmit`: exit 0. Re-run by this session.
- Full `bun test` (implementer): 1532 pass, 83 skip, 25 fail. The 25 match the pre-existing environmental set; the 2 extra passes are the new tests.

**unverifiable-here (AC3):** the TUA reachability proof is still the operator's, asked in `## Consult Log` (first entry, with the exact curl). `kb/engine-mcp-godot.md` `## Reachability proof (Story 35.4)` reads `pending` until it is recorded.

**Residual risks:**
- Nobody has measured whether the godot-ai add-on follows a non-default `--ws-port`. The kb's fallback is a literal `--ws-port 9500`, one run at a time.
- A sandbox policy that allows only one host:port needs `TK_SUPERVISOR_ENGINE_MCP_PORT` set (runbook §4.8). The advisory's `port per-run` describes `engine.mcp.port` only.
- The 35.5 implementer widens the three Stories-row regexes by `(, Story 35\.5)?` (consult 08:31:57Z).

DRIFT: Stories-row regexes in the 35.2 and 35.8 contract tests relaxed too — both pinned the row exactly and broke on `Story 35.4` — affects: 35-5
DRIFT: `{ws_port}` substituted with a fixed port too — a literal `{ws_port}` would otherwise reach the server argv — affects: none
DRIFT: forwarder's unref order not observed directly; its kill checked by its port going silent — no forwarder seam — affects: none
DRIFT: malformed `engine.mcp.filter` refused `engine-mcp:no-config` — existing malformed-config rule — affects: none
DRIFT: stop of a pre-35.4 start carries `port`/`forwarder_port: null` — old start events hold no ports — affects: none
DRIFT: `engine mcp` row mirrors every pin no-config check, null `engine.mcp` included — the pin refuses it — affects: none
DRIFT: 0.1.30 Story 35.4 supersession sentence reworded — clarity, meaning unchanged — affects: none
DRIFT: `start-failed` resolves forwarder half follows whether TK_SUPERVISOR_ENGINE_MCP_PORT is set, fixed+unset included — the old text names an unset variable — affects: none

## Reconcile

- 2026-10-29 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 35-5-the-sandbox-and-the-host-agree
