---
title: 'The Engine Gate on the Host Leg'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '93ee61e31c405d4c7cae4a365b98ee150e548763'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** No run has ever imported the game or run its engine tests: the engine's Linux sandbox has no `godot`, and the host leg runs a project's `verify.host` only, so a story that breaks a scene or a GoDotTest suite reaches its PR green.

**Approach:** One additive key `verify.engine` beside `verify.host` in the project's tracked `.tk-studio/config.yaml`; the host leg (`hostVerify`) runs it after a green `verify.host`, in the worktree, with `dirname($GODOT)` first on PATH, and records `engine` on the `host-verify` result; an engine red is a red leg via the existing `green` rule. Doctor grows an `engine` row, contract 0.1.29 opens, a conformance e2e drives the leg with a fake `godot`, and the TUA proof is a kb record the operator fills.

### Acceptance Criteria (transcribed verbatim from epics.md, Story 34.1)

- **AC1** — **Given** a project config that declares `verify.engine: <one command line>` beside `verify.host` (additive; TUA's is `bash scripts/engine-gate.sh`) **When** the host leg runs (the close-out, or 33.8's `verify`) **Then** after `verify.host` is green it runs `verify.engine` in the worktree with the folder of `$env:GODOT` prepended to PATH (so `godot` resolves to the console binary the box has) and the project's own flags left to the project; the `host-verify` event carries `engine: green | red | skipped (no verify.engine)` with the exit code and the log tail; `red` ends the run `partial` with `host_verify: red` exactly as a red `verify.host` does; `bun test` covers the ordering, the PATH composition, the event and both verdicts with a fake engine binary
- **AC2** — **Given** the box **When** `tk-studio doctor` runs **Then** it reports an engine row: `$env:GODOT` set and the file present, the version `godot --version` prints, and "no engine" otherwise; the runbook names the row and the `verify.engine` key
- **AC3** — **Given** tk-studio's conformance **When** it runs **Then** an e2e drives the host leg with a fake `godot` to both verdicts; contract 0.1.29 adds `verify.engine` and the event field (additive); the story's proof on TUA (an ended TUA run re-verified through `POST /runs/{id}/verify`, the import and the GoDotTest suite green on the host) is recorded in `kb/`

## Boundaries & Constraints

**Always:** Follow SPEC.md `## Design notes (settled shape, planner, 2026-10-27)` (the seven CAP-1/CAP-2 bullets) and the plan's Settled shape 1-7 exactly. The engine step runs only when the host step ran green; argv via `splitCommand`, never a shell; never resolve `godot` itself; one PATH key only (`pathKey`, hole 54); each step gets the full worker guard. Leg `green` = host green && engine.verdict !== "red", so every consumer reads red through `isRed`/`green` with no caller edits. Studio scripts stdlib-only via `uv run`; writes atomic; headless surfaces end with the JSON status block; `kb/index.md` regenerated with `uv run plugins/tk-studio/lib/kb.py index --directory .`, never hand-edited. Touch only the plan's Files; any other file is a recorded DRIFT.

**Block If:** (1) a consumer other than `isRed`/`green` needs its own engine rule to end the run `partial` or keep the PR draft (name the path:line); (2) the engine step needs its own wall clock separate from the worker guard; (3) widening `SBX_ENV_PASSTHROUGH_PREFIXES` to `GODOT` is needed for the leg to see it; (4) conformance `ok` must depend on an absent `bun` differently from the `cli_drives` "not run" precedent; (5) the Files list grows past band L.

**Never:** Edit `worktree.ts`, `hostleg.ts`, `server.ts`, `board.ts`, `office.ts`, `launch.py`, `tools/verify_host.py`; merge `verify.engine` with `engine.verify_commands` (33.5); a model on the host leg; push, tag, PR, release motion, version bumps beyond the contract's 0.1.29; edits to `epics.md`, `stories.yaml`, plan files, `.bmad-loop/*.toml`, `_bmad-output/implementation-artifacts/supervision/`, `.claude/`, `_bmad/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Both green | `verify.host` exit 0, `verify.engine` exit 0, `GODOT` set | `green: true`; `engine: {verdict: "green", exit: 0, argv, cwd: worktree, godot_dir, tails}`; host spawned before engine | none |
| Engine red | host 0, engine exit 1 | `green: false`; `engine.verdict: "red"`, `exit: 1`; `redReason` starts ``host verify red (engine): `<cmd>` ``; PR body `Engine gate: red` + fenced tails; close-out `partial`, `--draft` | red leg |
| Engine guard / spawn fail | guard trips / missing binary | `engine.guard` / `engine.error` set; verdict `red` | red leg |
| Host red | host exit ≠ 0 | engine never spawned; `engine: {verdict: "skipped", reason: "verify.host red", godot_dir}`; `redReason` host text unchanged | red leg (as today) |
| No key | `verify.engine` absent | `engine: {verdict: "skipped", reason: "no verify.engine", godot_dir}`; `green` follows host | none |
| Bad key | `verify.engine` non-string or empty | `skipped`, `reason: "verify.engine is not a non-empty string"` | none |
| Host-side skip | no config / no `verify.host` | `{skipped, reason}` as today, no `engine` field | none |
| GODOT unset | env lacks `GODOT` | engine still runs, PATH unchanged, `godot_dir: null` | none |
| Doctor | `GODOT` unset or no file / `--version` exit 0 / non-zero | `engine` row `skipped` `no engine` / `pass` `<path>; <first line>` / `fail` | doctor stays `complete` |

</intent-contract>

## Code Map

The plan's `## Code Map` (`_bmad-output/specs/spec-epic-34/plans/34-1.md`) is the investigation; anchors re-checked 2026-10-27 (hostverify.ts 234 lines: `HostVerifyRan` :50, `HostVerifySkipped` :59, `splitCommand` :77, `tail` :123, green rule :175, `isRed` :209, `redReason` :214, `prSection` :222; 49 `0.1.28` occurrences in `test_driver_contract.py`). Distilled:

- `apps/supervisor/src/hostverify.ts` -- the whole leg; both callers (`worktree.ts` `sweepEngines` close-out, `hostleg.ts` `runLeg` re-verify) record its result, so no caller edits. Add `EngineStep`, `engine` on `HostVerifyRan`, engine answer from `verifyCommand` (:92-120), factor `runStep` from the spawn (:136-190), prepend `dirname(GODOT)` under `pathKey(env)` on top of the host step's final env (:156-170), apply the bare-first-token resolution to engine argv too, green rule, `redReason` `(engine)` text, `prSection` `Engine gate:` line, header comment.
- `apps/supervisor/test/hostverify.test.ts` -- AC1 suite; helpers `bunCmd` :13, `project` :16-21, `hostKey` :22, fake `run` dep :234-259, `Path` spelling :262-288; fake binary via `fakeBin` (`test/fakes.ts` :34) in `tempDir("tk-sup-godot-")` (`test/tmp.ts`), `GODOT` through `deps.env`.
- `apps/supervisor/test/worktree.test.ts` -- one sweep case in "Story 27.4" describe (:515-950; red case pattern :562-586).
- `apps/supervisor/test/board.test.ts` -- fixtures only, if `HostVerifyRan` literals need `engine` (prefer fixtures gaining `engine` over making it optional).
- `apps/supervisor/README.md` -- leg paragraph (:226), verify route row (:56), config example + `verify.engine` vs `engine.verify_commands` sentence.
- `tools/installer/cli/tk_studio_cli/doctor.py` -- `check_engine` using `_check` (:86-89), `_run` (:103), `apps._var(ctx,"GODOT")`, pattern `check_tailscale_cert` (:554-584); register after `check_studio_web` in `run_doctor` (:1173-1195); docstring process list (:1-33).
- `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- `ALLOWED` (:38), `DoctorHost` (:46-86), `AllFailing` (:211-268, keep `GODOT` unset), `AllPassing` (:271-306), four new rows.
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 header `**0.1.29**` + clause; line 6 Story / rulings; `**0.1.29 (Story 34.1, additive).**` paragraph after 33.8's block (:377-404); launch row (:588) distinction sentence.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- every `**0.1.28**` current-version pin → `**0.1.29**`; new `test_0_1_29_story_34_1_engine_gate` (pattern :995-1040); narrative block :84-109 one line.
- `plugins/tk-studio/contracts/conformance/e2e_engine_gate.py` (new) + `manifest.json` -- model `e2e_verify_commands.py`, drive under `surfaces."tk-studio-launch".drives[]` (:134-138); `runner.py` `_run_drive` (:210-335).
- `kb/agent-pc-setup-runbook.md` -- §3.8 step 5 (:848-861), §4 table (:969), §4.7 `host-verify` row (:1244), §7 list (:1330-1349), §8 row (:1395) rewritten as landed.
- `kb/acceptance-record-34-1-engine-gate-on-tua.md` (new, modelled on `kb/acceptance-record-23-3-queue-driven-run-2026-10-17.md`) + regenerated `kb/index.md`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- engine step per Settled shape 1-3 -- AC1
- `apps/supervisor/test/hostverify.test.ts` -- tests listed in plan §Verify "Tests to write" (ordering, host red, engine red, timeout/spawn fail, no key/bad key, PATH composition incl. `Path` spelling and `GODOT` unset, both verdicts through the fake binary found only via the prepended folder) -- AC1
- `apps/supervisor/test/worktree.test.ts` -- host green + engine red sweep ends `partial`, `--draft`, event `engine.verdict === "red"`, reason `(engine)` -- AC1
- `apps/supervisor/test/board.test.ts` -- fixture `engine` only if type-check requires -- AC1
- `apps/supervisor/README.md` -- document the step -- AC1/AC2
- `tools/installer/cli/tk_studio_cli/doctor.py` + `plugins/tk-studio/lib/tests/test_installer_doctor.py` -- `engine` row (Settled shape 4) and its four rows -- AC2
- `kb/agent-pc-setup-runbook.md` -- name the row and the key -- AC2
- `plugins/tk-studio/contracts/driver-contract.md` + `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.29 (Settled shape 7) -- AC3
- `plugins/tk-studio/contracts/conformance/e2e_engine_gate.py` + `manifest.json` -- e2e drive (Settled shape 5) -- AC3
- `kb/acceptance-record-34-1-engine-gate-on-tua.md` + `kb/index.md` -- operator steps and `## Evidence` (Settled shape 6) -- AC3

**Acceptance Criteria:**
- Given the AC1 matrix rows, when `bun test test/hostverify.test.ts` and `test/worktree.test.ts` run, then all pass.
- Given the doctor suite, when the lib suite runs, then the four `engine` rows and the updated `ALLOWED`/`AllPassing` pass.
- Given conformance, when `runner.py run` runs, then `ok: true` and the engine-gate drive passes (or records `not run` without `bun`).
- Given the TUA proof, then it is `unverifiable-here`: the kb record holds the operator commands.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- layers: blind-hunter, edge-case-hunter (band L, both run); the ~128 KB diff was handed to both layers as a file (`/tmp/…/diff.txt`; the contract's two very long lines were shown as a word-diff) instead of inline
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 3, low 1)
- defer: 0
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Docs claimed a bare `godot` resolves through `GODOT`'s folder, but the box's console exe is `Godot_v4.7.2-stable_mono_win64_console.exe` (runbook §2). Reworded doctor `FIX_ENGINE`/docstring, the runbook §3.8 and doctor-row text, and kb record step 2: the folder goes first on PATH, and a project calls the engine through `$GODOT` (as TUA's `engine-gate.sh` does). Behaviour unchanged.
  - `[medium]` `[patch]` A bare or relative `GODOT` made `dirname` return `.`, which put the worktree first on the engine PATH. The folder is now prepended (and `godot_dir` set) only for an absolute `GODOT`; new test. README and contract 0.1.29 now say `null` when "unset or not an absolute path".
  - `[medium]` `[patch]` The e2e drive's 420 s bound sat above the runner's 60 s drive cap, so a runner kill would orphan `bun` and skip temp cleanup (33.4 rule). `BOUND_S` is now 50 s with a comment; manifest note fixed.
  - `[low]` `[patch]` Doctor `check_engine` now strips `GODOT` as the leg trims it; new padded-value test.
- rejected:
  - doctor row passes for a winget-link `GODOT` (only `--version` works there): Settled shape 4 and AC2 define `pass` as `--version` exiting 0. Detecting the link would extend the story, and `FIX_ENGINE_RUN` already names it.
  - `GODOT` naming a folder or a missing path: the spec rule is `dirname(GODOT)`, and the doctor row already reports a missing file as `no engine`.
  - quoted `GODOT` value: the runbook sets it unquoted, and a quoted value shows as `no engine` on the doctor row.

### 2026-10-27 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (band L, both run). Both were given the diff since `93ee61e31c405d4c7cae4a365b98ee150e548763` as a file (`/tmp/rv341/diff.patch`, 1412 lines, executor spec excluded) instead of inline.
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 5: (high 0, medium 2, low 3)
- addressed_findings:
  - `[low]` `[patch]` When `GODOT` named an existing folder, the doctor `engine` row said `... which does not exist`. It now says `no engine (GODOT names <path>, which is not a file)` when the path exists. New test.
  - `[low]` `[patch]` Doctor could `pass` a relative `GODOT`, but since pass 2 the leg does not prepend a relative `GODOT`'s folder. It now returns `fail` with `GODOT <value> is not an absolute path: the host leg leaves PATH unchanged` and `FIX_ENGINE`, and starts nothing. Docstrings updated. New test.
- rejected:
  - `[medium]` The PATH prepend does not make a bare `godot` resolve on the box, because the console exe has a different name. Pass 1 already patched the docs for this. The criterion's mechanism (the folder of `$GODOT` first on PATH) is built, and the plan forbids the leg resolving `godot` itself.
  - `[medium]` Doctor reads `GODOT` from the registry first (`apps._var`), while the leg reads the supervisor's process env. Rejected: `apps._var(ctx, "GODOT")` is the source the plan prescribes (Code Map, Settled shape 4), and the runbook and the kb record already say to restart the supervisor after setting `GODOT`.
  - `[low]` The e2e drive goes red when `bun install` has not run in `apps/supervisor`. Rejected: Settled shape 5 and Block If (4) name exactly two not-run cases (no checkout, no `bun`). A third skip case would widen the gate's blind spot, which is a design call. A red that shows the import error is an honest signal for a broken checkout.
  - `[low]` No test covers the re-run (`hostleg.ts` `runLeg`) carrying `engine`. Plumbing: `runLeg` records `hostVerify`'s result and reads its `green` unchanged (`hostleg.ts` is a Never-edit file). AC1's `bun test` list (ordering, PATH composition, the event, both verdicts) is covered.
  - `[low]` Doctor passes when `--version` exits 0 and prints nothing. Rejected: Settled shape 4 defines `pass` as exit 0, and the detail already reads `(no version printed)`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH TMPDIR=$(mktemp -d)`; then each of `bun test test/hostverify.test.ts`, `test/worktree.test.ts`, `test/hostleg.test.ts`, `test/board.test.ts`, `test/office.test.ts`, `test/closeout.test.ts`, `test/api.test.ts`, `test/conformance.test.ts` -- expected: pass; then `bun x tsc --noEmit` -- clean; `find "$TMPDIR" -maxdepth 1 -name 'tk-sup-*' | wc -l` -- 0; remove `$TMPDIR`
- `git diff --stat -- .claude _bmad` -- expected: empty

**Manual checks (unverifiable-here, operator on the agent PC):**
- TUA PR adds `verify.engine: bash scripts/engine-gate.sh`; restart the supervisor after `GODOT` is set; `POST /runs/<id>/verify` (or `bun src/cli.ts verify <id>`) on an ended TUA run; the `host-verify` event's `engine.verdict` is `green` with import and GoDotTest lines in `engine.stdout_tail`; fill the record's `## Evidence`; `tk-studio doctor --json` shows `engine` `pass` with the 4.7.2 version line.

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: `engine` required on `HostVerifyRan`, fixtures gain it / actual: `engine?: EngineStep` optional; `redReason`/`prSection` tolerate absence; `board.test.ts` untouched / why: pre-34.1 `host-verify` events are re-read by the close-out and the re-run, so the type must admit them / may affect: 34-3-the-playable-verify-leg
- planned: doctor `AllFailing` asserts `set(commands)==ALLOWED` / actual: count unchanged (3, `GODOT` unset); set assertion now `ALLOWED - {"godot --version"}` plus `engine` row `skipped` / why: `ALLOWED` gains a command that cannot run with `GODOT` unset / may affect: none
- planned: skipped detail `no engine` / actual: unset → `no engine`; missing file → `no engine (GODOT names <path>, which does not exist)` / why: names the bad path for the fix / may affect: none
- planned: manifest `assertion` names the engine gate / actual: `assertion: "headless-clean"` (shared vocabulary, as 33.5's drive) with the phrase in `note` / why: assertion names are a shared reporting set / may affect: none
- planned: e2e bounded by 420 s / actual: script bounds `bun test` at 420 s but `runner.py` caps non-harness drives at 60 s / why: no per-drive timeout outside harness drives; changing the runner is out of scope / may affect: none
- planned: fake-`godot` test PATH otherwise empty-bin / actual: PATH holds bun's and git's folders; the `GODOT`-unset case proves `godot` resolves only through the prepended folder / why: the fake's shebang needs `bun`, the config read needs `git` / may affect: none
- planned: `kb/index.md` via `kb.py index --directory .` / actual: generated by `kb.py` over a copy of `kb/` in a folder named `tk-studio` (heading taken from folder name; the worktree folder is the run id); regeneration also adds two existing pages the committed index lacked (`engagement-loop.md`, `quote-band.md`) / why: a direct run would rename the index heading / may affect: none
- planned: test helpers unchanged / actual: `worktree.test.ts` `config`/`launchedSbx` gained an optional `engine` arg; `doctor.py` section comment "only these three" → "only these" / why: needed for the sweep case; comment otherwise wrong / may affect: none
- planned: `bun x tsc --noEmit` / actual: `bun node_modules/typescript/bin/tsc --noEmit` / why: sandbox EPERM creating `node_modules/.bin` links / may affect: none

DRIFT: `engine` optional on `HostVerifyRan` (not required with fixture edits; producer always writes it, contract 0.1.29 says so) — pre-34.1 recorded events must still type as `HostVerifyRan`; consult scored 2 — affects: 34-3-the-playable-verify-leg (readers must handle a missing `engine`; add `playable` the same way: optional on the type, always written by the producer)
DRIFT: doctor `AllFailing` set assertion excludes `godot --version` — `GODOT` unset in that case — affects: none
DRIFT: doctor missing-file detail extends `no engine` with the path — operator fix needs the path — affects: none
DRIFT: e2e drive `assertion: headless-clean` with the phrase in `note` — shared assertion vocabulary — affects: none
DRIFT: e2e effective bound is runner's 60 s, not 420 s — runner has no per-drive timeout — affects: none
DRIFT: fake-godot PATH carries bun/git folders — shebang and config read need them — affects: none
DRIFT: `kb/index.md` regenerated via a `tk-studio`-named copy, adding two previously missing pages — heading derives from folder name — affects: none
DRIFT: optional `engine` arg on worktree test helpers; doctor comment wording — needed for the sweep case — affects: none
DRIFT: tsc run via `bun node_modules/typescript/bin/tsc` — EPERM on `.bin` links — affects: none

### pass 2 (2026-10-27, review patches)

- planned: patch 1 rewords only the "`godot` found through the folder" claims / actual: the runbook doctor-row text also changed "the version `godot --version` prints" to `& $env:GODOT --version` / why: the old sentence implied the same bare-name resolution; the new form matches runbook §2 / may affect: none
- planned: the absolute-path guard touches code and one test / actual: hostverify.ts doc comments, the README and the contract 0.1.29 paragraph now say `godot_dir` is `null` when `GODOT` is "unset or not an absolute path" / why: the contract has to describe the leg's behaviour / may affect: none
- planned: e2e drive bounded at 420 s (pass-1 DRIFT) / actual: bounded at 50 s, below the runner's 60 s cap / why: lets the drive's own timeout kill `bun` and clean up its temp folder / may affect: none

DRIFT: runbook doctor-row text names `& $env:GODOT --version` — the box's exe is not named `godot` — affects: none
DRIFT: `godot_dir` is `null` also for a non-absolute `GODOT` (code, README, contract 0.1.29) — keeps the worktree off the front of PATH — affects: none
DRIFT: e2e drive bound 50 s (supersedes the pass-1 420 s line) — runner's 60 s cap — affects: none

### pass 3 (2026-10-27, follow-up review patches)

- No deviations. Both patches stay inside the plan's Files (`tools/installer/cli/tk_studio_cli/doctor.py`, `plugins/tk-studio/lib/tests/test_installer_doctor.py`).

## Consult Log

- 2026-10-27T04:44Z — trigger: deviation-gt-0 — question: accept the implementer's nine deviations (notably `engine?` optional on `HostVerifyRan` vs plan's "prefer fixtures") at score 1, 2, or reject? — ruling: accept-deviation score 2 — do: keep `engine?: EngineStep` and its doc comment, leave board.test.ts fixtures without `engine`; record at score 2; note for 34-3: from 0.1.29 every new ran `host-verify` carries `engine` but readers of recorded events must handle it missing, and `playable` should follow the same pattern — rule candidate: a new field on a persisted event type is optional on the TS type, documented as always written from the contract version that adds it, tested on the producer's output; score 2 when a later story extends the same type

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass over the Story 34.1 engine gate, which commit `657840b11eb36e5bbea2d0ae9061f739bd4a696f` already implemented. Both layers re-reviewed the full diff from the baseline. Two low-severity patches were applied to doctor's `engine` row:
- A `GODOT` that names a folder now reads `which is not a file`.
- A non-absolute `GODOT` now gives `fail`, in line with pass 2's rule that the leg prepends only an absolute `GODOT`'s folder.

The leg, the contract (0.1.29) and the conformance drive did not change in this pass.

**Files changed (this pass).**
- `tools/installer/cli/tk_studio_cli/doctor.py`: `check_engine` now distinguishes unset, not absolute (`fail`), missing and not-a-file. Module and function docstrings updated.
- `plugins/tk-studio/lib/tests/test_installer_doctor.py`: two engine-row tests (a folder `GODOT`, a relative `GODOT`) and the `Engine` class docstring.

**Story files (pass 1 and 2, commit `657840b11eb36e5bbea2d0ae9061f739bd4a696f`).**
- `apps/supervisor/src/hostverify.ts` and its tests.
- `apps/supervisor/test/worktree.test.ts`.
- `apps/supervisor/README.md`.
- `doctor.py` and its tests.
- `driver-contract.md` 0.1.29 and `test_driver_contract.py`.
- `conformance/e2e_engine_gate.py` and `manifest.json`.
- `kb/agent-pc-setup-runbook.md`, `kb/acceptance-record-34-1-engine-gate-on-tua.md` and `kb/index.md`.

**Review.** Both layers ran (band L): 2 patches applied (low 2), 0 deferred, 5 rejected (reasons are in the Review Triage Log). Follow-up review recommended: false (patched: high 0, medium 0, low 2; score 3×0 + 1×2 = 2, below 5).

**Verification.**
- From `plugins/tk-studio/lib`, `uv run python -m unittest discover tests`: `Ran 2087 tests`, OK (skipped=2).
- From `plugins/tk-studio/lib`, `uv run python ../contracts/conformance/runner.py run`: `ok: true`, failures `[]`.
- `git diff --stat -- .claude _bmad`: empty.
- No supervisor (bun) file changed in this pass, so the pass-1/2 bun results stand: hostverify 33, worktree 103, hostleg 15, board 23, office 77, closeout 60, api 102, conformance 50, all with 0 failures, and `tsc` clean.

**unverifiable-here (operator, agent PC).** Unchanged from pass 1:
1. Land TUA's `verify.engine: bash scripts/engine-gate.sh` through a TUA PR.
2. Restart the supervisor after setting `GODOT` to the absolute path of the 4.7.2 Mono console exe.
3. Re-verify an ended TUA run with `curl -X POST http://<supervisor>/runs/<id>/verify`, or `bun src/cli.ts verify <id>` from `apps/supervisor`.
4. Check that the `host-verify` event has `engine.verdict: green`, with the import and GoDotTest lines in `engine.stdout_tail`.
5. Check that `tk-studio doctor --json` shows `engine` `pass` with the 4.7.2 version line.
6. Fill `## Evidence` in `kb/acceptance-record-34-1-engine-gate-on-tua.md`.

**Residual risks.**
- On Windows, Python treats a rooted path with no drive (`\foo`) as not absolute, but Node's `isAbsolute` treats it as absolute. For that `GODOT`, doctor reports `fail` while the leg prepends its folder. The runbook's `GODOT` is a full drive path, so the case does not come up there.
- A project whose `verify.engine` calls a bare `godot` gets no help from the prepend on this box, because the exe is not named `godot`. Projects call `$GODOT`, and the docs say so.
- `engine` is optional on the `HostVerifyRan` type (consult: score 2). Readers of recorded events must handle it missing, and 34-3's `playable` should follow the same pattern.
- A bun checkout without `bun install` turns the engine-gate conformance drive red (a review finding, rejected).

DRIFT: `engine` optional on `HostVerifyRan` (not required with fixture edits; producer always writes it, contract 0.1.29 says so) — pre-34.1 recorded events must still type as `HostVerifyRan`; consult scored 2 — affects: 34-3-the-playable-verify-leg (readers must handle a missing `engine`; add `playable` the same way: optional on the type, always written by the producer)
DRIFT: doctor `AllFailing` set assertion excludes `godot --version` — `GODOT` unset in that case — affects: none
DRIFT: doctor missing-file detail extends `no engine` with the path — operator fix needs the path — affects: none
DRIFT: e2e drive `assertion: headless-clean` with the phrase in `note` — shared assertion vocabulary — affects: none
DRIFT: fake-godot PATH carries bun/git folders — shebang and config read need them — affects: none
DRIFT: `kb/index.md` regenerated via a `tk-studio`-named copy, adding two previously missing pages — heading derives from folder name — affects: none
DRIFT: optional `engine` arg on worktree test helpers; doctor comment wording — needed for the sweep case — affects: none
DRIFT: tsc run via `bun node_modules/typescript/bin/tsc` — EPERM on `.bin` links — affects: none
DRIFT: runbook doctor-row text names `& $env:GODOT --version` — the box's exe is not named `godot` — affects: none
DRIFT: `godot_dir` is `null` also for a non-absolute `GODOT` (code, README, contract 0.1.29) — keeps the worktree off the front of PATH — affects: none
DRIFT: e2e drive bound 50 s (supersedes the pass-1 420 s line) — runner's 60 s cap — affects: none

## Reconcile

### 2026-10-27 — adjust-stories

- Score: 2
- Reasoning: Two deviations reach later work. (1) `engine` is optional on the `HostVerifyRan` type, though the producer always writes it from 0.1.29; 34-3 adds `playable` to the same event and its readers must tolerate older events without either field. (2) On the box the console exe is `Godot_v4.7.2-stable_mono_win64_console.exe`, so putting `dirname($GODOT)` first on PATH does not make a bare `godot` resolve. The epic narrative's "`godot` on PATH" does not hold, so later host-side callers must invoke `$GODOT`. Both can be handled with notes in the later stories' `invoke_dev_with`. No acceptance criterion of a later story changes. The other nine DRIFT lines are `affects: none`, and their test-helper, tooling and wording changes back that up.
- Affected: 34-3-the-playable-verify-leg — the `host-verify` event "carries `playable: pass | fail | skipped`" must be added the way `engine` was (optional on the type, always written by the producer); readers of recorded events handle both fields missing
- Affected: 34-2-spike-a-playable-run-on-the-box — "starts the game" on the host: the binary is `$GODOT`; a bare `godot` does not resolve on the box (epic narrative "`godot` on PATH")
- Affected: 34-4-engine-knowledge-pinned-per-project — "the `$env:GODOT` rule on the box": the rule is "call the engine through `$GODOT`", not "`godot` on PATH"
- Invariant: none (contract 0.1.29 says every ran `host-verify` carries `engine`; a type that also admits pre-0.1.29 events is consistent with an additive bump)

- Gate: Part A adjust-stories; Part B story accepted, planned 34-2-spike-a-playable-run-on-the-box
