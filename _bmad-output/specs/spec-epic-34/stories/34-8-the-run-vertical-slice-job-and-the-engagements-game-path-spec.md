---
title: 'The `run-vertical-slice` Job and the Engagement''s Game Path'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '6f836dfcf047801fb88aa2e3946ccb3b44296c87'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
reconcile_verdict: no-impact
context:
  - '{project-root}/_bmad-output/specs/spec-epic-34/plans/34-8.md'
  - '{project-root}/_bmad-output/specs/spec-epic-34/SPEC.md'
warnings: [oversized, multiple-goals]
deferred:
  - summary: >-
      A green slice re-run (POST /runs/{id}/verify) marks the PR ready without committing the placed art or the proof.
    evidence: |-
      hostleg.ts runLeg runs hostVerify with { slice } in the detached .verify worktree, where greybox/match write the
      placed art. It then calls removeWorktree, and markReady when the leg is green. proofCommit (worktree.ts) runs only
      at the close-out. If the close-out's assets step was red (no host commit) and the re-run is green, the PR goes
      ready while its branch has no greybox art, no .tk-studio/proof/<run_id>/ and no embedded sheet. The consult
      ruled that this cannot be fixed here: the contract fixes the re-run as verify-only and marks green PRs ready
      (driver-contract.md:385-390). Operator to decide: skip pr_ready for slice runs, or have the re-run commit and push.
    location: >-
      apps/supervisor/src/hostleg.ts:155-180
    severity: medium
  - summary: >-
      The engagement's closeout page carries each slice's contact sheet and verdicts, but not the sampled frames or report.json.
    evidence: |-
      AC2 lists the proof media (the frames, a contact sheet, the report) landing on the run workspace, the PR body and
      the engagement's page. Plan shape 7/8 distributes them: the closeout input carries only slices[].contact_sheet
      (delivery.ts composeCloseout) and engage.py closeout copies and attaches only <key>-contact-sheet.png. A consult
      (second follow-up review) ruled the plan's distribution holds for this story. Attaching the sampled frames and
      report.json to ENG-NNN: Closeout is an open enhancement that changes the published 0.1.29 closeout input, so it
      needs a contract bump through planning.
    location: >-
      apps/supervisor/src/delivery.ts composeCloseout; plugins/tk-studio/lib/engage.py closeout
    severity: low
---

<intent-contract>

## Intent

**Problem:** User flow F9 is still a diagram: a game project engaged through the chat route gets no game brief or GDD, approval mints plain `run-epic` instances, and no job type runs the asset ladder, a contact sheet or slice verdicts through the host leg, the PR and the closeout report.

**Approach:** Transcribed from epics.md "### Story 34.8" (authoritative), shaped by `plans/34-8.md` §Settled shape 1-10 (SPEC Design notes CAP-15, CAP-16). As the owner, I want one message to a game project to end in a playable greybox slice with proof media, a report and a measured cost, so that the studio's promise (user flow F9) is a thing I can run, not a diagram.

Acceptance criteria (verbatim):

- **AC1:** **Given** a game project engaged through the chat route (EP-32) **When** the scope step runs on a project whose working set carries GDS **Then** it runs `gds-create-game-brief` and `gds-gdd` (quick flow) and publishes both to the engagement's Confluence page beside the scope; approval mints the epics as today, and the plan's `run-epic-N.json` instances carry `type: run-vertical-slice`
- **AC2:** **Given** the shipped job type `plugins/tk-studio/jobs/run-vertical-slice.json` **When** a run of it executes **Then** the engine runs the story as `run-epic` does; the host leg runs the engine gate (34.1), the ladder's `check` and `greybox` (34.6; `match` when the mirror exists) and the `playable-verify` leg (34.3); the proof media (the frames, a contact sheet, the report) land in the run workspace, the PR body and the engagement's page; the closeout report (32.8) lists the slice's verdicts per story; guards and stop conditions per the job schema; the planner tier per the measured routing
- **AC3:** **Given** TUA **When** the acceptance runs **Then** one `POST /jobs` (or one chat message) on TUA ends in a merged PR with a playable greybox scene, the frames in the PR, a `job-run` ledger line with the cost, conformance green over every surface (the contract at 0.1.29 or later), the three new skills' eval cases above the threshold, and the acceptance record under `kb/`; the design spec's feature ledger flips Phase 3 to built

## Boundaries & Constraints

**Always:**
- Settled shape 1-10 of `plans/34-8.md` is the design; follow it literally (game detection in `engage.py` only; `--brief-file`/`--gdd-file`; `game: true`; approve's type rule; the job file as `run-epic.json`'s shape with `id: run-vertical-slice` and `target.skill: tk-studio-launch`; the assets step order and verdicts; `playable.py sheet`; `.tk-studio/proof/<run_id>/`; host-side commit with named paths only; `## Slice verdicts`; eval cases; acceptance record).
- "Quick flow" = `gds-create-game-brief`'s Fast path and `gds-gdd`'s Express path, run per each skill's `## Headless Mode` when unattended (both exist at the pin).
- The host leg calls `assets.py match` without `--mirror` (env/default resolves it; no mirror ends `complete`, entries `skipped`), and calls `generate` zero times. `match` exit 1 with rows action `failed` = `fault` (recorded, not red, placeholder kept); `check`/`greybox` exit 1 or 2 = red; `match` exit 2 = red. Status blocks are `complete | partial | blocked` (intent `assets`).
- New `host-verify` fields are optional on the type and always written by the producer on a slice run (34.1 DRIFT precedent); a non-slice run's host leg, PR body and close-out are byte-unchanged.
- Contract stays 0.1.29: extend the 0.1.29 entry additively (line 5 clause, stories row "…Story 34.8 (Epic 34)", §4 shipped-job bullet, `host-verify.assets`, engagement record keys, `scope` flags); re-pin `test_driver_contract.py` stories-row assertions and add `test_0_1_29_story_34_8_vertical_slice`.
- House rules: stdlib-only Python via `uv run`; atomic writes; AD-11 status block on every headless path; no credential in a tracked file or event; nothing in the plugin imports the supervisor; every Atlassian, Blender, engine, judge and git call in tests is a fake.
- Feature ledger Phase 3 row reads `**built, TUA acceptance pending**` (operator evidence flips it to `**built** (Epic 34; acceptance: kb/acceptance-record-34-8-vertical-slice-on-tua.md)` later).

**Block If:**
- The Files list in `plans/34-8.md` must grow beyond what is listed (a file outside Files is a consult trigger first; growth of the list itself HALTs).
- A contract or taxonomy test requires a version bump past 0.1.29.
- A recorded rule is found that the close-out never commits on its own behalf (none found in driver-contract.md, supervisor README, worktree.ts at planning).

**Never:** push, tag, open PRs, release motion or version bumps; call `assets.py generate` or pass `--mirror` from the host leg; add a skill wrapper for the asset ladder; add a job-type roster or a new job-schema field; rename `run-epic-N` ids; `git add -A` in the host-side commit; edit epics.md, stories.yaml, plan files or anything under `supervision/`; run a live model, Blender, Godot or Confluence in a test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Game scope | game project, `scope --brief-file B --gdd-file G` | brief.md/gdd.md written under the engagement folder, published as `ENG-NNN: Game Brief` / `ENG-NNN: GDD`; record has `brief_page`, `gdd_page`, `game: true` | — |
| Game docs missing | game project, either flag absent | refusal `GameDocsMissing: brief` / `gdd`, exit 2 | status block `blocked` |
| Not a game | non-GDS project, a doc flag given | refusal `NotAGameProject`, exit 2 | status block `blocked` |
| Approve game | record `game: true` | `run-epic-N` instances with `type: "run-vertical-slice"` | — |
| Approve other | no `game` | `type: "run-epic"`, unchanged | — |
| No manifest | slice run, no `assets/manifest.yaml` (nor config `assets.manifest`) | `assets: {verdict: skipped, reason: "no manifest"}`; leg continues | — |
| Assets green | check 0, greybox 0, match 0 | `assets.verdict: green`, three steps; engine gate then playable run | — |
| Match fault | match exit 1, rows action `failed` | `assets.verdict: green` with step status recorded as fault; not red | placeholder kept |
| Assets red | check/greybox exit 1 or 2, or match exit 2 | `assets.verdict: red`; leg red; run `partial` with `host_verify: red` | ordering after a red step follows the existing host→engine→playable gating in `hostVerify` |
| Non-slice run | `run-epic` | no assets step, no `assets` field, PR/close-out unchanged | — |
| Sheet | `playable.py sheet --frames D --out P` with 0 / 5 / 40 frames | 0 → refusal exit 2; else ≤16 evenly sampled in name order, nearest-neighbour, 8-bit RGB PNG | status block `intent: playable` |
| Proof commit | slice run, assets green/fault | `git add -- <art_path changes> <manifest> .tk-studio/proof/<run_id>/`, message `host leg: placed assets and proof (run <run_id>)`, before the push | commit failure = close-out `error` |
| Closeout slices | runs with `host-verify` events | `## Slice verdicts` lines `<key> — engine <v>; assets <v>; playable <v>`, contact sheets attached | no slice run → section absent |

</intent-contract>

## Code Map

The investigation is `plans/34-8.md` §Code Map (read it first; line anchors are from that plan and current at HEAD 6f836df). Distilled:

- `plugins/tk-studio/jobs/run-epic.json` -- shape to copy; `lib/job.py` `load_types` :296 (id == file stem, no own `type`), `validate_definition` :223, `_DEF_FIELDS` :65; tests `lib/tests/test_job.py` :218/:245/:267.
- `apps/supervisor/src/queue.ts` :74 `LAUNCH_SKILL`, :967 `queue.definition(run)` -- seam for slice detection; precedent `cli.ts:993,1001,1409,1413` reading `v.defn`.
- `apps/supervisor/src/hostverify.ts` -- `verifyCommand` :183, `runStep` :268 (reuse for asset verbs), `hostVerify` :317, `MEDIA` :371, `copyMedia` :412, `playableStep` :428, `redReason` :535, `prSection` :557. `hostleg.ts` :124/:155 re-run path calls the same `hostVerify` (no change expected).
- `apps/supervisor/src/worktree.ts` -- `hostVerify` call :797, `finishStudio` :688/:824, `prBody` :371, `closeOut` :405; host-commit idiom `closeout.ts` `commitStep` :269/:371.
- `apps/supervisor/src/approve.ts` :688-705 mints `run-epic-${n}` with hard-coded `type`; pinned by `test/approve.test.ts:156`; ids stay (`board.ts:231`, `cli.ts:788`).
- `apps/supervisor/src/delivery.ts` `composeCloseout` :197 -- add `slices` from each run's last `host-verify` event.
- `plugins/tk-studio/lib/assets.py` CLI :2364 -- `check`/`greybox`/`match`; PNG decode (`_png_image` + un-filter) and PNG writer (34.6 labels) reusable by import for `sheet`.
- `plugins/tk-studio/lib/playable.py` -- `run` writes `report.json`, `log.txt`, `frames/`; add `sheet`.
- `plugins/tk-studio/lib/engage.py` -- `_publish_scope` :986 (takes `title`/`rel`), `scope` :1070, `SCOPE_TITLE` :715, `CLOSEOUT_TITLE` :1576, `closeout_verdicts` :1685, `render_closeout` :1767, `closeout` :1900; `confluence.upload_attachment` :359; GDS detection pattern `launch.py:549-551`, working sets role-keyed (`config.py:321`).
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` step 4 :120-175 -- add step 4a.
- `plugins/tk-studio/contracts/driver-contract.md` -- :5 version row, :6 stories row, :116 engagement record, :405 0.1.29 note, :829/:850 §4 shipped jobs, :1331/:1355-1376/:1387 asset paragraph (34.7 seam). `lib/tests/test_driver_contract.py` stories-row pins :2091, :2133, :2182, :2242, :2322.
- `plugins/tk-studio/contracts/conformance/manifest.json` -- add `e2e_vertical_slice.py` drive (type validates; `bun test` legs when bun present, "not run" otherwise); keep under runner's 60 s.
- `plugins/tk-studio/evals/gds-engine-godot-4-pinned-facts/{prompt.md,graders/criteria.md}` -- layout for the two new cases.
- `jobrun.py` :106-130 already writes `job-run` with costs; no change (DW-67 stays open).
- `_bmad-output/planning-artifacts/design/studio-design-spec-2026-10-09/feature-ledger.md:16` Phase 3 row; `kb/acceptance-record-34-1-engine-gate-on-tua.md` frontmatter pattern; `kb/index.md` via `kb.py index` (restore line 1 by hand if it takes the worktree name — 34.4/34.6 precedent).
- Earlier DRIFTs affecting this story: 34-3 PR body omits the Playable line on skip `no playable`; 34-6 status values `complete|partial|blocked`; 34-7 missing `--mirror` folder is a refusal, Blender/normalise failure leaves entry status unchanged (action `failed`), failed write-back ends `failed`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/jobs/run-vertical-slice.json` -- new, `run-epic.json` shape, own id/description -- AC2 type
- `plugins/tk-studio/lib/tests/test_job.py` -- type loads, validates, resolves; `job.py` only if a test forces it -- AC2 guards/stop per schema
- `plugins/tk-studio/lib/engage.py` + `tests/test_engage.py` -- game detection, doc flags/refusals, publishing, record keys, `## Slice verdicts` with attachments -- AC1, AC2 closeout
- `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` -- step 4a (brief Fast path, GDD Express path, headless when unattended, then `scope --brief-file --gdd-file`) -- AC1
- `plugins/tk-studio/lib/playable.py` + `tests/test_playable.py` -- `sheet` verb -- AC2 contact sheet
- `apps/supervisor/src/approve.ts` + test -- type rule -- AC1
- `apps/supervisor/src/hostverify.ts` + test -- slice detection input, assets step, sheet call, `MEDIA`, PR section (`Assets:` line, embedded sheet, frame list on pass and fail) -- AC2
- `apps/supervisor/src/worktree.ts` + test -- proof folder copy and host-side commit before push -- AC2
- `apps/supervisor/src/delivery.ts` + test -- `slices` -- AC2 closeout
- `plugins/tk-studio/contracts/driver-contract.md`, `lib/tests/test_driver_contract.py` -- additive 0.1.29 extension and pins -- AC3 conformance
- `plugins/tk-studio/contracts/conformance/manifest.json`, `contracts/conformance/e2e_vertical_slice.py` -- new drive -- AC3 conformance
- `plugins/tk-studio/evals/tk-studio-playable-judge-verdict/`, `plugins/tk-studio/evals/asset-ladder-generated-rung/` -- new cases per Settled shape 9 -- AC3 evals
- `README.md`, `apps/supervisor/README.md`, `kb/asset-ladder.md` -- job type and assets step docs
- `kb/acceptance-record-34-8-vertical-slice-on-tua.md`, `kb/index.md`, feature-ledger.md -- AC3 records

**Acceptance Criteria:**
- Given the lib suite, when `uv run python -m unittest discover tests` runs from `plugins/tk-studio/lib`, then it is green including the new engage, playable `sheet`, job and contract tests.
- Given conformance, when `runner.py run` executes, then `ok: true` with the new drive present.
- Given `bun test` (engine sandbox), when approve/hostverify/worktree/delivery tests run, then the type rule, assets verdicts, PR section, proof commit and `slices` are covered with fakes -- `unverifiable-here` on this host (no bun).
- Given AC3's TUA run and `claude plugin eval`, when the operator follows the acceptance record, then the evidence lands in its `## Evidence` -- `unverifiable-here`.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 4, low 3)
- defer: 0
- reject: 2 (conformance drive covers only approve/hostverify suites — matches plans/34-8.md Files line literally; PR proof paths with an unslashed prefix — `git rev-parse --show-prefix` always ends in `/`, approve.ts:564)
- addressed_findings:
  - `[medium]` `[patch]` retried slice close-out lost the contact-sheet embed (no `head` on "nothing to commit") — `worktree.ts` now reads `rev-parse HEAD` always; retry test added
  - `[medium]` `[patch]` slice verdicts took the run's last `host-verify` for every story — `delivery.ts` uses each story's latest `host-verify` at or before its `close-out`; test updated
  - `[medium]` `[patch]` one story in two linked slice runs gave two lines and colliding sheet names — one slice per key, later run replaces; test added
  - `[medium]` `[patch]` pre-34.8 game engagements could never be revised (`GameDocsMissing` on `--revise-at`) — revise with `scope_page` needs no doc flags; test added; contract sentence updated
  - `[low]` `[patch]` SKILL step 4a told the planner to make a flagless scope call first — reworded to one flagged call
  - `[low]` `[patch]` job description gave the wrong host-leg order — fixed
  - `[low]` `[patch]` failed playable lost store frame paths when the sheet step failed — guard `!proof?.frames.length`; test added

### 2026-10-27 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 3, low 2)
- defer: 1 (high 0, medium 1, low 0)
- reject: 6 (no-manifest slice commits no proof — the I/O matrix pins the proof commit to assets green/fault; passing slice whose sheet failed lists no frames — a failed sheet is the designed degraded mode, report still committed; unslashed `run.prefix` — repeat, `rev-parse --show-prefix` always ends in `/`; sanitised story-key sheet collision — keys are `<epic>-<story>`; `sheet` per-pixel cost — PNG decode dominates, no criterion; conformance drive scope — repeat, matches the plan's Files line)
- addressed_findings:
  - `[medium]` `[patch]` `assets.art_path` of `.`/`./`/`""` or a `.git`/`.tk-studio` first segment passed `layoutPath`, so the proof commit could `git add -- .` — such values now fall back to the default (leading `./` stripped); `assetsLayout` test added
  - `[medium]` `[patch]` a retried close-out with the playable store pruned deleted the committed proof folder (unstaged, worktree dirty, sheet embed lost) — the folder is replaced only when the store's `report.json` exists, else kept and its sheet/frames reused; retry test added
  - `[medium]` `[patch]` every leg of a multi-story slice run recorded the same `<store>/contact-sheet.png`, so the closeout embedded the last leg's sheet for every story — `contact_sheet` now records a per-leg copy under `<store>/sheets/` (media/proof keep `contact-sheet.png`); contract sentence extended (consult: accept-deviation score 2); two-leg test added
  - `[low]` `[patch]` the host commit's `diff --cached`/`commit` covered the whole index — both scoped to the named paths; no paths = nothing to commit with no git call; argv and stray-file tests added
  - `[low]` `[patch]` `_check_closeout_input` checked only `story`/`contact_sheet` per `slices` entry — `engine`, `assets`, `playable` now required non-empty strings (`CloseoutInputInvalid`); test added
  - deferred: green slice re-run marks the PR ready without committing art/proof (consult: reject-deviation, defer; criterion (a), AC2 proof media in the PR)

### 2026-10-27 — Review pass (second follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 1 (high 0, medium 0, low 1)
- reject: 4 (no-manifest slice commits no proof — repeat, the I/O matrix pins the proof commit to assets green/fault; a manifest the run deleted skips the step — the matrix's "No manifest" row is read at the worktree; a game doc publish refused after the scope page leaves no `game` — the scope call exits 2 `blocked` and a retry with the same flags completes it; a game-project revise before any `scope_page` is `GameDocsMissing` — a loud named refusal, the planner's first scope with both docs follows, and the contract pins the `scope_page` exemption)
- addressed_findings:
  - `[medium]` `[patch]` slice verdicts per story read "the latest `host-verify` at or before the story's `close-out`", but `close-out` events come only from the paused-ruling path (`closeout.ts:369-383`), which runs no leg — every story landed through a ruling read `not run` with no sheet. `delivery.ts` restores plan shape 8: every story of a slice run reads the run's last `host-verify` (the run-end leg, or a later re-verify); the test now uses the real event order, plus a re-verify-supersedes case. The 0.1.29 `contact_sheet` clause now says each leg keeps its own sheet (wording only, no bump). Supersedes the pass-3 slice-verdict DRIFT.
  - `[low]` `[patch]` `engage.py` merged `game: true` on a flagless revise that published no game doc, against `driver-contract.md:116` ("once `engage.py scope` published the game brief and the GDD") — `game` and the page keys are merged only when this call published the docs; revise test asserts no `game`, and a held `game: true` survives
  - deferred: frames and `report.json` on the engagement's closeout page (consult: apply Reading A, the plan's shape-7 distribution; enhancement needs a contract bump) — meets (a), AC2 proof media

## Design Notes

The asset step sits after the host command and before the engine gate so the import sees placed files. Slice detection: resolved definition `type` or `id` equals `run-vertical-slice`, decided once in the supervisor and passed into `hostVerify`/close-out as a flag. Eval threshold: each case passes its grader on at least 2 of 3 runs (planner default, retunable in the acceptance record).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_job tests.test_engage tests.test_playable tests.test_assets_ladder tests.test_driver_contract tests.test_release_roster` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && bun test test/approve.test.ts test/hostverify.test.ts test/worktree.test.ts test/delivery.test.ts && bun test` -- expected: pass; `unverifiable-here` (bun absent on this host)

**Manual checks (if no CLI):**
- Operator, on the box: the acceptance record's steps (TUA config PR, one `POST /jobs`, merged PR with sheet and frames, `job-run` line read back, `claude plugin eval plugins/tk-studio --trust-plugin` on the three cases).

## Deviation Summary

### pass 1 (2026-10-27, implementer)

- planned: `job.py` untouched unless a test forces it / actual: `resolve_instance` keeps the instance's `type` on the resolved definition, and `resolve` serves it / why: the resolved definition dropped `type` and took the instance id (`run-epic-N`), so "type or id is run-vertical-slice" could never match a minted instance; `test_a_run_epic_n_instance_of_the_slice_type_resolves_as_a_slice` forces it / may affect: none
- planned: `assets: {verdict, reason?, steps: [{verb, exit, status, …}]}`, status `complete|partial|blocked` / actual: optional `manifest` and `art_path` added; step `status` may also be `fault` (match exit 1) or `error` (no status block) / why: the close-out commits by the base config's paths; the matrix records the fault / may affect: none
- planned: `match` exit 1 with rows action `failed` is fault / actual: any `match` exit 1 is fault; exit 2, timeout or spawn failure is red / why: plan risk note says `candidate` is not red; reading rows adds nothing / may affect: none
- planned: playable step unchanged apart from the sheet / actual: optional `contact_sheet` and `sampled` on the playable step, slice runs only / why: close-out and closeout report need the sheet path and sampled frame names / may affect: none
- planned: `GameDocsMissing` whenever a doc flag is absent on a game project / actual: a `--revise-at` re-run is exempt when the record already carries both pages / why: the supervisor's revise call (`scope.ts`, outside Files) passes no doc flags / may affect: none
- planned: contact sheet embedded through `upload_attachment` / actual: `_publish_scope` gained an `attachments` parameter (hash-skipped uploads, counted in the footer hash); `closeout` copies each sheet beside `closeout.md` as `<key>-contact-sheet.png` / why: the Markdown image must resolve to a file for `mdstorage` and the page / may affect: none
- planned: slice flag passed into `hostVerify` / actual: 4th parameter `opts: {slice?}`; `hostleg.ts` unchanged, so a re-run (`POST /runs/{id}/verify`) gets no assets step / why: plan says no change expected to `hostleg.ts` / may affect: none
- planned: slice detection only from the resolved definition / actual: `delivery.ts` also treats a run as a slice when its last `host-verify` event has `assets` / why: runs whose stored definition predates the `type` fix / may affect: none
- planned: eval cases tested / actual: the two new eval folders have no unit test / why: no test file is named for them in Files / may affect: none
- note: bun was found at `~/.bun/bin`; the four named supervisor test files pass; full `bun test` has 25 failures identical at baseline 6f836df (pre-existing). `tsc --noEmit` not run (TypeScript not installable here).

DRIFT: `job.py` `resolve_instance` keeps the instance `type` on the resolved definition — a minted `run-epic-N` could never be detected as a slice otherwise — affects: none
DRIFT: `host-verify.assets` gains optional `manifest`/`art_path`; step status may be `fault` or `error` — close-out commits by named paths; fault is recorded — affects: none
DRIFT: any `match` exit 1 is `fault`, not only rows with action `failed` — a `candidate` is not red per the plan's risk note — affects: none
DRIFT: playable step gains optional `contact_sheet` and `sampled` on slice runs — close-out and closeout report need them — affects: none
DRIFT: `scope --revise-at` on a game project is exempt from `GameDocsMissing` when the record already has both pages — `scope.ts` revise passes no doc flags — affects: none
DRIFT: `_publish_scope` gained `attachments`; closeout copies sheets beside `closeout.md` — the page image must resolve to an uploaded file — affects: none
DRIFT: `hostVerify` gains `opts: {slice?}`; `hostleg.ts` re-run passes none, so a re-verify of a slice run has no assets step — `hostleg.ts` not in Files — affects: none
DRIFT: `delivery.ts` also detects a slice by `assets` on the last `host-verify` — older stored definitions — affects: none
DRIFT: no unit test for the two new eval folders — none named in Files — affects: none

### pass 2 (2026-10-27, implementer, consult fix)

- consult ruling applied: `hostleg.ts` `runLeg` passes `{ slice: isSlice(queue.definition(run)) }`; `hostleg.test.ts` case for slice/non-slice re-verify; contract names step status `error` beside `fault`. Pass-1 entry (c) is superseded.
- planned: consult authorised `hostleg.ts`, `hostleg.test.ts` and the contract edit / actual: one sentence in `apps/supervisor/README.md` updated to say the re-run records `assets` / why: the old sentence described removed behaviour; file is in Files / may affect: none
- planned: name `error` next to `fault` / actual: the same edit says `assets` is written by both close-out and `POST /runs/{id}/verify`, pinned in `test_0_1_29_story_34_8_vertical_slice` / why: follows from the hostleg change / may affect: none

DRIFT: `apps/supervisor/src/hostleg.ts` and `test/hostleg.test.ts` changed outside Files — consult ruling: a slice re-verify must record `assets` per the contract text — affects: none
DRIFT: the pass-1 line "hostleg.ts re-run passes none" is superseded by the consult fix — affects: none

### pass 3 (2026-10-27, implementer, review patches)

- planned: change `driver-contract.md` only where a sentence describes changed behaviour / actual: the `tk-studio-engage` row's `brief_file?`/`gdd_file?` sentence now says the revise exemption is "the record already carries `scope_page`" / why: patch 4 changed that behaviour / may affect: none

DRIFT: slice verdicts come from each story's latest `host-verify` at or before its `close-out` (run's last only for a key with no close-out), not plan shape 8's "each run's last host-verify" — the AC says per story, and the run's last misreported earlier stories (review patch) — affects: none
DRIFT: a `--revise-at` scope on a record with `scope_page` needs no doc flags (supersedes pass 1's "both pages held" exemption) — pre-34.8 game engagements must stay revisable (review patch) — affects: none

### pass 4 (2026-10-27, implementer, follow-up review patches)

- planned: `contact_sheet` recorded as `<store>/contact-sheet.png` / actual: after a green sheet, a per-leg copy at `<store>/sheets/<ms>-<pid>-<n>.png` is recorded (shared path on copy failure); media and proof keep `contact-sheet.png`; `driver-contract.md` 0.1.29 asset sentence extended additively (consult: accept-deviation score 2) / may affect: closeout slices
- no file outside Files touched in this pass; `hostleg.ts` left unchanged per consult ruling

DRIFT: `playable.contact_sheet` records the leg's own copy under `<store>/sheets/`, not `<store>/contact-sheet.png` — a per-run store written once per story's leg made every slice embed the last sheet (AC2 per-story verdicts) — affects: closeout slices (delivery.ts `slices`, `render_closeout`)

### pass 5 (2026-10-27, implementer, second follow-up review patches)

- planned (pass 3 DRIFT): each story's verdicts from its latest `host-verify` at or before its `close-out` / actual: every story of a slice run reads the run's last `host-verify`, as plan shape 8 states / why: the paused close-out path runs no leg; the leg runs once per engine completion and on each re-verify / may affect: none (restores the plan)
- `driver-contract.md` 0.1.29 `contact_sheet` clause reworded: each leg (the close-out's and each `POST /runs/{id}/verify`) keeps its own sheet — wording only, no bump
- `engage.py`: `game: true` merged only with published game docs — matches `driver-contract.md:116`; no deviation
- no file outside Files touched in this pass; implementer reports deviation score 0

## Consult Log

- 2026-10-27T20:35:33Z — trigger: deviation-gt-0 — question: accept the pass-1 deviation set (match exit 1 = fault; job.py keeps type; hostleg re-run has no slice flag; revise exemption; optional assets/playable keys)? — ruling: reject-deviation — do: (1) in `apps/supervisor/src/hostleg.ts` `runLeg` (:164) pass `{ slice: isSlice(queue.definition(run)) }` to `hostVerify` and add a `test/hostleg.test.ts` case showing a slice re-verify records `assets` (consult authorises both files outside Files); (2) keep (a), (b), (d), (e) and the other four, accepted together at score 2; in the 0.1.29 contract paragraph also name step status `error` (no status block) next to `fault` — rule candidate: when a story adds a flag to a supervisor function, every call site of that function is in Files by default, and a caller left unchanged is a deviation to justify against the contract text

- 2026-10-27T21:07:21Z — trigger: file-outside-files — question: follow-up review finding: a green slice re-run (`hostleg.ts` `runLeg`) marks the PR ready without committing the placed art or proof; patch hostleg (skip `pr_ready` / commit+push) or leave it? — ruling: reject-deviation — do: (1) no change to `apps/supervisor/src/hostleg.ts` or `test/hostleg.test.ts` beyond the pass-1 `{ slice }` pass; close the finding as outside this story's scope; (2) add one frontmatter `deferred:` item naming the gap and the operator choice (skip `pr_ready` for slice runs, or re-run commits and pushes); leave the contract's re-run paragraph unchanged — rule candidate: a review finding whose fix would change re-run or close-out semantics in driver-contract.md (`rerun`, `pr_ready`, commit/push scope) is filed to the spec's `deferred:` list directly, not consulted as file-outside-files
- 2026-10-27T21:15:50Z — trigger: deviation-gt-0 — question: accept the follow-up patch-4 DRIFT (`playable.contact_sheet` records a per-leg copy under `<store>/sheets/`, not `<store>/contact-sheet.png`, so each story of a multi-story run keeps its own sheet)? — ruling: accept-deviation score 2 — do: (1) keep patch 4 in `apps/supervisor/src/hostverify.ts`; (2) extend the 0.1.29 sentence at `driver-contract.md:1508-1512` after "recorded as the playable step's `contact_sheet` and `sampled`" with: `contact_sheet` holds the leg's own copy under `<store>/sheets/` (the shared `<store>/contact-sheet.png` if the copy fails), so each story of a multi-story run keeps its own sheet; the proof folder and the media still carry the name `contact-sheet.png` — no version bump; (3) log the DRIFT with affects: closeout slices (delivery.ts `slices`, `render_closeout`) — rule candidate: when the contract records a file path and the producing store is per run while the producer runs per story/leg, the recorded path must be per-leg unique and the contract must say what the field holds, not only where the verb writes

- 2026-10-27T21:28:43Z — trigger: monitor judgement (two readings of AC2; second follow-up review) — question: must the frames and `report.json`, not only the contact sheet, reach the engagement's closeout page (AC2 "proof media … land in the run workspace, the PR body and the engagement's page")? — ruling: apply (Reading A, the plan's shape-7 distribution) — do: (1) reject the blind-hunter finding as plan-settled distribution; no change to delivery.ts, engage.py, the 0.1.29 contract or tests; (2) record attaching sampled frames and `report.json` to `ENG-NNN: Closeout` as an open enhancement needing a contract bump via planning — applied as one frontmatter `deferred:` item, not a direct ledger write (this session writes only the spec; the orchestrator owns `deferred-work.md`) — rule candidate: when an AC lists artefacts landing on several surfaces and the plan's settled shape distributes them, the plan's split is authoritative and an "every artefact on every surface" gap is deferred work, not a patch finding
- 2026-10-27T22:0xZ — operator session (the box, after PR #221 merged at 7d61cf1): the supervisor restarted through the scheduled task on the new `apps/supervisor`; acceptance-record steps 1 and 6 hold (`GODOT` and `BLENDER` set, the host leg's conformance ran `e2e_vertical_slice.py` green); steps 2 to 5 and 7 remain. TUA's engine gate is red (the 12 `Phone.ConversationTest` failures, Tim's since 34.3), so a TUA slice run today ends `partial` after the assets step with the playable proof skipped; the full proof and the feature-ledger flip wait on that fix. The sandbox's 15 red delivery tests at baseline are hole 84 in the observation ledger.
- 2026-10-27T22:3xZ — operator session (the box): acceptance-record step 2 done (TUA PR 11, f49d3fd: the `assets` keys and a six-entry manifest; `check` on it ok, 6 missing) and step 7 run on the host: `gds-engine-godot-4-pinned-facts` 3 of 3, `tk-studio-playable-judge-verdict` 0 of 3, `asset-ladder-generated-rung` 0 of 3, the two failures measuring the host (no shell grant possible, the plugin's docs unreadable to the eval child under the kept deny list: hole 85); the Evidence table carries the rows. Steps 3 to 5 wait on TUA's engine gate.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Second follow-up review of the completed story: the game path for engagements (brief/GDD publishing, `game: true`, `type: run-vertical-slice` minting) and the `run-vertical-slice` job (assets step, contact sheet, proof commit, PR section, `## Slice verdicts`). This pass fixes the closeout's per-story slice verdicts, which read a leg the supervisor never writes. Every story of a slice run now reads the run's last `host-verify`, per plan shape 8. It also stops a flagless revise from marking an engagement `game: true` without published game docs.

**Files changed (this pass).**
- `apps/supervisor/src/delivery.ts`, `test/delivery.test.ts`: `slices` read the run's last `host-verify` for every story; real-order test plus a re-verify-supersedes test
- `plugins/tk-studio/lib/engage.py`, `tests/test_engage.py`: `game` and the page keys are merged only when the call published the game docs
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.29 `contact_sheet` clause says each leg keeps its own sheet (wording only, no bump)

**Review.** One pass, two layers (blind-hunter, edge-case-hunter; band L). Patches applied: 2 (medium 1, low 1). Deferred: 1 (frames and `report.json` on the closeout page; consult ruled the plan's distribution holds, and the enhancement needs a contract bump). Rejected: 4. Follow-up review recommended: false (patched high 0, medium 1, low 1; score 3×1 + 1 = 4 < 5).

**Verification.**
- `uv run python -m unittest discover tests` (plugins/tk-studio/lib): `Ran 2366 tests`, `OK (skipped=2)`. Re-run by this session.
- `uv run python ../contracts/conformance/runner.py run`: `"ok": true`, `failures: []`. Re-run by this session.
- `uv run python -m unittest tests.test_engage tests.test_driver_contract`: `Ran 170 tests`, OK (implementer).
- `PATH=$HOME/.bun/bin:$PATH bun test test/delivery.test.ts test/hostverify.test.ts`: 67 pass, 15 fail. The same 15 Story 32.8 closeout-pass delivery tests fail with identical names at baseline 6f836df (checked in a temporary worktree). The Story 34.8 block passes 4/4 (implementer). `tsc --noEmit` was not run.
- unverifiable-here (AC3, operator on the box): unchanged. Follow `kb/acceptance-record-34-8-vertical-slice-on-tua.md`: the TUA config PR, one `POST /jobs` ending in a merged PR with the sheet and frames, the `job-run` ledger line read back, then `claude plugin eval plugins/tk-studio --trust-plugin` for the three cases. After that, flip the feature-ledger Phase 3 row to `**built**`.

**Residual risks.** The stories of one slice run now share the run's last leg's verdicts and sheet. That is accurate, because the leg verifies the worktree all of them landed in, but it is not a per-story leg. The closeout page carries the sheet and verdicts, not the frames or report (deferred). The earlier deferral stands: a green slice re-run can mark a PR ready that lacks the placed art. The 15 pre-existing Story 32.8 delivery failures remain. TypeScript was not type-checked.

DRIFT: `playable.contact_sheet` records the leg's own copy under `<store>/sheets/`, not `<store>/contact-sheet.png` — the per-run store is rewritten by each leg (close-out, re-verify), so a recorded sheet would otherwise be overwritten — affects: closeout slices (delivery.ts `slices`, `render_closeout`)
DRIFT: `job.py` `resolve_instance` keeps the instance `type` on the resolved definition — a minted `run-epic-N` could never be detected as a slice otherwise — affects: none
DRIFT: `host-verify.assets` gains optional `manifest`/`art_path`; step status may be `fault` or `error` — close-out commits by named paths; fault is recorded — affects: none
DRIFT: any `match` exit 1 is `fault`, not only rows with action `failed` — a `candidate` is not red per the plan's risk note (consult accepted) — affects: none
DRIFT: playable step gains optional `contact_sheet` and `sampled` on slice runs — close-out and closeout report need them — affects: none
DRIFT: a `--revise-at` scope on a record with `scope_page` needs no doc flags — pre-34.8 game engagements must stay revisable; `scope.ts` revise passes no doc flags — affects: none
DRIFT: `_publish_scope` gained `attachments`; closeout copies sheets beside `closeout.md` — the page image must resolve to an uploaded file — affects: none
DRIFT: `hostVerify` gains `opts: {slice?}` and `apps/supervisor/src/hostleg.ts` + `test/hostleg.test.ts` changed outside Files — consult ruling: a slice re-verify must record `assets` per the contract text — affects: none
DRIFT: `delivery.ts` also detects a slice by `assets` on a `host-verify` event — older stored definitions — affects: none
DRIFT: no unit test for the two new eval folders — none named in Files — affects: none

## Reconcile

### 2026-10-27 — no-impact

- Score: 2
- Reasoning: 34-8 is the last entry in `stories.yaml`, and Epic 34 is the last epic in `epics.md`, so no later story or epic was planned against anything this unit changed. Every DRIFT is `affects: none` or names this story's own closeout code (delivery.ts `slices`, `render_closeout`). The contract changes are additive within 0.1.29, as the intent contract allows; the `hostleg.ts` file-outside-Files change was authorised by consult. The replan queue has no open entry. The two `deferred:` items (a green slice re-run marks the PR ready without committing art or proof; frames and `report.json` absent from the closeout page) are operator or planning follow-ups that the orchestrator's ledger carries. They are not contradictions.
- Affected: none
- Invariant: none
- Gate: Part A no-impact; Part B epic complete: no next story (34-8 accepted; AC3 unverifiable-here, TUA acceptance pending)
