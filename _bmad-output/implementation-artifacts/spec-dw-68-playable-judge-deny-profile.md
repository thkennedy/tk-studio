---
title: 'DW-68: the playable judge runs under a scoped deny profile'
type: 'feature'
created: '2026-11-08'
status: 'done'
baseline_revision: '1f548de4ff8366c55707233ab608b19415b68ccf'
review_loop_iteration: 1
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The judge profile leaves all of `.bmad-loop/` readable, including the engine run's transcripts, tasks, bundles and journal beside the media folder, which carry the code and the spec.
    evidence: |-
      Review pass 1 (blind hunter): `judgeDenyRules` skips `.bmad-loop` wholesale; only the media chain `.bmad-loop/runs/<engine>/playable/` must stay open. The bundle intent enumerates plugins/apps/_bmad-output and the project's code folders only, so denying run state siblings level by level along the media path is beyond this bundle. Deferral class (a): DW-68's read-only rule.
    location: >-
      apps/supervisor/src/hostverify.ts judgeDenyRules
    severity: medium
  - summary: >-
      The judge profile also leaves `.bmad-loop/` writable by the Write/Edit tools, so the judge could overwrite the engine run's state (transcripts, tasks, journal) beside the media.
    evidence: |-
      Review pass 2 (blind hunter): `judgeDenyRules` skips `.bmad-loop` wholesale, so no `Edit(...)`/`Write(...)` rule covers the run folder's siblings of `playable/`. Same root as the read-side deferral; denying siblings level by level along the media path is beyond the bundle intent's enumerated folders. The half about rewriting the profile itself is moot: `--settings` is loaded at session start. Deferral class (a): DW-68's read-only rule.
    location: >-
      apps/supervisor/src/hostverify.ts judgeDenyRules
    severity: medium
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** The playable judge's "reads only report.json and the frames, never the code or the spec" rule (tk-studio-playable-judge SKILL.md) rests on the instruction alone: `defaultJudge` (apps/supervisor/src/hostverify.ts:767) launches the `claude -p` session with the whole worktree mounted and no deny profile (DW-68).

**Approach:** Per the operator's recorded reading of TKSTUDIO-224 ruling A, `defaultJudge` writes a deny-only settings profile into the worktree (beside the media folder, under the ignored `.bmad-loop/`) and passes it as invokeSkill's `deny_profile`: `Edit(...)`, `Read(...)` and `Write(...)` denied (consult ruling 2026-11-08: scoped `Edit`, never bare — a bare `Edit` deny also denies the Write tool) for `./plugins/**`, `./apps/**`, `./_bmad-output/**` and the project's code folders; Bash left open. Best effort, not a seal.

## Boundaries & Constraints

**Always:**
- The profile is exactly `{"permissions": {"deny": [string…]}}` (passes `validateDenyProfile`, server.ts:444) and lies inside the served root so `vmDenyProfile` maps it into the microVM.
- Written atomically (tmp + rename), with `encoding`/`utf-8` named; paths built for the Windows host too (rules are POSIX strings `./<name>/**`, never `path.join`ed).
- No rule denies `Bash` (bare or scoped), bare `Edit`, bare `Write`, bare `Read`, or any `Read(...)`/`Write(...)` path covering the media folder (`.bmad-loop/runs/<engine>/playable/`), so `uv run playable_judge.py prepare|verdict`, the `Read` of each frame, and the `answer.json` write stay permitted.
- "The project's code folders" = every top-level entry of the served root except `.bmad-loop` (the media's ancestor): a directory denied as `./<name>/**`, a file as `./<name>`. The three fixed folders are always listed, present or not.
- A profile that cannot be written is the judge's infrastructure failure (the existing `catch` at hostverify.ts:941 → `inconclusive`, cause `sbx`), never a throw out of the leg.

**Block If:** satisfying the gate requires changing the `judge.json` contract, `playable_judge.py`, or the `PlayableJudge` type's call shape.

**Never:** change `judge.json`, the judge's SKILL.md behavior, `validateDenyProfile`/`vmDenyProfile`, or injected `deps.judge` paths; deny Bash; edit the deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default judge runs | worktree with `src/`, `project.godot`, `.git`, `.bmad-loop/…/playable/` | worker argv carries `--settings <vm path of the profile>`; profile denies Edit+Read+Write for plugins/apps/_bmad-output, `./src/**`, `./project.godot`, `./.git` | none |
| Judge's own calls | same profile | no rule is `Bash`/`Bash(…)`/bare `Edit`/bare `Write`/bare `Read`; no Read/Write rule names `.bmad-loop` | none |
| Profile write fails | served root unwritable / path blocked | playable step `inconclusive`, `infrastructure: sbx: …` | caught, never thrown |

</intent-contract>

## Code Map

- `apps/supervisor/src/hostverify.ts:765-771` -- `defaultJudge`: wraps `invokeSkill(root, PLAYABLE_JUDGE_SKILL, args, spawner, {vmHostRoot, pin})`; add the profile write + `deny_profile` here. `args.payload.media` is the media path relative to `root` (`.bmad-loop/runs/<engine>/playable`, built at :850).
- `apps/supervisor/src/hostverify.ts:940-941` -- the judge call site and its catch → `infra(judgeBase, "sbx", …)`; unchanged, already catches a throwing judge.
- `apps/supervisor/src/server.ts:444-468` -- `validateDenyProfile` (absolute path, deny-only shape); `:493-496` buildWorkerCommand pushes `--settings`; `:507-516` `vmDenyProfile` (must lie inside root; maps to `toVmPath(root)/<rel>`). `InvokeArgs.deny_profile` at :1066/:1147. Read-only.
- `apps/supervisor/test/hostverify.test.ts:1096-1122` -- existing default-judge test (fake `spawner` + `sbx` pin seam, `fixture(config)`, `legEnv()`, `recorder`, `route`); model the new test on it, but let the preflight succeed so the worker `sbx exec … claude -p …` argv is captured.
- `apps/supervisor/test/tier.test.ts:330-440` -- reference for how sbx deny-profile argv is asserted.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- add an exported pure builder `judgeDenyRules(root: string): string[]` (per target `Edit(t)`, `Read(t)`, `Write(t)`; fixed list + top-level entries except `.bmad-loop`, sorted/deduped) and have `defaultJudge` atomically write `{"permissions":{"deny": rules}}` to `<root>/<dirname(media)>/judge-deny.settings.json` (beside, not inside, the media folder), then pass its absolute path as `deny_profile` -- DW-68 enforcement, best effort.
- `apps/supervisor/test/hostverify.test.ts` -- add tests: (1) the default judge's worker argv carries `--settings` pointing at the profile's VM path, and the profile on disk denies exactly the expected rules; (2) the judge's own Bash and Write stay permitted: no `Bash` rule, no bare `Edit`/`Write`/`Read`, no Read/Write rule matching the media path; (3) `judgeDenyRules` covers a top-level dir, a top-level file and excludes `.bmad-loop`; (4) a profile write failure → `inconclusive`, `infrastructure: sbx: …`; (5) AC3: with an injected `deps.judge`, no `judge-deny.settings.json` is written.

**Acceptance Criteria:**
- Given the default judge on the sbx tier, when the host leg drives it, then the `claude -p` argv carries `--settings` with the profile's microVM path and that file passes `validateDenyProfile`.
- Given that profile, when inspected, then it denies `Edit(...)`/`Read(...)`/`Write(...)` (never bare `Edit`) for `./plugins/**`, `./apps/**`, `./_bmad-output/**` and each top-level code folder, and denies nothing that blocks the judge's Bash, its frame Reads, or its `answer.json` Write.
- Given an injected `deps.judge`, when the leg runs, then no profile is written and `judge.json` handling is unchanged (existing tests stay green).

## Spec Change Log

- 2026-11-08 — loop 1. Trigger: review pass 1 finding (high) — a bare `Edit` deny also denies the Write tool (Claude Code docs: Edit rules apply to all built-in file-editing tools), blocking the judge's `answer.json` Write; consult ruled accept-deviation score 1 (see Consult Log). Amended: Approach, Always, matrix rows, Tasks and AC now emit scoped `Edit(<t>)` beside `Read(<t>)`/`Write(<t>)`, never bare `Edit`; Tasks add test (5) for AC3 (injected `deps.judge` writes no profile). Known-bad state avoided: a profile that silently breaks the judge's own answer write. KEEP: `JUDGE_DENY_PROFILE` export and file location `.bmad-loop/runs/<engine>/judge-deny.settings.json` (beside media); atomic tmp+rename write with `encoding: "utf-8"`; fixed three always listed; dir `./<n>/**` vs file `./<n>`; dangling link denied as a file; async `defaultJudge` passing `deny_profile` with vmHostRoot/pin unchanged; the `judgeSpawner`/`pinOk` test helpers; the four pass-1 tests (adjusted for scoped `Edit`), including the write-failure test (folder where the profile goes).

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story (2 files, ~115 new lines; no story plan, band judged from the diff)

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 1: (high 1, medium 0, low 0)
- patch: 1: (high 0, medium 0, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` bare `Edit` deny also denies the Write tool, blocking the judge's `answer.json` Write — consult ruled scoped `Edit(<t>)`; spec amended (Spec Change Log loop 1), code reverted and re-derived
  - `[low]` `[patch]` AC3 (injected `deps.judge` writes no profile) had no test — folded into the re-derive as test (5)

### 2026-11-08 — Review pass (loop 1 re-derive)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 1: (high 0, medium 1, low 0)
- reject: 0
- addressed_findings:
  - `[low]` `[patch]` the hostverify.ts module header did not describe the judge's deny profile or the profile-write infrastructure cause — header lines added (doc only)

## Design Notes

Claude Code resolves `./` rules against the session cwd, which `buildSbxCommand` sets to the served root's VM path (`env -C`), so the rules address the worktree. Deny beats allow, so the media folder can only stay open by not being covered: hence enumeration of top-level entries minus `.bmad-loop`, rather than `Read(./**)`. A Bash `cat` of the code is not sealed — as ruled.

Deviation from the intent's wording (consult ruling 2026-11-08, score 1): the profile carries scoped `Edit(<t>)` per denied target, never the bare `Edit` the operator reading names, because Claude Code applies an `Edit` rule to every built-in file-editing tool, Write included, and a bare `Edit` would block the judge's `answer.json` Write that the same reading requires stay open. The owner may override on TKSTUDIO-224.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 600 bun test --timeout 60000 test/hostverify.test.ts test/tier.test.ts test/conformance.test.ts` -- expected: all pass
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-11-08)

- planned: three tests, as listed in Tasks & Acceptance / actual: a fourth test, "profile write fails → `inconclusive`, `infrastructure: sbx`" / why: the I/O matrix row and the Always rule require that behaviour, and no named test covered it / may affect: none
- planned: only `judgeDenyRules` exported / actual: the file-name constant `JUDGE_DENY_PROFILE` is exported too / why: the tests build the profile path without hard-coding the name / may affect: none

DRIFT: a fourth test pins the profile-write-failure matrix row — the matrix row had no named test — affects: none
DRIFT: `JUDGE_DENY_PROFILE` exported from hostverify.ts — tests reference the profile file name — affects: none

### loop 1 (2026-11-08)

- planned: bare `Edit` denied (intent wording) / actual: scoped `Edit(<t>)` beside `Read(<t>)`/`Write(<t>)` per denied target / why: a bare `Edit` deny also denies the Write tool, breaking the judge's `answer.json` Write; consult ruled accept-deviation score 1 / may affect: none (owner may override on TKSTUDIO-224)

DRIFT: the judge profile denies scoped `Edit(<t>)`, not bare `Edit` — a bare `Edit` deny also blocks the Write tool the judge needs for `answer.json` — affects: none

### pass 2 (2026-11-08, re-derive after loop 1)

DEVIATIONS: none (implementer score 0; the scoped-`Edit` deviation is the consult-ruled one recorded above)

## Consult Log

- 2026-11-08T22:32:31Z — trigger: deviation-gt-0 — question: accept the extra profile-write-failure test and the exported JUDGE_DENY_PROFILE constant? — ruling: accept-deviation score 1 — do: keep the fourth test and the export as they are; leave deviation_score 1 and both DRIFT lines; go on to Verification — rule candidate: a test covering an uncovered I/O-matrix row, or a test-only export of a literal the spec fixes, is expected work, not a deviation
- 2026-11-08T22:34:46Z — trigger: high-severity-finding — question: bare `Edit` deny (intent's literal) also denies the Write tool per Claude Code docs, blocking the judge's answer.json Write the intent requires stay open; keep bare Edit, scope it, or escalate? — ruling: accept-deviation score 1 — do: drop bare `Edit`, emit `Edit(<t>)` beside `Read(<t>)`/`Write(<t>)` for every denied target so no Edit/Write/Read rule covers the media; extend test (2) to assert no bare `Edit`; update the spec's Approach, matrix row and AC to match; record the deviation and reason in Design Notes and the result (PR body) so the owner can override on TKSTUDIO-224 — rule candidate: in a deny profile scope every `Edit` rule to the paths it denies: Claude Code applies a bare `Edit` deny to Write too

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T202640Z-af3d56` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-68 — `defaultJudge` now writes a deny-only settings profile atomically to `.bmad-loop/runs/<engine>/judge-deny.settings.json` (beside the media) and passes it as invokeSkill's `deny_profile` (→ `--settings <microVM path>`). It denies `Edit(t)`, `Read(t)`, `Write(t)` for `./plugins/**`, `./apps/**`, `./_bmad-output/**` and every top-level entry of the worktree except `.bmad-loop`; Bash, bare Write/Read and the media folder stay open. Best effort, not a seal. A profile that cannot be written is `inconclusive` (`infrastructure: sbx: …`). `judge.json` contract unchanged.

**Files changed:**
- `apps/supervisor/src/hostverify.ts` — `judgeDenyRules`, `JUDGE_DENY_PROFILE`, atomic `writeJudgeDenyProfile`, async `defaultJudge` passing `deny_profile`; module header updated.
- `apps/supervisor/test/hostverify.test.ts` — five DW-68 tests: `--settings` at the VM path + exact deny list; judge's Bash/Write/frame Reads stay permitted; dir/file/fixed/`.bmad-loop` coverage; write failure → `inconclusive`; injected `deps.judge` writes no profile (AC3).

**Review findings:** pass 1 — 1 bad_spec (high: bare `Edit` would deny the Write tool; consult-ruled scoped `Edit`, spec amended, code re-derived), 1 patch (low, AC3 test), 1 deferred. Pass 2 — 1 patch (low, header doc), 1 deferred. 0 rejected. Deferred: `.bmad-loop/` run state beside the media stays readable and writable by the judge (two entries in frontmatter `deferred`).

**Follow-up review recommendation:** false — last pass patched high 0, medium 0, low 1; score 3×0 + 1×1 = 1 (< 5).

**Verification:** `bun test --timeout 60000 test/hostverify.test.ts test/tier.test.ts test/conformance.test.ts` — 200 pass, 2 skip, 0 fail; `uv run python -m unittest discover tests` — 3061 OK (4 skipped); `uv run python ../contracts/conformance/runner.py run` — `ok: true`.

**Residual risks:** Bash stays open (as ruled), so a Bash read of the code is not sealed. The scoped-`Edit` reading departs from the operator reading's "bare `Edit`"; the owner may override on TKSTUDIO-224. Claude Code's actual enforcement of `Write(...)` rule forms was not exercised live (no authenticated sandbox here).

DRIFT: a fourth test pins the profile-write-failure matrix row — the matrix row had no named test — affects: none
DRIFT: `JUDGE_DENY_PROFILE` exported from hostverify.ts — tests reference the profile file name — affects: none
DRIFT: the judge profile denies scoped `Edit(<t>)`, not bare `Edit` — a bare `Edit` deny also blocks the Write tool the judge needs for `answer.json` — affects: none

## Reconcile

- 2026-11-08 — score 1; reconcile not required.
- Spec resolution: unit key `dw-playable-judge-deny-profile` has no `spec-<key>.md`; used the engine's recorded `spec_file` for this unit (run 20261108-202816-6452 state.json), `spec-dw-68-playable-judge-deny-profile.md`.
- Part B note: this unit is a sweep DW bundle (DW-68), not a `stories.yaml` story. No manifest entry, plan file or `epics.md` story section names it, so task-planning §2–4 has nothing to act on. Spot-check of the spec's ACs instead: AC1 hostverify.test.ts:1137 (worker argv `--settings` at the profile's VM path, exact deny list, profile beside not inside the media); AC2 :1157 (no Bash / bare Edit/Write/Read, no rule over the media) and :1170 (dir `./<d>/**`, file `./<f>`, fixed three, never `.bmad-loop`); AC3 :1194 (injected `deps.judge` writes no profile); matrix row "profile write fails" :1180 (`inconclusive`, `infrastructure: sbx`). Not rerun here (no `bun` on this box); evidence is the Auto Run Result (200 pass / 2 skip / 0 fail; unittest 3061 OK; conformance `ok: true`). Live enforcement of `Write(...)`/scoped `Edit(...)` rules in an authenticated sandbox is unverifiable-here; the scoped-`Edit` reading awaits owner confirmation on TKSTUDIO-224. Two medium deferrals (`.bmad-loop/` run state readable/writable) stay in frontmatter `deferred:`.
Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met by test inspection (suites not rerun: no bun here)
