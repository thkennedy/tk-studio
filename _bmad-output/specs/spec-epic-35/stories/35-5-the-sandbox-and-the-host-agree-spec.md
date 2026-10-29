---
title: 'The Sandbox and the Host Agree'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '698218e5887b9401328ac8adfd37c5c88765fe3b'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-5.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The engine's sandbox gate and the host's gate disagree for reasons unrelated to the code under test: 15 Story 32.8 delivery tests are red only in the sandbox, two eval cases cannot run on the host, a bare `godot` on the host leg reaches WinGet's GUI build, and an unplaced engine job can be claimed on the host tier (holes 78, 84, 85, 90; DW-78, DW-80, DW-81; the retrospective's C1, C6, C7, AI-7).

**Approach:** Fix the delivery tests' fake env, ship a `maintenance-evals` sibling job type over a new `tk-studio-evals` surface on the sandbox tier, put a `godot` shim on the engine step's PATH, write the plugin's sandbox and Windows notes, and add `requires: {tier}` to job definitions with a `placement:TierRequired` refusal at submit; contract 0.1.30 gains an additive Story 35.5 paragraph.

**User story (epics.md §Story 35.5, verbatim):** As the operator, I want the gates the engine runs in the sandbox and the gates the host runs to disagree only on what the box has: the 15 delivery tests red only in the sandbox reproduced and fixed, the eval cases that need a shell or the repository tree run on the sandbox tier through a job, a `godot` shim on the engine step's PATH, and the plugin's Windows notes for sandbox-written tests, So that the engine can trust its own suite and an acceptance record names a tier that works (holes 78, 84, 85; DW-78, DW-80, DW-81; the retrospective's C1, C6, C7, AI-7).

**Acceptance criteria (epics.md §Story 35.5, verbatim):**

- **AC1.** **Given** the sandbox `claude-tk-studio` at main **When** `bun test test/delivery.test.ts` runs there **Then** the 15 Story 32.8 closeout-pass tests pass, the cause reproduced and fixed in the tests or the code (a path, a locale, the sandbox's bun at `~/.bun/bin`, whichever it is) and named in the plugin's sandbox notes, so the engine's gate may run the whole supervisor suite again (hole 84, DW-80)
- **AC2.** **Given** the plugin's eval cases **When** the shipped `maintenance-conformance` job type (or a `maintenance-evals` sibling of it) runs on the sandbox tier **Then** it runs `claude plugin eval` for the cases the host cannot (`tk-studio-playable-judge-verdict`, `asset-ladder-generated-rung`: the sandbox has the tree and a shell), writes the scores to the run workspace and a `job-run` ledger line, and `kb/acceptance-record-34-8-vertical-slice-on-tua.md`'s step 7 names the tier per case, the host keeping `gds-engine-godot-4-pinned-facts` (hole 85, DW-81); the operator queues it once and fills the record's eval row
- **AC3.** **Given** the engine step of the host leg and the plugin's docs **When** a project's command calls a bare `godot`, and when a sandbox-written test reaches the host **Then** the step's PATH holds a tk-studio shim named `godot` that execs `$env:GODOT` (or the leg refuses a bare `godot` with the reason; the planner picks and the runbook row says which; hole 78, DW-78), and the plugin's Windows notes for sandbox-written tests name case-folding file systems, PATHEXT, YAML backslashes, HKCU reads and append-mode handles (holes 74, 77, 82, 83) with one lib-suite example each that runs on Windows
- **AC4.** **Given** an engine job type (`run-epic`, `run-vertical-slice`, 35.7's `run-sweep`) **When** a project submits an instance of it with no per-job placement on the sandbox tier (hole 90: an unplaced `run-epic-35` claimed on the host tier and ran the launch skill as a host `claude -p` for five turns before blocking) **Then** the job type declares the tier it requires (`requires: {tier: sbx}` in `job.schema.json`, additive) and `submit` refuses a host placement for it with `placement:TierRequired` before any process starts; the contract (0.1.30, additive) and the runbook's planning checklist name the supervisor's per-job config entry

**Planner's picks (SPEC Design notes CAP-9..CAP-12, plans/35-5.md Settled shape):** AC2 = the `maintenance-evals` sibling; AC3 = the shim (not the refusal).

## Boundaries & Constraints

**Always:**
- The plan's Files list (plans/35-5.md `## Files`) is the boundary; any other file is a deviation recorded as `DRIFT:`. The two "dev picks" lib test files (YAML-backslash, append-mode) count as in-list.
- Stdlib-only Python via `uv run`; atomic writes; every headless surface (incl. `evals.py run`) ends in the JSON status block (AD-11); nothing in the plugin imports a driver/supervisor/Hermes (AD-2).
- Contract changes are additive at 0.1.30; `driver-contract.md` and its conformance surface update in this story (AD-19).
- Widen the four 0.1.30 Stories-row pins in `test_driver_contract.py` (:2533, :2611, :2677, and 35.4's `assertIn` → `assertRegex`) by one optional `(, Story 35\.5)?` group (35-4 consult 08:31:57Z) — score 0, not a deviation.
- A test's injected env carries every variable production reads; never rely on inheriting it from `process.env`.
- `GODOT` unset or not absolute keeps 0.1.29 behaviour exactly; the existing unset-`GODOT` cases stay as they are.
- `run-epic.json` and `run-vertical-slice.json` stay identical minus id/description.

**Block If:**
- The Files list grows past the plan's (the `halt` consult).
- Adding `tk-studio-evals` needs a status-block schema change, or a surface count pinned beyond `test_driver_contract.py`, `released-roster.json`, `manifest.json`.
- approve's job step cannot carry `placement:TierRequired` through its existing refusal path without a new event shape.
- A nested `claude plugin eval` inside the sandbox worker needs a credential or permission the worker lacks (never add `--dangerously-skip-permissions`).

**Never:**
- Set `TK_STUDIO_ROOT` suite-wide to "fix" AC1.
- Touch the 0.1.29 Story 34.1 sentences pinned by `test_driver_contract.py`; name the shim's supersession in the 35.5 paragraph only.
- Fix the 10 residual sandbox-only supervisor failures unless they share the env-leak cause (then a test-only fix + DRIFT); otherwise name them in the notes.
- Loosen `requires` for approve-minted runs; touch TUA's `scripts/engine-gate.sh`; DW-46..DW-65.
- Push, tag, PR, release, or bump versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delivery suite, sandbox shape | `TK_STUDIO_ROOT` unset, `bun test test/delivery.test.ts` | 25 pass, 0 fail | — |
| Unplaced engine job | `run-epic` instance, no explicit/stored/config placement | submit throws `placement:TierRequired`, reason names `jobs.<project-id>/<job-id> {tier: "sbx", sandbox: "<name>"}` in `TK_SUPERVISOR_CONFIG`; nothing enqueued or spawned; `POST /jobs` 400 by name | named refusal |
| Placed engine job | config entry `{tier: "sbx", sandbox}` | enqueued as today | — |
| `requires` malformed | `requires: "sbx"`, `{tier: "vm"}`, `{tier:"sbx", x:1}` | `validate_definition` error | definition invalid |
| Bare `godot` argv[0] | `GODOT` absolute file, engine `godot --version` | spawned as `$GODOT`; `engine.godot_shim` = shim dir | — |
| `godot` inside a script | `GODOT` absolute, engine `sh -c 'godot --version'` | reaches `$GODOT` through the shim dir (prepended before the `GODOT` folder) | — |
| No `GODOT` | `GODOT` unset or relative | no shim, no `godot_shim`; bare `godot` still "failed to start" as in 0.1.29 | unchanged |
| Evals run | fake `claude` via `CLAUDE_BIN`, two cases, runs 3 | one argv per case; `<out>/<case>.json` each; `<out>/scores.json` `{cases: {<c>: {runs, passed, score}}, cli}`; status block `artifacts` ⊇ scores.json, `reason` `<c> <passed>/<runs>; …` | eval exit 1 is a score, not a refusal; missing CLI → status-block failure |

</intent-contract>

## Code Map

The plan (`plans/35-5.md` `## Code Map`, loaded as context) is the investigation; anchors re-checked at baseline `698218e`. Key points:

- `apps/supervisor/test/delivery.test.ts:137` -- `deps()` env `{ ...process.env, GH_BIN, TK_SUPERVISOR_NOTIFY }`: add `TK_STUDIO_ROOT` (a `temp()` dir or `resolve(import.meta.dir, "..", "..", "..")`). Cause chain: `delivery.ts:281/:303` → `studioScript` (`worktree.ts:127`) → `pluginRoot`/`studioRoot` (`env.ts:32-36`) throws `StudioRootMissing`, swallowed by `closeoutPass` (:387-397).
- `apps/supervisor/src/hostverify.ts` -- `GODOT` read :434-435, `godotDir` prepend :442, `resolveBare` :349 / :444, `runStep` temp dir `tk-sup-hv-` :371, engine member :437-447 (add `godot_shim`). Tests: `test/hostverify.test.ts` Story 34.1 block :340-515 (fixtures `fakeGodot`, `bareEnv`, `recorder`; `test/fakes.ts`), win32 case beside :471, bash-skip pattern :978.
- `apps/supervisor/src/cli.ts:977-999` -- `submitJob`: `resolveBeforeStart` :992, `validate()` :993, editor-in-the-loop refusal :995 (precedent), `queue.enqueue` :999; second submit path at :1411 (check it carries the same refusal); `placementRefusal` :1269-1276; `engagementPlacement` :790-808 (host fallback for approve-minted `run-epic-N`).
- `apps/supervisor/src/server.ts:381, :389` -- `TierRefused`/`SbxSandboxMissing`: add `TierRequired` beside. `src/api.ts:259` -- `NAMED_REFUSALS`: add `TierRequired`. `src/config.ts:1-17, :31-34, :86` -- the per-job entry shape for the reason.
- Tests to extend: `test/tier.test.ts`, `test/command-line.test.ts` (:1253, :1280-1283), `test/api.test.ts` (:238-249, :980, :1025), `test/approve.test.ts` (:92, :179 expect the host fallback — give them an sbx config entry or assert the named refusal).
- `plugins/tk-studio/contracts/job.schema.json` `definition.fields` :6-54 -- add `requires` beside `editor_in_the_loop` (:33). `lib/job.py` `validate_definition` :223 (type check like :256-258). `lib/tests/test_job.py:217/:226`.
- `plugins/tk-studio/jobs/run-epic.json`, `run-vertical-slice.json` -- `"requires": {"tier": "sbx"}` (parity pinned by `contracts/conformance/e2e_vertical_slice.py:66-83`, `test_driver_contract.py:2394-2396`).
- New: `jobs/maintenance-evals.json` (one-shot, `requires`, `target.skill: "tk-studio-evals"`, payload `{cases, runs: 3}`, guards from `run-epic.json`, `max_wall_clock_seconds` ≥ 3600, `effort: low`); `skills/tk-studio-evals/SKILL.md` (thin); `lib/evals.py run` (`CLAUDE_BIN` honoured; argv `claude plugin eval <plugin root> --trust-plugin --allow-tools Bash Write --no-publish --case <c> --runs <n> --json <out>/<c>.json`, `--threshold 0` or read JSON either way); `lib/tests/test_evals.py`.
- Scores to workspace/ledger: `lib/jobrun.py` `finish` (status block → `run.json`), `_finalize_run` :375, `_emit_job_event` :105-128 (carry the reason additively if absent).
- Surface registration: follow `tk-studio-playable-judge` in `.claude-plugin/released-roster.json`, `driver-contract.md` §2, `contracts/conformance/manifest.json` (one `evals.py run` drive with a fake `claude`), `test_driver_contract.py`.
- `plugins/tk-studio/contracts/driver-contract.md` -- header clause after 35.4's (:5), Stories row (:6) + `Story 35.5`, `**0.1.30 (Story 35.5, additive).**` after 35.4's paragraph (:1826, before `## 8. Conformance` :1877), §4 job model (:825-836) gains `requires`. `lib/tests/test_driver_contract.py` -- new `test_0_1_30_story_35_5_sandbox_and_host` modelled on :2679, order 35.4 < 35.5; widen :2533, :2611, :2677, and 35.4's row check.
- Windows-notes examples: case-folding `test_assets_ladder.py:405-410`; PATHEXT `test_assets.py:162-164`; HKCU `test_installer_plugin_leg.py:97-99, :118`; YAML backslash — new test near `test_miniyaml.py`; append-mode — new lib test (a `subprocess` child writing through a `"w"` handle if no real lib site hands an append handle to a child).
- `kb/agent-pc-setup-runbook.md` -- hole 78 row (:1589) says `shim`; `### Planning checklist (Story 35.5)` after §4.6 (:1287); hole 84/85/90 rows and `TK_SUPERVISOR_CONFIG` env row (:1094) point at it. `kb/acceptance-record-34-8-vertical-slice-on-tua.md` -- step 7 (:41) tier per case; evidence row (:58) gains `pending: maintenance-evals on sbx`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/test/delivery.test.ts` -- `TK_STUDIO_ROOT` in `deps()`'s fake env -- AC1 cause (unset root swallowed by `closeoutPass`).
- `plugins/tk-studio/README.md` -- `## Sandbox notes for the suites` (cause, injected-env rule, `export PATH=$HOME/.bun/bin:$PATH`, the residual 10 with one-line causes if cheap) and `## Windows notes for sandbox-written tests` (five bullets, hole + one Windows-running lib test each) -- AC1, AC3.
- `apps/supervisor/src/hostverify.ts` + `test/hostverify.test.ts` -- shim dir in the step's temp dir (`godot` sh script; on win32 also `godot.cmd`), prepended before the `GODOT` folder; argv[0] `godot`/`godot.exe` (case-insensitive, no separator) spawned as `$GODOT`; `engine.godot_shim`; three new cases + one win32 bash case -- AC3.
- Lib test for YAML backslashes (near `test_miniyaml.py`) and lib test for append-mode handles -- AC3 examples.
- `contracts/job.schema.json`, `lib/job.py`, `lib/tests/test_job.py`, `jobs/run-epic.json`, `jobs/run-vertical-slice.json` -- `requires` field, validation, tests -- AC4.
- `apps/supervisor/src/server.ts`, `src/cli.ts`, `src/api.ts` + `test/tier.test.ts`, `test/api.test.ts`, `test/command-line.test.ts`, `test/approve.test.ts` -- `TierRequired`, the submit check before enqueue, `placement:TierRequired` key, 400 by name; each test asserts nothing enqueued/spawned -- AC4.
- `jobs/maintenance-evals.json`, `skills/tk-studio-evals/SKILL.md`, `lib/evals.py`, `lib/tests/test_evals.py`, `.claude-plugin/released-roster.json`, `contracts/conformance/manifest.json` -- the sibling job and its surface -- AC2.
- `contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- 0.1.30 Story 35.5 paragraph, header clause, Stories row, §4 `requires`; new pin test; four widened row pins -- all ACs.
- `kb/agent-pc-setup-runbook.md`, `kb/acceptance-record-34-8-vertical-slice-on-tua.md` -- planning checklist, hole rows, step 7 tiers, evidence pending cell -- AC2, AC3, AC4.

**Acceptance Criteria (proofs):**
- Given `TK_STUDIO_ROOT` unset and `PATH=$HOME/.bun/bin:$PATH`, when `bun test test/delivery.test.ts` runs in `apps/supervisor`, then 25 pass, 0 fail.
- Given a fake `claude` via `CLAUDE_BIN`, when `evals.py run` runs for the two cases, then `scores.json` and the status block are as in the matrix (`test_evals.py`, conformance drive); the live sbx run is `unverifiable-here` (operator queues `maintenance-evals` once and fills the record).
- Given `GODOT` absolute, when the engine step runs a bare `godot` and a script calling `godot`, then both reach the fake at `GODOT` and the event names `godot_shim` (`hostverify.test.ts`); the win32 bash case is `unverifiable-here` in the sandbox.
- Given an unplaced `run-epic` instance, when submitted via CLI and `POST /jobs`, then `placement:TierRequired` with the per-job config reason, nothing enqueued or spawned, 400 by name.
- Given the contract, when the lib suite and conformance run, then `test_0_1_30_story_35_5_sandbox_and_host` passes and conformance reports `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 6, low 3)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `run` verb spawned `claude auth status` (maxLoginPreflight) before the TierRequired refusal — requires check moved ahead of the preflight; test asserts no `claude` call at all, logged-out host included
  - `[medium]` `[patch]` claim/drain path never checked `requires`; `placement:TierRequired` unreachable — check added on the claim path through `placementRefusal` → refused claim; tests; contract paragraph matches
  - `[medium]` `[patch]` evals guard 3600 s vs 2 × 3000 s case timeout, all-or-nothing `scores.json`, one 10-min Bash call — `CASE_TIMEOUT_S` 1500, `scores.json` rewritten per case with per-case `{error}`, SKILL runs the core in the background and polls
  - `[medium]` `[patch]` an unrecognised eval result shape scored as 0/N (hole 85's confusion) — named refusal `case <c>: unreadable run verdicts`; tested
  - `[medium]` `[patch]` acceptance record's host command for `gds-engine-godot-4-pinned-facts` added `--allow-tools Bash Write` the host cannot grant — dropped
  - `[medium]` `[patch]` `scores.json` is VM-local on sbx; record/SKILL said fill from it — wording names the status-block `reason` in the host `run.json` / `job-run` line (runbook, job description, §2 row too)
  - `[low]` `[patch]` stale `<case>.json` in a reused `--out` read as fresh — deleted before the CLI runs; tested
  - `[low]` `[patch]` `godot_shim` reported when the shim write failed — reported only after `writeGodotShim` succeeds (no test: no seam)
  - `[low]` `[patch]` approve-minted host-fallback refusal untested end to end — new test drives `engagementSubmitter` → `engagementPlacement` → `submitJob` → `requireTier`
- rejected: `[low]` TierRequired reason always names the config entry even for an explicit/stored host placement — the reason text is the settled shape's (SPEC CAP-12) and names the placement source

### 2026-10-29 — Review pass (follow-up, review_loop_iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 3, low 1)
- defer: 0
- reject: 8: (high 0, medium 3, low 5)
- addressed_findings:
  - `[medium]` `[patch]` `evals.py` `_passed` read any verdict string other than a pass (`error`, `timeout`, `skipped`, `aborted`) as a failed run, against the module's hole-85 rule. Now only pass/fail strings are verdicts and any other string is unreadable (`case <c>: unreadable run verdicts`). Tested.
  - `[medium]` `[patch]` `evals.py` `_case_entry` credited a case with another case's result (a single list entry or a bare document naming a different case). It now falls back only to an entry that names no case or this case, otherwise `case <c>: not in the result JSON`. Tested in both shapes.
  - `[medium]` `[patch]` `evals.py`: non-Refusal exceptions (UnicodeDecodeError on CLI output or the result file, OSError on the output folder or the `scores.json` write) escaped with no AD-11 status block. Fixed by lenient decoding, catching `(OSError, ValueError)` on the read, and named refusals `output folder not writable` and `scores.json not writable` (scored cases kept). Tested.
  - `[low]` `[patch]` `SKILL.md` Rules said the session writes only the core's results, while step 1 also writes the captured-stdout file. The rule now names that file.
- rejected:
  - `[medium]` drained run with a pre-`requires` stored definition: the fresh `requireTier` runs after `claimGate` (pin/preflight), and a TierRequired refusal there can leave an sbx pin. Already ruled by consult 2026-10-29T10:50:15Z (keep the second check after claimGate, named residual). Every shipped type now stores `requires`, so the first check catches it, and no shipped type requires `host`. Not re-consulted (never twice on one question).
  - `[medium]` `evals.py` reads a guessed `claude plugin eval --json` shape, and the tests prove it only against the fake. Already recorded as a residual risk and `unverifiable-here` (the operator's sbx run); an unknown shape is a named refusal.
  - `[medium]` the supervisor may not pass `directory`/`run_id` in the payload. False: `cli.ts:2391` adds `run_id`, and `server.ts:1117` defaults `directory` to the VM root.
  - `[low]` `tk-studio-evals` has no `customize.toml`. Not an invariant: `tk-studio-engage`, `tk-studio-knowledge` and `tk-studio-track` ship without one, and the job definition carries `effort: low`.
  - `[low]` contract/runbook name 35.7's `run-sweep` as shipping `requires` before it exists. This is the planner's settled shape (CAP-12), a forward obligation on 35.7.
  - `[low]` the refusal text in the contract/runbook reads only for `requires: sbx`, and the host direction is untested end to end. AC4 names only `sbx`. The class message covers `host`.
  - `[low]` an approve-minted refusal reads `placement resolved host (explicit)` for the engagement fallback. The remedy text (the per-job config entry) is correct. Relabelling needs a new submit option (not trivial, cosmetic).
  - `[low]` the edge-case variant of the claim-path ordering, deduplicated with the first reject above (same claim, same action).

### 2026-10-29 — Review pass (follow-up 2, review_loop_iteration 0)
- layers: blind-hunter, edge-case-hunter (band L, both run). The diff (32 files, 264 KB, the spec excluded) went to both layers as a file path (`/tmp/rv-35-5-p3/diff.patch`), because it is too large to inline.
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 2: (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` `evals.py` `score_case` never compared the run count it read with the requested `--runs`, and never rejected `passed` above that count. A 3-run request that came back with one passing run scored `1/1`. That breaks the hole-85 rule and AC2's "at least 2 of 3" record row. Fixed: a count mismatch raises `case <c>: <n> runs reported, <runs> requested`, and a `passed` outside 0..runs raises `case <c>: unreadable run verdicts`. Either refusal keeps the other cases scored and ends `blocked`. Tested: three new tests, and two fixtures realigned whose counts were mismatched by accident.
- rejected:
  - `[medium]` found by both layers, deduplicated: a drained run refused `placement:TierRequired` for its stored host tier, where the `resolves` text names the config entry, so the run would stay queued for good. False: `cli.ts:1294`'s `resolves` already names "or cancel the run and resubmit with --tier". The reason text is the settled shape (CAP-12). A stored host tier arises only for runs queued before `requires` existed, the residual already named.
  - `[low]` `maintenance-evals.json`'s `stop.on_status [blocked]` locks resubmission after one unscored case. Not a defect: the plan copied the guards from `run-epic.json`, and a blocked eval run (an unreadable result shape) should stop rather than spend again. The way to lift it is documented: the README's instance-override rule, as used for holes 90 and 93 (runbook :1627, :1630).

## Design Notes

Settled shape (SPEC `## Design notes` CAP-9..CAP-12) is binding: the `requires` overlay rule (an instance's own `requires` overrides its type's), the shim's scope (only when `GODOT` is an absolute path to a file), the `scores.json` shape `{cases: {<c>: {runs, passed, score}}, cli: "<claude --version>"}`, and the two README section titles. The shim supersedes 0.1.29 Story 34.1's "the leg never resolves `godot` itself" only when `GODOT` is absolute; say so in the 35.5 paragraph, as 35.4 did for 8788.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && env -u TK_STUDIO_ROOT bun test test/delivery.test.ts` -- expected: 25 pass, 0 fail
- `cd apps/supervisor && env -u TK_STUDIO_ROOT bun test test/hostverify.test.ts test/tier.test.ts test/api.test.ts test/command-line.test.ts test/approve.test.ts` -- expected: no new failure versus baseline
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: exit 0
- `cd apps/supervisor && env -u TK_STUDIO_ROOT bun test` -- expected: 15 fewer failures than the 25 baseline, no new failure; the residual 10 named in the sandbox notes

## Deviation Summary

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T094835Z-d5b44c` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-10-29, implementer)

- planned: `evals.py` honours `CLAUDE_BIN`, one conformance drive with a fake `claude` / actual: added a `--claude-bin` flag; `lib/tests/test_evals.py` doubles as the fake when run as a script; `--out` / `--directory`+`--run-id` choose the output folder (default the run workspace's `evals/`); the §2 row lists `out`, `plugin?`, `claude_bin?` beyond `{cases, runs}`; two manifest drives / why: the conformance runner has no per-drive env, and a new fixture file would grow the Files list (Block If) / may affect: none
- planned: adjust `approve.test.ts:92, :179` / actual: both left unchanged; a new approve test shows `TierRequired` travels through the approve `queued` step's existing refusal path / why: neither existing test reaches the real submit / may affect: none
- planned: residual 10 named, or fixed test-only with a DRIFT if they share the env-leak cause / actual: 6 (release ×5 in `sandbox.test.ts`, the `(unnamed)` in `closeout.test.ts`) share the unset `TK_STUDIO_ROOT` cause; named in the notes, not fixed / why: both test files are outside the plan's Files list (Block If) / may affect: none (a follow-up test-only fix)
- planned: `apps/supervisor/src/conformance.ts` updated if it enumerates surfaces / actual: not touched (it has `SURFACE_CORES`; no `tk-studio-evals` entry, so the supervisor-routed conformance pass turns its drives into skill payloads) / why: outside the Files list / may affect: none

DEVIATION SCORE: 1

DRIFT: evals.py takes `--claude-bin`/`--out`/`--directory`+`--run-id` beyond the planned `CLAUDE_BIN`; test_evals.py doubles as the fake — conformance runner has no per-drive env and a fixture file would grow Files — affects: none
DRIFT: approve.test.ts :92/:179 unchanged; new test proves TierRequired through the approve queued step — neither existing test reaches the real submit — affects: none
DRIFT: 6 of the residual 10 share the TK_STUDIO_ROOT cause but are named, not fixed — sandbox.test.ts and closeout.test.ts are outside Files — affects: none (superseded by pass 2, consult)
DRIFT: conformance.ts SURFACE_CORES lacks tk-studio-evals — outside Files — affects: none (superseded by pass 2, consult)

### pass 2 (2026-10-29, consult-directed implementer)

- planned: only the plan's Files / actual: `apps/supervisor/test/sandbox.test.ts` (`sweepWith`'s sandbox-deps env gains the repo root as `TK_STUDIO_ROOT`; the in-VM probe `vmLaunchStatus` → `studioRootOf` reads it) and `apps/supervisor/test/closeout.test.ts` (`fakeStudioRoot` gets the repo root explicitly), test env only / why: consult ruling (deviation 3, option b): same cause and rule as AC1 / may affect: none
- planned: only the plan's Files / actual: `apps/supervisor/src/conformance.ts` `SURFACE_CORES` gains `"tk-studio-evals": ["evals.py"]`; no test pins the set / why: consult ruling (deviation 4) / may affect: none
- planned: README residual list names 10 / actual: names 4 (sbx wall-clock guard ×2, invokeSkill sbx-tier ×2, `TK_ATLASSIAN_*` passthrough cause) / why: the other 6 are fixed above / may affect: none

DEVIATION SCORE: 1

DRIFT: sandbox.test.ts and closeout.test.ts carry TK_STUDIO_ROOT in their fake env (file outside Files) — consult: same env-leak cause as AC1, plan's test-only-fix line wins — affects: none
DRIFT: conformance.ts SURFACE_CORES gains tk-studio-evals (file outside Files) — consult: without it the supervisor conformance pass sends the drives as spend-bearing skill runs — affects: none
DRIFT: sandbox notes' residual list is 4, not 10 — the 6 sharing the cause are fixed — affects: none

### pass 3 (2026-10-29, review-patch implementer)

- planned: the requires-tier check on the claim path before anything spawns / actual: checked on the stored definition before `claimGate`, and again on the fresh `resolve` result after `claimGate` and before the claim; for a run queued before `requires` existed the host `claude auth status` probe still runs, but no worker does; the contract's 35.5 paragraph says so / why: a pre-`requires` stored definition carries no `requires`; only the fresh `resolve` has it / may affect: none
- planned: finding 8 fixes the record, README, SKILL.md / actual: also the runbook (two sentences), the `maintenance-evals.json` description, the contract §2 `tk-studio-evals` row (wording only) / why: they said the same; all in the change set / may affect: none
- planned: a test for the `godot_shim` write-failure path / actual: none / why: no cheap seam (the shim dir sits in the step's own fresh temp dir) / may affect: none

DEVIATION SCORE: 1

DRIFT: claim-path requires check runs twice (stored definition before claimGate, fresh resolve after it); a pre-requires queued run still gets the host auth probe, never a worker — a pre-requires stored definition has no requires — affects: none
DRIFT: scores wording fixed also in the runbook, maintenance-evals.json description and contract §2 row — they repeated the VM-local scores.json claim — affects: none
DRIFT: godot_shim write-failure path untested — no cheap seam — affects: none

Residual (consult 2026-10-29T10:50:15Z): a run queued before `requires` existed (stored definition lacks it) still triggers the host `claude auth status` probe in `claimGate` before its `TierRequired` refusal; no worker starts.

## Consult Log

- 2026-10-29T10:19:14Z — trigger: deviation-gt-0 — question: accept or reject pass 1's four score-1 deviations (evals.py extra flags/self-faking test; approve tests unchanged; 6 residual reds sharing the TK_STUDIO_ROOT cause left named; conformance.ts SURFACE_CORES lacks tk-studio-evals)? — ruling: accept-deviation score 1 — do: keep deviations 1 and 2 as recorded (score-1 DRIFT) | reject 3, option (b): add TK_STUDIO_ROOT to the fake env in sandbox.test.ts (release ×5) and closeout.test.ts ((unnamed)) as delivery.test.ts deps() does, file-outside-Files DRIFT, drop those 6 from the README residual list, keep the other 4 named | reject 4: add "tk-studio-evals": ["evals.py"], // Story 35.5 to SURFACE_CORES (conformance.ts:126-148), file-outside-Files DRIFT, rerun conformance and the supervisor suite; no item is score 2 — rule candidate: when a plan's Code Map tells you to touch a file (conditionally or not) and its Files list leaves it out, the Code Map line wins: edit it, record a file-outside-Files DRIFT, no consult
- 2026-10-29T10:50:15Z — trigger: deviation-gt-0 — question: accept or reject pass 3's score-1 deviations (claim-path requires check twice, the second after claimGate's auth probe; scores wording fixed in runbook/job description/§2 row too; no godot_shim write-failure test)? — ruling: accept-deviation score 1 — do: record all three as score 1 unchanged, keep the second claim-path check after claimGate | name the residual (a pre-requires queued run gets the host auth probe before its TierRequired refusal; no worker starts) | proceed to closeout; none is score 2 — rule candidate: an AC that says "before any process starts" binds only the verb it names; a drain/claim check for rows written before the field existed may run the claim gate's read-only probes first, scored 1, if no worker starts and the contract states the order

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-29T09:04:04Z | 2026-10-29T09:17:12Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-29T09:50:13Z | 2026-10-29T10:51:17Z | 745a4fda-5287-4734-9773-212898282ef5 | claude-opus-5-5 | medium | 38787993 | 205151 | 16.8022 | completed |
| review | 1 | 2026-10-29T10:51:18Z | 2026-10-29T11:01:01Z | 84393f24-4c6f-49cb-8265-533d843f0104 | claude-opus-5-5 | medium | 4772619 | 44717 | 3.7585 | completed |
| review | 2 | 2026-10-29T11:01:01Z | 2026-10-29T11:11:55Z | c1f2af3d-0406-418c-8289-fbba93d88b39 | claude-opus-5-5 | medium | 4814535 | 42439 | 3.7048 | completed |
| gate | 1 | 2026-10-29T11:11:56Z | 2026-10-29T11:19:37Z | ab938ba9-e129-4550-93b4-01a3ebc041d0 | claude-opus-5-5 | medium | 8903359 | 57595 | 5.0199 | completed |


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T094835Z-d5b44c` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary (follow-up review pass 2).** This pass re-reviewed Story 35.5's full diff against `698218e5887b9401328ac8adfd37c5c88765fe3b` (32 files, the spec excluded) with both layers (band L). AC1–AC4 stand as implemented in `2261da67f48d316eb160d2fdae7e7bdade644249` and hardened in `726ee22`. This pass closes the last way a result could be misread as a score: `evals.py` now refuses a result whose run count differs from the requested `--runs`. A short run can no longer read as a pass in the acceptance record's eval row.

**Files changed (this pass):**
- `plugins/tk-studio/lib/evals.py`: `score_case` refuses a reported/requested run-count mismatch (`case <c>: <n> runs reported, <runs> requested`) and a `passed` outside 0..runs (`unreadable run verdicts`).
- `plugins/tk-studio/lib/tests/test_evals.py`: three new tests (count mismatch in the list and integer forms, `passed` out of range, and a full run ending `blocked` with the other case still scored), plus two fixtures realigned.

**Review:** one pass, both layers. Patches applied: 1 (high 0, medium 1, low 0). Deferred: 0. Rejected: 2 (medium 1, low 1). Follow-up review score: 3×1 + 1×0 = 3 < 5, and no high, so `followup_review_recommended: false`.

**Verification (re-run by this session after the patch):**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests`: Ran 2474, OK (skipped=4).
- `uv run python ../contracts/conformance/runner.py run`: exit 0, `ok: true`.
- `uv run python -m unittest tests.test_evals -v` (implementer): Ran 23, OK.
- Supervisor (`bun test`, `bunx tsc --noEmit`): not re-run, because no TypeScript changed in this pass. Earlier results stand (delivery 25/0, tsc exit 0).

**Deviation:** this pass adds none (implementer score 0). The story's `deviation_score: 1` stands.

**unverifiable-here (operator), unchanged:**
- AC2's live scores. Add `jobs."<project-id>/maintenance-evals": {tier: "sbx", sandbox: "<name>"}` to the file `TK_SUPERVISOR_CONFIG` names, then send one `POST /jobs` `{project: "<project-id>", job: "maintenance-evals"}`. Fill the record's eval row from the status-block `reason` in the run's `run.json` or `job-run` line.
- AC3's win32 Git Bash shim case runs on the host leg only.

**Residual risks:**
- The `claude plugin eval --json` shape is still confirmed only against the fake. An unknown shape, verdict, case name or run count is a named refusal, and the job's `stop.on_status [blocked]` then holds until the stop is lifted through the instance.
- `cli_version`'s `--version` probe still decodes strictly.
- A run queued before `requires` existed still gets the claim gate's probes before its `TierRequired` refusal (consult 10:50:15Z).
- An approve-minted refusal labels the host fallback `(explicit)`.
- The `godot_shim` write-failure path is untested (no seam).

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 35-6-the-closeout-carries-the-proof (band L, oversize; CAP-13 design note appended to SPEC.md; no open replan entries; plan stage row buffered in stages/35-6-*.jsonl).
