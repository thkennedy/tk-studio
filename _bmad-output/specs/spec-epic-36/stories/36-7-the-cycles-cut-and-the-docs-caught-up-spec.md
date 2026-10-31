---
title: 'The Cycles Cut and the Docs Caught Up'
type: 'refactor'
created: '2026-10-31'
status: 'done'
baseline_revision: 'af91fc92f7790fed459d8f7c8bf240d1c37690a6'
deviation_score: 2
reconcile_verdict: no-impact
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-7.md'
warnings: ['oversized']
deferred:
  - summary: >-
      `withMcpStop` in `cli.ts` is not checked to inject `stopEngineMcp`; only its call sites and `sbxDeps` are pinned.
    evidence: |-
      Category (b), a contract line left partly unpinned: "the run's engine MCP stops at its release". The patch's `releaseWiringFaults` covers the callers, so removing the injection from `withMcpStop`'s body fails no test.
    location: >-
      apps/supervisor/src/cli.ts:626
    severity: low
---

<intent-contract>

## Intent

**Problem:** As the loop, I want the supervisor's eleven-module import cycle and the lib's `assets` ↔ `playable` cycle cut to one-way seams with the dynamic-import dodges removed, the duplication the ledger names folded into shared helpers, `assets.py` split along its concerns as far as one story carries, and the docs the retrospective lists landed, so that the next epic adds surface on a module graph a reader can hold and the READMEs name every verb that ships (AI-7; DW-85, DW-86, DW-87).

**Approach:** The plan's Settled shape, corrected by its Risks entries (36.2, 36.3, 36.4, 36.6 gates), which win over its earlier text wherever they differ: leaves with re-exports at the old homes, injected seams, value-import cycle tests with an exact allowlist. Behaviour pinned by the existing suites, no surface change.

## Boundaries & Constraints

**Always:**
- Every moved name keeps a re-export at its old home, so patch targets and test imports hold (`patch.object(assets, ...)`, `playable.LAST_TREE_KILL_CONFIRMED`).
- Name the encoding on every text-mode open (`encoding="utf-8"`); a new lib module with `def main(` calls the utf-8 guard. Studio scripts stay stdlib-only; writes stay atomic.
- Keep the seams that avoid cycles: `ResumeDeps`/`PausedDeps.startedStories` and the `JournalReader` parameter (`closeout` never imports `planstatus`, `planstatus` never imports `office`); `engage.py:802`'s lazy `from inventory import`.
- `stopEngine`'s sbx default survives the cut (DW-120's no-injection test, `closeout.test.ts:1991`), at both default callers (`closeout.ts:1087`, `:1194`).
- Order of value if the story must narrow: AC1's cuts and the cycle tests, then `_core.py` and the `scope` shrink, then `_glb.py`, then the docs. Each narrowing is a recorded deviation and a remainder stated on the ledger entry.

**Block If:**
- A moved name is a test patch target the re-export cannot satisfy and the cut needs it moved anyway (report it as a deviation; do not rewrite the test's target).
- Removing a named cycle needs a behaviour or surface change.

**Never:** `git push`, tag, PR, release motion or a gate x3 version bump. No edits to `epics.md`, the canonical plan files, `stories.yaml`, `.bmad-loop/routing.toml`, `.bmad-loop/policy.toml`, or under `supervision/`. No new verb, field, event or schema. Not in this story: the plan's Settled shape 4 "stated" items, the `enginemcp → api` dynamic import, the `own_block` `render`/`lock` setters and DW-157.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| TS cycle test green | `src/*.ts` after the cuts | No named cycle; no `import("./…")` in `closeout.ts`, `hostverify.ts`, `hygiene.ts`; remaining SCCs equal the allowlist exactly | A failure names the SCC |
| TS planted back-edge | A synthetic graph or source with a back-edge among the named modules | The test's check fails on it | Proven inside the test |
| TS type-only edge | `import type`, or a brace list of only `type` names | Not counted | Header states why |
| TS allowlist staleness | An allowlisted SCC is cut or a new one appears | Fails until the allowlist is edited | Exact set equality |
| Lib cycle test green | `lib/*.py` top-level imports by AST | `assets ⇄ playable` absent; allowlist `{inbox, syncback}` exact; each module imports alone in a subprocess | A failure names the module |
| Lib planted back-edge | A synthetic graph with `assets ⇄ playable` | The check fails on it | Proven inside the test |
| Engine MCP advisory | `engine_mcp_row` per-run and fixed | Names the per-run forwarder port (`TK_SUPERVISOR_ENGINE_MCP_PORT`, `engine-mcp-forwarder`) and the host:port-policy case | Row stays advisory |

</intent-contract>

## Code Map

The investigation is `plans/36-7.md` (`## Code Map`, `## Settled shape`, `## Files`, `## Risks and open decisions`). Its Risks entries are newer than its Code Map. Re-derived from this tree at baseline, value imports only:

- SCCs now: `{hygiene, server, transcript}`, `{enginemcp, hostverify, queue, sandbox}`, `{board, closeout, engagement, inbox, log, office, page, planstatus, registry, sweep, worktree}`, `{api, cli}`. This confirms the plan's 36.6 entry.
- `apps/supervisor/src/sweep.ts:69` -- `DEFERRED_REL` from `board.ts:42`; the edge to cut through a leaf.
- `apps/supervisor/src/sweep.ts:72`, `:347` and `hygiene.ts:161` -- the `registerSweepLine` dodge.
- `apps/supervisor/src/closeout.ts:122` -- `isSweep, stopEngine` from `sweep.ts`; callers `:1087`, `:1194`; `gracefulStopCommand` `:1144-1147` mirrors `stopEngineAt`'s argv.
- `apps/supervisor/src/sweep.ts:517`, `:532` -- `stopEngineAt`, `stopEngine`; `cli.ts:129` also imports `stopEngineAt`, `isSweep`.
- `apps/supervisor/src/hostverify.ts:618` -- the `./registry` dynamic import.
- `apps/supervisor/src/sandbox.ts:51`, `:188` -- the MCP stop edge. `enginemcp.ts:472`'s `./api` dynamic import stays, stated.
- `closeout.ts` has no `import("./cli")` left; the test's no-dynamic-import check still covers it.
- `plugins/tk-studio/lib/assets.py:111`, `playable.py:788` -- the lib cycle. `engage.py` `scope` `:1170`, closures `:1248`, `:1319`.
- `plugins/tk-studio/lib/launch.py:1391` -- `engine_mcp_row`; pins `tests/test_launch.py:1817-1856`.

## Tasks & Acceptance

**Execution:**
- The plan's `## Files` list is the boundary, plus `apps/supervisor/src/board.ts` (the `DEFERRED_REL` move, re-exported, ordered by the 36.2 Risks entry) and whatever leaf holds `stopEngine`/`stopEngineAt` (a new `src/` leaf, or `src/runners.ts`; the 36.3 Risks entry orders it). Any other file is a deviation.
- Supervisor cuts -- the plan's "The named cuts" and Settled shape 2, as corrected by Risks; then re-derive the SCCs and fix the allowlist from what remains. The expected residuals are `{queue, sandbox}`, `{api, cli}` and the board…registry SCC without `closeout`, `planstatus`, `sweep`, `worktree`. A residual holding any of those four, or `hygiene`, `server`, `transcript`, `enginemcp` or `hostverify`, is a deviation to report.
- `apps/supervisor/test/cycles.test.ts`, `plugins/tk-studio/lib/tests/test_import_cycles.py` -- Settled shape 1, including a planted back-edge in each. `python -I` ignores `PYTHONPATH` and the cwd, so the child must put `lib/` on `sys.path` itself.
- `apps/supervisor/test/sweep.test.ts`, `test/hygiene.test.ts` -- the direct hygiene → sweep import.
- Lib helpers -- `_proc.py`, `_png.py`, `_core.py`, `_glb.py` when the band allows; Settled shape 3.
- DW-86 folds -- the plan's "DW-86" paragraph: user-env, engine/Blender resolution, base-ref `git show` (`src/gitshow.ts`), status-block scaffolding.
- `plugins/tk-studio/lib/engage.py` -- lift the two `scope` closures to module level; `scope` at most 149 lines.
- Docs -- Settled shape 5: the supervisor README table, the advisory text and its pins, the encoding bullet, the nested `plugin.toml` line 27. Verify the root README rows and `apps/supervisor/README.md:332`, rewriting nothing that already holds.
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- the 0.1.31 sentence, its rulings entry, the phrase test.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-85 resolved with residuals stated; DW-86, DW-87 narrowed with the remainder stated, dated 2026-10-31.

**Acceptance Criteria:**

AC1. **Given** the supervisor and the lib **When** a cycle test runs in the host gate (a script over the TypeScript imports and a lib test importing each module alone) **Then** `sweep ⇄ worktree`, `sweep ⇄ planstatus` and `closeout → sweep → planstatus → closeout` are gone, the `registerSweepLine` dodge (`hygiene.ts:159-172`, `sweep.ts:283`) and the `closeout.ts:919 → cli` and `hostverify.ts → ./registry` dynamic imports are gone, `assets.py` and `playable.py` share `_proc.py` and `_png.py` instead of importing each other, and the MCP stop reaches the sandbox through a one-way seam (DW-85); the test pins zero cycles among the named modules

AC2. **Given** the duplication and the size the ledger names **When** the story lands **Then** the user-env reads, the engine and Blender resolution, the base-ref `git show` and the status-block scaffolding each live in one helper (DW-86), `assets.py`'s concerns are split into named modules as far as one story carries with the remainder stated on the entry, and `engage.py scope` is back under its Epic 34 size (DW-87); behaviour pinned by the existing suites, no surface change

AC3. **Given** the READMEs and the plugin's notes **When** the story lands **Then** the root and `apps/supervisor` READMEs carry rows for `tk-studio-evals`, `maintenance-evals`, `run-sweep`, `evals.py` and `report.py` and the EP-34 rows for `tk-studio-playable-judge`, `tk-studio-track` and `tk-studio-engage`; `apps/supervisor/README.md:332` and the `engine mcp` advisory name the per-run forwarder port and the host:port-policy case; the Windows notes carry the `utf-8-sig` bullet and the encoding rule of Story 36.4; the mirror's hook comments are aligned (AI-7); the contract (0.1.31, additive) is unchanged in surface; DW-85, DW-86 and DW-87 close or narrow by this PR

## Spec Change Log

## Review Triage Log

### 2026-10-31 — Review pass
- skipped-layer: none; band L, blind-hunter and edge-case-hunter both ran over a diff file, as 296 KB would not inline
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 4, low 3)
- defer: 1: (high 0, medium 0, low 1)
- reject: 4: (high 0, medium 1, low 3)
- addressed_findings:
  - `[medium]` `[patch]` DW-86 and DW-87 read `status: narrowed`, which hides their remainders from the board and the sweep; now `status: open — narrowed …` (consult)
  - `[medium]` `[patch]` the `engine mcp` advisory read this process's environment as if it were the supervisor's; the unset wording now says so
  - `[medium]` `[patch]` the Text encodings bullet contradicted the UTF-8 BOMs bullet; reworded, and `e2e_text_encoding.py` accepts either
  - `[medium]` `[patch]` `cli.ts`'s MCP stop wiring had no pin; `releaseWiringFaults` in `test/cycles.test.ts`, with planted sources
  - `[low]` `[patch]` a refused `TK_SUPERVISOR_ENGINE_MCP_PORT` read as `forwarder fixed <value>`; `_forwarder_text` mirrors `engineMcpPort`
  - `[low]` `[patch]` the contract edit dropped ` — additive` from Story 36.6's entry; restored
  - `[low]` `[patch]` DW-86's remainder did not state the two `gitshow.ts` readers or the helper copies; stated
- rejected, one line each:
  - optional `SandboxDeps.stopEngineMcp`: the plan orders the optional dep, every production call is wired and now pinned
  - DW-85 resolved with residuals: the plan orders it, the residuals are stated on the entry and held by the exact allowlists
  - contract entry's repeated `36.7:` and `additive` beside `no surface change`: the plan's and the AC's own wording, and pinned
  - `atRef` lacks `LC_ALL=C`: unchanged behaviour, moved as it was

### 2026-10-31 — Review pass
- skipped-layer: none; band L, follow-up review, blind-hunter and edge-case-hunter both ran over a diff file, as 327 KB would not inline
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 1, low 2)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` `tk-studio-launch/SKILL.md:61` and the `launch.py` module docstring described the `engine mcp` row without the appended forwarder and host:port-policy text; both now name it (SKILL.md is outside Files, on the consult's ruling)
  - `[low]` `[patch]` `assets.py` kept no re-export for seven names moved to `_glb.py` (`_accessor`, `_vec3`, `_close`, `_IDENTITY`, `_mat_mul`, `_node_matrix`, `_mesh_instances`), against the story's Always rule; added, found by both layers
  - `[low]` `[patch]` the `_png.py` docstring said `playable.py` re-exports every name; it now says `playable.py` imports the two it uses

### 2026-10-31 — Review pass
- skipped-layer: none; band L, second follow-up review, blind-hunter and edge-case-hunter both ran over a diff file, as 340 KB would not inline; edge-case-hunter returned no findings
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 1, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` the `engine mcp` advisory's two set forms stated this process's `TK_SUPERVISOR_ENGINE_MCP_PORT` as the supervisor's fact (a shell's `8788` read `forwarder fixed 8788` beside the host:port-policy text while `engineMcpPort` returned 0 in the supervisor); both now say the value was read in the process running this check and that the supervisor's own environment decides, with the docstring and the pins moved to match and the classification unchanged

## Design Notes

"Zero cycles among the named modules" reads as the named cycles and dodges gone and the rest allowlisted; the plan's Risks settle this. The Settled shape 6 serve restart is an operator action, recorded in the terminal report, not done here.

## Verification

Put bun on PATH first (`export PATH="$HOME/.bun/bin:$PATH"`) and run `bun install --frozen-lockfile` in `apps/supervisor` if `node_modules` is absent: the suites spawn `bun`.

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- `cd apps/supervisor && bun test test/cycles.test.ts` -- expected: green
- `cd apps/supervisor && env -u TK_SUPERVISOR_NOTIFY -u TK_SUPERVISOR_TELEGRAM_TOKEN -u TK_SUPERVISOR_TELEGRAM_CHAT -u TK_SUPERVISOR_NTFY_URL bun test --timeout 30000` with `TK_ATLASSIAN_*` unset -- expected: green
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: exit 0
- `cd plugins/tk-studio/lib && python3 -c "import ast; f=[n for n in ast.parse(open('engage.py',encoding='utf-8').read()).body if getattr(n,'name','')=='scope'][0]; print(f.end_lineno-f.lineno+1)"` -- expected: at most 149

## Deviation Summary

### pass 1

- planned: no test outside the Files list changes / actual: edited `apps/supervisor/test/enginemcp.test.ts` (helper injects `stopEngineMcp`, new default-wiring test) and `apps/supervisor/test/sandbox.test.ts` (three Story 35.4 `releasePin` calls inject the real stopper; assertions unchanged) / why: those tests relied on `sandbox.ts`'s static stop, which the one-way seam removes / may affect: none
- planned: modify `test/sweep.test.ts`, `src/inbox.ts` / actual: neither changed / why: `sweep.test.ts` stayed green and the supervisor test now sits in `hygiene.test.ts`; `inbox.ts` already imported the single `server.ts` user-env export / may affect: none
- planned: `planseams.ts` holds `runPr`, `PLAN_RETRY_LIMIT` / actual: it also holds `canonicalPr` and `DEFERRED_REL`, re-exported from `hygiene.ts` and `board.ts` / why: `runPr` needs `canonicalPr`, and leaving it in `hygiene` would re-close `hygiene → sweep → planseams → hygiene`; `DEFERRED_REL` needed a leaf / may affect: none
- planned: `runners.ts` holds `runner`, `uvRunner`, `studioScript`, `gh`, `originGhRepo` / actual: it also holds `originRepo`, `stopEngine`, `stopEngineAt` / why: `originRepo` is `gh`'s dependency; the stop placement follows the 36.3 Risks entry / may affect: none
- planned: `_glb.py` holds lines 695-934 and `_core` the listed names / actual: `_glb.py` also took `AXES`, `BOUNDS_TOLERANCE` and `_number`; `_core` also holds `Refusal` and a `Binary` tuple / why: the GLB code needs them and may not import `assets`; `assets.Refusal` is the same class / may affect: none
- planned: `resolve_binary(arg, env, var, *, require_absolute, allow_which)` / actual: it adds a `flag` keyword and returns `Binary(path, problem, name, value)` instead of raising; `assets.py` and `playable.py` word the refusals / why: each module has its own refusal class and its own pinned wording / may affect: none
- planned: `assets` re-exports `user_env` / actual: `assets.user_env` is a thin wrapper over `_core.user_env(..., read=_hkcu_value)` / why: `patch.object(assets, "_hkcu_value")` would not bite through a plain re-export / may affect: none
- planned: `showAtBase(root, ref, path)` with one reader / actual: it takes an opts argument (`env`, `git`, `clip`); `atRef` stays a separate function in the same leaf, taking a runner / why: the callers' locale, stream, regex and clip differ and their tests pin them / may affect: none
- planned: `_write_atomic` in `_core` for the sites using it / actual: only `assets`, `playable` and `playable_judge` use it; `evals.py` (text) and `launch.py` (copymode) keep theirs, stated on DW-86 / why: their bodies differ / may affect: none
- planned: moves only / actual: removed imports the move left unused (`struct`, `subprocess`, `zlib` from `assets.py`; `signal`, `time` from `playable.py`; `os` from `playable_judge.py`); kept `playable.subprocess` because tests patch it / why: tidy-up after the move; a grep found no test using the removed attributes / may affect: none
- planned: advisory text as in Settled shape 5 / actual: the per-run form also names `engine-mcp-forwarder`, and the fixed form names the variable / why: the I/O matrix requires those names / may affect: none
- planned: contract gets one sentence and a rulings entry / actual: the sentence also mentions the advisory's wording, and the body of the 35.4 note still gives the old row format / why: the note is a historical entry and its phrases are pinned by tests; the header states the change / may affect: none

DRIFT: `test/enginemcp.test.ts` and `test/sandbox.test.ts` edited, outside Files — they relied on the static stop the one-way seam removes — affects: none
DRIFT: `test/sweep.test.ts` and `src/inbox.ts` left unchanged, though listed — neither needed a change — affects: none
DRIFT: `planseams.ts` also holds `canonicalPr` and `DEFERRED_REL` — `runPr` needs the first, and the second needed a leaf — affects: none
DRIFT: `runners.ts` also holds `originRepo`, `stopEngine`, `stopEngineAt` — `gh`'s dependency and the 36.3 Risks placement — affects: none
DRIFT: `_glb.py` also took `AXES`, `BOUNDS_TOLERANCE`, `_number`; `_core` also holds `Refusal`, `Binary` — the GLB code may not import `assets` — affects: none
DRIFT: `resolve_binary` adds `flag` and returns a `Binary` tuple rather than raising — each module has its own refusal class and pinned wording — affects: none
DRIFT: `assets.user_env` is a thin wrapper, not a re-export — `patch.object(assets, "_hkcu_value")` must still bite — affects: none
DRIFT: `showAtBase` takes opts and `atRef` stays separate in the leaf — the callers' locale, stream, regex and clip differ and are pinned — affects: none
DRIFT: `_write_atomic` shared by three modules only; `evals.py` and `launch.py` keep theirs — their bodies differ — affects: none
DRIFT: imports the moves left unused removed from `assets.py`, `playable.py`, `playable_judge.py` — tidy-up; no test uses them — affects: none
DRIFT: the advisory's per-run form names `engine-mcp-forwarder`, the fixed form names the variable — the I/O matrix requires them — affects: none
DRIFT: the contract sentence also mentions the advisory wording; the 35.4 note's body keeps the old row format — historical and pinned — affects: none

- planned: `apps/supervisor/src/board.ts` outside the plan's Files list / actual: it imports and re-exports `DEFERRED_REL` from `planseams.ts` / why: the plan's Risks entry (36.2 gate) orders the leaf; added on the consult's ruling / may affect: none

DRIFT: `apps/supervisor/src/board.ts` edited, outside the plan's Files list — the 36.2 Risks entry orders `DEFERRED_REL` through a leaf — affects: none

## Consult Log

- 2026-10-31T21:35:40Z — trigger: deviation-gt-0, file-outside-files — question: accept the implementer's deviation set at score 1, including test/sandbox.test.ts and test/enginemcp.test.ts outside Files? — ruling: accept-deviation score 1 — do: accept the whole set with no code change; add one DRIFT line and one Deviation Summary entry for apps/supervisor/src/board.ts; proceed — rule candidate: When a plan turns a static call into an injected dep, its Files list must include the tests that reach the call through the real default, and its "re-export keeps tests unchanged" clause applies only to moved names.
- 2026-10-31T21:40:05Z — trigger: deviation-gt-0 — question: which status line for DW-86 and DW-87, given the readers key on the first word open? — ruling: accept-deviation score 2 — do: set DW-86 and DW-87 to status: open — narrowed 2026-10-31 by this story's PR (36.7: …; remaining: …), keep the text after narrowed, leave DW-85 resolved; record the deviation in the spec; leave line 891 unchanged and note in the PR body that its first word also hides it from the board and the sweep — rule candidate: Add to deferred-work-format.md and SKILL.md:34: an entry is open when the first word of its status is open, and an entry with remaining work is written status: open — narrowed <date> by <ref> (…; remaining: …), never status: narrowed.

### pass 2 (Deviation Summary addendum, review pass 1)

- planned: `status: narrowed …` on DW-86 and DW-87 / actual: `status: open — narrowed …` / why: the remainders must stay visible to the board and the sweep, whose readers key on the first word / may affect: later sweeps, which will triage both entries

DRIFT: DW-86 and DW-87 read `status: open — narrowed …`, not `status: narrowed` — `board.ts:179`, `plansync.py:3340` and the sweep key on the first word — affects: later sweeps triage both entries; `deferred-work.md:891` has the same `narrowed` first word and stays hidden (PR body note owed by the operator)
- 2026-10-31T21:57:05Z — trigger: deviation-gt-0 — question: accept at score 1 the patch's mirroring of `engineMcpPort` in `_forwarder_text`? — ruling: accept-deviation score 1 — do: keep `_forwarder_text` and its pins as they stand; record the deviation at score 1 and proceed — rule candidate: When a patch says to mirror a named function's rule, extra pins and value normalization that follow that function's exact behaviour are the instruction itself, not a deviation, provided the output is advisory text with no machine reader.

### pass 3 (Deviation Summary addendum, review pass 1)

- planned: a refused-value pin for `abc` and an out-of-range number, with no other change to set values / actual: the pin also covers other refused forms and accepted values, `00080` reads `forwarder fixed 80`, and whitespace is trimmed with a constant matching JavaScript's `trim` / why: mirroring `engineMcpPort`'s exact rule / may affect: none

DRIFT: `_forwarder_text` normalises a set value as `engineMcpPort` does (`00080` reads `fixed 80`, JavaScript's whitespace) — the patch asked for its exact rule — affects: none

- 2026-10-31T22:02:30Z — trigger: file-outside-files — question: follow-up review: edit the stale `engine mcp` row description at `tk-studio-launch/SKILL.md:61`, outside Files, or leave it as a residual? — ruling: accept-deviation score 1 — do: edit only the `engine mcp` clause at SKILL.md:61 so the port text reads `port <per-run|fixed <n> (one flagged run at a time)>; forwarder <…>; a host:port sandbox policy needs the fixed forwarder port (runbook)`, use the same wording in the `launch.py` docstring, touch no other SKILL.md text and do not bump the version; add one DRIFT line and one Deviation Summary entry at score 1; re-run the lib unittest suite and conformance before proceeding — rule candidate: When a plan changes a check row's printed text, its `## Files` list must include every live prose description of that row, found by grepping the row's literal text across `plugins/tk-studio/skills` and `plugins/tk-studio/lib`.

### pass 4 (Deviation Summary addendum, follow-up review)

- planned: `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` outside the plan's Files list / actual: the `engine mcp` clause at line 61 names the appended forwarder and host:port-policy text / why: the row description is the same text as the `launch.py` docstring, and the check no longer prints the old shape; added on the consult's ruling / may affect: none

DRIFT: `plugins/tk-studio/skills/tk-studio-launch/SKILL.md:61` edited, outside the plan's Files list — the row description is the same text as the `launch.py` docstring, and the check no longer prints the old shape — affects: none

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261031T205808Z-161a25` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** this was a second follow-up review of the finished story, whose spec arrived as `done`. The story's change stands: the named supervisor cycles and dodges are cut and pinned by `test/cycles.test.ts` and `tests/test_import_cycles.py`, `assets ⇄ playable` is gone, DW-86's duplications are folded as far as the entry states, `engage.py scope` is 104 lines (limit 149), and the docs residual landed with the contract still at 0.1.31. This pass corrected one misleading piece of advisory wording.

**Files changed in this pass:**
- `plugins/tk-studio/lib/launch.py` -- the `engine mcp` advisory's two set forms, and the `engine_mcp_row` docstring, say the value was read in the process running this check
- `plugins/tk-studio/lib/tests/test_launch.py` -- the three pins follow the new wording through a shared `MCP_READ_HERE` constant
- `_bmad-output/specs/spec-epic-36/stories/36-7-the-cycles-cut-and-the-docs-caught-up-spec.md` -- this record

**Review findings:** 1 patch applied, 0 deferred, 0 rejected. Follow-up review: not recommended. Patched high 0, medium 1, low 0; score 3 × 1 + 0 = 3, below the threshold of 5. No existing deferred-work ledger entry was changed, as the invocation ordered.

**Verification** (run by this session after the patch, bun on PATH, `TK_ATLASSIAN_*` unset):
- `uv run python -m unittest discover tests` -- 2806 tests OK, 4 skipped
- `runner.py run` -- `ok: true`, 23 surfaces
- `tests.test_release_roster` -- OK
- `bun test test/cycles.test.ts` -- 16 pass, 0 fail
- `bun test --timeout 30000` -- 1998 tests, 1903 pass, 95 skip, 0 fail
- `bunx tsc --noEmit` -- exit 0
- `scope` line count -- 104

**Unverifiable here (operator actions):**
- Settled shape 6: every supervisor module's loading changes, so stop the supervisor tab before the loop builds `apps/supervisor`, and restart it through the scheduled task after the merge.
- The PR body must note that `deferred-work.md:891`'s `status: narrowed:` also hides that entry from the board and the sweep (consult).

**Residual risks:**
- `.claude/skills/bmad-loop-sweep/SKILL.md:34` says the status line "is `open`"; a sweep agent reading that literally could omit DW-86 and DW-87 from `open_ids` and fail its check. The earlier consult's rule candidate covers it; those files are outside this story.
- `releasePin` without an injected stopper does not stop the MCP; production paths are wired and pinned, except `withMcpStop`'s own body (DW-164).
- The advisory still cannot read the supervisor's environment, only the checking process's; it now says so in all three forms.
- The seven `assets.py` re-exports added by the previous pass have no test of their own, and nothing in the tree calls them through `assets`.
- The `SKILL.md` edit from the previous pass changes shipped skill text with no version bump, as the story forbids one; it reaches users at the next release.
- Both review layers read the diff from a file, as it was too large to inline. The Agent tool in this session has no `run_in_background` parameter, so the workflow's explicit `run_in_background: false` could not be passed; every subagent still returned within the turn.

DRIFT: `test/enginemcp.test.ts` and `test/sandbox.test.ts` edited, outside Files — they relied on the static stop the one-way seam removes — affects: none
DRIFT: `test/sweep.test.ts` and `src/inbox.ts` left unchanged, though listed — neither needed a change — affects: none
DRIFT: `planseams.ts` also holds `canonicalPr` and `DEFERRED_REL` — `runPr` needs the first, and the second needed a leaf — affects: none
DRIFT: `runners.ts` also holds `originRepo`, `stopEngine`, `stopEngineAt` — `gh`'s dependency and the 36.3 Risks placement — affects: none
DRIFT: `_glb.py` also took `AXES`, `BOUNDS_TOLERANCE`, `_number`; `_core` also holds `Refusal`, `Binary` — the GLB code may not import `assets` — affects: none
DRIFT: `resolve_binary` adds `flag` and returns a `Binary` tuple rather than raising — each module has its own refusal class and pinned wording — affects: none
DRIFT: `assets.user_env` is a thin wrapper, not a re-export — `patch.object(assets, "_hkcu_value")` must still bite — affects: none
DRIFT: `showAtBase` takes opts and `atRef` stays separate in the leaf — the callers' locale, stream, regex and clip differ and are pinned — affects: none
DRIFT: `_write_atomic` shared by three modules only; `evals.py` and `launch.py` keep theirs — their bodies differ — affects: none
DRIFT: imports the moves left unused removed from `assets.py`, `playable.py`, `playable_judge.py` — tidy-up; no test uses them — affects: none
DRIFT: the advisory's per-run form names `engine-mcp-forwarder`, the fixed form names the variable — the I/O matrix requires them — affects: none
DRIFT: the contract sentence also mentions the advisory wording; the 35.4 note's body keeps the old row format — historical and pinned — affects: none
DRIFT: `apps/supervisor/src/board.ts` edited, outside the plan's Files list — the 36.2 Risks entry orders `DEFERRED_REL` through a leaf — affects: none
DRIFT: DW-86 and DW-87 read `status: open — narrowed …`, not `status: narrowed` — `board.ts:179`, `plansync.py:3340` and the sweep key on the first word — affects: later sweeps triage both entries
DRIFT: `_forwarder_text` normalises a set value as `engineMcpPort` does (`00080` reads `fixed 80`, JavaScript's whitespace) — the patch asked for its exact rule — affects: none
DRIFT: `plugins/tk-studio/skills/tk-studio-launch/SKILL.md:61` edited, outside the plan's Files list — the row description is the same text as the `launch.py` docstring, and the check no longer prints the old shape — affects: none

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:53Z | 2026-10-30T20:48:44Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-31T19:52:07Z | 2026-10-31T19:54:00Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-31T20:59:50Z | 2026-10-31T21:57:18Z | 618d0317-67be-4003-acde-586750ae5795 | claude-opus-5-5 | medium | 8793767 | 172895 | 11.7352 | completed |
| review | 1 | 2026-10-31T21:57:18Z | 2026-10-31T22:10:58Z | 35cfc603-93bc-4269-99a4-35a3a5a7596f | claude-opus-5-5 | medium | 3885250 | 64322 | 4.9650 | completed |
| review | 2 | 2026-10-31T22:10:58Z | 2026-10-31T22:25:16Z | 3c731e7d-96ee-43d6-b022-3960cc3d2f39 | claude-opus-5-5 | medium | 3864529 | 61530 | 5.0467 | completed |
| gate | 1 | 2026-10-31T22:25:16Z | 2026-10-31T22:29:45Z | bcb89cf4-7aaa-44c6-b66e-011c333883ca | claude-opus-5-5 | medium | 1132966 | 17651 | 1.4575 | completed |

## Reconcile

### 2026-10-31 — no-impact

- Score: 2
- Reasoning: 36-7 is the last entry of `stories.yaml` and Epic 36 the last epic in `epics.md`, so no later story was planned against anything that changed. The one DRIFT line naming an effect, DW-86 and DW-87 reading `status: open — narrowed …`, touches later sweeps, not a story: the engine's own parser (`bmad_loop/deferredwork.py:34`), `board.ts` and `plansync.py` read the first word, so both stay open. The moves keep their re-exports, and the contract stays 0.1.31 with one wording sentence; the advisory text is what AC3 orders.
- Affected: none
- Invariant: none
- Stated, not impact: `bmad-loop-sweep/SKILL.md:34` and `automation-mode.md:56` still say the status "is `open`", so a sweep session reading that literally could omit both ids and burn a retry (`sweep.py:110` compares against the parser); `deferred-work-format.md` has no `open — narrowed` form yet. The consult's rule candidate covers it, for the retrospective.

Gate: Part A no-impact; Part B epic complete: no next story (36-7 accepted, plans/36-7.md; every manifest entry has a spec; no open queue entry names an Epic 36 story, so nothing to apply; `bmad-loop validate` reports only the expected dirty tree; no plan stage opened, as nothing was planned)

