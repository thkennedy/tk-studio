---
title: 'The Closeout Carries the Proof'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '193d6fe35deb347dbe47104619c83ce6e16980c1'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-6.md'
warnings: [multiple-goals, oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The engagement's closeout page carries each slice's contact sheet and verdicts but not its sampled frames or `report.json`, and every story of a run embeds the run's last leg's sheet (DW-77; DW-92's first edge); five smaller B15 edges remain open (DW-92).

**Approach:** Each slice leg copies its report and sampled frames beside the sheet it already copies; `composeCloseout` picks each story's own leg; `report`/`frames` flow through the closeout input to the page (files attached, verdict table embedded); the five edges are fixed, each with a test; contract 0.1.30 gains an additive Story 35.6 paragraph.

**User story (epics.md §Story 35.6, verbatim):** As the owner, I want the engagement's closeout page to carry each slice's sampled frames and `report.json` beside the contact sheet and the verdicts, each story reading its own leg's sheet, and the closeout's smaller edges closed, So that the page I read is the whole proof (DW-77, DW-92; the retrospective's B15).

**Acceptance criteria (epics.md §Story 35.6, verbatim):**

- **AC1.** **Given** a slice run's closeout **When** `delivery.ts composeCloseout` composes and `engage.py closeout` publishes **Then** the closeout input carries each slice's `report.json` and its sampled frames (paths under the run workspace), the page attaches the sheet and the frames and embeds the report's verdict table, and each story reads its own leg's sheet, not the run's last (`delivery.ts:240-245`); the contract (0.1.30, additive) names the closeout input's media shape and the engagement conformance drive is extended
- **AC2.** **Given** the edges **When** a run hits them **Then** `playable` declared without `verify.engine` reads `skipped: no verify.engine`, not `engine gate not green` (`hostverify.ts:420-421`); `recommend.py` reads a `.mcp.json` with a BOM (`utf-8-sig`, `:528`, as `engine_pin.py:134` does); a moment at tick ≥ `--ticks` is captured on the last tick (`playable.py:302-314`); `enginemcp.ts` starts the server in the folder whose config it read (`run.prefix`, `:398-426`); the `scoping` revise path sets `game: true` (`engage.py:1190-1196`); each with a test
- **AC3.** **Given** the lib and supervisor suites and conformance **When** they run **Then** the closeout's media and the five edges are covered; DW-77 and DW-92 close by this PR; the design spec's feature-ledger Phase 3 row is untouched (the TUA acceptance stays the operator's, AI-1)

**Planner's settled shape (SPEC Design notes CAP-13; plans/35-6.md `## Settled shape` 1-4):** the per-leg copy to `<store>/legs/<stamp>/` with `playable.report?`/`leg_frames?`; the story-leg window rule; `slices[].report?`/`frames?` and the page's attachment names and `| Report | Value |` table; the `e2e_closeout_media.py` conformance drive. These are binding as written in the plan.

## Boundaries & Constraints

**Always:**
- The plan's `## Files` list (18 files) is the boundary; any other file is a deviation recorded as `DRIFT:` and triggers the `file-outside-files` consult. A Files list growing past the plan's is a `halt` consult. Never split the story.
- Stdlib-only Python via `uv run`; atomic writes; every headless surface ends in the JSON status block (AD-11); nothing in the plugin imports a driver/supervisor/Hermes (AD-2); credentials never land in files or events (NFR5).
- The per-leg copy is slice-only and best-effort: a failed copy leaves `report`/`leg_frames` out and never sets a verdict. `frames`/`sampled` keep their 0.1.29 meaning. A slice with neither `report` nor `frames` renders exactly as in 0.1.29.
- Contract changes are additive at 0.1.30; the 0.1.29 Story 34.3/34.8 sentences stay untouched; the supersession is named only in the new 35.6 paragraph. Widening the four/five Stories-row pins in `test_driver_contract.py` is score 0 (35-4 consult rule).
- Ledger: DW-77 and DW-92 flipped to resolved in the ledger's own pending form when the PR number is unknown.

**Block If:**
- The per-leg copy needs a change to `proofCommit` (`worktree.ts:471-510`) or to the judge's `MEDIA` copy → consult.
- `engage.closeout` cannot run in process against a fake transport without importing from `tests/` → consult before adding a fixture folder or CLI flag.
- The story-leg window rule breaks a 34.8/35.1 test that pins the shared-sheet behaviour other than `delivery.test.ts:626-629` and `:649` → consult.

**Never:**
- Edit the design spec's feature-ledger Phase 3 row (AI-1); touch DW-46..DW-65 / DW-85..DW-87 (35.7); change the committed proof's per-run layout; ship 35.7's `run-sweep`.
- Push, tag, open a PR, run the release motion, or bump gate x3 versions.
- Edit `epics.md`, `stories.yaml`, canonical plan files, `.bmad-loop/routing.toml`/`policy.toml`, or anything under `supervision/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two stories, two legs | events: hv(A) → close-out A → hv(B) → close-out B | A's slice carries A's sheet/report/frames; B's carries B's | — |
| Re-run on branch tip | … close-out B → hv(B') | only B (last story) takes B'; A keeps its own | — |
| Window with no leg | close-out A with no host-verify in its window | A reads `not run` | — |
| `landedStory` without close-out | no close-out for landed key | takes window after the run's last close-out | — |
| Leg copy fails | copy of report/frames throws | `report`/`leg_frames` absent; verdict unchanged | best-effort |
| Unreadable report/frame at closeout | path in input not readable | note; field dropped; page still publishes | note |
| Report not a JSON object | `report.json` is `[]` or invalid | note, no table | note |
| Bad input types | `report` not a non-empty string / `frames` not list of non-empty strings | `CloseoutInputInvalid` | refuse |
| playable without verify.engine | `playable` declared, no `verify.engine` | `{verdict: skipped, reason: "no verify.engine"}` | red/malformed engine keep `engine gate not green` |
| `.mcp.json` with BOM | UTF-8 BOM file | `_mcp_status`/`record_mcp` read it | — |
| Moment tick ≥ `--ticks` | moment at tick ≥ ticks | captured on last tick; report looks up `Math.Min(tick, ticks-1)` | — |
| Prefixed run engine MCP | `run.prefix` non-empty | server cwd / probe / `--path` = `servedRoot(run)`; `{worktree}` token = worktree top | — |
| Scoping revise, no doc flags | revise of a pre-34.8 scope | record gains `game: true` | `OSError` → `ScopeUnwritable` |

</intent-contract>

## Code Map

The plan's `## Code Map` (`_bmad-output/specs/spec-epic-35/plans/35-6.md`) is the investigation; its line anchors are as of 2026-10-29 and are anchors, not pins. Summary:

- `apps/supervisor/src/hostverify.ts` -- `PlayableStep` :160-166; store :657-659; sheet copy block (`SHEETS_DIR`, `sheetSeq`) :561, :706-715 → reuse its stamp for `<store>/legs/<stamp>/{report.json,frames/<name>}`; `MEDIA` :557 untouched; engine skip at :297, playable gate :487; header list :48.
- `apps/supervisor/src/delivery.ts` -- `CloseoutInput` :82-93, header doc :29-39, `composeCloseout` :208-277, the shared-leg block :236-247. Event order: `worktree.ts:1005-1017` (host-verify before close-out); re-run `hostleg.ts:328` appends host-verify after the last close-out (35-1 DRIFT: a red re-run carries a top-level `reason` on the event).
- `apps/supervisor/src/enginemcp.ts` -- `engineMcpPlan` :236-264 reads under `run.prefix`; `startEngineMcp` :460-504 spawns at `run.worktree`; import `servedRoot` from `./queue` (as `hostleg.ts:56`); header :24.
- `apps/supervisor/README.md` :226 -- playable skip-reason list (add, don't replace).
- `plugins/tk-studio/lib/engage.py` -- docstring input :145-155; `_check_closeout_input` :1818-1858; `sheet_name` :1758; `_atomic_write_bytes` :1742; `render_closeout` :1958+ (`## Slice verdicts` :1989-2003); `closeout` :2107-2245 (sheet read :2145-2163, writes :2179-2194, `attachments=` :2226-2231 into `_publish_scope` :1042-1141, reused as is); scoping revise `if not pages:` :1334-1338 vs merge :1343; docstring :99-107. `mdstorage.py:209-226` converts GFM tables.
- `plugins/tk-studio/lib/recommend.py` -- `_mcp_status` :134 and `record_mcp` :381-385 → `utf-8-sig` (as `engine_pin.py:134/:165`); leave :297.
- `plugins/tk-studio/lib/godot/PlayableHarness.cs` -- capture cond :453-460 add `|| (m.Tick >= _ticks && _tick == _ticks - 1)`; `WriteReport` :695 `_frameAt` at `Math.Min(m.Tick, _ticks - 1)`; header :56. `playable.py` stays as is.
- `plugins/tk-studio/contracts/driver-contract.md` -- header :5 (0.1.30 clause after 35.5's), Stories row :6 (`, Story 35.6`), engage row :771 (append `report?`, `frames?`), new paragraph after 35.5's (~:1915) before `## 8. Conformance`; :465-466 playable reason list.
- `plugins/tk-studio/contracts/conformance/manifest.json` :554-565 -- the `tk-studio-engage` entry; precedent `e2e_vertical_slice.py`, `e2e_asset_manifest.py`.
- Tests: `delivery.test.ts` :618-702 (reorder :626-629, rewrite :649); `hostverify.test.ts` :759/:765 flip; `enginemcp.test.ts` `flaggedRun` :108, start test :168, cwd capture :280/:495; `test_engage.py` `CloseoutSliceTests` :2297, helpers :1833/:1863/:629, `GameScopeTests` :2240/:2257 flip; `test_recommend.py` :254/:303; `test_playable.py` :946 with `_method_body`; `test_driver_contract.py` pins :2533/:2611/:2677/:2743/:2807 + new `test_0_1_30_story_35_6_closeout_carries_the_proof`. Leave `test_driver_contract.py:2080`, `hostleg.test.ts:597/620`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-77 :595-601, DW-92 :715-721.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- per-leg report+frames copy, `report?`/`leg_frames?`, `no verify.engine` skip, header list -- AC1, AC2.1
- `apps/supervisor/src/delivery.ts` -- story-leg windows, `slices[].report?`/`frames?`, `CloseoutInput`, header doc -- AC1
- `apps/supervisor/src/enginemcp.ts` -- cwd/probe/`--path` from `servedRoot(run)` -- AC2.4
- `apps/supervisor/README.md` -- skip-reason list -- AC2.1
- `plugins/tk-studio/lib/engage.py` -- closeout media read/write/attach, verdict table, input check, revise `game: true`, docstrings -- AC1, AC2.5
- `plugins/tk-studio/lib/recommend.py` -- `utf-8-sig` on both `.mcp.json` reads -- AC2.2
- `plugins/tk-studio/lib/godot/PlayableHarness.cs` -- moment clamp (capture and report lookup), header -- AC2.3
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.30 Story 35.6 header clause, Stories row, engage row, paragraph, reason list -- AC1
- `plugins/tk-studio/contracts/conformance/e2e_closeout_media.py` (new) + `manifest.json` -- the in-process headless-clean drive -- AC1
- Tests: `hostverify.test.ts`, `delivery.test.ts`, `enginemcp.test.ts`, `test_engage.py`, `test_recommend.py`, `test_playable.py`, `test_driver_contract.py` -- per the plan's "Tests to extend" and the I/O matrix -- AC3
- `_bmad-output/implementation-artifacts/deferred-work.md` -- close DW-77, DW-92 -- AC3

**Acceptance Criteria:**
- Given the lib gate, when `uv run python -m unittest discover tests` and `uv run python ../contracts/conformance/runner.py run` run from `plugins/tk-studio/lib`, then both are green (`ok: true`), the new drive among them.
- Given the supervisor suites, when the plan's three bun steps run, then the targeted tests have 0 fail, `tsc` exits 0, and the full `bun test` has no new failure versus the residual 4 named in `plugins/tk-studio/README.md`.
- Given the repo after the change, when `git diff` is inspected, then the design spec's feature-ledger Phase 3 row is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 0, low 2)
- defer: 0
- reject: 5 (high 0, medium 1, low 4)
- addressed_findings:
  - `[low]` `[patch]` `apps/supervisor/README.md` slice-assets sentence still said the closeout uses each run's last `host-verify`; rewritten to the per-story leg with `report`/`frames`
  - `[low]` `[patch]` the flagless `scoping` revise's `game: true` merge had no `ScopeUnwritable` test; added `GameScopeTests.test_a_flagless_revise_whose_game_merge_the_os_refuses_is_scope_unwritable`
- rejected (one line each):
  - blind-hunter: the last story's window takes a later key's leg when that key's close-out is missing — both rules are the planner's settled shape 2 verbatim (last story takes the later re-runs; a key with no close-out takes the window after the last close-out), pinned by the `storyLegs` test
  - blind-hunter: windowing relies on a leg per story — `worktree.ts:1005-1017` runs one `host-verify` per engine completion, before that completion's `close-out`; a run drives one story per completion
  - blind-hunter: red host / malformed engine with no `verify.engine` untested — `hostverify.test.ts:764/:766` and `hostleg.test.ts:597/:620` keep `engine gate not green`
  - edge-case-hunter ×2: duplicate frame basenames — the harness writes frames flat under `<store>/frames/` (`hostverify.ts:726`); no subfolder case exists

## Design Notes

`unverifiable-here` (operator): the published page on a live Confluence (first real slice closeout on TUA, AI-1); the harness clamp under Godot (next flagged run with a moment past `--ticks`).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && unset TK_STUDIO_ROOT && bun test test/delivery.test.ts test/hostverify.test.ts test/enginemcp.test.ts` -- expected: 0 fail
- `cd apps/supervisor && bunx tsc --noEmit` -- expected: exit 0
- `cd apps/supervisor && bun test` -- expected: no new failure versus the residual 4

## Deviation Summary

### pass 1 (2026-10-29, implementer)

- planned: change only the 0.1.30 Stories-row pins in `test_driver_contract.py` / actual: also loosened `test_0_1_27_story_32_2_adds_the_chat_and_the_engage_surface`, which pinned the engage manifest's drive list to exactly the `reply` drive; it now checks that drive plus the new `e2e_closeout_media.py` drive after it / why: adding the drive the plan requires broke that exact-list check / may affect: none
- planned: change only the cwd, probe and `--path` in `enginemcp.ts` / actual: the no-`project.godot` refusal now reads "the served root holds no project.godot …" instead of "the worktree holds no …" / why: the probe now runs on the served root; no test or contract pinned it / may affect: none
- DEVIATION SCORE: 1

DRIFT: 32.2 engage-manifest drive-list pin widened to admit the new closeout drive — the exact-list pin broke on the drive the plan requires — affects: none
DRIFT: engine MCP no-project.godot refusal names the served root, not the worktree — the probe now runs on servedRoot(run) — affects: none

## Consult Log

- 2026-10-29T12:58:11Z — trigger: deviation-gt-0 — question: accept the 32.2 engage drive-list pin widening and the served-root refusal text (score 1)? — ruling: accept-deviation score 1 — do: keep both changes; record both at score 1; keep the 32.2 pin strict element by element (drives[:1] = reply, drives[1:] = e2e_closeout_media.py), never a containment check — rule candidate: when a plan adds a drive to a conformance-manifest surface, extending exact-list drive pins to the new list (still element by element) is score 0; message text that changes because the plan moved a check to a new root is score 0 when grep shows no pin

### pass 2 (2026-10-29, review patches)

- planned (patch brief): follow the file's existing `_merge_record` patch idiom / actual: no such idiom exists; wrapped the real `_merge_record` with `mock.patch.object`, as the nearby `atomic_write_text` test does / why: failing by filename breaks before the `game: true` merge — not a deviation from the spec's Tasks, Code Map or Design Notes (the brief only), score unchanged at 1

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-29T11:13:16Z | 2026-10-29T11:19:12Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-29T12:34:57Z | 2026-10-29T13:11:09Z | 7c582c78-b0a2-43a1-9e9a-44a066bbc9d1 | claude-opus-5-5 | medium | 19671005 | 115535 | 9.4991 | completed |
| gate | 1 | 2026-10-29T13:11:10Z | 2026-10-29T13:20:15Z | 52a7ffbe-a3f7-4a37-a64c-866234ee4413 | claude-opus-5-5 | medium | 14829882 | 71891 | 7.1339 | completed |

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T123300Z-6ea119` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Each slice leg copies its `report.json` and sampled frames to `<store>/legs/<stamp>/` (`playable.report?`/`leg_frames?`, best-effort); `composeCloseout` picks each story's own leg through `storyLegs()` (settled shape 2) and carries `slices[].report?`/`frames?`; `engage.py closeout` validates, writes, attaches (`<key>-report.json`, `<key>-frame-<name>`) and embeds the `| Report | Value |` table; the five B15 edges are fixed, each with a test; contract 0.1.30 gains the additive Story 35.6 paragraph; a new `headless-clean` drive `e2e_closeout_media.py` is registered under `tk-studio-engage`; DW-77 and DW-92 are closed in the ledger's pending-PR form.

**Files changed.**
- `apps/supervisor/src/hostverify.ts` — per-leg report/frames copy; `no verify.engine` skip; header list
- `apps/supervisor/src/delivery.ts` — `storyLegs()` windows; `slices[].report?`/`frames?`; `CloseoutInput`; header doc
- `apps/supervisor/src/enginemcp.ts` — server/editor cwd, probe and `--path` from `servedRoot(run)`
- `apps/supervisor/README.md` — skip-reason list; per-story-leg closeout sentence
- `apps/supervisor/test/{hostverify,delivery,enginemcp}.test.ts` — Story 35.6 cases; 34.8 fixtures reordered/rewritten per plan
- `plugins/tk-studio/lib/engage.py` — closeout media, verdict table, input check, revise `game: true`
- `plugins/tk-studio/lib/recommend.py` — `utf-8-sig` on both `.mcp.json` reads
- `plugins/tk-studio/lib/godot/PlayableHarness.cs` — moment clamp (capture and report lookup)
- `plugins/tk-studio/lib/tests/{test_engage,test_recommend,test_playable,test_driver_contract}.py` — new and flipped tests; pins widened
- `plugins/tk-studio/contracts/driver-contract.md` — 0.1.30 Story 35.6 clause, Stories row, engage row, paragraph, reason list
- `plugins/tk-studio/contracts/conformance/{manifest.json,e2e_closeout_media.py}` — the closeout media drive
- `_bmad-output/implementation-artifacts/deferred-work.md` — DW-77, DW-92 resolved

**Review.** 2 patches applied (low ×2), 0 deferred, 5 rejected. Follow-up review: patched high 0, medium 0, low 2; score 3×0 + 2 = 2 < 5 → `false`.

**Verification.**
- `uv run python -m unittest discover tests` (lib): 2489 tests OK (4 skipped)
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`
- `bun test test/delivery.test.ts test/hostverify.test.ts test/enginemcp.test.ts`: 151 tests, 0 fail
- `bunx tsc --noEmit`: exit 0
- full `bun test`: 1635 pass, 4 fail — exactly the known residual named in `plugins/tk-studio/README.md` (the sbx argv ×2, invokeSkill sbx ×2)
- the design spec's feature-ledger Phase 3 row: not in the diff

**unverifiable-here (operator).** The published page on a live Confluence (the first real slice closeout on TUA, AI-1); the harness clamp under Godot (text-asserted only; the next flagged run with a moment past `--ticks`). The PR number for DW-77/DW-92 is filled when the operator opens the PR.

**Residual risks.** A key whose `close-out` is lost after its leg shares the last story's window (as settled shape 2 states); `bun install` hit EPERM in the sandbox but `node_modules` was populated.

DRIFT: 32.2 engage-manifest drive-list pin widened to admit the new closeout drive — the exact-list pin broke on the drive the plan requires — affects: none
DRIFT: engine MCP no-project.godot refusal names the served root, not the worktree — the probe now runs on servedRoot(run) — affects: none

## Reconcile

- 2026-10-29 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 35-7-the-run-sweep-job-type
