---
title: 'The Windows Classes Out of the Host Leg'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_revision: 'f11269603b3ff5bc0047bc448dc1c58e9f1b9d45'
deviation_score: 1
reconcile_verdict: not-required
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-37/plans/37-2.md'
  - '{project-root}/_bmad-output/specs/spec-epic-37/SPEC.md'
warnings: [oversized]
deferred: []
---

> **Serve process changes.** `apps/supervisor/src/hostverify.ts` and `cli.ts` run inside `serve`: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge (SPEC Constraints; plan Settled shape 5).

<intent-contract>

## Intent

**Problem:** Three of Epic 36's six host legs went red on Windows-only differences the Linux sandbox gate cannot see (holes 108, 110; retrospective B6, B7, C2): a `path.join` reaching `toVmPath`, a rename over the empty folder a failed rename leaves, a POSIX-suffix assertion on a joined path, git-backed time bounds past bun's 5 s, and `subprocess` calls decoding cp1252 under `text=True`. A red leg hides a lib failure behind a 20-line tail (DW-150), and the preload's timeout reaches only the first file of a multi-file `bun test` (DW-155).

**Approach:** A new `e2e_windows_semantics` conformance drive rejects the four classes plus a bounds step under the five scopes; the live sites are fixed so it is green on the tree. `_budget.py` gets the host figure and every bun command takes `--timeout` from it; `tier.test.ts` pins its env. The `host-verify` event, the PR body and the re-run verb carry a `verdicts` list on a red leg. Contract 0.1.32 gains the Story 37.2 clause additively.

### Acceptance Criteria (verbatim, Story 37.2, `epics.md` "### Story 37.2")

AC1. **Given** the conformance suite's `e2e_text_encoding` drive (Story 36.4) and the supervisor's `preload.ts` default timeout (hole 108) **When** the gate runs in the sandbox **Then** a `e2e_windows_semantics` drive (or the encoding drive widened) rejects, under `plugins/tk-studio/lib`, `apps/supervisor/src`, `apps/supervisor/test`, `_bmad/scripts` and `tools`: a `path.join`/`resolve` whose result reaches `toVmPath` or an `sbx` argv (the POSIX tail after `toVmPath(studioRoot(env))` is the rule), an `endswith`/`toContain`/`toBe` assertion on a joined path against a POSIX literal, an `os.rename`/`Path.rename`/`renameSync` onto a path that may exist without the empty-folder clear, and a `subprocess.run`/`Popen` with `text=True` or `universal_newlines` and no `encoding=`; each with the host figure or the rule in its message; the drive is green on `main` after this story's fixes

AC2. **Given** a bare multi-file `bun test` (DW-155: the preload's `setDefaultTimeout` reaches only the first file on bun 1.4.3) and the conformance drives' bounds (`_budget.py`) **When** `verify_host.py`, the engine's gate or a drive runs the supervisor suites **Then** the per-file timeout holds for every file (`--timeout` on the command from `_budget.py`'s host figure, or the preload re-applied per file), the drives' bounds carry the host figure with headroom, and the supervisor's `tier.test.ts` env-dependent cases either pin the env or skip by name (C7)

AC3. **Given** the host leg's `host-verify` event **When** `verify_host.py` ends red **Then** the event carries every suite's own verdict line (`== lib suite: FAILED rc=1 …`, `== conformance: ok`, `== supervisor: <file> N pass, M fail …`) as a `verdicts` list beside the 20-line tail, the PR body's `## Host verify` lists them, and the re-run verb's answer names the red suites; the supervisor suites cover it with a fake; the contract names the field (0.1.32, additive)

## Boundaries & Constraints

**Always:**
- Settled shapes (plan `## Settled shape`, SPEC design notes CAP-4/5/6) bind: (1) a NEW `e2e_windows_semantics.py`, never the encoding drive widened; (2) `--timeout` on the command, never the preload re-applied; `_budget.HOST_TEST_TIMEOUT_MS = 30_000` + `bun_test_args()`; `verify_host.py` own `SUPERVISOR_TEST_TIMEOUT_MS` pinned equal by a test (no cross-tree import); (3) `verdicts?: string[]` only on a red leg; (4) no engine gate runs bun — the contract says the rule applies to `verify_host.py` and the drives.
- Stdlib-only Python via `uv run`; atomic writes; status blocks on headless surfaces; `encoding="utf-8"` on every text-mode open and text subprocess (AGENTS.md).
- Contract: extend 0.1.32 additively (a `0.1.32 (Story 37.2, additive)` clause in line 5, `, Story 37.2` in the Stories row, a `**0.1.32 (Story 37.2, additive).**` paragraph after 37.1's and before `## 8. Conformance`). No second bump; no new `**0.1.32**` guard test (37.1's guards `**0.1.33**`).
- Ledger: DW-150, DW-154, DW-155 close as `status: resolved 2026-11-05 by Story 37.2` (never `by this story's PR`). A hand-filed entry takes its id from `plansync.py deferred mint`.
- The `6d0a0cc` and `bcfa691` regression shapes stay flagged when planted un-fixed.

**Block If:**
- Class (b) or (c) cannot reach zero hits on the tree with the shape exemptions plus `win-ok: <reason>` comments without exempting a real regression shape → consult `bad_spec`; never widen an exemption to go green.
- `verdicts` would break a pinned exact shape on a green leg (`hostleg.test.ts` exact `toEqual`) → consult `deviation-gt-0`.
- `tier.test.ts`'s two unexplained failures (C7), reproduced with `TK_ATLASSIAN_SITE=x bun test test/tier.test.ts`, are not env-only → record them, consult `high-severity-finding`; never skip them by name to go green.
- The Files list must grow materially past the plan's band → consult `halt`; never split the story.

**Never:** widen the encoding drive or rename its pinned steps; touch `apps/supervisor/_bmad/scripts` (outside the five scopes — leave it, note it); edit `epics.md`, `stories.yaml`, plans, `.bmad-loop/routing.toml|policy.toml`, or anything under `supervision/`; push, tag, open a PR, or run the release motion; bump the gate x3 versions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Drive green | the fixed tree | `{ok: true, steps:[…5 scopes + bounds]}` | — |
| Planted class (a) | `toVmPath(join(root, "x"))` in a src file | step red, detail `<label>:<line> …` naming the POSIX-tail rule | — |
| Planted class (b) | `str(Path(a) / b).endswith("x/y")` / `expect(join(a,b)).toContain("x/y")` | red naming the rule | normalised subject (`.replace("\\","/")`, `.as_posix()`, `toVmPath`) exempt |
| Planted class (c) | `os.rename(src, dst)` with no clear of `dst` in the function | red naming WinError 183 / the empty-folder clear | prior `rmdir/rmtree/rmSync/_remove/unlink` of same name, pid/random dest, tmp→file, `win-ok:` exempt |
| Planted class (d) | `subprocess.run(cmd, text=True)` (or alias, or `universal_newlines=True`) | red naming the cp1252 host figure | `**kwargs` or `encoding=` exempt; `self.subTest(text=…)` never flagged |
| Bounds | a drive's `bun test` argv without `--timeout`, or a drive `git` subprocess without `timeout=` | `bounds` step red naming the 30 000 ms host figure | — |
| Absent scope | scope dir missing in a checkout | that step `{ok: true, not_run}` | — |
| Unparsable Python | syntax error file | red hit (as the encoding drive) | — |
| Red leg | `verify_host` stdout with `== lib suite: FAILED rc=1 in 3s`, `== conformance: ok in 9s`, `== supervisor: test/x.test.ts 3 pass, 1 fail in 2s rc=1`, `(cwd …)` headers, `== lib suite failed (rc=1); last …` tail headers | `verdicts` = the three verdict lines only; PR body red block lists `Verdicts:`; verb answer has `verdicts` + `red: ["lib suite","supervisor"]` | — |
| Green leg / non-verify_host command | ok, or no `== ` lines | `verdicts` absent; verb answer unchanged | — |

</intent-contract>

## Code Map

The plan's `## Code Map` (`plans/37-2.md` :23-43) is the investigation and is binding; read it in full. Anchors predate 37.1 where noted; re-grep by symbol. Highlights at `f1126960`:

- `plugins/tk-studio/contracts/conformance/e2e_text_encoding.py` -- the shape to copy: `_import_aliases`, `_canonical`, `_dotted`, `_python_files`, `_checkout`, `_scan_step`, `run()`, `main`. Sibling-import it (`import e2e_text_encoding as enc`; precedent `_budget.py:31 import runner`).
- `plugins/tk-studio/contracts/conformance/manifest.json` -- the encoding drive's entry under `tk-studio-activate` is the registration shape; `runner.py DEFAULT_TIMEOUT = 60`, `_run_drive` (`expect: ok` needs `parsed.ok is True`).
- `plugins/tk-studio/contracts/conformance/_budget.py` -- `HEADROOM_S`, `suite_bound`; add `HOST_TEST_TIMEOUT_MS`, `bun_test_args()`. Duplicated `TEST_TIMEOUT_MS = "30000"` in `e2e_vertical_slice.py`, `e2e_paused_exits.py`; no `--timeout` in `e2e_engine_gate.py`, `e2e_run_sweep.py`, `e2e_playable_verify.py`; `e2e_run_sweep.py _git` lacks `timeout=`.
- `tools/verify_host.py` -- per-file `["bun","test",f"./{rel}"]`, `SUPERVISOR_FILE_TIMEOUT = 420`; verdict print sites (`== <name>: ok|FAILED rc=N in Ns`, per-file `== supervisor: …`, `== <name> failed (rc=N); last …` tail headers, `(cwd …)` headers).
- Class (d) live sites (re-grepped): `lib/pipeline.py:422`, `lib/evals.py:243`, `tools/installer/cli/tk_studio_cli/plugin_leg.py:105` and `:210`; tests `test_assets.py`, `test_installer_bootstrap.py` (two), `test_kb.py`, `test_playable.py`, `test_publish.py`, `test_restructure_rehearse.py`. Re-scan with the drive; fix all it reports.
- Class (a): `apps/supervisor/src/server.ts toVmPath`, `env.ts studioRoot/pluginRoot`; POSIX-tail rule sites `runners.ts stopEngineAt`, `sandbox.ts vmLaunchStatus`, `closeout.ts gracefulStopCommand`, `server.ts` `${toVmPath(root)}/${rel.split(sep).join("/")}`; test false positive `closeout.test.ts` `toVmPath(join(fx.wt, patch))` → `win-ok:`.
- Class (b): `6d0a0cc` fix in `lib/tests/test_jobrun.py` is the motivating shape; URL-subject false positives in `test_track.py`, `test_syncback.py`, `test_jirabackend.py`; `closeout.test.ts` `toEndWith("/lib/launch.py")` on a VM argv.
- Class (c): `bcfa691` `_bmad/scripts/render_skill.py` `if destination.is_dir(): os.rmdir(destination)`; TS `hostverify.ts rmSync(media)` then `renameSync`. Site lists per plan.
- `apps/supervisor/src/hostverify.ts` -- `HostVerifyRan` (`stdout_tail`/`stderr_tail`), `TAIL_LINES = 20`, `runStep(…, sink?)`, `hostVerify` (call `runStep` with a sink, parse `verdicts`), `prSection` red block; event writes spread the result (`closeout.ts`, `worktree.ts`, `hostleg.ts`).
- `apps/supervisor/src/cli.ts verifyVerb` -- answer gains `verdicts` and `red` on red only.
- `apps/supervisor/test/{hostverify,hostleg,tier}.test.ts`, `preload.ts` -- fake leg via `bunCmd(...)`; `hostleg.test.ts` green exact `toEqual` must hold; `tier.test.ts` `beforeAll` deletes `TK_*ATLASSIAN*`.
- Tests: `lib/tests/test_conformance.py TextEncodingDriveTestCase` (:974) is the model; `test_playable_judge.py BUN_DRIVES` + `--timeout` pin; `test_verify_host.py` argv pins; `test_driver_contract.py test_0_1_32_story_37_1_one_id_source` (:3137) the shape for `test_0_1_32_story_37_2_…`.
- Contract/docs: `driver-contract.md` 37.1 paragraph :2411, `## 8. Conformance` :2442, the 36.4 encoding rule (grep `e2e_text_encoding`), §8 sentence naming drives, the `host-verify` re-run answer (`green, skipped?, reason?, pr`) gains `verdicts?`, `red?`; `apps/supervisor/README.md` (the event row, the verb row); `AGENTS.md` second pitfall line inside `<!-- bmad:context -->`; `kb/agent-pc-setup-runbook.md` hole-108 and hole-110 rows `; fixed (Story 37.2, …)`; `deferred-work.md` `### DW-150` :1185, `### DW-154` :1217, `### DW-155` :1225.

## Tasks & Acceptance

**Execution:**
- [ ] `plugins/tk-studio/contracts/conformance/e2e_windows_semantics.py` (new) -- AST (Python) + line/regex (TS) scan for classes (a)-(d) across the five scopes, one step per scope (`not_run` if absent) plus a `bounds` step; messages name the class rule and the host figure; `win-ok: <reason>` inline exemption -- AC1, AC2.
- [ ] `plugins/tk-studio/contracts/conformance/manifest.json` -- register under `tk-studio-activate`, `expect: ok`, a `timeout` with headroom -- AC1.
- [ ] `_budget.py`, `e2e_vertical_slice.py`, `e2e_paused_exits.py`, `e2e_run_sweep.py`, `e2e_engine_gate.py`, `e2e_playable_verify.py` -- `HOST_TEST_TIMEOUT_MS`, `bun_test_args()`; every bun argv takes `--timeout`; `_git` `timeout=` -- AC2.
- [ ] `tools/verify_host.py` -- `SUPERVISOR_TEST_TIMEOUT_MS = 30_000`; `--timeout` on every per-file bun command -- AC2.
- [ ] The class (d) live sites + any (a)/(b)/(c) hits the drive reports (fix, or `win-ok:` only for a proven false positive) -- AC1 green.
- [ ] `apps/supervisor/src/hostverify.ts`, `cli.ts` -- `verdicts` parse/type/`prSection` `Verdicts:`; verb `verdicts` + `red` -- AC3.
- [ ] `apps/supervisor/test/hostverify.test.ts`, `hostleg.test.ts`, `tier.test.ts`, `preload.ts`, `closeout.test.ts` -- fake red leg (lib failure behind a supervisor failure), red verb case, env pin, comment, `win-ok:` -- AC2, AC3.
- [ ] `lib/tests/test_conformance.py`, `test_playable_judge.py`, `test_verify_host.py`, `test_driver_contract.py` -- `WindowsSemanticsDriveTestCase` (real tree green + registered; a planted site per class fails naming the site, incl. the un-fixed `6d0a0cc`/`bcfa691` shapes; every scope/`not_run`; exempt shapes; AGENTS.md second pitfall pin); every bun drive passes `--timeout` from `_budget`; `--timeout` on every verify_host file + equality pin; `test_0_1_32_story_37_2_…` -- all ACs.
- [ ] `driver-contract.md`, `apps/supervisor/README.md`, `AGENTS.md`, `kb/agent-pc-setup-runbook.md`, `deferred-work.md` -- the 37.2 clause/row/paragraph (drive, host figure, `verdicts`, `red`, the engine-gate note), §8 names the drive; README rows; pitfall line; holes 108/110 fixed; DW-150/154/155 resolved -- AC1-AC3 contract half.

**Acceptance Criteria:**
- Given the fixed tree, when `uv run python ../contracts/conformance/e2e_windows_semantics.py` runs from `plugins/tk-studio/lib`, then it prints `ok: true` with a step per scope; and given a planted site of each class, then the drive fails naming the site and the rule/host figure (test_conformance).
- Given a drive or `verify_host.py` running bun, then every `bun test` argv carries `--timeout 30000` from the host figure, and the equality pin holds (test_playable_judge, test_verify_host, the drive's `bounds` step).
- Given a box with `TK_ATLASSIAN_*` set, when `bun test test/tier.test.ts` runs, then it has no env-dependent failure.
- Given a fake red leg, when `hostVerify` runs, then `verdicts` lists the gate and failing per-file lines (headers and tail headers excluded), `prSection` lists them, and `verifyVerb` answers `verdicts` and `red`; on green the shapes are unchanged (hostverify/hostleg tests).
- Given the contract, when `test_driver_contract` and conformance run, then the 37.2 clause is pinned and `runner.py run` is `ok: true`.

## Spec Change Log

## Review Triage Log

### 2026-11-05 — Review pass
- layers: blind-hunter, edge-case-hunter (band L); the diff went to both layers as the file `/tmp/d372.diff` (118 KB; the docs were shown as word-diffs), not pasted into the prompt
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 0
- reject: 6: (high 0, medium 1, low 5)
- addressed_findings:
  - `[medium]` `[patch]` class (a)/(b) `JOIN` missed `path.join`/`path.resolve`, which AC1 names; it now matches the `path.`/`nodePath.`/`node_path.` prefixes, and `parts.join`/`posix.join` stay exempt
  - `[medium]` `[patch]` class (c) tmp-source exemption was a bare `tmp|temp` substring (`attempt_dir`, `templates`, `staging_tmp_dir`) and applied to Python; it is now a tmp token, TS `renameSync` only, never a dir/folder source, and the `pid` token is tightened
  - `[medium]` `[patch]` the bounds step checked only the manifest timeout; it now checks each bun drive's derived `BOUND_S` against the host figure plus `HEADROOM_S`, reads the manifest under `--plugin-root`, and makes a missing drive a red hit
  - `[low]` `[patch]` Python renames written with keyword args were missed; `_rename_parts` now reads `node.keywords`
  - `[low]` `[patch]` `TS_RENAME` required `);`; it now parses the call's arguments with brackets counted
  - `[low]` `[patch]` the TS scan read JSDoc/block-comment lines; these are now skipped, and the class (c) multi-line limit is documented
  - `[low]` `[patch]` `tier.test.ts` `beforeAll` deleted the env with no restore; `afterAll` now restores it
  - `[low]` `[patch]` DW-150 closed with an undelivered remainder; each bun drive's bound now names the host figure, and the remainder is DW-172 (minted)
  - `[low]` `[patch]` the consult's ledger entry for the `guards.test.ts` env failures is filed as DW-173 (minted)
- rejected (one line each): Python class (b) `assertIn`/`assertEqual` — AC1 names `endswith`/`toContain`/`toBe`, all covered; `os.replace` — not a form AC1 names, and it is the safe file idiom; literal `bun`/`git` argv names — a shape scan, and every bun drive is pinned by `test_playable_judge`; run-sweep bound 240→180 s — a pass-1 deviation the consult accepted (host ~80 s); `red: []` when no suite line is red — nothing to name; no verdicts on a non-host-command red — by design (AC3 reads "verify_host.py ends red")

### 2026-11-05 — Review pass
- follow-up pass (status `done` → fresh review); layers: blind-hunter, edge-case-hunter (band L); the diff since `f11269603b3ff5bc0047bc448dc1c58e9f1b9d45` (specs excluded, docs as word-diffs) went to both layers as the file `/tmp/d372-f1.diff` (241 KB)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` `verdictLines` kept the supervisor gate's reason line (`== supervisor: git ls-files failed (rc=128); running anyway`; `rc=`/`timed out` matched `SUPERVISOR_RED`), so `redSuites` named a green supervisor gate red; a `GATE_REASON` rule now drops every `app_changed` reason shape, pinned in `hostverify.test.ts` (both layers)
  - `[low]` `[patch]` the scan read the `== <name> failed (rc=N); last N lines:` tails, duplicating refuse lines and admitting echoed verdict-shaped lines; it now stops at the first tail header (`TAIL_HEADER`), pinned
  - `[low]` `[patch]` the supervisor gate's refusal lines (temp folder not creatable / inside a git checkout, no test files, could not remove) never reached `verdicts`; `SUPERVISOR_REFUSAL` keeps them (Design Notes: gate-level lines always), pinned
  - `[low]` `[patch]` `driver-contract.md` and the manifest note described the bounds step as a manifest-`timeout` check; they now describe the derived `BOUND_S = suite_bound(…)` check and its three extra failures, pinned in `test_driver_contract.py`
  - `[low]` `[patch]` `driver-contract.md` exempted a tmp-to-file rename for all of class (c); it now says TypeScript `renameSync` only (a Python tmp rename stays flagged), pinned
  - `[low]` `[patch]` the AGENTS.md pitfall claimed the drive fails every `bun test` call site; it now scopes that to a conformance bun drive's or `tools/verify_host.py`'s `bun test`; the `test_conformance.py` pin follows
- rejected (one line each): `tier.test.ts` env pin never exercised with `TK_ATLASSIAN_*` set — the pin is the test's own setup, proven by the Verification command `TK_ATLASSIAN_SITE=x bun test test/tier.test.ts` (0 fail); a test of a test's env is plumbing; `tools/restructure/rehearse.py:787` bare `bun test` unflagged — AC2 names `verify_host.py`, the engine's gate and the drives, not the rehearsal, and the overclaiming AGENTS.md wording is patched; `_bun_test_list` detects bun by a `bun` name — no current site uses another binary name, a hypothetical shape

### 2026-11-05 — Review pass
- follow-up pass 2 (status `done` → fresh review); layers: blind-hunter, edge-case-hunter (band L); the diff since `f11269603b3ff5bc0047bc448dc1c58e9f1b9d45` (specs excluded) went to both layers as the file `/tmp/rv372/diff.patch` (325 KB, 2175 lines), not pasted into the prompt
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 4: (high 0, medium 0, low 4)
- addressed_findings:
  - `[low]` `[patch]` TS class (c) `_ts_cleared` crossed function boundaries (`TS_FUNCTION_START` saw only `function` declarations and column-0 lines), so a clear in a sibling class method or arrow exempted an unguarded `renameSync`; a brace-counted `_ts_scope` now stops at the enclosing arrow/function/class/method head, pinned by `test_a_sibling_method_or_arrow_clear_does_not_exempt_a_typescript_rename` (blind-hunter)
  - `[low]` `[patch]` Python class (c) missed a bare `from os import rename` / `... as mv` call; `_aliases` maps bare `from os import X` names (and no longer hardcodes `subprocess.` for every bare import), `_rename_parts` reads a bare name resolving to `os.rename`, pinned by `test_a_bare_os_rename_import_is_read_through` (edge-case-hunter)
  - `[low]` `[patch]` the bounds step's `_manifest_timeouts` kept the last registration of a drive while `_budget._manifest_timeout` takes the first with a `timeout`; it now uses the budget's rule, pinned by `test_the_bounds_step_reads_a_twice_registered_drive_as_the_budget_does` (edge-case-hunter)
  - `[low]` `[patch]` `test_agents_md_carries_the_second_pitfall` pinned the pitfall count at exactly 2, so the next pitfall recorded by `bmad-project-context` would break the lib suite; it now asserts at least two and checks the line naming `e2e_windows_semantics` (blind-hunter)
- rejected (one line each): class (a) unchecked in Python — AC1's class (a) names `path.join`/`resolve` and the POSIX-tail rule after `toVmPath`, a TS-only shape, and the Python `sbx exec` argvs (`launch.py:719`, `sandbox_login.py:275`) carry no joined path; Python class (b) `in`/`assertIn`/`assertEqual` — rejected in pass 1 (AC1 names `endswith`/`toContain`/`toBe`, all covered); `apps/supervisor/package.json` `"test": "bun test"` with DW-155 closed — AC2 names `verify_host.py`, the engine's gate and the drives, not a hand `bun run test`, and the ledger entry is the orchestrator's; an `sbx` argv split across lines unflagged — the TS scan is line-based by design (Design Notes; the drive's docstring)

## Design Notes

- The drive's TS scan is line/regex-based (no TS parser in stdlib); class (a)'s data flow through a variable is out of scope (plan). Exemptions are by shape first, `win-ok: <reason>` for the remainder; each `win-ok:` needs a real reason.
- `verdicts` regex (Settled shape 3): `^== (lib suite|conformance|supervisor|studio-web): ` excluding `(cwd ` headers; the `== <name> failed (rc=` tail headers don't match the `: ` form. Gate-level lines always; per-file `supervisor` lines only with a fail or timeout; absent on green or when none print. `red` = suite names whose verdict line is not `ok`/passing.
- `apps/supervisor/_bmad/scripts/render_skill.py` is outside the five scopes and stays untouched.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`, `e2e_windows_semantics` passing
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster tests.test_dwledger` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/e2e_windows_semantics.py` -- expected: `ok: true`
- `cd apps/supervisor && ~/.bun/bin/bun test test/hostverify.test.ts test/hostleg.test.ts test/tier.test.ts` and `TK_ATLASSIAN_SITE=x ~/.bun/bin/bun test test/tier.test.ts` -- expected: green
- `cd apps/supervisor && ~/.bun/bin/bun test` and `bunx tsc --noEmit` (if the project types) -- expected: green before commit

## Deviation Summary

`DW-150/154/155` closures cite `by Story 37.2` per the run's gate note (the PR does not exist inside the loop); not a deviation.

### pass 1 (implementer, 2026-11-05)

- planned: only the plan's Files list is touched / actual: one-line `win-ok:` comments in `apps/supervisor/src/closeout.ts`, `apps/supervisor/test/fakes.ts`, `tools/installer/cli/tk_studio_cli/apps.py`, `lib/tests/test_install_base.py`, `test_installer_plugin_leg.py`, `test_sprites_export.py`, `test_conformance.py` (:121) / why: the drive reported rename hits there, each with a real reason (fresh temp names, undoing the function's own move, a guarded restore, the `_swap` protocol) / may affect: none
- planned: class (c) exempts a prior clear of the same name / actual: Python counts a clear of the same name anywhere in the enclosing function; TS counts a preceding clear or a `const <dst> = …pid/random…` binding / why: the fixed `bcfa691` retry clears after the rename line (retry branch); `chat.ts`, `closeout.ts` carry the pid in a variable / may affect: none
- planned: class (b) flags a joined subject against a `/` literal / actual: also flags a recorded-argv subscript subject (`calls`, `argv`, `args`, `cmd`, `command`) and a computed expected value, only inside assertions / why: the un-fixed `6d0a0cc` line has neither a join nor a literal and must stay flagged / may affect: none
- planned: absent lib red as in the encoding drive / actual: absent `plugins/tk-studio/lib` is `not_run` / why: the spec matrix's absent-scope row / may affect: none
- planned: `_git` gets `timeout=` / actual: also `GIT_BOUND_S = 20` × 3 counted in run-sweep's `other_s` (bound 240→180 s; host measured ~80 s); `test_playable_judge` bound formulas updated / why: B7 counts the drive's own git steps / may affect: none
- planned: `bounds` checks argv flags and git timeouts / actual: also each bun drive's manifest timeout ≥ host figure + `HEADROOM_S` / why: AC2 "bounds carry the host figure with headroom" / may affect: none
- planned: `verdicts` = gate lines + failing per-file lines / actual: also gate-level `skipped (…)` lines and the supervisor install/tsc `FAILED` lines; `red` excludes `ok` and `skipped` / why: they are suite verdicts the leg prints / may affect: none
- planned: whole supervisor suite green / actual: `guards.test.ts` 2 failures when the box has `TK_ATLASSIAN_*` (same class as `tier.test.ts`), not fixed / why: outside Files and ACs; `verify_host.py` strips those vars / may affect: none (needs a ledger entry)

- accepted score 1 (consult, 2026-11-05T22:38Z)

DRIFT: `win-ok:` comments in seven files outside Files — the drive's rename hits there need a reason on the line — affects: none
DRIFT: class (c) clear-of-same-name read function-wide (Py) and via pid binding (TS) — the fixed `bcfa691` retry clears after the rename — affects: none
DRIFT: class (b) also flags argv-subscript subjects and computed expected values — the un-fixed `6d0a0cc` shape must stay flagged — affects: none
DRIFT: absent lib scope is `not_run` — the matrix's absent-scope row — affects: none
DRIFT: run-sweep bound counts `GIT_BOUND_S` × 3 (240→180 s) — B7 — affects: none
DRIFT: `bounds` also checks manifest timeout ≥ figure + headroom — AC2's bounds clause — affects: none
DRIFT: `verdicts` also keeps skipped and install/tsc FAILED lines — they are suite verdicts — affects: none
DRIFT: `guards.test.ts` env-dependent failures left — outside Files; host gate strips the vars — affects: none

### pass 2 (review patches, 2026-11-05)

- planned: TS tmp→file exemption keyed on a tmp token / actual: it also needs a source that is not a dir/folder token (`DIR_SOURCE`) / why: renameSync replaces a file, not a folder, on win32 / may affect: none
- planned: each bun drive names the host figure beside its bound / actual: `test_playable_judge`'s `assertNotIn("TEST_TIMEOUT_MS")` now forbids only a copied assignment, plus a pin that the comment is there / why: the old check rejected the required comment / may affect: none
- planned: DW-172 records DW-150's remainder / actual: its `location:` names Story 37.3's planner-guidance change as where the work could go, unassigned / why: SPEC CAP-8 has 37.3 rewriting the same guidance / may affect: 37-3
- accepted score 1 (consult, 2026-11-05T22:58Z)

DRIFT: the TS tmp exemption excludes dir/folder sources — Node replaces files only — affects: none
DRIFT: the TEST_TIMEOUT_MS pin is narrowed to an assignment, and the comment is pinned — DW-150's Fix asks for the comment — affects: none
DRIFT: DW-172's location points at 37.3's guidance change — the same file — affects: 37-3

### pass 3 (follow-up review patches, 2026-11-05)

- planned: the contract names `verdicts` (0.1.32, additive) / actual: the 37.2 paragraph's `verdicts` sentence also states the scan stops at the first tail header, a supervisor reason line is never a verdict, and the supervisor's refusal lines always are; new pins in `test_driver_contract.py` / why: the contract text would otherwise contradict the patched `verdictLines` / may affect: none
- accepted score 1 (consult, 2026-11-05T23:13Z)

DRIFT: the contract's `verdicts` sentence describes the patched line rules (tail-header stop, reason lines excluded, refusals kept) — it must match the shipped parser — affects: none

## Consult Log

- 2026-11-05T22:38Z — trigger: deviation-gt-0 + file-outside-files — question: accept or reject the implementer's eight deviations (win-ok comments in seven files outside Files; broadened (b)/(c) shapes; not_run lib; GIT_BOUND_S; bounds manifest check; verdicts skipped/FAILED lines; guards.test.ts env failures left) — ruling: accept-deviation score 1 — do: keep all eight entries; record `accepted score 1 (consult)` under pass 1; file the guards.test.ts TK_ATLASSIAN_* env failures as a ledger entry minted by `plansync.py deferred mint`, never skipped by name; keep test_the_regression_shapes_stay_flagged_un_fixed_and_pass_fixed as the guard — rule candidate: in the plan template, `win-ok:` comments the drive needs on sites a Code Map class lists count as in-Files
- 2026-11-05T22:58Z — trigger: deviation-gt-0 — question: accept or reject the patch pass's three deviations (DIR_SOURCE on the TS tmp exemption; the narrowed TEST_TIMEOUT_MS pin plus the comment pin; DW-172's location naming 37.3) — ruling: accept-deviation score 1 — do: keep all three; leave DW-172 `status: open`, with no 37.3 owner and no 37.3 plan edit — rule candidate: a remainder DW may name a later story in `location:` only as where the work could go, never as its owner; score 1, no consult
- 2026-11-05T23:13Z — trigger: deviation-gt-0 — question: accept or reject the follow-up patch pass's deviation (the contract's `verdicts` sentence extended to the patched line rules, with new pins) — ruling: accept-deviation score 1 — do: keep the extended `verdicts` sentence and the new pins as they are; record `accepted score 1 (consult)` beside the pass's entry; do not bump the contract past 0.1.32 and add no change-policy entry — rule candidate: a story's own unreleased contract clause changed only to describe the shipped behaviour of a field it already publishes (name, type, presence unchanged) is score-1 local and needs no consult (observation recorded)

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-11-02T21:12:24Z | 2026-11-02T21:26:53Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-11-02T22:15:05Z | 2026-11-02T22:16:16Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-11-05T22:01:29Z | 2026-11-05T22:58:49Z | dc875fb4-d9cb-4fe0-adee-966fcbd6615f | claude-opus-5-5 | medium | 28675046 | 183913 | 13.9271 | completed |
| review | 1 | 2026-11-05T22:58:50Z | 2026-11-05T23:18:11Z | 320e67ef-a33e-45c3-a5ec-6c1b83147db9 | claude-opus-5-5 | medium | 8297455 | 67571 | 5.7676 | completed |
| review | 2 | 2026-11-05T23:18:11Z | 2026-11-05T23:37:12Z | d4fe1c79-c29b-40f6-8532-d3229f525ba9 | claude-opus-5-5 | medium | 9704628 | 80190 | 6.0487 | completed |
| gate | 1 | 2026-11-05T23:37:13Z | 2026-11-05T23:40:02Z | 2a739513-5d65-458c-b185-1b76cc2ae4c0 | claude-opus-5-5 | medium | 2087165 | 12202 | 1.4235 | completed |
| host-leg | 1 | 2026-11-05T23:40:09Z | 2026-11-06T00:40:09Z | — | — | — | — | — | — | red |
| close-out | 1 | 2026-11-06T00:40:09Z | 2026-11-06T00:40:17Z | — | — | — | — | — | — | draft PR |
| re-run | 1 | 2026-11-06T01:09:21Z | 2026-11-06T01:58:42Z | — | — | — | — | — | — | green |
| merge | — | 2026-11-06T02:00:05Z | 2026-11-06T02:00:05Z | — | — | — | — | — | — | merged |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-37-20261105T204854Z-4f20f3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Follow-up review pass 2 on the done story (commits `0332ee35b7cdd7f8e364bfab24b3afd1f252876b`, `9c765d2eead4d1f4917659382994edcc8854ccc3`). Both layers reviewed the whole diff since baseline: 8 findings, 4 patched (all low) and 4 rejected. Every patch tightens the `e2e_windows_semantics` drive or its tests:
- TS class (c) now finds the clear only inside the rename's own enclosing function, including class methods and arrows.
- Python class (c) now reads a bare `from os import rename` call.
- The bounds step reads the manifest by the same rule as `_budget`.
- The AGENTS.md pin no longer fixes the pitfall count.

The real tree has no new hits.

**Files changed (this pass):**
- `plugins/tk-studio/contracts/conformance/e2e_windows_semantics.py` — `_ts_scope`/`_ts_blank`/`_ts_function_head` and the `TS_*_HEAD` patterns bound the TS clear search; `_aliases` maps bare `from os import` names; `_rename_parts` reads a bare `os.rename`; `_manifest_timeouts` uses the first registration that has a timeout
- `plugins/tk-studio/lib/tests/test_conformance.py` — three new pins (sibling method/arrow clear, bare `os.rename` import, twice-registered drive); the AGENTS.md pin finds its pitfall line by content

**Review findings:** 4 patched (low 4), 0 deferred, 4 rejected (one line each in the Review Triage Log). Both layers ran.

**Follow-up review recommendation:** false. Patched high 0, medium 0, low 4; score 3 × 0 + 1 × 4 = 4.

**Verification:**
- `uv run python -m unittest discover tests` (lib): 2860 tests, OK (skipped=4)
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, 23 surfaces, 169 checks (bun on PATH)
- `e2e_windows_semantics.py`: `ok: true`, all six steps green
- `tests.test_release_roster tests.test_dwledger`: OK
- `bun test --timeout 30000 test/hostverify.test.ts test/hostleg.test.ts test/tier.test.ts`: 176 tests, 0 fail, 2 skip; `TK_ATLASSIAN_SITE=x bun test --timeout 30000 test/tier.test.ts`: 0 fail
- No TypeScript changed this pass, so the full `bun test` and `tsc --noEmit` were not re-run. Both were clean in the previous pass.

**Residual risks:**
- The TS checks stay line-based with a brace-counted scope. A multi-line `sbx` argv, or a clear reached through a variable, is out of reach, as the drive documents.
- `apps/supervisor/package.json` `"test"` is still a bare `bun test`. AC2 does not name it.
- `hostverify.ts` runs inside `serve`. The operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it after the merge.
- Unverifiable here: the Windows host leg. The operator runs `uv run tools/verify_host.py` on the host before the merge.

## Reconcile

- 2026-11-05 — score 1; reconcile not required.

Gate: Part A not-required; Part B story accepted, planned 37-3-a-timed-out-session-keeps-its-stop-and-its-records
