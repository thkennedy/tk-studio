---
title: 'DW-87 (TKSTUDIO-220 option A): split the stage log into lib/stagelog.py and the stage pass into src/stagepass.ts'
type: 'refactor'
created: '2026-11-09'
status: 'done'
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: '9a5260984d5065a777b7d3ce4184bd85e6d9469f'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `plugins/tk-studio/lib/plansync.py` (4,022 lines) holds two products besides plan sync: the Story 35.8 stage log (`# ---- stage log` seam, :2221-3521) and the Story 35.7 `ledger_resolve` (:3524-3631). Consumers (report.py, measurepush.py) reach into it as a sub-API, including the private `plansync._stage_target` (report.py:285). `apps/supervisor/src/planstatus.ts` (862 lines) holds the stage pass (:656-862). It is the one supervisor pass not in its own module (`ledgerPass` lives in `sweep.ts`).

**Approach:** Move the code without changing behaviour. The stage log section and the ledger_resolve section go into a new `lib/stagelog.py`. `plansync` keeps every CLI verb and re-exports the moved names lazily. The stage pass goes into a new `src/stagepass.ts`, which `planstatus.ts` re-exports. No CLI verb, JSON shape, event or test assertion changes.

## Boundaries & Constraints

**Always:**
- Move code verbatim: same bodies, same docstrings and comments. Edits are limited to the module qualification needed after the move.
- Every name that `plansync` exported before stays reachable as `plansync.<name>`. That covers the public names and the private ones that tests and conformance read (`_stage_target`, `_finish_stage`, `_fence_mask`, …).
- Every name that `planstatus.ts` exported before stays importable from `./planstatus`: `STAGE_LEASE`, `StageRow`, `supervisorRows`, `ownerSpecPresent`, `stagePass`.
- Name `encoding="utf-8"` on every text-mode open and every `text=True` subprocess (AGENTS.md pitfalls).
- Stdlib-only Python. Atomic writes stay atomic (they keep calling `plansync._atomic_write`).
- The Python import graph keeps its allowlisted SCCs exactly (`tests/test_import_cycles.py`). The TS graph keeps its allowlist (`test/cycles.test.ts`): `stagepass` value-imports nothing that value-imports it back, and `planstatus` is in no cycle.

**Block If:**
- A test needs an assertion or fixture edit (not just an import path) to pass. That means behaviour changed: HALT.
- Keeping the import graph acyclic needs a change to the allowlist in either cycle test.

**Never:**
- Touch the rest of DW-87's list: the assets split, `hostverify.ts` markers, a `test_report.py`, `enginemcp.ts`.
- Move `ledger_decide`, `mint_deferred` or `_deferred_next` (Stories 38.4 and 38.x stay in plansync).
- Rename CLI verbs, flags or JSON keys. Edit the deferred-work ledger. Change `driver-contract.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import order A | `import plansync` alone (`python -I`) | loads; `plansync.stage_append` resolves through the lazy re-export | No error |
| Import order B | `import stagelog` alone | loads (it imports plansync at top; plansync never top-level-imports stagelog) | No error |
| Unknown attribute | `plansync.no_such_name` | `AttributeError` naming the module and the attribute, as before | raised |
| CLI verbs | `plansync.py stage / stage-post / ledger-resolve / deferred / ledger-decide …` | identical argv, exit codes and JSON | unchanged |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/plansync.py:2221-3521` -- the stage log section (STAGE_* constants, `_finish_stage`, `_stage_cell`/`_stage_stamp`, `stage_moment`…`stage_rows`, `_StageDoc`, `stage_post`). It moves whole.
- `plansync.py:3524-3631` -- `# ---- Story 35.7: the sweep's ledger flip` (LEDGER_REL, `_DW_*_RE`, `_PR_*_RE`, `_BUNDLE*_RE`, `pr_ref`, `_ledger_spans`, `resolved_status`, `ledger_resolve`). It moves whole. The `# ---- CLI` marker at :3522 stays in plansync, above 38.4.
- The moved code uses these plansync names; refer to them as `plansync.X` from stagelog: `PlanSyncError`, `SETUP_INTENT` (module level: `STAGE_INTENT`), `IMPL_REL` (module level: `LEDGER_REL`), `_atomic_write`, `_find_entity`, `_now`, `_recorded`, `plan_dir`, `load_counter`, `_deferred_next`. Import `syncback`, `jirabackend` and `dwledger` directly.
- Remaining plansync code uses these moved names; resolve them through a function-local `import stagelog`:
  - `_carried_stage_log` (:452-465): `_fence_mask`, `_heading_index`, `_section_end`, `STAGE_HEADING`
  - `ledger_decide` (:3647+): `LEDGER_REL`, `_DW_ID_RE`, `_ledger_spans`, `_DW_STATUS_RE`, `_finish_stage`
  - `mint_deferred` (:3715+): `LEDGER_REL`, `_finish_stage`
  - `main` (:3858 `stage_post`), `_ledger_resolve_main`, `_ledger_decide_main`, `_deferred_main`, `_stage_main` (`_finish_stage`, `ledger_resolve`, `stage_from_pass`, `run_stage_rows`, `stage_append`, `stage_start`, `stage_stop`)
- `plugins/tk-studio/lib/tests/test_import_cycles.py` -- top-level imports by AST. A function-local import is no edge, so stagelog→plansync at top plus plansync→stagelog lazily is acyclic. `test_each_module_imports_alone` imports each module alone in `python -I`.
- `plugins/tk-studio/lib/report.py:57-370` -- `plansync.{NO_VALUE, stage_*, load_stage_posts, stage_documents, parse_stage_log, _stage_target (:285), _jira_issue_of}`. Point the moved names at `stagelog`. `plan_dir`, `interchange`, `_recorded` and `PlanSyncError` stay `plansync.`.
- `plugins/tk-studio/lib/measurepush.py:237,275,326,356` -- `plansync.NO_VALUE` and `plansync.stage_rows` → `stagelog.`.
- Read-only, through plansync re-exports: tests (`test_stage_log.py`, `test_plansync.py`, `test_measurepush.py`, `test_driver_contract.py`, `test_planner_rules.py`) and conformance (`e2e_stage_log.py`, `e2e_run_sweep.py`). Only one test patches plansync: `tests/test_plansync.py:1380` patches `plansync._atomic_write` for `mint_deferred`, which stays.
- Hooks `apps/supervisor/.bmad-loop/plugins/studio-pipeline/meter_hook.py` and `reconcile_gate.py` -- call the `plansync.py` CLI by path. They stay unchanged.
- `apps/supervisor/src/planstatus.ts:656-862` -- the stage pass (`STAGE_LEASE`, `StageRow`, `stable`, `supervisorRows`, `StageDetail`, `StageOutcome`, `callStage`, `why`, `stageStory`, `sameFailure`, `lastSeq`, `ownerSpecPresent`, `stageTodo`, `stagePass`). The header doc block :73-106 ("Story 35.8 — the stage pass") goes with it into stagepass.ts's header.
  - The pass needs these planstatus-local helpers: `planEvents` (:324), `clip` (:147), `message` (:146), `failed` (:148).
  - It also needs `canonicalPr`, `runPr`, `PLAN_RETRY_LIMIT`, `jiraBound` (`planseams`), `legVerdict`/`HostVerifyResult` (`hostverify`), `isTerminal`/`selfOwner`/`Queue`/`QueueEvent`/`QueueRun` (`queue`), `lastJsonObject`/`RunResult` (`server`), and `gh`/`studioScript`/`uvRunner`/`WorktreeDeps` (`worktree`).
- `apps/supervisor/src/planseams.ts` -- the leaf for seams the passes share (its header: names are re-exported at their old home). Move `planEvents`, `message`, `clip` and `failed` here, exported, and have planstatus import them.
- `apps/supervisor/src/sweep.ts:130` -- the precedent: `import type { PlanStatusDeps } from "./planstatus"` (a type import is no cycle edge).
- `apps/supervisor/test/cycles.test.ts` -- value-import graph. The new `stagepass` must not be in any SCC.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/stagelog.py` -- NEW. Add a module docstring (the stage log of Story 35.8 and the ledger flip of Story 35.7, split out of plansync.py per DW-87 / TKSTUDIO-220 A). Add `from __future__ import annotations`, the stdlib imports, `import plansync`, `import syncback`/`jirabackend`/`dwledger`. Then the two sections verbatim, with the plansync dependencies qualified as listed in the Code Map.
- `plugins/tk-studio/lib/plansync.py` -- delete the two sections. Add a `_STAGELOG_NAMES` frozenset holding every moved top-level name. Add a PEP 562 `__getattr__(name)` that, for those names only, does `import stagelog` and returns `getattr(stagelog, name)`; for any other name it raises `AttributeError(f"module {__name__!r} has no attribute {name!r}")`. Make the remaining uses `stagelog.X` through a function-local import. Keep the module docstring's verb list accurate; it may note where the stage log now lives.
- `plugins/tk-studio/lib/report.py`, `plugins/tk-studio/lib/measurepush.py` -- add `import stagelog`. Retarget the moved names, so `report.py` no longer reaches `plansync._stage_target`.
- `apps/supervisor/src/planseams.ts` -- add the exported `planEvents` (with its `Phase` type, or a structurally equal `string` phase parameter), `message`, `clip` and `failed`, bodies verbatim.
- `apps/supervisor/src/stagepass.ts` -- NEW. Header: the moved Story 35.8 doc block. Body: the stage pass verbatim, with value imports from planseams, hostverify, queue, server and worktree, and `import type { PlanStatusDeps } from "./planstatus"`.
- `apps/supervisor/src/planstatus.ts` -- delete the stage-pass section and the moved helpers. Import `planEvents`/`message`/`clip`/`failed` from `./planseams` and `stagePass` from `./stagepass`. Add `export { ownerSpecPresent, STAGE_LEASE, stagePass, supervisorRows, type StageRow } from "./stagepass"`. Replace the header's 35.8 block with a one-line pointer to `stagepass.ts`. Drop imports that are now unused.

**Acceptance Criteria:**
- Given the split, when `uv run python -m unittest discover tests` runs from `plugins/tk-studio/lib`, then it is green, and `git diff --stat -- plugins/tk-studio/lib/tests apps/supervisor/test` is empty: no test changed.
- Given the split, when `uv run python ../contracts/conformance/runner.py run` runs from `plugins/tk-studio/lib`, then `ok: true` over every surface, including `e2e_text_encoding`, `e2e_windows_semantics`, `e2e_stage_log` and `e2e_run_sweep`.
- Given the split, when `bun test --timeout 120000` runs in `apps/supervisor`, then it is green: `planstatus`, `worktree`, `sweep` and `cycles` included. When `bunx tsc --noEmit` runs, it is clean.
- Given the moved code, when `grep -n "# ---- stage log\|^def ledger_resolve\|^def stage_post" plugins/tk-studio/lib/plansync.py` runs, then nothing matches. When the same grep runs on `stagelog.py`, it matches. When `grep -n "plansync._stage_target" plugins/tk-studio/lib/report.py` runs, nothing matches. When `grep -n "export async function stagePass" apps/supervisor/src/*.ts` runs, it matches only `stagepass.ts`.

## Spec Change Log

## Review Triage Log

### 2026-11-09 — Review pass
- review content: the diff was handed to both layers by path (`/tmp/dw87/review.diff`, ~1,170 lines): the new modules diffed against their baseline source blocks, then the tracked diff with verbatim-moved deletions elided
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 1: (low 1) — test_stagelog's three-name identity test overlaps test_every_listed_name_resolves; harmless explicit pin
- edge-case-hunter: no findings ([])
- addressed_findings:
  - `[low]` `[patch]` planseams.ts header claimed every name is re-exported at its old home; amended to name DW-87's `message`/`clip`/`failed`/`planEvents` as moved, not re-exported (trailing comment folded in)
  - `[low]` `[patch]` stagelog.py kept a blanked `# ---- CLI` marker line (four blank lines before the 35.7 section); reduced to two

## Design Notes

Lazy re-export: function-local imports and `__getattr__` keep the Python graph acyclic at load time, which is the rule `test_import_cycles` pins. A top-level `from stagelog import *` in plansync would be a load-time SCC, and it would fail when `stagelog` is imported first.

```python
def __getattr__(name: str):
    if name in _STAGELOG_NAMES:
        import stagelog
        return getattr(stagelog, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

`__getattr__` only serves `plansync.X` from outside the module. Code inside plansync must say `stagelog.X`.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && timeout -k 5 1500 uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && timeout -k 5 1500 uv run python ../contracts/conformance/runner.py run` -- expected: `"ok": true`
- `cd apps/supervisor && ~/.bun/bin/bun install --frozen-lockfile && timeout -k 5 1500 ~/.bun/bin/bun test --timeout 120000` -- expected: 0 fail
- `cd apps/supervisor && ~/.bun/bin/bunx tsc --noEmit` -- expected: no output, exit 0

## Deviation Summary

### pass 1 (2026-11-09)

- planned: `measurepush.py` retargets `plansync.NO_VALUE` and `plansync.stage_rows` to `stagelog.` / actual: only `NO_VALUE` retargeted; both `plansync.stage_rows(...)` calls (:326, :356) stay / why: `tests/test_measurepush.py:525` monkeypatches `plansync.stage_rows = flaky`; calling `stagelog.stage_rows` would bypass the fake and fail an unchanged test / may affect: none
- planned: no plansync change beyond the section delete, the re-export and `stagelog.X` uses / actual: `sys.modules.setdefault("plansync", sys.modules[__name__])` in the `if __name__ == "__main__":` block / why: run as a script plansync is `__main__`, so stagelog's `import plansync` loaded a second copy whose `PlanSyncError` the CLI handlers missed (reproduced: `stage --start` on a missing story answered `retryable: true` with a `stage: PlanSyncError:` reason instead of the baseline refusal); with the line the output is byte-identical to HEAD / may affect: none
- planned: n/a / actual: the old `# ---- stage log (Story 35.8)` marker in plansync.py replaced by `# ---- stagelog re-export (DW-87)` above the shim / why: the moved section's marker lives in stagelog.py; the acceptance grep pins its absence in plansync.py / may affect: none

DEVIATION SCORE: 1

DRIFT: measurepush keeps `plansync.stage_rows` (through the lazy re-export) — an unchanged test patches that name on plansync — affects: none
DRIFT: plansync's `__main__` block registers itself as `plansync` in sys.modules — without it the CLI loads plansync twice and `PlanSyncError` from stagelog escapes the handlers — affects: none
DRIFT: plansync's stage-log section marker replaced by a re-export marker — the section moved — affects: none
- Code Map correction (consult ruling): the Code Map line "Only one test patches plansync" was wrong — `tests/test_measurepush.py:518-529` also assigns `plansync.stage_rows`; deviation 1 corrects a pinned fact, not new drift.

### pass 2 (2026-11-09)

- planned: no test file / actual: new `plugins/tk-studio/lib/tests/test_stagelog.py` (5 tests: re-export identity for every `_STAGELOG_NAMES` name, the unknown-attribute AttributeError, `_STAGELOG_NAMES` == stagelog's AST top-level names, the `__main__` alias keeping a `stage --start` refusal plain — proven red with the alias removed) / why: the matrix row "Unknown attribute" had no test (consult 2: file-outside-files, accept score 1); no existing test edited / may affect: none

DRIFT: a new test file outside Tasks pins the matrix's unknown-attribute row and the `__main__` alias — the Matrix Test Audit needs a test that ran — affects: none

## Consult Log

- 2026-11-09T10:21:02Z — trigger: deviation-gt-0 — question: accept the three pass-1 deviations (measurepush keeps plansync.stage_rows; __main__ sys.modules alias; marker rename)? — ruling: accept-deviation score 1 — do: keep all three as in the tree; record the Code Map "only one test patches plansync" error; run Verification and acceptance greps unchanged — rule candidate: when a spec moves names out of a module, grep tests for `<module>\.<name>\s*=` as well as mock.patch and keep patched names' call sites on the old module; when the source module runs as a CLI and the moved module imports it back, alias it in sys.modules in its __main__ block
- 2026-11-09T10:27:43Z — trigger: file-outside-files — question: matrix row "Unknown attribute" has no test; add new tests/test_stagelog.py (AC-1 read as "no existing test changed") or record hand-check? — ruling: accept-deviation score 1 — do: add tests/test_stagelog.py pinning the lazy re-export (identity + AttributeError text), _STAGELOG_NAMES == moved names, and the __main__ alias (stage --start on a missing story answers the plain refusal); edit no existing test; run full Verification and confirm it ran — rule candidate: when a matrix row has no existing coverage the planner names a new test file in Tasks; "no test changed" means existing tests

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261109T095041Z-480ca3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** DW-87 under TKSTUDIO-220 option A, and nothing else from DW-87's list. Behaviour-neutral: no CLI verb, JSON shape or event changed, and no existing test changed.
- The Story 35.8 stage log and the Story 35.7 `ledger_resolve` section moved verbatim from `plansync.py` (4,022 → ~2,740 lines) into a new `lib/stagelog.py`.
  - `plansync` keeps every CLI verb. It re-exports the 95 moved names lazily (`_STAGELOG_NAMES` + PEP 562 `__getattr__`), so the Python import graph stays acyclic.
- The supervisor's stage pass moved from `planstatus.ts` into a new `src/stagepass.ts`, which `planstatus.ts` re-exports. The shared helpers went to the `planseams.ts` leaf, so the TS graph stays acyclic too.

**Files:**
- `plugins/tk-studio/lib/stagelog.py` (new): the stage log and the ledger flip, verbatim, with the plansync dependencies qualified.
- `plugins/tk-studio/lib/plansync.py`: the sections removed; the lazy re-export; function-local `import stagelog` at the remaining uses; a `__main__` `sys.modules` alias.
- `plugins/tk-studio/lib/report.py`: the moved names now come from `stagelog`, so it no longer reaches `plansync._stage_target`.
- `plugins/tk-studio/lib/measurepush.py`: `NO_VALUE` now comes from `stagelog`; `stage_rows` stays on `plansync`, the name a test patches.
- `plugins/tk-studio/lib/tests/test_stagelog.py` (new): pins the re-export, the name set, the unknown-attribute error and the `__main__` alias.
- `apps/supervisor/src/stagepass.ts` (new): the stage pass and its Story 35.8 header, verbatim.
- `apps/supervisor/src/planstatus.ts`: the stage pass removed; it re-exports `ownerSpecPresent`, `STAGE_LEASE`, `stagePass`, `supervisorRows` and `StageRow`; the helpers are imported from `planseams`.
- `apps/supervisor/src/planseams.ts`: `message`, `clip`, `failed` and `planEvents` moved here; the header was updated.

**Review:** 2 patches applied (low, low), 0 deferred, 1 rejected. edge-case-hunter had no findings.

**Follow-up review recommendation:** false. Patched: high 0, medium 0, low 2, so the score is 3×0 + 1×2 = 2.

**Verification:**
- `uv run python -m unittest discover tests`: 3077 OK, 5 skipped. I ran it after implementation; the implementer re-ran it after the patches.
- `runner.py run`: `ok: true`, every surface, including `e2e_text_encoding`, `e2e_windows_semantics`, `e2e_stage_log` and `e2e_run_sweep`.
- `bun test --timeout 120000`: 2133 pass, 0 fail, 85 skip. This needs `~/.bun/bin` on PATH, because the fake `gh` scripts use `#!/usr/bin/env bun`.
- `bunx tsc --noEmit`: clean.
- After the patches (comments and whitespace only): `tsc` clean, `cycles` + `planstatus` tests 126 pass.
- Acceptance greps hold. `git diff --stat` on the existing test folders is empty.

**Residual risks:**
- Other consumers (`engage`, `track`, `migrate`, `sweepdecisions`, `measurepush.stage_rows`) still reach moved names through the `plansync` re-export. That works, but it is indirect.
- `test_stagelog`'s alias test depends on the wording of the "no spec … no spec folder to buffer" refusal.

DRIFT: measurepush keeps `plansync.stage_rows` (through the lazy re-export) — an unchanged test patches that name on plansync — affects: none
DRIFT: plansync's `__main__` block registers itself as `plansync` in sys.modules — without it the CLI loads plansync twice and `PlanSyncError` from stagelog escapes the handlers — affects: none
DRIFT: plansync's stage-log section marker replaced by a re-export marker — the section moved — affects: none
DRIFT: a new test file outside Tasks pins the matrix's unknown-attribute row and the `__main__` alias — the Matrix Test Audit needs a test that ran — affects: none

## Reconcile

- 2026-11-09 — score 1; reconcile not required.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle dw-stagelog-stagepass-split, DW-87; no stories.yaml entry); ACs spot-checked as met (acceptance greps hold; the only test-folder change is the new test_stagelog.py, recorded as accepted drift).
