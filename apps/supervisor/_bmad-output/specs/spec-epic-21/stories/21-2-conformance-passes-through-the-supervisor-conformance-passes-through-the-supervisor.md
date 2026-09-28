---
title: 'Conformance Passes Through the Supervisor'
type: 'feature'
created: '2026-09-28'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
baseline_revision: 'f06c9e9d1cc95f99c05f86fa5f7a7fe567363be7'
context:
  - '{project-root}/_bmad-output/specs/spec-epic-21/salvage-findings.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The lifted `src/conformance.ts` cannot prove the new driver conforms (acceptance (b), AD-19). Its surface and verb maps have no `tk-studio-evolve` or `tk-studio-launch` entries, it throws a TypeError on the manifest's `expect: harness-blocked` drive (no `argv`), and its report carries fewer checks per surface than `runner.py run`, so the two cannot be compared.

**Approach:** Fix `conformance.ts` in place so it drives every manifest surface through the supervisor (`server.ts` over stdio, `tk_invoke` per drive), skips or runs harness drives per §8, reports the driver as the studio supervisor, and can compare its report against `runner.py run` direct, failing on any divergence.

**User story (verbatim, epics.md Story 21.2):** As the operator, I want the shipped conformance suite driven through the supervisor, so that acceptance (b) proves the new driver honours the contract (AD-19).

## Boundaries & Constraints

**Always:**
- Read the manifest from the installed plugin (`$TK_STUDIO_ROOT/plugins/tk-studio/contracts/conformance/manifest.json`); drive the studio only through published invocations (AD-2): `tk_invoke` → `claude -p "/tk-studio:<skill> …"`, the §1 pure-data allowance (`uv run <core>`), and `uv run …/contracts/conformance/runner.py run --no-emit` for the direct comparison. Never import, copy or patch plugin code.
- Every shipped surface gets the same check list as `runner.py`: `registered`, `status-block`, `unrunnable-core`, `auth-preflight`, then one check per manifest drive (harness drives included, skipped or run). Check counts per surface must equal the direct runner's.
- A harness drive without `--harness` is one check, `ok: true`, detail naming the skip and its reason (spend-bearing, `--harness` not given); the report carries `harness_pass: {declared, state}` like the runner.
- With `--harness`, the drive runs through the supervisor's worker path (host mode `auto`, no `ANTHROPIC_API_KEY`, bypass refused) under the drive's `settings` profile, bounded by the drive's `timeout` or 180 s, and is judged per §8: a terminal status block that is schema-valid (every required key, no key outside the schema), `status: blocked`, `intent` = the surface, a non-empty `reason`, and the declared marker (if any) inside `reason`. A question/free text, a `complete` block, a hang, or a supervisor preflight refusal (nothing driven) fails with the gap named.
- The deny profile can only add denials: the supervisor accepts a settings file only when it parses to exactly `{"permissions": {"deny": [string…]}}`, and refuses anything else with a named error before any process starts. User `permissions.deny` stays untouched.
- The report's `driver` names the studio supervisor.

**Block If:**
- A live run shows a surface failing through the supervisor while passing direct, and the fix would need a plugin or contract change (Epic 20 territory) → HALT naming the surface and assertion.
- A file outside the Files list below is needed.

**Never:**
- Edit the plugin, the manifest, `runner.py`, or anything under `$TK_STUDIO_ROOT`. Emit `headless-failure` events (the direct runner is the sole emitter).
- Pass `--dangerously-skip-permissions`, `bypassPermissions`, or a settings profile carrying anything but `permissions.deny`.
- Touch SQLite, locks, tiers, guards, the pacer, resume, `tick.ts` or `cli.ts` (Stories 21.3–21.6). No `git push`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Evolve drives | manifest `tk-studio-evolve` (`lib/evolve.py draft …`) | evolve is a known surface with core `evolve.py` and payload `verb` (`draft\|status`); `draft` is carried as `verb` | — |
| Launch drives | `lib/launch.py status\|start`, `lib/pipeline.py resolve\|apply` | launch is a known surface with cores `launch.py`, `pipeline.py` and payload `verb` (`start\|status\|stop`); `pipeline.py` verbs (`resolve`, `apply`) are not §2 payload verbs, so those drives run direct (§1 pure-data allowance) | — |
| Plugin-relative directory | evolve's `--directory contracts/conformance/fixtures/unparseable-proposals-ledger` | a relative `--directory` value without `{sandbox}` is resolved against the plugin root (the direct runner's cwd) before translation | — |
| Harness drive, no flag | detect's `expect: harness-blocked` drive, `--harness` absent | one ok check, detail `skipped: …` with the reason; no TypeError, no process | — |
| Harness drive, `--harness` | same drive, flag given | runs under `fixtures/harness-deny-core.settings.json`; judged per §8 | named failure per gap |
| Bad profile | settings file with `allow`, `defaultMode`, or anything beyond `permissions.deny` | named refusal before spawn | never forwarded |
| Compare | `--compare-direct` | runs `runner.py run --no-emit` (`--harness` forwarded iff given), compares: both `ok`, same surface set, same per-surface check count and assertion names; report gains `comparison: {ok, divergences[]}`; any divergence → exit 1 | runner unrunnable → exit 2 |

</intent-contract>

## Code Map

- `src/conformance.ts` (452 lines, the lift) -- `VERB_SURFACES` :82, `SURFACE_CORES` :89-106 (no evolve/launch), `DIRECT_ONLY_VERBS` :111, `isDirectDrive` :119 (reads `drive.argv[0]` → TypeError on harness drives), `translateDrive` :127, `evaluate` :179, `evaluateDirect` :244, `runDirect` :269 (cwd = plugin root), `parseArgs` :297, `driveSurface` :313 (only `registered` + drives), `main` :352 (report :418 already `driver: "tk-studio-supervisor"`, no `harness_pass`). Header :2-41 still says "connector" and "static checks stay with the direct runner"; update it.
- `src/server.ts` -- `buildWorkerCommand` :248 (argv `-p … --output-format json --permission-mode <mode>`), `buildWorkerEnv` :264, `invokeSkill` :694 (preflight `ran:false` block, status block extraction), `tk_invoke` tool :638 (schema `additionalProperties: false`; add the deny-profile arg here), `lastJsonObject` :342, `resolveStudioRoot` :112.
- `src/client.ts` -- `ConnectorClient.callTool` used by conformance.ts; unchanged.
- `$TK_STUDIO_ROOT/plugins/tk-studio/contracts/conformance/runner.py` (read-only) -- the check list to mirror: `_check_status_block_doc` :94 (first SKILL.md line starting `{"status"` parses, keys ⊆ schema props, required present, status in enum, intent = surface), `_check_unrunnable_core_doc` :126 (literal `If the deterministic core is unrunnable`), `_check_auth_preflight` :147 (non-empty; `external_calls` + starts with `none` fails), harness skip :376-392, `evaluate_harness_transcript` :244, report :424-435 (`surfaces_checked`, `checks_run`, `harness_pass`). `run --no-emit [--timeout] [--harness]`; exit 0/1/2.
- `…/contracts/conformance/manifest.json` (read-only) -- 18 surfaces; one harness drive (detect, `prompt`, `settings`, `expect: harness-blocked`); evolve drive 3 uses a plugin-relative `--directory`.
- `…/contracts/driver-contract.md` §2 :97 (launch verbs `start|status|stop`, cores `launch.py`, `pipeline.py`; evolve verbs `draft|status`), §8 :324.
- Baseline: `runner.py run` direct on plugin 0.2.16 → 18 surfaces, 116 checks, 0 failures (21-1 verification).
- `claude auth status --json` here → `loggedIn: true, authMethod: claude.ai`, so the live pass runs in this environment.

## Tasks & Acceptance

**Execution:**
- `src/conformance.ts` -- add evolve/launch to `SURFACE_CORES` and `VERB_SURFACES`, launch `resolve`/`apply` to `DIRECT_ONLY_VERBS`; resolve plugin-relative `--directory`; add the three static checks; handle harness drives (skip with reason, or run under `--harness` and judge per §8); `harness_pass` in the report; driver named the studio supervisor; `--harness` and `--compare-direct` flags with a pure exported `compareReports`; export pure functions the tests need; update the header.
- `src/server.ts` -- `buildWorkerCommand` accepts an optional deny-profile path (validated deny-only, else a named error, emitted as `--settings <path>`); `tk_invoke`/`invokeSkill` carry it through. Nothing else changes.
- `test/conformance.test.ts` -- pin every matrix row that runs without a live login: evolve/launch translation and direct routing, the relative-directory resolution, harness skip (no throw, ok check with reason), the §8 harness judge (pass, complete block, missing block, missing marker, extra key, preflight refusal), static checks against temp SKILL.md fixtures, deny-profile accept/refuse, `compareReports` (equal, count divergence, surface divergence, one side not ok), report `driver` name.
- `README.md` -- operator commands for the conformance pass and the comparison; drop the "Stories 21.2 … fix them" line for conformance.ts.

**Acceptance Criteria (verbatim from epics.md Story 21.2):**
- AC1: Given `contracts/conformance/manifest.json` from the installed plugin, when the lifted `conformance.ts` runs it through the supervisor, then every surface in the manifest is driven, the missing `evolve` and `launch` surface and verb entries are added, and the report names the driver as the studio supervisor.
- AC2: Given a drive declared `expect: harness-blocked`, when the suite runs without `--harness`, then the drive is reported as skipped with its reason, never a thrown error; with `--harness` it runs under a denying permission profile and is judged per §8.
- AC3: Given the supervisor-driven report and `runner.py run` direct, on the same plugin version, when they are compared, then both are ok over the same surfaces and check counts, and any divergence fails the story.

## Spec Change Log

## Review Triage Log

### 2026-09-28 — Review pass
- layers: blind-hunter, edge-case-hunter (band M: 4 files; both ran). Both reviewers were handed the diff as a file (`/tmp/v212/diff.txt`, 1072 lines) rather than inline.
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 0, low 4)
- defer: 0
- reject: 2: (low 2)
  - The harness drive drops the manifest's `prompt`. This is consult-accepted deviation 4: the supervisor's published invocation rebuilds the same skill line.
  - "Schema-valid" checks only key names and the status enum. `runner.py` does the same (`_check_status_block_doc`, `evaluate_harness_transcript`), so the checks mirror it one for one.
- addressed_findings:
  - `[high]` `[patch]` A relative `deny_profile` was validated against the supervisor's cwd while `claude -p --settings` resolved it from the worker's cwd, so a non-deny-only file could load (both layers). Fix: a non-absolute path is `DenyProfileRefused` before any process starts; the same absolute path is validated and forwarded. Test added.
  - `[low]` `[patch]` AC2's profile forwarding was unpinned. Fix: `invokeSkill` with a valid profile spawns with `--permission-mode auto --settings <path>`; the exported `harnessInvokeArgs` pins the bound (drive `timeout` or 180 s), the payload and the resolved profile.
  - `[low]` `[patch]` The matrix Compare row's "runner unrunnable → exit 2" had no test (matrix audit). Fix: `runDirectRunner` takes an injectable exec; tests cover exit 1 with a report, `--harness` forwarding, other exits, no report, and a timeout.
  - `[low]` `[patch]` `--compare-direct --harness` spent on the direct runner before the supervisor was known to start. Fix: client init and the contract gate run first.
  - `[low]` `[patch]` The README said every drive goes through `tk_invoke`. Fix: it now names the direct §1 pure-data drives and the shared identical payloads.

### 2026-09-28 — Review pass (follow-up)
- layers: blind-hunter, edge-case-hunter (no story plan for 21-2, so no S band; both ran). Both reviewers were handed the diff since the baseline as a file (`/tmp/v212f/diff.txt`, 1166 lines).
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 7: (low 7)
  - Blind: the schema check compares key names and the status enum only. It mirrors `runner.py` one for one; the previous pass rejected this for the same reason.
  - Blind: the harness drive drops the manifest's `prompt`. This is consult-accepted deviation 4.
  - Blind: hang detection keys on error text. The supervisor's worker timeout surfaces as a `… timed out after Ns` tool error (`src/server.ts` runClaude), which `evaluateHarness` matches.
  - Blind: `driveSurface`'s check order and `main`'s exit mapping are untested. The order is proven by the live `--compare-direct` run (equal assertion lists). `main`'s mapping is two lines over the tested `compareReports` and `runDirectRunner`.
  - Edge: the profile could change between validation and `claude` reading it (TOCTOU). That needs write access to the operator's own profile file, which the supervisor already trusts.
  - Edge: a relative `TK_STUDIO_ROOT` makes the harness profile path relative. It fails loudly with `DenyProfileRefused`, never silently.
  - Edge: an earlier well-formed block could be judged when the final one is malformed. That is `extractStatusBlock`, 21-1 logic shared by every drive and unchanged by this story.
- addressed_findings:
  - `[low]` `[patch]` A tk_invoke-routed drive with a plugin-relative `--directory` (evolve's unparseable-ledger fixture) pointed an auto-mode LLM worker at a directory inside the installed plugin (edge-case-hunter). Fix: the exported `stagePluginFixture` copies the fixture to `<sandbox>/fixtures/<plugin-relative path>` and passes the copy. Direct §1 drives keep the plugin path, per the matrix row. Tests added. Live evolve pass green.
  - `[low]` `[patch]` On Windows, a root-relative `deny_profile` (`\x\p.json`) passes `isAbsolute`. The supervisor validated it on its own drive while the worker loaded it from its cwd's drive (edge-case-hunter). Fix: `validateDenyProfile` reads and returns `resolve(path)`, and `buildWorkerCommand` forwards exactly that path as `--settings`. Test added.

## Design Notes

- Why the static checks: AC3 demands equal check counts; the runner emits four per-surface checks before the drives. They read only contract-published files (SKILL.md surfaces, the manifest, `status-block.schema.json`), so mirroring them keeps AD-2.
- Why launch's pipeline verbs run direct: §2's launch payload declares `start|status|stop`; `pipeline.py resolve|apply` cannot be expressed as that payload — the same rule already applied to research's `seed|spine`.
- Live proof is the verify gate's own step: AC1/AC3 by the full `--compare-direct` run; AC2's `--harness` leg by the detect surface alone (spend-bearing).

## Verification

**Commands:**
- `bun install --frozen-lockfile`, `bun test`, `bunx tsc --noEmit` -- expected: green
- `timeout -k 5 5400 bun src/conformance.ts --json --compare-direct` -- expected: exit 0; `ok: true`; `driver` names the studio supervisor; 18 surfaces / 116 checks equal to `runner.py`; `comparison.ok: true`; `harness_pass.state` names the skip
- `timeout -k 5 900 bun src/conformance.ts --json --harness --surface tk-studio-detect` -- expected: exit 0; the harness check `ok` judged per §8
- `git grep -n -E "(/c/|[A-Z]:\\\\|/home/|/Users/)" -- src test README.md` -- expected: nothing

## Deviation Summary

### pass 1 (2026-09-28, implementer)

- planned: `translateDrive(surface, drive, sandbox)` signature as lifted / actual: takes a fourth `pluginRoot` argument; a new exported `resolveDriveArgv` does the `{sandbox}` substitution and relative `--directory` resolution for both routes / why: the resolution needs the plugin root, and direct drives must resolve the same way / may affect: none
- planned: `--compare-direct` with any flag combination / actual: `--compare-direct` together with `--surface` is refused with exit 2 / why: the runner has no surface filter, so a filtered comparison would always diverge on the surface set / may affect: none
- planned: `buildWorkerCommand` validates the deny profile / actual: validation lives in a new exported `validateDenyProfile` plus the `DenyProfileRefused` error class, which `buildWorkerCommand` calls; the new tool argument is named `deny_profile` / why: gives a named, separately testable refusal; the spec named no argument / may affect: 21-4
- planned: harness drive runs the drive's `prompt` / actual: runs `tk_invoke` with skill = surface and an empty payload (directory defaults to the sandbox); the manifest `prompt` isn't used / why: the supervisor's published invocation builds the skill line itself, and the shipped prompt is just `/tk-studio:tk-studio-detect` / may affect: none
- planned: §8 harness judge as listed / actual: also fails when the reason starts with "harness auth", i.e. the worker hit the Max-login gate / why: that is a nothing-driven case the preflight-refusal rule is meant to catch / may affect: none

DEVIATION SCORE: 2 (consult: the `deny_profile` tool arg is a seam 21-4's worker command line relies on)

Note (consult): the §1 headless preamble `buildSkillPrompt` adds is part of the published invocation the harness drive exercises; the manifest's bare `prompt` is only the skill line it rebuilds.

DRIFT: `translateDrive` gains a `pluginRoot` argument and a shared `resolveDriveArgv` — relative `--directory` resolution needs the plugin root on both routes — affects: none
DRIFT: `--compare-direct` with `--surface` refused (exit 2) — the runner has no surface filter, so a filtered comparison always diverges — affects: none
DRIFT: deny profile validated by exported `validateDenyProfile`/`DenyProfileRefused`; `tk_invoke` arg `deny_profile` — named, testable refusal; spec named no argument — affects: 21-4
DRIFT: harness drive goes through `tk_invoke` (skill = surface, empty payload), not the manifest's raw `prompt` — the supervisor's published invocation builds the skill line — affects: none
DRIFT: §8 harness judge also fails a reason starting "harness auth" — nothing was driven — affects: none

### pass 2 (2026-09-28, implementer: review patches)

- planned: `buildWorkerCommand` validates the deny profile / actual: after review it also refuses a non-absolute profile path (`DenyProfileRefused`) / why: a relative path was validated against the supervisor's cwd while `claude -p --settings` resolves it from the worker's cwd / may affect: 21-4
- planned: `runDirectRunner` private and run before the supervisor client / actual: exported with an injectable `RunnerExec`, and run after the client's contract gate; the harness branch's `tk_invoke` args built by the exported `harnessInvokeArgs` / why: review patches (test seams, no spend before the supervisor is known to run) / may affect: none

DEVIATION SCORE: 2 (consult: narrowing the `deny_profile` seam 21-4 relies on scores 2; the runner export/reorder alone is local)

DRIFT: `deny_profile` must be an absolute path. A relative path is DenyProfileRefused, because the supervisor validated against its own cwd while `claude -p --settings` resolved against the worker's cwd — affects: 21-4 (it must pass an absolute profile path)
DRIFT: `runDirectRunner` exported with an injectable exec; `--compare-direct` runs the client + contract gate before the direct runner — review-directed ordering and test seam — affects: none

### pass 3 (2026-09-28, implementer: follow-up review patches)

- planned: `validateDenyProfile` exposes the canonical path it validated / actual: the return type changed from `string[]` to the exported `DenyProfile {path, deny}`; `buildWorkerCommand` forwards `--settings <resolve(path)>` / why: the validated path and the forwarded path are now one value / may affect: none (the `deny_profile` input set and the `--settings` argv shape are unchanged)
- planned: stage plugin-relative fixtures at `<sandbox>/fixtures/<basename>` / actual: the exported `stagePluginFixture` copies to `<sandbox>/fixtures/<path relative to the plugin root>`, for tk_invoke-routed drives only / why: two fixtures with the same folder name cannot collide / may affect: none

DEVIATION SCORE: 1 (consult: pass 3 is local; the story's deviation_score stays 2 from passes 1–2)

DRIFT: tk_invoke-routed drives stage plugin-relative fixtures to <sandbox>/fixtures/<plugin-relative path>; direct §1 drives keep the plugin path — affects: none

## Consult Log

- 2026-09-28T10:15:29Z — trigger: deviation-gt-0 — question: accept the pass-1 deviation set (resolveDriveArgv/pluginRoot, compare+surface refusal, deny_profile validation, harness via tk_invoke, harness-auth judge)? — ruling: accept-deviation score 2 — do: Accept all five and proceed to review; record pass-1 score 2 (deny_profile tool arg is a seam 21-4 relies on). / Keep the harness drive on tk_invoke; note in the Deviation Summary that the §1 headless preamble is part of the published invocation the harness drive exercises. — rule candidate: a deviation that adds or renames an argument on a supervisor MCP tool schema and names a later story in may-affect scores 2 automatically, no consult. — observe record: ok
- 2026-09-28T10:19:31Z — trigger: deviation-gt-0 (review-patch pass 2) — question: accept the pass-2 deviations (absolute-path deny_profile refusal; runDirectRunner export + client-first ordering)? — ruling: accept-deviation score 2 — do: Accept (a) and (b) and continue; record pass-2 score 2 (narrows the deny_profile seam 21-4 relies on); story deviation_score stays 2. / Add the DRIFT line: deny_profile must be an absolute path (relative → DenyProfileRefused) — affects 21-4. / Keep the new main order and the exported runDirectRunner with injectable RunnerExec. — rule candidate: a deviation narrowing or widening a supervisor MCP tool arg already scored 2 for a later-story seam inherits score 2 without a consult, provided the DRIFT line names the new constraint. — observe record: ok
- 2026-09-28T10:31:28Z — trigger: deviation-gt-0 (follow-up review, patch pass 3) — question: accept the pass-3 deviations ((a) validateDenyProfile returns DenyProfile {path, deny} and --settings forwards resolve(path); (b) stagePluginFixture copies plugin-relative fixtures to <sandbox>/fixtures/<rel> for tk_invoke-routed drives)? — ruling: accept-deviation score 1 — do: Accept both (a) and (b); record pass-3 score 1; story deviation_score stays 2 (set by passes 1–2). / No new DRIFT line for (a) — the existing "deny_profile must be an absolute path … affects: 21-4" line still describes the seam exactly; log (b) as DRIFT "tk_invoke-routed drives stage plugin-relative fixtures to <sandbox>/fixtures/<plugin-relative path>; direct §1 drives keep the plugin path — affects: none". / Proceed to the next review step. — rule candidate: a review patch that keeps a later-story seam's accepted input set and argv shape unchanged (it only canonicalizes the value or changes an internal helper's return type) scores 1 without a consult, provided the existing DRIFT line for that seam still describes it verbatim. — observe record: ok

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmad-loop; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review of the finished story; the spec was `done`, so step 1 routed it to a fresh review. The lifted `conformance.ts` still drives the installed plugin's whole manifest through the supervisor and matches `runner.py run` direct. The pass fixed two low defects:
- A tk_invoke-routed drive with a plugin-relative fixture `--directory` now gets a copy staged into its sandbox, so no auto-mode worker is pointed inside `$TK_STUDIO_ROOT`.
- The deny profile is validated and forwarded as one canonical `resolve()` path, which closes the Windows root-relative case.

**Files changed (this pass):**
- `src/conformance.ts`: `stagePluginFixture` (plus a private `isWithin`), called after `translateDrive` on the tk_invoke branch; header note
- `src/server.ts`: `validateDenyProfile` returns `DenyProfile {path, deny}` from `resolve(path)`; `buildWorkerCommand` forwards that path as `--settings`
- `test/conformance.test.ts`: staging tests (copy made, original untouched, `{sandbox}` not copied, missing fixture throws, direct route keeps the plugin path) and canonical-path deny-profile tests
- this spec

Story-wide (all passes): `src/conformance.ts`, `src/server.ts`, `test/conformance.test.ts` (new), `README.md`, this spec.

**Review findings:** 2 patches applied (low 2), 0 deferred, 7 rejected. Follow-up review recommended: false, because only 2 low findings were patched (score 3×0 + 2 = 2, below 5, no high).

**Verification (re-run by this session after the patches):**
- `bun install --frozen-lockfile`: ok, no changes. `bun test`: 113 pass / 0 fail. `bunx tsc --noEmit`: clean. Machine-path grep: nothing.
- `bun src/conformance.ts --json --compare-direct --concurrency 8`: exit 0 in 104 s. `driver: tk-studio-supervisor`, `ok: true`, 18 surfaces, 116 checks, 0 failures. `comparison: {ok: true, divergences: []}` against `runner.py run --no-emit`. `harness_pass.state`: `skipped: --harness not given (spend-bearing)`.
- `bun src/conformance.ts --json --surface tk-studio-evolve`: exit 0, 7/7. `unparseable-ledger-refusal` passed on the staged copy (core refusal at step `ledger-parse`).
- `bun src/conformance.ts --json --harness --surface tk-studio-detect`: exit 0. `harness_pass.state: ran`. `denied-core-refusal` passed per §8 under the profile forwarded in its `resolve()` form.

**Residual risks:**
- These carry over from the first run: launch's `start` drive maps `--spec` to `spec` rather than §2's `spec_folder`, which would need an Epic 20 contract change. Migrate's and plan-sync's refusals are satisfied by the Jira preflight. LLM-mediated drives can vary from run to run.
- The profile file can still change between validation and the worker reading it. This was rejected as needing write access to an operator-owned file.
- `--compare-direct --harness` was not run live, because it is spend-bearing on both sides.

DRIFT: `translateDrive` gains a `pluginRoot` argument and a shared `resolveDriveArgv` — relative `--directory` resolution needs the plugin root on both routes — affects: none
DRIFT: `--compare-direct` with `--surface` refused (exit 2) — the runner has no surface filter, so a filtered comparison always diverges — affects: none
DRIFT: deny profile validated by exported `validateDenyProfile`/`DenyProfileRefused`; `tk_invoke` arg `deny_profile` — named, testable refusal; spec named no argument — affects: 21-4
DRIFT: harness drive goes through `tk_invoke` (skill = surface, empty payload), not the manifest's raw `prompt` — the supervisor's published invocation builds the skill line — affects: none
DRIFT: §8 harness judge also fails a reason starting "harness auth" — nothing was driven — affects: none
DRIFT: `deny_profile` must be an absolute path. A relative path is DenyProfileRefused, because the supervisor validated against its own cwd while `claude -p --settings` resolved against the worker's cwd — affects: 21-4 (it must pass an absolute profile path)
DRIFT: `runDirectRunner` exported with an injectable exec; `--compare-direct` runs the client + contract gate before the direct runner — review-directed ordering and test seam — affects: none
DRIFT: tk_invoke-routed drives stage plugin-relative fixtures to <sandbox>/fixtures/<plugin-relative path>; direct §1 drives keep the plugin path — to keep auto-mode workers out of the installed plugin — affects: none
