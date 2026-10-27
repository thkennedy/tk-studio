---
title: 'The `playable-verify` Leg'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'e67c04979496d6c2da8eb3e8dbce3c15be4404d3'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-3.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: ['oversized']
deferred:
  - summary: 'A 33.8 `verify` re-run (POST /runs/{id}/verify) runs the playable-verify judge, but its cost never reaches the `job-run` ledger (there is no `finish` on that path).'
    evidence: 'consult ruling 2026-10-27 (deviation-gt-0); AC3 "the leg''s cost lands in the ledger''s job-run as its own line" holds on the close-out path only; worktree.ts finishStudio'
    severity: medium
    location: 'apps/supervisor/src/hostleg.ts runLeg'
    note: '34-8 planner closes it or rules it out of scope; deferral class (a): a defect in behaviour the criteria name'
  - summary: >-
      The judge's "reads only report.json and the frames, never the code or the spec" rests on the SKILL.md instruction alone; the session runs with the whole worktree mounted and no deny profile.
    evidence: |-
      Review pass 1 (blind hunter). AC1 names the read-only rule; enforcing it needs a deny-profile design for invokeSkill's `deny_profile`, which this story's plan does not settle. Deferral class (a).
    location: >-
      apps/supervisor/src/hostverify.ts defaultJudge; plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md
    severity: medium
  - summary: >-
      A 33.8 re-run on an ended run pins (starts) the stopped sandbox for the judge and nothing releases it; it carries no pin record, so the launch check warns "started outside the supervisor" until the next run on that sandbox releases it.
    evidence: |-
      Consult ruling 2026-10-27 (high-severity-finding, option A), sandbox.ts:22-31. Deferral class (c): a safety/resource rule on the box.
    location: >-
      apps/supervisor/src/hostverify.ts defaultJudge pin; apps/supervisor/src/hostleg.ts runLeg
    severity: low
  - summary: >-
      Headless conformance drives ignore a manifest `timeout` (runner.py _run_drive uses DEFAULT_TIMEOUT 60); 34.1's e2e_engine_gate.py declares 120 and its 50+40 s bounds overrun the real 60 s cap. Also measure e2e_playable_verify's INSTALL_BOUND_S=12 on the agent PC with no node_modules.
    evidence: |-
      Consult ruling 2026-10-27 (deviation-gt-0, patch pass): runner.py:92, :210-211, :236, :520, :831-832. Deferral class (b): the AD-19 conformance invariant.
    location: >-
      plugins/tk-studio/contracts/conformance/e2e_engine_gate.py; plugins/tk-studio/contracts/conformance/manifest.json
    severity: low
---

<intent-contract>

## Intent

**Problem:** "It builds" stands in for "it plays". After 34.1's engine gate nothing runs the game, looks at it, and turns what it saw into a verdict the owner reads.

**Approach:** The host leg (`hostVerify`) gets a third step after a green engine gate, for projects whose tracked `.tk-studio/config.yaml` declares `playable: {scenario, seed, ticks}`. The step runs 34.2's `playable.py run` on the host, stores the media in the run workspace and the worktree's ignored `.bmad-loop/runs/<engine>/playable/`, and drives a routed `claude -p` judge on the sandbox tier. The judge is the new skill `tk-studio-playable-judge`, with the deterministic core `playable_judge.py`, and it reads only `report.json` and the frames. The verdict rides `host-verify` as `playable` and folds into the leg's `green`. The leg also gets a `pipeline.py` routing entry, the judge's cost as its own `job-run` field, contract 0.1.29 text, a roster row and a conformance e2e.

### Acceptance Criteria (transcribed verbatim from epics.md, Story 34.3)

- **AC1** — **Given** a project config that declares `playable: {scenario: <file>, seed: <n>, ticks: <t>}` (additive) **When** the host leg's engine gate is green **Then** the host leg runs 34.2's `playable.py run` in the worktree, writes the media under the run workspace (`~/.tk-studio/runs/<run>/playable/`) and the worktree's ignored `.bmad-loop/runs/<engine>/playable/`, then drives the judge: a `claude -p` session on the project's sandbox tier (`sbx exec`, the plugin's `tk-studio-playable-judge` skill, routed by `[pipeline.legs] playable-verify` with its own `model` and `effort` through `pipeline.py`'s tables) that reads only `report.json` and the frames (never the code or the spec), answers the rubric (the scene loaded; the player is visible and framed; no missing-texture magenta and no error overlay; the HUD reads; the scenario's named moments appear in the frames they name) with `verdict: pass | fail` and `findings[]` each naming a frame and a rubric line, and ends in a status block; the `host-verify` event carries `playable: pass | fail | skipped` and the findings
- **AC2** — **Given** a `fail` **When** the close-out continues **Then** the run ends `partial` with `host_verify: red (playable)`, the PR body carries the findings and the frames' paths, the inbox gets the line, and 33.8's `verify` re-runs the leg after a fix; `pass` lets the PR go ready; a project without `playable` is `skipped` and unchanged
- **AC3** — **Given** the suites **When** they run **Then** `bun test` covers the ordering, the event, the PR body and both verdicts with fakes; the lib suite covers the rubric parsing and the judge's refusals (no frames, a malformed report); conformance adds the skill's roster row and an e2e over a fake judge; contract 0.1.29 names the leg; the leg's cost lands in the ledger's `job-run` as its own line

## Boundaries & Constraints

**Always:**
- Follow the plan's `## Settled shape` 1-6 (`plans/34-3.md`) exactly. Those are the planner's rulings for this story's shapes.
- `playable` is optional on `HostVerifyRan`, exactly as 34.1 did with `engine?`. It is always written on a ran leg, never on a `{skipped, reason}` leg, and the tests assert it on the producer's output. Readers treat a missing `playable` as not run.
- `green` = `stepGreen(host) && engine.verdict !== "red" && playable.verdict !== "fail"`. `isRed`, `redReason` and `prSection` carry the new state. Close-out, board, office and inbox read it through `green`/`isRed`/`redReason`, with no rule of their own.
- Read `playable.py`'s `verdict` from its status block or `report.json`, never from whether `log_errors[]` is empty. Exit 0 is a pass, 1 a fail and 2 a refusal. Never pass `--mode`: movie is the default ruling.
- Read the config at `base_ref` with the same `git show` as `verify.host`, never from the worktree. The plugin lives in the supervisor's checkout (`studioScript`/`pluginRoot`), never in the served project.
- Contract: extend the existing 0.1.29 paragraph, the line-5 clause, the Story / rulings row and the §2 row, and list the leg in §5.1. No version bump.
- Every `sbx`, judge, `claude`, Godot and `playable.py` in a test is a fake. Lib code stays stdlib-only and runs through `uv run`. Writes are atomic. Every headless surface ends in the AD-11 status block.
- Touch only the plan's `## Files`. Any other file is a recorded DRIFT. Re-pinned test literals are recorded as DRIFT.

**Block If:**
1. The leg needs a `skipped` path for a missing display session or an unreachable sandbox. The plan rules that every non-pass on a configured project is `fail` (SPEC Open Question CAP-4/CAP-5).
2. `invokeSkill` cannot target the worktree mount with a relative payload `media` path without a change to `server.ts`.
3. `ledger.validate` or the taxonomy tests reject the additive `job-run` field without a taxonomy version bump.
4. The Files list grows past the plan's list.

**Never:**
- Edit `server.ts`, `board.ts`, `office.ts`, `hygiene.ts`, `queue.ts` or `playable.py`. Change TUA.
- Run a model on the host (the judge runs only through `invokeSkill` on the sandbox tier). Let the judge read code or the spec.
- Add `playable-verify` to `STAGE_OF`/`SUBAGENT_LEGS`, or touch `meter.py`'s `LEGS`.
- Push, tag, open a PR or run the release motion. Bump any version.
- Edit `epics.md`, `stories.yaml`, plan files, `SPEC.md`, `.bmad-loop/*.toml`, `_bmad-output/implementation-artifacts/supervision/`, `.claude/` or `_bmad/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No playable | config without `playable:` | `playable: {verdict:"skipped", reason:"no playable"}`; green unchanged | none |
| Malformed | `playable` not a mapping or a bad field | `skipped`, `playable is malformed: <field>` | none |
| Engine not green | engine red or skipped | `skipped`, `engine gate not green` | none |
| Harness pass, judge pass | exit 0 pass; judge status ok, verdict pass | `playable.verdict:"pass"`, judge {status, verdict, cost_usd, model, effort}; leg green | none |
| Judge fail | judge verdict fail + findings | `fail`, findings[], frames[] store paths; `redReason` `host verify red (playable): …`; PR draft, run partial | none |
| Harness fail | `playable.py` exit 1 | `fail`, judge not run, one finding `{frame, rubric:"harness: <invariant>", note}` | none |
| Refusal | `playable.py` exit 2 | `fail`, reason `playable.py refused: <reason>` | none |
| Judge broken | judge blocked/failed or an answer refused | `fail`, reason `judge: <reason>` | never throws |
| Judge core refusals | `prepare`/`verdict` with no report.json, malformed report, no frames, unknown rubric id, frame not in frames[], fail with no findings, malformed answer | exit 2, `blocked` status block naming the refusal | AD-11 block |

</intent-contract>

## Code Map

The plan's `## Code Map` (`plans/34-3.md`) is the full investigation, with file:line anchors verified at baseline `e67c049`. Read it first and do not repeat the search. Key anchors:

- `apps/supervisor/src/hostverify.ts` -- the leg. `HostVerifyRan` :62-73 (`engine?` :72), `Run` :84, `Deps` :85, `verifyCommand` :120-156 (the config read), `runStep` :203-239, `hostVerify` :245-284 (engine step :265-278, `green` :282), `redReason` :292-299, `prSection` :305-327.
- `apps/supervisor/src/server.ts` (read-only) -- `invokeSkill(root, skill, args, spawner, opts)` :1083. `opts.vmHostRoot` sets the mount. A payload `directory` defaults to the VM root (:1096), and a relative `media` passes through untouched. Precedent call: `cli.ts` :2320-2327. Inject it as `deps.judge` so `hostverify.ts` takes no new hard dependency, which tests fake.
- `apps/supervisor/src/registry.ts` `resolveRoute` :91 -- route reader. Take `route["playable-verify"]`, and fall back to `{claude-sonnet-5, medium}` when it is absent.
- `apps/supervisor/src/worktree.ts` -- `prBody` :367/:389, `closeOut` :401 (`isRed` :413, draft :523), `sweepEngines` :719 (`hostVerify` :787, partial :812, `finishStudio` :813), `finishStudio` :682 (cost pass-through), `studioScript` :102.
- `apps/supervisor/src/hostleg.ts` `runLeg` :157-180 -- widen the run passed at :164.
- `apps/supervisor/src/sandbox.ts` :572 `studioRunDir` -- the store `--out`.
- `plugins/tk-studio/lib/playable.py` (read-only) -- `main` :694-720, `PLAYABLE_PATH` :78, `REPORT_KEYS` :102, exits :618-621, status block `with_block` :585.
- `plugins/tk-studio/lib/pipeline.py` `LEGS` :84-85, `_validate_legs` :155; `skills/tk-studio-launch/customize.toml` `[pipeline.legs]` :70-79; `tests/test_pipeline.py` :97.
- `plugins/tk-studio/lib/jobrun.py` `_emit_job_event` :104-125, `finish` :677/:736; `ledger.py` validate :75-107; `contracts/events/taxonomy.v1.json` `job-run` :60-71.
- Conformance: `runner.py` `_check_status_block_doc` :142, `_check_unrunnable_core_doc` :176, `_check_auth_preflight` :197; `manifest.json` (e2e precedent :140-146); `e2e_engine_gate.py` (SUITE :38, FILTER :40, BOUND_S :44, `run()` :56).
- Skill shape: `skills/tk-studio-observe/` (`SKILL.md` with `name` and `description`, `customize.toml` `[model]`). Roster: `.claude-plugin/released-roster.json`, `test_release_roster.py` :79 (precedent commit `05d6499`).
- `driver-contract.md` -- 0.1.29 paragraph :405-441, line 5, line 6, §2 table, §5.1 :918-922. `test_driver_contract.py` :1956, :2006 (re-pin the stories line only).
- Tests: `apps/supervisor/test/hostverify.test.ts` (34.1 block :314; `fakeGodot` :316, `bareEnv` :330, `recorder` :335), `test/fakes.ts` (`fakeBin` :34, `fakeSbx` :272), `worktree.test.ts` :516/:591, `hostleg.test.ts` :103.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/playable_judge.py` (new) -- `prepare --media` and `verdict --media --answer`, the five fixed rubric ids, the named refusals, `judge.json` written atomically, the AD-11 block with `intent: "tk-studio-playable-judge"` -- Settled shape 3.
- `plugins/tk-studio/lib/tests/test_playable_judge.py` (new) -- rubric parsing, every refusal (no frames, malformed report, no report.json, unknown rubric, unknown frame, fail without findings, malformed answer), `judge.json` contents -- AC3.
- `plugins/tk-studio/skills/tk-studio-playable-judge/SKILL.md` + `customize.toml` (new) -- read only `report.json` and the frames under the payload `media`; run `prepare`, write the answer, run `verdict`; carry the status-block line and the "If the deterministic core is unrunnable" phrase -- AC1.
- `plugins/tk-studio/lib/pipeline.py`, `skills/tk-studio-launch/customize.toml`, `tests/test_pipeline.py` (only if a pin needs it) -- the `playable-verify` leg with the default `{claude-sonnet-5, medium, off}` -- Settled shape 5.
- `plugins/tk-studio/lib/jobrun.py` + its tests; `contracts/events/taxonomy.v1.json` -- `--playable-verify-cost-usd` (finite, ≥ 0, absent when not sent) to `playable_verify_cost_usd` on `job-run` -- Settled shape 6.
- `apps/supervisor/src/hostverify.ts` -- the config read, the playable step (spawn `uv run <plugin>/lib/playable.py run`, store `--out`, copy to the worktree, the judge through `deps.judge`), `playable` on the result, `green`, `redReason` `(playable)`, the `prSection` `Playable:` line with the findings and the store frame paths, `Run`/`Deps` widened, header -- Settled shapes 1-4.
- `apps/supervisor/src/worktree.ts`, `apps/supervisor/src/hostleg.ts` -- widen the run passed to `hostVerify` (sandbox, engine_run_id, studio_run_id, project_id); `finishStudio` passes the judge's cost and adds it into `--total-cost-usd` -- AC2, AC3.
- `apps/supervisor/test/hostverify.test.ts` -- `describe("Story 34.3 …")`: ordering (playable after a green engine only), the skipped reasons, the event shape, both verdicts, harness fail, refusal, judge broken, `redReason`, the PR section; a fake `playable.py` runner and a fake judge -- AC3.
- `apps/supervisor/test/worktree.test.ts` -- the red (playable) close-out (partial, draft, PR body findings and frame paths), pass to ready, the cost line -- AC2, AC3.
- `apps/supervisor/README.md` -- the playable step after the engine gate section.
- `contracts/conformance/e2e_playable_verify.py` (new) + `manifest.json` -- the skill surface and the drive (`bun test test/hostverify.test.ts -t "Story 34.3"`, "not run" when bun or the checkout is absent) -- AC3.
- `.claude-plugin/released-roster.json` -- the skill row, no version bump -- AC3.
- `contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- the §2 row, the 0.1.29 paragraph and the header clauses naming the leg, the §5.1 leg; one new 34.3 test and the 34.2 stories-line re-pin -- AC3.

**Acceptance Criteria:** AC1-AC3 above, each proved by a named test or command in Verification.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 1, medium 2, low 3)
- defer: 3: (medium 1, low 2)
- reject: 2: (medium 1, low 1)
- addressed_findings:
  - `[high]` `[patch]` The default judge passed no `pin`, so a 33.8 re-run on an ended run (sandbox stopped) would exec into a stopped sandbox and never go green (AC2). The judge now pins with `pinSandbox` (consult: apply, option A); `Deps` gained `sbx`/`spawner`; a test covers pin-before-exec and a pin failure giving `fail` with `judge: …`.
  - `[medium]` `[patch]` `finishStudio` zero-filled `--total-cost-usd` with the judge's cost alone when the engine was unmetered. The total is now absent and `--playable-verify-cost-usd` is still sent; test added.
  - `[medium]` `[patch]` The host trusted `judge.json` blindly. It now re-validates the verdict, the five rubric ids, frames in `report.json`'s `frames[]`, and that a fail has findings, else `fail` with `judge: <what>`; test added.
  - `[low]` `[patch]` A failed media copy masked a harness fail. The harness-fail branch is decided before the copy, and the copy is best-effort there; test added.
  - `[low]` `[patch]` e2e_playable_verify bounds were inconsistent with the runner's real 60 s cap. Bounds now total 58 s with an assert and a test; manifest `timeout` 60 (consult: accept score 1).
  - `[low]` `[patch]` `ticks` > int32 passed config validation and then `playable.py` refused it (red instead of `skipped` malformed). It is now capped at 2147483647; the seed bounds are pinned by a test.
- deferred: judge read-only not enforced (class a); sandbox left running after a re-run (class c); headless drive timeout cap / 34.1 drive overrun (class b). Plus the pass-1 consult's deferral of the re-run judge cost missing from `job-run` (class a). That is 4 deferrals in all, each with its class.
- rejected: `--wall-clock` equals the outer guard (plan Settled shape 2 pins `--wall-clock` = `guardS`, and the verdict is still `fail`); store frames overwritten on a re-run (the paths stay valid and the newest frames are the evidence).

### 2026-10-27 — Review pass (follow-up)
- diff: `e67c04979496d6c2da8eb3e8dbce3c15be4404d3`..HEAD plus the working tree, `_bmad-output/` excluded (the loop's own artifacts); both layers ran (band L); 12 raw findings, 10 after dedupe (the edge-case hunter's two duplicate the blind hunter's re-run pin and re-run cost)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 8
- addressed_findings:
  - `[medium]` `[patch]` `SURFACE_CORES` (apps/supervisor/src/conformance.ts) had no `tk-studio-playable-judge` entry, so the supervisor-routed conformance path payloaded `e2e_playable_verify.py` instead of running it direct. Added `["playable_judge.py"]` plus a `Story 34.3` isDirectDrive test in conformance.test.ts (consult 10:21:19Z, file outside Files, DRIFT score 1).
  - `[low]` `[patch]` The taxonomy note on `playable_verify_cost_usd` said "also counted in total_cost_usd", which is false when the engine cost is unmetered (finishStudio omits the total). The note now states both cases.
- rejected:
  - `--wall-clock` equals the outer guard: plan Settled shape 2 pins `--wall-clock` = `guardS`, and the verdict is `fail` on either path (already rejected in pass 1).
  - the judge pin bypasses `pinWithRestart`: consult 10:02:36Z ruled option A (`pinSandbox`), and the missing pin record is DW-69.
  - a re-run leaves the sandbox running: a duplicate of the existing deferral DW-69.
  - the re-run judge cost never reaches `job-run`: a duplicate of the existing deferral DW-67.
  - read-only rests on the prompt: a duplicate of the existing deferral DW-68.
  - a re-run overwrites the store's frames: the store holds the run's latest playable evidence by design (Settled shape 2). 33.8 not regenerating the PR body predates this story.
  - the close-out record says `red`, not `red (playable)`: 34.1 set the precedent of `host_verify: red` (epics.md:3031), and `HostVerifyOutcome` is read by board.ts, which the spec's Never list forbids editing. `(playable)` rides `redReason`, per the I/O matrix.
  - no re-run test with `playable`: a plumbing assertion gap. `rerunHostLeg` passes the full run to the same `hostVerify` (hostleg.ts:164), and AC3's bun coverage list does not name the re-run.

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: OK.
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- From `plugins/tk-studio/lib`: `uv run python -m unittest tests.test_playable_judge tests.test_pipeline tests.test_driver_contract tests.test_conformance tests.test_release_roster tests.test_utf8_guard tests.test_installer_bootstrap tests.test_jobrun -v` -- expected: OK.
- From `apps/supervisor`: `bun test test/hostverify.test.ts test/worktree.test.ts test/hostleg.test.ts`, then `bun test` and `bunx tsc --noEmit` -- expected: 0 failures. If `bun` is absent, record `unverifiable-here` with this command.

**Manual checks (if no CLI):**
- Host proof, unverifiable here (operator on the agent PC): TUA declares `playable:` through a TUA PR; an ended TUA run is re-verified with `POST /runs/<id>/verify`; the `host-verify` event's `playable` and the frames are read back.

## Deviation Summary

- Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-10-27, implementer, DEVIATION SCORE: 1)

- planned: widen the run passed to `hostVerify` in `hostleg.ts` / actual: `hostleg.ts` untouched; it already passes the full queue run, so only the `Run` type in `hostverify.ts` was widened / why: nothing to change / may affect: none
- planned: judge mounted at the worktree (`vmHostRoot: worktree`), media under `<worktree>/.bmad-loop/…` / actual: both use the served root (`<worktree>/<prefix>`), which is the worktree when there is no prefix / why: the engine's `.bmad-loop/runs/<id>` lives in the served root (Story 28.5) / may affect: none
- planned: PR section `Playable: … skipped (<reason>)` / actual: no `Playable` line when the reason is `no playable`; other skips and every ran verdict show it / why: AC2 says a project without `playable` is unchanged, and this avoided re-pinning two 34.1 tests / may affect: 34-8
- planned: the judge's verdict comes back from the session / actual: the host reads `<media>/judge.json` after the session ends `complete`, because the status-block schema is closed / why: the schema forbids extra fields / may affect: none
- planned: none / actual: extra `fail` reasons (`no engine run id: …`, `judge: no sandbox recorded for the run`, `media copy: …`, `playable.py not found: …`); `--wall-clock` clamped to 1..86400 / why: never throw, every non-pass is `fail` / may affect: none
- planned: manifest registers the surface and the e2e drive / actual: also two refusal drives on `playable_judge.py`; the e2e also runs the core against a scripted judge answer / why: AC3's "e2e over a fake judge" without bun / may affect: none
- planned: test re-pins / actual: `test_pipeline.py` shipped-defaults dict gained `playable-verify`; the `test_driver_contract.py` 34.2 stories line now pins `"Story 33.2 (Epic 33), Story 34.1, Story 34.2"` / why: the new leg and the stories line / may affect: none
- planned: none / actual: `worktree.test.ts` helper `launchedSbx` gained an `extra` config-lines parameter; the playable close-out tests use a fake `sbx` for the engine status probe / why: a recorded sandbox makes the sweep check the engine through `sbx` / may affect: none
- planned: `hostleg.test.ts` coverage / actual: no 34.3 case there (it isn't in Files) / why: the re-run goes through the same `hostVerify` / may affect: none
- implementer risks: the judge's cost is recorded only on the close-out path (a `POST /runs/{id}/verify` re-run has no `finish`); the outer step timeout usually fires before `playable.py`'s own wall clock; the judge reading PNGs in `claude -p` is unproven here.

DRIFT: hostleg.ts untouched — it already passes the full queue run to hostVerify — affects: none
DRIFT: judge mount and media live at the served root (<worktree>/<prefix>) rather than the bare worktree — the engine's .bmad-loop/runs lives in the served root (28.5) — affects: none
DRIFT: PR body omits the Playable line when the skip reason is `no playable` — AC2 "unchanged" — affects: 34-8
DRIFT: the judge's verdict is read from <media>/judge.json, not from the status block — the status-block schema is closed — affects: none
DRIFT: extra fail reasons and a clamped --wall-clock — never throw, every non-pass is fail — affects: none
DRIFT: two extra conformance refusal drives, and the e2e drives the core with a scripted answer — prove the fake judge without bun — affects: none
DRIFT: re-pins in test_pipeline.py (shipped defaults) and test_driver_contract.py (34.2 stories line) — the new leg and the stories line — affects: none
DRIFT: worktree.test.ts launchedSbx helper gained an `extra` parameter — the playable config lines in the close-out fixture — affects: none

Consult note (DO, pass 1): a project with no `playable` config still writes `playable: {verdict: "skipped", reason: "no playable"}` on the `host-verify` event. Only the PR body leaves the Playable line out, so 34-8 reads the verdict from the event and never from the PR line.

### pass 2 (2026-10-27, review patches, DEVIATION SCORE: 1)

- planned: make the pin injectable through `Deps` / actual: `Deps` gained `"sbx"` and `spawner?: Spawner` / why: proving the pin precedes the judge's first `sbx exec` without a live call needs a fake spawner / may affect: none
- planned: drive bounds below the manifest/runner timeout / actual: fitted under the runner's real 60 s cap and set the manifest entry `timeout: 60` (was 120, never honoured for headless drives) / why: runner.py ignores a headless drive's own timeout / may affect: none
- planned: judge.json re-validation / actual: a bad finding is now `fail` where it was silently dropped / why: the patch asks for it / may affect: none

DRIFT: hostverify.ts Deps gained `sbx` and `spawner` — testing the judge's pin order without a live call — affects: none
DRIFT: e2e_playable_verify manifest timeout 120 → 60 and its bounds cut to a 58 s worst case — headless drives run under runner.py's global 60 s — affects: none
DRIFT: a malformed judge.json finding is now `fail` — the host re-validates at its trust boundary — affects: none
DRIFT: apps/supervisor/src/conformance.ts SURFACE_CORES gained `tk-studio-playable-judge` (+ a conformance.test.ts test) — file outside Files, named Optional in the plan's Code Map at :86; without it the supervisor conformance path payloads the e2e drive — affects: none

## Consult Log

- 2026-10-27T09:59:07Z — trigger: deviation-gt-0 — question: accept the implementer's score 1 over 7 deviations (PR line omitted for `no playable`, served-root mount, judge.json verdict, extra fail reasons, extra drives, re-pins, hostleg untouched)? — ruling: accept-deviation score 1 — do: keep all seven deviations, revert none; record that the event still carries `skipped (no playable)` and 34-8 reads the event, not the PR line; log a deferred entry for the re-run judge cost missing from `job-run` — rule candidate: Leaving a skipped record's line out of a human-facing render (PR body, inbox) is score 1 when the machine record (the event) still carries it; score 2 only if a later story's criteria parse that render.
- 2026-10-27T10:02:36Z — trigger: high-severity-finding — question: the default judge passes no pin, so a 33.8 re-run on an ended run (sandbox stopped) would exec into a stopped sandbox; patch with pinSandbox (A), route through pinWithRestart (B), or defer (C)? — ruling: apply — do: take (A): the default judge passes `pin: (sb) => pinSandbox(sb)`, plus a bun test (stopped sandbox pinned before the preflight; a pin failure gives `fail` with `judge: …`); do not touch sandbox.ts/server.ts or use pinWithRestart; defer the sandbox left running after a re-run on an ended run (score 1); severity high, fixed in this story — rule candidate: Any skill a supervisor leg invokes on the sbx tier passes a pin to invokeSkill, because the 33.8 re-run path runs on ended runs whose sandbox is released.
- 2026-10-27T10:13:45Z — trigger: deviation-gt-0 — question: accept the patch pass's score 1 (Deps sbx/spawner seam; manifest timeout 120→60 with 58 s bounds; strict judge.json re-validation)? — ruling: accept-deviation score 1 — do: keep all three; defer the headless-drive timeout cap (34.1's e2e_engine_gate 50+40 overrun) and measure INSTALL_BOUND_S on the agent PC; a slow-PC drive timeout is a new hole, not this story's — rule candidate: Headless conformance drives run under the runner global DEFAULT_TIMEOUT (runner.py:92); a manifest timeout is honoured only for harness drives, so every headless e2e asserts its summed bounds stay below 60 s.
- 2026-10-27T10:21:19Z — trigger: file-outside-files — question: follow-up review found `SURFACE_CORES` (apps/supervisor/src/conformance.ts:126-146) lacks `tk-studio-playable-judge`, so the supervisor conformance path payloads `e2e_playable_verify.py` instead of running it direct; patch conformance.ts (outside Files, Optional in plan :86), defer, or reject? — ruling: accept-deviation score 1 — do: add `"tk-studio-playable-judge": ["playable_judge.py"], // Story 34.3` to SURFACE_CORES after tk-studio-track; add a bun test in conformance.test.ts (the e2e drive is direct, the prepare/verdict core drives are not); record DRIFT score 1 "file outside Files, named Optional in the plan's Code Map at :86" — rule candidate: Any story that adds a conformance surface with a non-core (e2e/fixture) drive in contracts/conformance/manifest.json must list a matching SURFACE_CORES entry in apps/supervisor/src/conformance.ts in its plan's ## Files, not as Optional.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review of the committed 34.3 playable-verify leg (HEAD `198d3fd`), started from a `done` spec with `followup_review_recommended: true`. Both layers ran over the code diff since `e67c04979496d6c2da8eb3e8dbce3c15be4404d3`. Two patches were applied:
- The supervisor's conformance `SURFACE_CORES` now lists the new `tk-studio-playable-judge` surface, so its e2e drive runs direct and is not payloaded to a harness worker.
- The taxonomy note on `playable_verify_cost_usd` now states the unmetered-engine case correctly.

The story's behaviour is unchanged.

**Files changed (this pass).**
- `apps/supervisor/src/conformance.ts`: `SURFACE_CORES` gains `"tk-studio-playable-judge": ["playable_judge.py"]`.
- `apps/supervisor/test/conformance.test.ts`: a `Story 34.3` isDirectDrive test (the e2e drive is direct; `prepare` and `verdict` are not).
- `plugins/tk-studio/contracts/events/taxonomy.v1.json`: the `playable_verify_cost_usd` note covers both the metered and the unmetered engine cost. Note text only, no field or version change.
- `_bmad-output/implementation-artifacts/deferred-work.md`: committed as the orchestrator left it in the working tree (DW-67..DW-70), unmodified by this session.

**Review.**
- Findings: 12 raw, 10 after dedupe.
- Patches: 2 (medium 1, low 1).
- Deferred: 0.
- Rejected: 8. Five repeat existing rulings or deferrals (DW-67/68/69, consult 10:02:36Z, plan Settled shape 2), and three are rejected on precedent or as plumbing. The reasons are in the Review Triage Log.
- Consults: 1 (file-outside-files, accept-deviation score 1).
- Follow-up review recommended: false. Patched high 0, medium 1, low 1; score 3×1 + 1×1 = 4 (< 5), no high.

**Verification.**
- From `plugins/tk-studio/lib`:
  - `uv run python -m unittest discover tests`: `Ran 2171 tests`, OK (skipped=2).
  - `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- From `apps/supervisor` (bun at `~/.bun/bin`):
  - `bun test test/conformance.test.ts`: 51 pass, 0 fail.
  - `bun test test/conformance.test.ts test/hostverify.test.ts test/worktree.test.ts` (implementer): 207 pass, 2 skip, 0 fail.
  - `bunx tsc --noEmit`: clean.

**Residual risks.** These are unchanged from the first pass:
- The judge reading PNGs inside `claude -p` in the sandbox is unproven here.
- A re-run's judge cost does not reach `job-run` (DW-67).
- The read-only rule rests on the prompt (DW-68).
- A re-run leaves the sandbox running (DW-69).
- The headless drive timeout cap is still open (DW-70).
- The supervisor-routed conformance pass over the new surface was not run here, because it needs a live supervisor and harness.

**unverifiable-here (operator).**
1. Run the supervisor-routed conformance for the surface from `apps/supervisor` against a running supervisor: `bun src/conformance.ts --json --surface tk-studio-playable-judge` (needs the supervisor running). Confirm `e2e_playable_verify.py` reports as a direct drive.
2. The first pass's TUA steps still stand: declare `playable` in TUA's `.tk-studio/config.yaml`, then `POST /runs/<id>/verify` and read back `host-verify.playable`.

DRIFT: apps/supervisor/src/conformance.ts SURFACE_CORES gained `tk-studio-playable-judge` (+ a conformance.test.ts test) — file outside Files, named Optional in the plan's Code Map at :86; without it the supervisor conformance path payloads the e2e drive — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 34-4-engine-knowledge-pinned-per-project
