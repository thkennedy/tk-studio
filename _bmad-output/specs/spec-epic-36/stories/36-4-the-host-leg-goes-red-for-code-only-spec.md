---
title: 'The Host Leg Goes Red for Code Only'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
baseline_revision: 'b1703794fa9aa810fca4a2e29b6ea65718ea2bc0'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: adjust-stories
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-4.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** As the loop, I want the host leg to fail only on what the story or the bundle changed: no host test pinning a live planning artifact, every drive budgeting from its manifest timeout with headroom and git- or uv-spawning tests above bun's 5 s, every text read and write under the lib and the installer naming its encoding, an in-process drain test for the claim-path `TierRequired`, and the planner's Stories-row regex rule in its contract-test guidance, so that a leg's red means the code, never the box, the clock or the planner (holes 96, 97, 103; AI-8; DW-111, DW-112, DW-132).

**Approach:** Transcribed acceptance criteria below (epics.md §Story 36.4, authoritative); the shapes are `plans/36-4.md` §Settled shape 1-6 and its "Anchors after 36.3" paragraph (where its older numbers differ, that paragraph wins; re-grep). The serve process does not change: only tests, conformance drives, guidance and docs move, so no supervisor restart is owed.

**AC1 (verbatim).** **Given** the lib suite and the supervisor suites **When** a test asserts the exact state of a planning artifact under `_bmad-output` (a live spec's design-note set, a stories list) **Then** a guard in the lib suite finds the exact-set assertion over a live spec folder and fails naming it; shape tests read fixtures, and a real-artifact test asserts only what cannot change (the capability count, the story map; `test_launch.py`; DW-111, hole 96)

**AC2 (verbatim).** **Given** every conformance drive that runs a bun suite, and every test that spawns git or uv under bun **When** the drive and the test run **Then** the drive's suite bound derives from its manifest `timeout` with headroom through one helper the drives share (`contracts/conformance/`, `runner.py`), and git- or uv-spawning tests carry a preload default above bun's 5 s (DW-112, hole 97); an in-process drain test asserts the claim-path `TierRequired` inside the host gate (B11); the planner's contract-test guidance carries the Stories-row regex rule (C8); the nt `kill_tree` tests run once on the host by the operator through the consult log and the spec records the result (35.3's `unverifiable-here`)

**AC3 (verbatim).** **Given** a text-mode `write_text`, `read_text`, `open` or `Path.open` under `plugins/tk-studio/lib`, `tools/installer` and `apps/*/scripts` **When** conformance runs **Then** a call with no explicit `encoding=` fails the run naming the call site (binary modes exempt), the existing call sites are fixed, and `AGENTS.md` carries the pitfall line (DW-132, hole 103); the contract (0.1.31, additive) names the rule; DW-111, DW-112 and DW-132 close by this PR

**Replan (36-3 gate, 2026-10-31).** Five drives run bun suites, not four: `e2e_paused_exits.py` comes onto `_budget.py` too.

## Boundaries & Constraints

**Always:** `plans/36-4.md` §Files is the boundary; any other file is a recorded deviation. Studio scripts are stdlib-only; writes atomic; headless surfaces end in the JSON status block; contract change additive on 0.1.31 (36.4's paragraph after 36.3's, its test pins 36.3 < 36.4). The two `task-planning.md` copies gain the same lines (`test_nest_pipeline`). `_budget.py` has no `main()` and stays import-safe in the built zip. The `encoding=` rule is the keyword: positional `read_text("utf-8")` sites are fixed too.

**Block If:** the Files list must grow past the band (consult `file-outside-files`; the dev session never splits the story). More than one lib test must stay default-encoded to reproduce a Windows defect (one such call: explicit `encoding=locale.getpreferredencoding(False)` with a comment; more: consult `deviation-gt-0`). `setDefaultTimeout` is not exported by this bun (`bun --version`; name the version, never a per-test timeout across twelve files).

**Never:** a bare exempting comment or a skip-list of files in the encoding drive. Run the nt `kill_tree` tests from the engine (the operator's, in the Consult Log). Push, tag, release, bump the gate x3 versions, or touch remotes. Edit `epics.md`, `plan/`, `stories.yaml`, `routing.toml`, `policy.toml` or `supervision/`. The `plugins/tk-studio/README.md` Windows-notes bullet (36.7's). DW-112's "the gate's tail names the failing test" (stays stated on the entry). Re-flip the 35 header pins.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pin planted (lib) | A planted lib test source reaching the live tree with `assertEqual(set(...), {...})` over a spec folder | The guard fails naming the test | `test_planning_pins_guard` planted case |
| Allowed read | `len(parsed["caps"])`, a subscript against a constant | Not flagged | Same test file |
| Pin planted (supervisor) | A planted `.test.ts` source joining the repo root (`import.meta.dir, "..", "..", ".."`) to `_bmad-output` with a `toEqual` | The guard fails naming the file | Same; a textual scan (no TS AST in stdlib), skipped when `apps/supervisor` is absent; temp-root fixtures are not flagged |
| Manifest entry present | `suite_bound("e2e_x.py", install_s=40)`, manifest `timeout` 300 | 245 (300 - 40 - 15) | `_budget` unit test |
| Manifest entry absent | Script not in the manifest | Falls back to `runner.DEFAULT_TIMEOUT` | Same |
| Unencoded call planted | A temp tree with one bare `read_text()` | The drive fails naming `<file>:<line> <call>` | `test_conformance` planted case |
| Exempt calls | `open(p, "rb")`, `os.open`, `os.fdopen`, `tempfile`, urllib/tar/zip openers, `**kwargs`, string constants | Not flagged | Same |
| Root absent | `apps/*/scripts`, or `tools/installer` in an extracted archive | A `not_run` step, `ok` | Same |
| Stored definition needs sbx on host | `runJob` over a queued run, `requires.tier: sbx`, tier host | Stays `queued`, one `claim-refused {key: "placement:TierRequired"}`, no `claimed`, no spawn | `test/drain.test.ts` |
| Fresh `validate()` branch | The same refusal past `claimGate` | As above, where it can run | `describe.skipIf(!TK_STUDIO_ROOT \|\| !uv)` |
| Test without its own timeout | Child `bun test` under `preload.ts` | Default 30 s; a test's own timeout wins | `tmp.test.ts` child-run precedent |

</intent-contract>

## Code Map

`plans/36-4.md` §Code Map is the investigation, read it first: "Anchors after 36.3" (current numbers), holes 96, 97, 103, B11, C8, the nt tests, the contract and the ledger. Added at dispatch:

- `apps/supervisor/test/*.test.ts` -- 18 files name `_bmad-output`, all over temp roots so far as the plan's sweep found; those that resolve the real repo root are `delivery.test.ts:139`, `engagement.test.ts:17,:624`, `closeout.test.ts:33`, `inbox.test.ts:20`. The AC's Given names the supervisor suites, so the guard's textual scan covers them, and must read green on them today.
- `~/.bun/bin/bun` -- bun exists but is not on `PATH` (see Verification).

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/tests/test_planning_pins_guard.py`, `tests/test_launch.py`, `tests/fixtures/open-questions/SPEC.md` -- the guard (lib AST sweep plus the supervisor textual scan), its planted cases and self-check; remove the three exact pins and move the question-set shape to the fixture -- AC1.
- `plugins/tk-studio/contracts/conformance/_budget.py`, `e2e_vertical_slice.py`, `e2e_engine_gate.py`, `e2e_run_sweep.py`, `e2e_playable_verify.py`, `e2e_paused_exits.py`, `manifest.json`, `lib/tests/test_playable_judge.py` -- Settled shape 2; `MANIFEST_TIMEOUT_S` copies and their asserts go; pins flip to the helper; a `_budget` unit test -- AC2.
- `apps/supervisor/test/preload.ts`, `apps/supervisor/test/drain.test.ts` -- `setDefaultTimeout(30_000)`; Settled shape 3 -- AC2.
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`, its `apps/supervisor` mirror, `lib/tests/test_planner_rules.py` -- Settled shape 5 and the phrase pin -- AC2.
- `plugins/tk-studio/contracts/conformance/e2e_text_encoding.py`, `manifest.json`, `lib/tests/test_conformance.py` -- Settled shape 1 and the planted case -- AC3.
- The eleven lib test files in the plan's §Files -- `encoding="utf-8"` on all sites the drive names, keyword form -- AC3.
- `AGENTS.md` -- Settled shape 4 -- AC3.
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- the 36.4 paragraph after 36.3's, the header clause and rulings entry, the §8 sentence; `test_0_1_31_story_36_4_…` with the prefix regex -- AC3.
- `_bmad-output/implementation-artifacts/deferred-work.md`, `kb/agent-pc-setup-runbook.md` -- DW-111, DW-112, DW-132 `resolved 2026-10-31 by this story's PR (36.4: …)`; holes 96, 97, 103 rows -- AC3.

**Acceptance Criteria:** the verbatim AC1-AC3 in the intent contract, proven as follows.
- Given the fixed tree, when the guard runs, then it is green; given a planted pin, then it fails naming the test.
- Given the fixed tree, when `runner.py run` runs, then `ok: true` with `e2e_text_encoding` among the drives and every bun drive's bound from `_budget.py`.
- Given `grep MANIFEST_TIMEOUT_S` under `contracts/conformance` and `lib/tests`, then no hits.
- Given the Consult Log's operator ask, when the operator answers, then the nt result is recorded; until then AC2's nt clause is `unverifiable-here`.

## Spec Change Log

## Review Triage Log

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 6, low 4)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[medium]` `[patch]` The 36.4 clause was nested inside 36.3's in the contract header; made a sibling, the test tightened.
  - `[medium]` `[patch]` The consult's open ledger entry was missing; DW-155 added, DW-112 points at it.
  - `[medium]` `[patch]` The pins guard missed common root and path spellings and exact-assert shapes (AC1); widened in both halves, planted cases added, green on today's tree.
  - `[medium]` `[patch]` The encoding drive missed computed-mode `Path.open`, `pathlib.Path.open`, `request.path.open` and `encoding=None` (AC3); all flagged, no new real site.
  - `[medium]` `[patch]` `e2e_run_sweep.py` counted none of its pre-suite wait; `other_s` carries `TRIAGE_WAIT_S`, the bound stays 240.
  - `[medium]` `[patch]` `suite_bound` could answer a non-positive bound after the module asserts went; raises `ValueError` naming the script.
  - `[low]` `[patch]` DW-112's status and the runbook row misdescribed what stays unbuilt; reworded.
  - `[low]` `[patch]` The `AGENTS.md` pitfall line had the failure backwards (the plan's wording, against DW-132); corrected.
  - `[low]` `[patch]` Nothing pinned the `AGENTS.md` line AC3 names; `test_conformance.py` pins it.
  - `[low]` `[patch]` Unbalanced parenthesis in the `e2e_playable_verify` manifest note; fixed.
- rejected: the nt `kill_tree` clause having no recorded result (the operator's step by the SPEC's Assumptions, asked in the Consult Log); per-drive minimum suite bounds (invented numbers, not in the criteria).

### 2026-10-31 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 3, low 6)
- defer: 0
- reject: 8: (high 0, medium 1, low 7)
- addressed_findings:
  - `[medium]` `[patch]` The pins guard passed a whole-set pin held in a known collection name against a subscript (`assertEqual(parsed["noted_caps"], want)`), hole 96's own shape (AC1); a known collection name is now exact, a subscript against a scalar constant stays allowed.
  - `[medium]` `[patch]` The encoding drive put any name bound from an `os.*` or `tempfile.*` call on its file-wide non-Path list, so `tmp = tempfile.mkdtemp(); tmp = Path(tmp); tmp.open("w")` was missed (AC3); only opener-making calls count now.
  - `[medium]` `[patch]` `gzip.open(p, "rt")`, `bz2` and `lzma` were exempt before the mode was read, the DW-132 failure (AC3); text mode without `encoding=` is flagged, an absent mode is binary for them.
  - `[low]` `[patch]` `codecs.open(p, "r")` was exempted by the string-second rule; it reads as an unbound open now.
  - `[low]` `[patch]` The guard did not read `assertTrue(set(x) == {...})` or `assertFalse(set(x) ^ {...})`; it does now.
  - `[low]` `[patch]` `_whole_names` skipped annotated assignments; it reads them now.
  - `[low]` `[patch]` `REPO_ROOT.glob("_bmad-output/...")` did not read as reaching the live tree; `glob` and `rglob` count as joins.
  - `[low]` `[patch]` The contract and the manifest note said any absent root is `not_run`, against the drive's red on a missing `lib`; both reworded, the contract's phrase pinned.
  - `[low]` `[patch]` Nothing pinned `--timeout` on the multi-file drives, their only route above 5 s on bun 1.4.3; `test_playable_judge.py` pins it for every drive with more than one suite file.
- rejected: DW-154's open entry naming Story 36.4 (medium: no AC names it, the intent's scope excludes it, and this run may not touch existing ledger entries; carried to Residual risks); the nt `kill_tree` clause (the operator's, already asked in the Consult Log); the drain test's `describe.skipIf` on ambient `TK_STUDIO_ROOT` (the spec's matrix row names that condition); `e2e_paused_exits.py` counting no `other_s` (`track.main` runs in-process and refuses with no binding, no subprocess or network; well inside the 15 s headroom); an exact assert inside a same-file helper and other supervisor root spellings (`new URL(import.meta.url)`, `process.cwd()`), both the guard's recorded static limit, with no such spelling in the suites today; `REPO_ROOT / OUT` through a string constant and a subscripted dict literal as the expected value (no such test exists, and a static guard cannot be complete).

### 2026-10-31 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 3, low 5)
- defer: 0
- reject: 3: (high 0, medium 2, low 1)
- addressed_findings:
  - `[medium]` `[patch]` The pins guard allowed any `len(...)`, so `assertEqual(len(parsed["noted_caps"]), 6)` passed though the count moves with the next planner note (AC1); only a `len` of a subscript keyed `caps` is allowed now, and `test_planner_rules.py`'s test is split so its two `len` asserts on a slug and a key are not read as live.
  - `[medium]` `[patch]` The guard flagged `want - set(parsed["x"])`, a stable subset check, and its docstring was false for `-`; `A - B` is exempt only when `A` is a literal collection or a name bound only to one, and `^` stays exact in both orders.
  - `[medium]` `[patch]` The drain test's fresh `validate()` case did not assert "no spawn", which its matrix row requires; the log must hold the login probe's line and nothing else. It ran and passed with `TK_STUDIO_ROOT` set.
  - `[low]` `[patch]` `assertSequenceEqual` and `assertTupleEqual` were not exact asserts in the guard; both are now.
  - `[low]` `[patch]` The guard missed `assertFalse(set(x) != {...})`, `assert not set(x) ^ {...}` and `assert not set(x) != {...}`; all are flagged.
  - `[low]` `[patch]` The encoding drive missed import aliases (`gz.open(p, "rt")`, `pl.Path.open(p, "w")`, `from io import open as o`); a per-file alias map reads them, and aliased exempt calls stay exempt.
  - `[low]` `[patch]` The drive exempted `zipfile.Path(p).open("r")`, which uses the locale encoding; `zipfile.Path` no longer counts as an opener maker.
  - `[low]` `[patch]` The drive flagged `z: zipfile.ZipFile = zipfile.ZipFile(p); z.open(name)`, where `encoding=` raises `TypeError`; annotated bindings are read.
- rejected: the nt `kill_tree` clause having no recorded result (medium: the operator's, already asked in the Consult Log); DW-154's open entry naming Story 36.4 (medium: no AC names it and this run may not touch existing ledger entries; carried to Residual risks); `suite_bound` raising at drive import before the status block (low: only a bad manifest reaches it, the module-level asserts it replaced died the same way, and the runner fails the drive).

## Design Notes

The guard's supervisor half is textual because stdlib has no TypeScript parser; it needs only to catch a test that joins the real repo root to `_bmad-output` and asserts equality, and it is a false-positive risk rather than a false-negative one on the current tree: read it green before relying on it.

The derived bounds with `HEADROOM_S = 15` are 245 (paused exits), 245 (run sweep), 185 (vertical slice), 65 (engine gate), 77 (playable verify), each covering today's: compute them from the manifest, never restate them in a drive.

`test/tier.test.ts` and `guards.test.ts` fail at baseline with `TK_ATLASSIAN_*` set (4 cases; 0 with them unset): compare against that. Bound any command that may hang with `timeout -k 5 <s>`.

## Verification

`bun` is at `~/.bun/bin/bun`, not on `PATH`: `export PATH="$HOME/.bun/bin:$PATH"`. `apps/supervisor/node_modules` is absent: run `bun install --frozen-lockfile` there first and commit nothing it produces. Typecheck with `bun node_modules/typescript/bin/tsc --noEmit` if `.bin` is empty.

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: green
- From `plugins/tk-studio/lib`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true` over every surface, the encoding drive included
- From the root: `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: green
- From the root: `uv run python plugins/tk-studio/contracts/conformance/e2e_text_encoding.py` -- expected: `ok: true`
- From `apps/supervisor`: `bun test` -- expected: green, `drain.test.ts` and `tmp.test.ts` ran
- From `apps/supervisor`: `bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean

**Manual checks:**
- The nt `kill_tree` tests: the operator's, by the Consult Log's ask.

## Deviation Summary

### pass 1 (2026-10-31)

- planned: `preload.ts` gains `setDefaultTimeout(30_000)` / actual: already there (hole 108, d872a3f), only its comment corrected / why: the existing comment was false for multi-file runs / may affect: none
- planned: the preload default alone covers git- and uv-spawning tests under bun / actual: `e2e_paused_exits.py` and `e2e_vertical_slice.py` also pass `--timeout 30000` through a local `TEST_TIMEOUT_MS`; a plain multi-file `bun test` stays at 5 s after its first file; DW-112 and the runbook row say so / why: on bun 1.4.3 the preload default stops after a run's first file (reproduced by this session outside the repo: 3 files, 6 s tests, first passes, next two time out at 5000 ms; the consult measured `[test] timeout = 30000` in a throwaway `bunfig.toml` on bun 1.4.3: all three still failed at 5000 ms) / may affect: 36-5, 36-7
- planned: the preload's child-run test follows the `tmp.test.ts` precedent / actual: it lives in `drain.test.ts`, outer tests carrying their own 90 s timeout / why: `tmp.test.ts` is not in §Files, and the outer tests hit the same first-file limit / may affect: none
- planned: the drive's interface was not specified beyond scanning its roots / actual: adds `--plugin-root` and an importable `run()` / why: the planted-tree test runs it end to end / may affect: none
- planned: a root that does not exist is a `not_run` step, `ok` / actual: holds for `tools/installer` and `apps/*/scripts`; a missing `lib` is red / why: otherwise the drive could pass having scanned nothing / may affect: none
- planned: guard design flags a test reaching `parents[4]`/`REPO_ROOT` plus `_bmad-output` / actual: requires one path expression joining the two / why: `test_stage_log.py` passes `REPO_ROOT` beside a temp root and was a false positive / may affect: none
- planned: `test_0_1_31_story_36_4_…` is the contract test change / actual: 36.3's Stories-row `assertIn` also moved to the prefix regex / why: appending Story 36.4 broke that literal, the C8 case / may affect: none

Implementer's score: 2.

DRIFT: `preload.ts` already carried the 30 s default, only its comment changed — hole 108 landed it first — affects: none
DRIFT: two multi-file drives pass `--timeout 30000`; a plain multi-file `bun test` stays at 5 s past its first file — bun 1.4.3's preload default reaches only the first file — affects: 36-5, 36-7
DRIFT: the preload's child-run test lives in `drain.test.ts` — `tmp.test.ts` is outside Files — affects: none
DRIFT: `e2e_text_encoding.py` adds `--plugin-root` and `run()` — the planted-tree test needs them — affects: none
DRIFT: a missing `lib` root is red in the encoding drive, not `not_run` — a drive that scanned nothing must not pass — affects: none
DRIFT: the pins guard requires one path expression joining the repo root and `_bmad-output` — `test_stage_log.py` was a false positive — affects: none
DRIFT: 36.3's Stories-row `assertIn` moved to the prefix regex — appending Story 36.4 broke the literal — affects: none

### pass 2 (2026-10-31, review patches)

- planned: a computed mode on a Path-like receiver stays text mode / actual: `p.open(m)` is flagged; objects made by an exempt module (`zipfile.ZipFile(p).open(m)`, `with … as z`) and argument shapes a Path cannot take stay exempt, and a conditional mode with `b` in both branches counts as binary. Limit: non-Path names are file-wide, so `z = Path(p); z.open(m)` is missed if `z` is bound to a `ZipFile` elsewhere in the same file / why: exempt openers must stay exempt, and `encoding=` on a binary open raises / may affect: none
- planned: the listed guard shapes / actual: also reads `str(R) + "/_bmad-output"`, f-strings, `Path(R, "_bmad-output")`, `import.meta.dirname` and similar / why: same class as the listed forms, green on today's tree / may affect: none
- planned: run sweep derives 245 (Design Notes, the plan's Anchors) / actual: it derives 240, still covering today's bound of 240, with `other_s` = `TRIAGE_WAIT_S` 5 / why: `launch.sweep` can spend that wait before the suite; the test pins the formula, not the result / may affect: none

DRIFT: the encoding drive exempts by receiver shape, with file-wide non-Path names — a Path name reused for a `ZipFile` in one file is missed — affects: none
DRIFT: the pins guard reads extra same-class root spellings — one line or two each, green on today's tree — affects: none
DRIFT: run sweep's bound derives 240, not the plan's 245 — the drive spends its triage wait before the suite — affects: none

### pass 3 (2026-10-31, follow-up review patches)

- planned: `_makes_non_path` never counts `os.*`, `tempfile.*` or `webbrowser.*` / actual: holds for name bindings; `_chained_on_a_module` keeps a direct chain on a module call exempt, so `tempfile.TemporaryFile().open(m)` stays exempt as `test_exempt_shapes` pins, and `tempfile.mkdtemp().open("w")` stays exempt because a `str` has no `.open` and the call raises before any file opens / why: the matrix exempts `tempfile`, and no encoding fault is reachable on that shape / may affect: none
- planned: a `len(...)` read is allowed by being narrow / actual: the `len` check runs first in `_exact_pair`, so `assertEqual(len(x), {"a"})`, flagged before this pass, is allowed / why: the matrix allows a count read, and a count compared with a collection can never pass, so it fails on its own / may affect: none

DRIFT: a direct chain on a module call stays exempt in the encoding drive — `test_exempt_shapes` pins `tempfile.TemporaryFile().open(m)`, and `mkdtemp().open` raises on a `str` — affects: none
DRIFT: the pins guard checks `len` first — the matrix allows a count read, and a count against a collection fails on its own — affects: none

### pass 4 (2026-10-31, second follow-up review patches)

- planned: pass 3's `len` read is allowed outright / actual: this narrows that line, which stays as history: the `len` check stays first, but only a `len` of a subscript keyed `caps` is allowed; `test_planner_rules.py`'s `test_worst_case_path_under_200` is split, all three assertions kept / why: a count of a planner-rewritten set moves with the next note, against AC1 / may affect: none
- planned: both operand orders of `-` read as exact / actual: `A - B` is exempt only when `A` is a literal collection or a name bound only to one in its scope. Limit: `want - have` stays allowed when both are names and `want` is literal-bound / why: a subset check stays green as notes grow, so it pins nothing / may affect: none
- planned: review patches change behaviour only / actual: the private helper `_has_exact_equality` is renamed `_has_exact_compare` and the module docstring now says "the count of `caps`" / why: the helper takes an operator now and the docstring would be false / may affect: none

DRIFT: the pins guard allows a `len` only of a subscript keyed `caps`, narrowing pass 3's line, and `test_planner_rules.py`'s test is split — a count of a planner-rewritten set is a pin AC1 forbids — affects: none
DRIFT: the pins guard exempts `A - B` only for a literal-bound `A`, so `want - have` stays allowed — a subset check pins nothing, and a static guard cannot tell the operands' contents — affects: none

## Consult Log

- 2026-10-31T09:17Z — trigger: operator step (AC2, not a consult) — question: ASK THE OPERATOR — on the Windows host, from `plugins/tk-studio/lib`, run `uv run python -m unittest tests.test_playable tests.test_assets` once and answer here with the pass and skip counts; the nt tests are `test_playable.py` `test_kill_tree_on_nt_kills_the_child_and_the_grandchild` and the nt class in `test_assets.py` (35.3's `unverifiable-here`) — ruling: n/a — do: record AC2's nt clause `unverifiable-here` until the answer lands
- 2026-10-31T09:48:21Z — trigger: deviation-gt-0 — question: accept that the preload's 30 s default reaches only the first file of a multi-file bun run, with two drives passing --timeout and DW-112 resolved with a caveat? — ruling: accept-deviation score 2 — do: keep the code as it stands, no package.json, bunfig or per-file timeout change, DW-112 stays resolved with its caveat; add one new status: open entry to deferred-work.md past the ledger's highest id for a bare multi-file bun test reading 5 s past its first file on bun 1.4.3, and point DW-112's status at it; change this deviation's line to may affect: 36-5, 36-7 with the bunfig measurement, keep deviation_score 2 — rule candidate: A plan that relies on a bun runner setting (preload default, timeout) must state and measure its reach across a multi-file bun test, and must name the runner shapes it covers: per-file host gate, multi-file drive, bare whole-suite.
- 2026-10-31T10:20:58Z — trigger: deviation-gt-0 — question: accept pass 2's encoding-drive exemption shapes, the guard's extra spellings and run sweep's 240 against the plan's 245? — ruling: accept-deviation score 1 — do: keep all three; deviation_score stays 2; add one deviation and one DRIFT line per item, may affect none, item 1 stating the file-wide name limit and item 3 stating 240 not 245; pin test_playable_judge.py's bound by the formula, not the literal 240 — rule candidate: A plan's derived numbers are illustrative and the formula's inputs are pinned, so a helper input that covers real time the drive spends, with the result still covering today's value, is a score-1 recorded deviation that needs no consult, and tests pin the formula, never the result.
- 2026-10-31T10:48:58Z — trigger: deviation-gt-0 — question: accept the follow-up pass's direct-chain exemption in the encoding drive and the `len`-first order in the pins guard? — ruling: accept-deviation score 1 — do: (a) keep `_chained_on_a_module`, add no list of object-making calls, record that `tempfile.mkdtemp().open("w")` stays exempt because a `str` has no `.open`; (b) keep the `len` check first and fix the `_is_len` docstring, which claimed a count cannot change — rule candidate: A static guard need not flag a shape that cannot succeed at runtime (an attribute the type lacks, a comparison that can never be true), so a false negative on such a shape is a score 1 deviation needing no consult when the implementer shows that with a return-type check or an existing pin.
- 2026-10-31T11:25:22Z — trigger: deviation-gt-0 — question: accept pass 4's narrowed `len` allowance with the `test_planner_rules.py` split, the literal-bound `-` exemption and the helper rename, or does any reopen the 10:48:58Z ruling? — ruling: accept-deviation score 1 — do: keep all three as patched, restore nothing, leave deviation_score at 2, the 10:48:58Z ruling stands; add a pass 4 deviation and DRIFT line for items 1 and 2, affects: none, item 1 saying it narrows pass 3's line and naming the split, item 2 stating the `want - have` limit, item 3 one deviation line only; the ruling covers these three only, and the full lib suite and conformance run on the patched tree before done — rule candidate: A pins-guard patch that narrows an allowance toward AC1's "only what cannot change" and keeps a consult-ruled check order is a score 1 deviation needing no consult, when every existing live-tree read the spec allows stays unflagged and any split test keeps all its assertions.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:43Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-31T07:00:50Z | 2026-10-31T07:05:09Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-31T09:16:35Z | 2026-10-31T10:26:21Z | 47dadc20-5695-471b-91b9-4ef428dae594 | claude-opus-5-5 | medium | 9035164 | 201471 | 11.8074 | completed |
| review | 1 | 2026-10-31T10:26:22Z | 2026-10-31T10:50:19Z | d22b26d0-006f-43a9-a561-e4b26a8eca2a | claude-opus-5-5 | medium | 3045238 | 100326 | 5.7258 | completed |
| review | 2 | 2026-10-31T10:50:19Z | 2026-10-31T11:26:24Z | e03b84ca-a7cc-4f05-8e7a-498671d83abe | claude-opus-5-5 | medium | 4195002 | 112624 | 7.4278 | completed |
| gate | 1 | 2026-10-31T11:26:25Z | 2026-10-31T11:32:29Z | 831d6d67-4e84-4073-80d6-58dd28e8a4d9 | claude-opus-5-5 | medium | 1438768 | 22812 | 2.0904 | completed |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261031T091448Z-e1bd9f` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** AC1: a lib-suite guard fails naming an exact-set assertion over a live spec folder, and `test_launch.py`'s real-artifact test keeps only the capability count and the story map. AC2: five bun drives take their suite bound from `_budget.py`; `drain.test.ts` asserts the claim-path `TierRequired` inside the host gate; the Stories-row rule is in both `task-planning.md` copies. AC3: `e2e_text_encoding` fails a text-mode open with no `encoding=`, the 147 lib-test sites are fixed, `AGENTS.md` carries the pitfall line, the contract names the rule (0.1.31, additive). This second follow-up pass closed eight gaps in the guard, the drive and the drain test. It changed no ledger entry: `deferred-work.md` has no diff against the story's previous commit.

**Files changed in this pass.**
- `plugins/tk-studio/lib/tests/test_planning_pins_guard.py`: the `caps`-only count allowance, the `-` rule, two more exact asserts, the negated forms, planted cases.
- `plugins/tk-studio/lib/tests/test_planner_rules.py`: `test_worst_case_path_under_200` split in two, all three assertions kept.
- `plugins/tk-studio/contracts/conformance/e2e_text_encoding.py`: the import alias map, `zipfile.Path`, annotated bindings.
- `plugins/tk-studio/lib/tests/test_conformance.py`: the drive's new flagged and exempt cases.
- `apps/supervisor/test/drain.test.ts`: "no spawn" on the fresh `validate()` branch.

**Review.** 8 patches applied (3 medium, 5 low), 0 deferred, 3 rejected, 0 bad_spec, 0 intent_gap. Follow-up review recommended: true (0 high; score 3 x 3 + 5 = 14, threshold 5). The review diff, 360 KB, reached both layers as a file path rather than inline.

**Verification.** All on the final patched tree.
- Run by this session: `uv run python -m unittest discover tests`: 2743 tests, OK, 4 skipped. `uv run python ../contracts/conformance/runner.py run`, bun on `PATH`: exit 0.
- Run by the implementer: `runner.py run`: `ok: true`, 23 surfaces, 166 checks, 0 failures. `tests.test_release_roster`: 86 tests, OK. `e2e_text_encoding.py` from the root: `ok: true`, `apps/*/scripts` `not_run`. `bun test`, all `TK_ATLASSIAN_*` unset: 1781 pass, 93 skip, 0 fail. `tsc --noEmit`: clean.
- `drain.test.ts`'s skip-gated case ran once with `TK_STUDIO_ROOT` set to the worktree root: 4 pass, 0 fail. The file did not change after that run. The whole-suite run skips it.
- The implementer reports the new planted guard and drive cases for the fixes failed against the code before each fix; the cases that passed there are regression guards. This session did not repeat that check.

**Unverifiable here.** AC2's nt `kill_tree` clause: the operator runs `uv run python -m unittest tests.test_playable tests.test_assets` from `plugins/tk-studio/lib` on the Windows host, and answers in the Consult Log. The clause stays open until then, so this story's AC2 is not wholly proven.

**Residual risks.**
- DW-154 (hole 110) stays `status: open` and its text still reads "Fix to make (Story 36.4, the host leg goes red for code only)". No AC builds it: no Windows-semantics check for path joins or renames, and no per-suite verdict line on the leg's event. Left untouched as this run's instructions require; the orchestrator owns re-homing it.
- On bun 1.4.3 a bare multi-file `bun test` reads 5 s past its first file, so slow git- or uv-spawning tests can still go red there (DW-155; 36-5 and 36-7 run the whole suite). The per-file host gate and the two multi-file drives are covered. AC2's "preload default above bun's 5 s" holds for those shapes only.
- The guard is static. Still not flagged: an exact assert in a helper that does not itself reach the live tree; `_bmad-output` held in a named constant; a collection held as a class attribute (`assertEqual(parsed["x"], self.WANT)`); `assertTrue(not set(x) != {...})`; `want - have` with a literal-bound `want`. Its supervisor half is textual and reads `import.meta.dir` spellings only.
- The encoding drive has no types: non-Path names are file-wide, so a Path name reused for a `ZipFile` in one file is missed. An unaliased `from gzip import open` reads as the builtin `open`.
- DW-155's id may collide with an operator session's new entry (the ledger's ids collided before, day-8e).
- Design Notes still print 245 for run sweep; the true derived value is 240 (Deviation Summary, pass 2).

DRIFT: `preload.ts` already carried the 30 s default, only its comment changed — hole 108 landed it first — affects: none
DRIFT: two multi-file drives pass `--timeout 30000`; a plain multi-file `bun test` stays at 5 s past its first file — bun 1.4.3's preload default reaches only the first file — affects: 36-5, 36-7
DRIFT: the preload's child-run test lives in `drain.test.ts` — `tmp.test.ts` is outside Files — affects: none
DRIFT: `e2e_text_encoding.py` adds `--plugin-root` and `run()` — the planted-tree test needs them — affects: none
DRIFT: a missing `lib` root is red in the encoding drive, not `not_run` — a drive that scanned nothing must not pass — affects: none
DRIFT: the pins guard requires one path expression joining the repo root and `_bmad-output` — `test_stage_log.py` was a false positive — affects: none
DRIFT: 36.3's Stories-row `assertIn` moved to the prefix regex — appending Story 36.4 broke the literal — affects: none
DRIFT: the encoding drive exempts by receiver shape, with file-wide non-Path names — a Path name reused for a `ZipFile` in one file is missed — affects: none
DRIFT: the pins guard reads extra same-class root spellings — one line or two each, green on today's tree — affects: none
DRIFT: run sweep's bound derives 240, not the plan's 245 — the drive spends its triage wait before the suite — affects: none
DRIFT: a direct chain on a module call stays exempt in the encoding drive — `test_exempt_shapes` pins `tempfile.TemporaryFile().open(m)`, and `mkdtemp().open` raises on a `str` — affects: none
DRIFT: the pins guard checks `len` first — the matrix allows a count read, and a count against a collection fails on its own — affects: none
DRIFT: the pins guard allows a `len` only of a subscript keyed `caps`, narrowing pass 3's line, and `test_planner_rules.py`'s test is split — a count of a planner-rewritten set is a pin AC1 forbids — affects: none
DRIFT: the pins guard exempts `A - B` only for a literal-bound `A`, so `want - have` stays allowed — a subset check pins nothing, and a static guard cannot tell the operands' contents — affects: none

## Reconcile

### 2026-10-31 — adjust-stories

- Score: 2
- Reasoning: The one deviation later work relies on is the preload's reach: on bun 1.4.3 its 30 s default stops after a run's first file (re-measured here: 3 files of 6 s tests, 1 pass and 2 fail at 5000 ms, 3 pass with `--timeout 30000`). The plans of 36-5, 36-6 and 36-7 run multi-file `bun test`s with no `--timeout`, so a notes-level change absorbs it; the DRIFT line named 36-5 and 36-7, and 36-6's plan is affected the same way. No later acceptance criterion names the preload, the bounds or the guards. The other deviations are consult-accepted and internal to the guard and the drive, and the 0.1.31 paragraph states the absent-root and budget rules as built. 36-5 also meets a stale fact (`AGENTS.md`) and moved anchors, refreshed in its plan.
- Affected: 36-5-the-supervisors-own-faults — "bun test                                                   # the whole suite before the commit"; "(5) No `AGENTS.md` yet (36.4 creates it)."
- Affected: 36-6-setup-and-the-launch-check-by-evidence — "bun test test/planstatus.test.ts test/queue.test.ts"
- Affected: 36-7-the-cycles-cut-and-the-docs-caught-up — "bun test                                                   # the whole suite: behaviour pinned by the existing suites"
- Invariant: none

Gate: Part A adjust-stories; Part B story accepted, planned 36-5-the-supervisors-own-faults
