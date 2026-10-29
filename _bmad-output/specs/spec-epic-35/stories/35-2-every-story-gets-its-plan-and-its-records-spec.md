---
title: 'Every Story Gets Its Plan and Its Records'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '9dad2dd9ed2c18b3b60e9a44e2ac846d1b9c36f9'
review_loop_iteration: 0
followup_review_recommended: true
deviation_score: 2
reconcile_verdict: no-impact
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-2.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The launch bootstrap plans the first story only, so a relaunch reached 34.6 with no `plans/34-6.md` and two un-noted open questions (hole 81, DW-79). A resumed run that crossed a story boundary landed 34-5 with no gate file, no `## Reconcile` and no cost line (hole 89, DW-83).

**Approach:** The bootstrap plans every manifest entry in list order, and `launch.py check` refuses (gap `open questions`) the story it would start when one of that story's CAPs has an open question with no design note; an advisory row `story plans` names unplanned stories. Of AC2's either/or the planner picked the **refusal**: the paused-run pass never relaunches across a story boundary while a graceful stop is in force, and a resume re-arms the stop. Contract 0.1.30 gains an additive Story 35.2 paragraph (no version bump).

**Acceptance criteria (verbatim, epics.md §Story 35.2):**

AC1. **Given** an epic launched with `bootstrap: true` **When** the bootstrap runs at the planner tier **Then** `plans/<story>.md` exists for every story in `stories.yaml` in list order (a Code Map and the band each), and a story whose SPEC open questions (`CAP-N`) have no design note is refused with the questions listed (the status block `blocked`, the reason naming the CAPs) before any dev session; the launch's advisory row names the stories still without a plan

AC2. **Given** a paused run resumed after an operator answer **When** the resumed run lands commits for more than one story (the 34.5 shape) **Then** the gate writes a result file per story and each spec gets its `## Reconcile`, the close-out writes one `job-run` ledger line per story (the cost split by the engine's per-story turns, or one line naming both with the cost) and the PR body lists both; or the supervisor refuses a resume that would cross a story boundary with the reason and the graceful stop re-armed — the planner picks one and the contract names it (0.1.30, additive)

AC3. **Given** the lib suite, the supervisor suites and conformance **When** they run **Then** the plan-per-story rule, the refusal and the per-story records are covered with fakes; the runbook's rule "never amend after a resume" stays and its row points at this story; DW-79 and DW-83 close by this PR

## Boundaries & Constraints

**Always:**
- **CAP-3 gap (settled, SPEC.md:129):** `check` adds gap `open questions` only for the *next* story = the first manifest entry with no `stories/<id>-*.md` at `status: done` (glob as `closeout.ts findSpec`). A CAP belongs to a story via `^- \*\*CAP-(\d+)\*\* \((\d+)\.(\d+)\)` (`35.2` → id prefix `35-2-`). Open question = `^- CAP-(\d+):` under `## Open Questions`. Noted = a bullet under `## Design notes (settled shape, planner, <any date>)` whose subject (before ` — `/`:`) is that `CAP-N` or the story (`35.2`/`35-2`; a story bullet notes all its CAPs). Detail `<story id>: CAP-N has no design note — <question, clipped>` joined by `; `; `check_block` then yields `blocked` naming every CAP. No `## Open Questions` → no gap. A later story's un-noted CAP is never a gap.
- **CAP-3 row (settled):** advisory `story plans`, `ok: True` always, added after `playable path`; detail `all <n> planned` or `without a plan: <id>, …` (manifest order), plus `; un-noted open questions: CAP-N (<id>), …` for later stories.
- **CAP-4 refusal (settled, as amended by the consult — see Deviation Summary):** a graceful stop is *in force* for a paused run when its engine run dir (`runDirOf(run)`) holds `stop-request.json` (existence only, any content — bmad-loop's own `graceful_stop_requested`), **or** its `journal.jsonl` has a `stop-request-discarded` entry with no `run-resume` or `run-start` entry after it (journal order; missing/unreadable journal = no stop). Read before the archive step.
  - `closeOutLanded` with a stop in force: commit, meter and `noteEngineCost` still run; archive and relaunch do not; run stays `paused`; one event `story-boundary` `{story_key, engine_run_id, code: "StoryBoundary", reason: "a graceful stop is in force (requested <at|discarded at pause>): relaunching would start the next story in this run", graceful_stop: "kept"}` and one notifier line, once since the run's latest `paused` (copy `noteFailed`/`rulingRecorded` idempotence); the pass skips that run afterwards.
  - `resumePaused` of an unlanded story with a stop in force: after the pid re-read, call `deps.launchStop ?? launchStopGraceful` once on the resumed engine and record `graceful-stop {engine_run_id, rearmed: true, ok, detail}`; the resume answer is unchanged. No stop → no call.
  - No per-story `job-run` lines, no PR-body change, no per-story gate. The contract paragraph names the refusal and says the per-story-records half is not built.
- **Bootstrap text:** `task-planning.md` §1 plans every manifest entry in list order (§3 each, the named story first); §3 gains the open-question rule (an open question of the story's CAPs the planner cannot settle into a design note is `escalate`/`blocked`, never a plan without it); §4 finish line `transcribed <n> stories, planned <n> plans`. **Keep §3's `**Stage Log (Story 35.8).**` bracket**: the bootstrap runs one `stage --start`/`--stop --stage plan` per plan it writes. Change nothing else in that file.
- **Bootstrap commit message** becomes exactly `loop(epic-<N>): SPEC, manifest and story plans from the launch bootstrap`, naming every `plans/*.md` written (SKILL.md step 5, contract :783, `test_driver_contract.py:207`).
- **Contract:** header clause `0.1.30 (Story 35.2, additive): …` placed after 35.8's clause; paragraph `**0.1.30 (Story 35.2, additive).**` placed after 35.8's paragraph (:1600) and before `## 8. Conformance` (:1710); Stories row becomes `… Story 35.1, Story 35.8, Story 35.2 (Epic 35)`; launch row :783 updated (bootstrap plans every entry, the new gap and row). No `**0.1.31**`.
- **Contract test:** add `test_0_1_30_story_35_2_plans_and_records` in 35.8's shape: header clause once, `assertLess` 35.8 clause < 35.2 clause and 35.8 paragraph < 35.2 paragraph, phrases (incl. `stop-request-discarded`, `StoryBoundary`, `graceful_stop: "kept"`, `open questions`, `story plans`), `assertNotIn("**0.1.31**")`. Relax 35.8's exact-row check (`"Story 35.1, Story 35.8 (Epic 35)"` at :2531) **only** to admit 35.2 (e.g. `"Story 35.1, Story 35.8, Story 35.2 (Epic 35)"`). 35.8's note slice ends at `## 8. Conformance`, so it will include 35.2's paragraph — keep its `assertNotIn` phrases absent from 35.2's text.
- **Mirror:** after editing `.bmad-loop/plugins/studio-pipeline/task-planning.md`, re-render `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` with `tools/restructure/nest_pipeline.py` (`uv run python tools/restructure/nest_pipeline.py --out <dir> [--project-name supervisor]`; read its docstring for how it lands in place) — never hand-edit; `test_nest_pipeline` pins it.
- House rules: stdlib-only Python via `uv run`, atomic writes, AD-11 status blocks, no credentials, plugin imports no driver/supervisor (AD-2). Supervisor reads only run-dir files; never imports or calls bmad-loop internals.

**Block If:**
- The refused relaunch's run cannot be ended by existing verbs (`POST /runs/{id}/cancel` from `paused`) without a new state or verb — consult `deviation-gt-0`; never invent a state.
- Anything pins `…first-story plan…` outside Files besides `test_driver_contract.py:207` and contract :783 (grep first).
- The Files list must grow beyond the plan's list plus the mirror.

**Never:** build AC2's per-story-records half (no `jobrun.py`, `prBody`, `board.ts`, `inbox.ts` changes); a contract version bump; edit epics.md, stories.yaml, `plans/`, SPEC.md (the CAP-4 design-note wording drift is recorded, not edited), routing/policy toml, or anything under `implementation-artifacts/supervision/`; push/tag/PR/release; hand-edit the mirror.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| next story un-noted | next story's CAP-3 has open question, no note | gap `open questions`, block `blocked`, reason names CAP-3 | — |
| two CAPs | next story CAP-3, CAP-4 both un-noted | one gap, both CAPs, `; ` joined | — |
| story-keyed note | bullet `- 35.2 — …` under Design notes | no gap | — |
| later story un-noted | CAP-7 of 35-4, next is 35-2 | no gap; row lists `CAP-7 (35-4-…)` | — |
| no Open Questions | SPEC without section | no gap | — |
| plans coverage | some entries lack `plans/<N>-<M>.md` | row `without a plan: <ids in order>` | row never a gap |
| landed + stop file | `stop-request.json` present | commit+meter, no archive/relaunch, paused, 1 `story-boundary`, 1 notifier; 2nd pass no-op | — |
| landed + discarded at pause | journal `stop-request-discarded`, no later `run-resume` | as above | — |
| stale discard | discard then `run-resume` later | no stop → relaunch as today | — |
| landed + no stop | neither | relaunch as today | — |
| resume + stop | unlanded, stop in force | `launchStop` once, `graceful-stop` recorded | failure → `ok: false, detail`, answer unchanged |
| resume + no stop | — | no call | — |
| bad journal | unreadable/garbage lines | treated as no stop | never throws |

</intent-contract>

## Code Map

Start from `plans/35-2.md` §Code Map (the paid investigation); anchors re-checked at baseline `9dad2dd`:

- `plugins/tk-studio/lib/launch.py` -- `check()` :802, `add()` :809, `task manifest` row :835-840 (message "bootstrap the first story's tasks first" may stay), `_manifest_entry_count` :235, `check_block` :647 (gap → `blocked`), `PLAYABLE_PATH_CHECK` :735 / row builder :766 (add `story plans` after it). Write the SPEC parser + next-story resolver here. Real shapes: `spec-epic-35/SPEC.md` `## Open Questions` :112, `## Design notes (settled shape, planner, 2026-10-27)` :119 (bullets `- CAP-3 — …`); Epic 34's SPEC for the second date/tail shape. Run `check` against `_bmad-output/specs/spec-epic-35` and report the `story plans` / `open questions` lines (expected: CAP-7 (35.4) only in the advisory row, never a gap).
- `plugins/tk-studio/lib/tests/test_launch.py` -- `_project(tmp, spec=, entries=, ran_before=)` :31-44 (extend for SPEC text with CAP lines/questions/notes); gap pattern :203-212; advisory-row tests :1108-1215; fixture `lib/tests/fixtures/planner-note/SPEC.md:11-15`.
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- `bootstrap?` :24; step 0 :33-36; step 2 readiness :46-58 (gap list :52, advisory rows :58); step 4 :64; step 5 commit :66-72 (message :69); status block :100-110 (`blocked` reason :108).
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` -- §1 :20-32 (heading "plan its first story" and :32 to change), §3 :66 (Stage Log bracket :68-80 kept; settled-shape rule near the end of §3 is where the open-question rule goes), §4 finish lines at the end. Pinned by `plugins/tk-studio/lib/tests/test_planner_rules.py` (:97-135, `HEADING_RE` :32, `BULLET_RE` :33).
- `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` -- mirror rendered by `tools/restructure/nest_pipeline.py` (FILES :40); pinned by `plugins/tk-studio/lib/tests/test_nest_pipeline.py`.
- `apps/supervisor/src/closeout.ts` -- header :1-80 (pass :4-54, resume :76-80); `PausedDeps` :211; `runDirOf` :294; `noteFailed` :326; `closeOutLanded` :369 (commit/meter/noteEngineCost → archive → relaunch); `rulingRecorded` :406; `closeOutPaused` :682; `ResumeRefusal` :738; `ResumeDeps` :745; `resumePaused` :798 (`StoryLanded` :808, pid re-read :825-854). Journal reader to reuse: `office.ts readJournal` :161 (or `worktree.ts` :779 pattern).
- `apps/supervisor/src/cli.ts` -- `launchStopGraceful` :1029; `pausedDeps(opts)` used at :679/:960/:1471 (add `launchStop`); resume deps near :2163; existing `launchStop: launchStopGraceful` wiring :827 for the pattern.
- `apps/supervisor/test/closeout.test.ts` -- `pausedRun` fixture :47-88 (engine run dir `E1` → write `stop-request.json` / `journal.jsonl` into `fx.runDir`); `passDeps` :93; resume :836-865; refusals :1196-1225; relaunch ~:988. Name tests `Story 35.2: …`.
- Engine facts (read-only, installed bmad-loop): `runs.py:378` existence read; `engine.py:431-439` pause/finish deletes a pending request and journals `stop-request-discarded`; `cli.py:1381` journals `run-resume`; `cli.py:1399` resume clears the file before `write_pid` (so the re-arm after the pid rewrite lands after the clear).
- `plugins/tk-studio/contracts/driver-contract.md` -- header :5; launch row :783; 33.7 resume prose ~:350-362; 35.8 paragraph :1600; `## 8. Conformance` :1710.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- bootstrap message pin :207; 35.1 test :2408; 35.8 test :2467 (Stories row :2531).
- `plugins/tk-studio/contracts/conformance/manifest.json` -- `tk-studio-launch` drives :94-135 (`status-block-fresh` :120, `status-block-relaunch` :127, marker `2 entries`); fixture dir `contracts/conformance/fixtures/launch-relaunch/`.
- `kb/agent-pc-setup-runbook.md` -- rows ~:1576 (hole 81) and ~:1577 (hole 89, "never amend after a resume"): rule stays, both gain `fixed by Story 35.2: …`.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-79 ~:611, DW-83 ~:643: `status: resolved 2026-10-29 by this story's PR (35.2: …)` following 35.1's convention; DW-83 notes 34.5's owed follow-up review is left to the operator.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/launch.py` -- SPEC parser, next-story resolver, `open questions` gap, `story plans` row, module docstring line -- AC1
- `plugins/tk-studio/lib/tests/test_launch.py` -- I/O matrix launch rows (one CAP, two CAPs, story-keyed note, later CAP not a gap, no section, all planned, missing in order, un-noted later CAPs) -- AC1/AC3
- `plugins/tk-studio/skills/tk-studio-launch/SKILL.md` -- `bootstrap?` text, step 4 plans every entry, step 5 paths + message, step 2 gap + row, status block -- AC1
- `.bmad-loop/plugins/studio-pipeline/task-planning.md` -- §1, §3 open-question rule, §4 finish line; Stage Log bracket kept -- AC1
- `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` -- re-render via `nest_pipeline.py` -- mirror pin
- `plugins/tk-studio/lib/tests/test_planner_rules.py` -- pins for the new text -- AC3
- `apps/supervisor/src/closeout.ts` -- stop-in-force reader (file or journal), `StoryBoundary` in `closeOutLanded`, re-arm in `resumePaused`, `launchStop?` on both deps, header -- AC2
- `apps/supervisor/src/cli.ts` -- wire `launchStopGraceful` into pass and resume deps -- AC2
- `apps/supervisor/test/closeout.test.ts` -- I/O matrix supervisor rows -- AC3
- `plugins/tk-studio/contracts/conformance/manifest.json` + `fixtures/launch-open-question/` (new: `SPEC.md`, `stories.yaml`, `stories/`) -- drive `status-block-open-question`: `check` → `blocked`, marker names the CAP; `status-block-relaunch` marker still holds -- AC3
- `plugins/tk-studio/contracts/driver-contract.md` + `lib/tests/test_driver_contract.py` -- clause, row, paragraph, pins as in Always -- AC2/AC3
- `kb/agent-pc-setup-runbook.md`, `_bmad-output/implementation-artifacts/deferred-work.md` -- rows point at 35.2; DW-79/DW-83 resolved -- AC3

**Acceptance Criteria:**
- Given the edits, when the lib suite runs, then the plan-per-story text, the gap and the row are covered (test_launch, test_planner_rules, test_nest_pipeline, test_driver_contract green).
- Given the edits, when `bun test test/closeout.test.ts test/resume.test.ts test/autoresume.test.ts` runs, then the Story 35.2 cases pass and the full `bun test` shows no failures beyond the 25 pre-existing ones (same names as clean HEAD).
- Given the edits, when conformance runs, then `ok: true` including `status-block-open-question`.
- Given `check` on `spec-epic-35`, then no `open questions` gap and the `story plans` row lists CAP-7 (35-4-…) as un-noted.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- note: both layers ran (band L); the 213 KB diff (long single-line contract/runbook rows) was handed to each reviewer as a file path, not inline
- intent_gap: 0
- bad_spec: 0 (H1/H2 sit inside the intent contract's Always; the consult ruled them patch + deviation)
- patch: 7: (high 2, medium 4, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` task-planning.md §2 "Next story" required "no spec file and no plan", which never matches once the bootstrap plans every entry → next story = first entry with no spec; an existing bootstrap plan is re-checked (open-question rule) and refreshed
  - `[high]` `[patch]` `OPEN_QUESTION_RE` missed multi-CAP lines (`- CAP-9 and CAP-10:`, spec-epic-34) → CAP lists accepted, each CAP mapped; real-SPEC test tightened
  - `[medium]` `[patch]` §3 rule blocked the whole bootstrap on a later story's unsettled CAP → only the started story ends `blocked`; a later one gets a Block If in its plan and stays un-noted (row, boundary, `check`); SKILL.md step 4 aligned; mirror re-rendered
  - `[medium]` `[patch]` design-note subjects like `CAP-11/CAP-12` were not split → split like questions
  - `[medium]` `[patch]` runbook hole-89 remedy still said the pass relaunches; hole-81 still said re-issue the stop after resume → rewritten to the 35.2 behaviour, the "never amend after a resume" rule kept
  - `[medium]` `[patch]` `resumePaused` re-armed even when `engine.pid` was never rewritten (bmad-loop clears the file just before `write_pid`) → skipped and recorded `rearmed: false, ok: false`; test + contract pin
  - `[low]` `[patch]` only the first question line per CAP was listed → all listed, `; ` joined

### 2026-10-29 — Review pass (follow-up, review_loop_iteration 0)
- note: follow-up pass on the done spec; both layers ran (band L); the ~226 KB diff `9dad2dd..worktree` was handed to each reviewer as a file path
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 4, low 1)
- defer: 0
- reject: 4: (DW-83 "resolved" overstated — AC3 names DW-83 closing and AC2's either/or sanctions the refusal; `cli.ts` default wiring untested — plumbing, present at `cli.ts:2160`/`:2167` with the lazy default; remediation `<key>-r<n>` spec glob — no such specs exist and the glob mirrors `findSpec` as the plan pins; blocked bootstrap leaves SPEC/manifest uncommitted — §3's `blocked` end predates 35.2)
- addressed_findings:
  - `[medium]` `[patch]` `OPEN_QUESTION_RE` dropped possessive open questions (`- CAP-9's tracked source: …`, spec-epic-29/33), so an un-noted CAP in that form never refused the launch → any CAP-led bullet (optional `'s`) under `## Open Questions` is a question; test added
  - `[medium]` `[patch]` design-note subject `CAP-2/CAP-3 (28.1)` (spec-epic-28:109) noted nothing → a CAP list with an optional `(N.M)` notes its CAPs; test added
  - `[medium]` `[patch]` task-planning §1 still planned only the named story on an existing manifest (AC1 every story) → plans every entry lacking `plans/<N>-<M>.md`, list order, named story first; mirror re-rendered; pinned
  - `[medium]` `[patch]` a skipped or `ok: false` re-arm was silent (event only), so the resumed engine could run on with no graceful stop → one notifier line naming `launch.py stop --graceful`, outcome on the `graceful-stop` event; contract paragraph and runbook hole-89 row qualified; tests + pin
  - `[low]` `[patch]` task-planning §3 never named the note-subject shape `launch.py check` reads → one clause added; pinned

### 2026-10-29 — Review pass (second follow-up, review_loop_iteration 0)
- note: second follow-up pass on the done spec; both layers ran (band L); the ~237 KB diff `9dad2dd..worktree` (spec excluded) was handed to each reviewer as a file path
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 7: (stock-template CAP lines carry no `(N.M)` — no story attribution exists, the intent contract attributes by the annotation; relaunch after a `blocked` bootstrap does not backfill — consult-ruled in pass 3 (option A), never consult twice; status page/office do not render `story-boundary` — not named by the criteria, the reason rides the event and the notifier line; the hold fires on the epic's last story — the intent contract pins the hold unconditionally under a stop, and `POST /runs/{id}/cancel` closes it out with its PR and job-run line; DW-83's owed 34.5 review untracked — 34-5's spec keeps `followup_review_recommended: true` and the orchestrator owns the ledger; remediation `<id>-r<n>` glob — rejected in pass 3, same reason; a resumed run crossing with no stop — the intent contract conditions the refusal on a stop in force)
- addressed_findings:
  - `[medium]` `[patch]` `## Open Questions` bullets naming a CAP mid-sentence (the bmad-spec template's `- Is … in scope for CAP-2?`, spec-epic-24's `(CAP-9)`) were ignored, so the AC1 refusal failed open → any bullet naming a CAP is a question of each CAP it names (a CAP-led bullet keeps its lead CAPs only), whole bullet as the question; task-planning §3 sentence and the contract 0.1.30 paragraph reworded, mirror re-rendered, pins and tests added
  - `[medium]` `[patch]` `CAP_LINE_RE` required `)` right after `E.S`, so `- **CAP-16** (28.5; added by correct-course …)` (spec-epic-28:66) mapped no story → `\((\d+)\.(\d+)(?![\d.])`; test added

## Design Notes

- The plan's settled CAP-4 signal (`stop-request.json` with `mode: "graceful"`) can never hold for a paused run: bmad-loop deletes a pending request on every exit and journals `stop-request-discarded` (`engine.py:431-439`). The consult ruled the two-part signal in Always (file existence, or a discard not followed by `run-resume`/`run-start`).
- AC2's per-story-records half is deliberately not built (planner's pick); the refusal keeps every story's own gate, reconcile and cost line by never letting one engine run carry two stories under a graceful stop.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && bun test test/closeout.test.ts test/resume.test.ts test/autoresume.test.ts` -- expected: 0 fail
- `cd apps/supervisor && export PATH=$HOME/.bun/bin:$PATH && bun test` -- expected: only the 25 pre-existing failures
- `uv run plugins/tk-studio/lib/launch.py check --directory . --spec _bmad-output/specs/spec-epic-35` -- expected: `story plans` row names CAP-7 (35-4-…); no `open questions` gap

## Deviation Summary

- DRIFT (planning, consult-ruled score 2): CAP-4's "graceful stop in force" signal widened from `stop-request.json` with `mode: "graceful"` (plans/35-2.md Settled shape; SPEC.md:130) to file existence OR a journal `stop-request-discarded` not followed by `run-resume`/`run-start` — bmad-loop deletes the file on every engine exit, so the planned condition never fires in a paused run — affects: none (the contract 0.1.30 Story 35.2 paragraph names the signal). The plan's "non-graceful file = no stop" test becomes "stale discard then resume = no stop" and "discard after latest resume = stop".
- Sanctioned by the replan directive (gate of 35-8): `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md` re-rendered (a mirror outside Files, pinned by `test_nest_pipeline`); `test_driver_contract.py` 35.8's exact Stories-row check relaxed only to admit 35.2.

### pass 1 — 2026-10-29 (implementer, score 1)

- planned: the `launch-open-question/` fixture holds `SPEC.md`, `stories.yaml`, `stories/` / actual: also `.tk-studio/config.yaml` (`vcs: git`), as `launch-relaunch` does / why: without it the nearest-root rule (0.1.22) climbs to the real checkout / may affect: none
- planned: `deps.launchStop ?? launchStopGraceful` in `closeout.ts` / actual: fallback via lazy `await import("./cli")`; production passes `launchStopGraceful` explicitly in `pausedDeps` and `resumeRun` / why: `cli.ts` imports `closeout.ts`; a static back-import is a cycle / may affect: none
- planned: reason `(requested <at|discarded at pause>)` / actual: `(requested <requested_at>)`, `requested at an unknown time` when the file names none, `(requested before the pause, discarded at pause)` from the journal; the contract names all three / why: the template was ambiguous / may affect: none
- planned: full `bun test` shows only the 25 known failures vs clean HEAD / actual: 0 failures (1663 pass), so no clean-HEAD comparison; run with `TK_STUDIO_ROOT` set after `bun install --frozen-lockfile --backend=copyfile` / why: the closeout fixture needs the variable; plain install EPERM here / may affect: none

DRIFT: CAP-4 stop-in-force signal widened to `stop-request.json` existence or a journal `stop-request-discarded` not followed by `run-resume`/`run-start` — bmad-loop deletes the file on every engine exit, so the planned `mode: "graceful"` file never exists in a paused run (consult, score 2) — affects: none
DRIFT: `launch-open-question` conformance fixture carries `.tk-studio/config.yaml` — the nearest-root rule would otherwise check the real checkout — affects: none
DRIFT: `closeout.ts` reaches the `launchStopGraceful` fallback by lazy import; production wires it explicitly — avoids a cli/closeout import cycle — affects: none
DRIFT: `story-boundary` reason has three `requested …` forms — the spec's `<at|discarded at pause>` template was ambiguous — affects: none
DRIFT: full `bun test` compared to no baseline (0 failures, not the expected 25) — nothing to compare — affects: none

### pass 2 — 2026-10-29 (implementer review patches, score 2, consult-ruled)

- planned: "Change nothing else" in task-planning.md beyond §1, §3's rule, §4 / actual: §2 "Next story" rewritten; §3's rule narrowed to the story being started / why: review H1 + medium, consult ruling / may affect: none
- planned: open-question pattern `^- CAP-(\d+):` and exact-CAP note subjects / actual: CAP lists in both, several questions per CAP listed; contract paragraph widened / why: review H2, real Epic 34 SPEC lines / may affect: none
- planned: re-arm called after the pid re-read unconditionally / actual: skipped and recorded `rearmed: false` when `engine.pid` was not rewritten / why: review patch, bmad-loop clears the stop before `write_pid` / may affect: none
- planned: runbook rows only gain "fixed by Story 35.2" / actual: hole-89 remedy and hole-81 resume advice rewritten (rule kept verbatim); new DW-98 records the intent-contract contradictions for the next spec pass / why: review patches, consult DO / may affect: none

DRIFT: task-planning.md §2 "Next story" rewritten (first entry with no spec; an existing bootstrap plan re-checked and refreshed) — the every-story bootstrap made "no spec file and no plan" never match, so the gate would record `epic complete` mid-epic (consult, score 2) — affects: none
DRIFT: launch.py open-question and design-note parsing accept CAP lists, several questions per CAP — the pinned single-CAP pattern missed the real Epic 34 SPEC shape (consult, score 1) — affects: none
DRIFT: the resume re-arm is skipped (`rearmed: false`) when `engine.pid` was not rewritten — bmad-loop clears the stop file just before `write_pid` — affects: none
DRIFT: runbook hole-89/hole-81 remedies rewritten to the 35.2 behaviour and DW-98 added — the old remedies contradicted the refusal — affects: none

### pass 3 — 2026-10-29 (follow-up review patches, score 1, consult-ruled)

- planned: the resolution pass's `resumeRun` options unchanged / actual: `apps/supervisor/src/cli.ts:750` passes `opts.hygiene`, so the failed-re-arm notifier line uses the paused-run pass's notifier setup / why: review patch 5 / may affect: none
- planned: §1 sentence fixed for every bootstrap / actual: the bootstrap trigger (SKILL.md:64, task-planning.md:5, "manifest empty") left unchanged, so a relaunch after a `blocked` bootstrap does not backfill later plans; the `story plans` row names them and Part B plans each at its boundary / why: consult option A (SKILL.md:60 relaunch writes nothing; AC1 presumes unplanned stories) / may affect: none

DRIFT: `cli.ts:750` passes `opts.hygiene` into the resolution pass's `resumeRun` — the failed-re-arm notifier line needs the same notifier setup as the paused-run pass (consult, score 1) — affects: none

### pass 4 — 2026-10-29 (second follow-up review patches, score 1, consult-ruled)

- planned: open question = `^- CAP-(\d+):` (as widened to CAP lists and the possessive form); capability line `^- \*\*CAP-(\d+)\*\* \((\d+)\.(\d+)\)` / actual: any `## Open Questions` bullet naming a CAP (CAP-led → lead CAPs only; any other bullet → every CAP it names, whole bullet as the question) and capability lines with a tail after `E.S` (`(?![\d.])`) / why: AC1 failed open on the bmad-spec template form and the real Epic 24/28 SPEC lines / may affect: none (spec-epic-35 `check` unchanged; done Epics 24/29 now read CAP-6/9/12 and CAP-8 as un-noted questions, Epic 28's CAP-16/17 map to 28.5/28.6)

DRIFT: launch.py open-question parsing reads any `## Open Questions` bullet naming a CAP, and capability lines with a tail after `E.S` — AC1's refusal failed open on the bmad-spec template form and real Epic 24/28 SPEC lines (consult, score 1) — affects: none

## Consult Log

- 2026-10-29T02:57:20Z — trigger: halt — question: plan Block If fired — bmad-loop deletes `stop-request.json` on every engine exit (journals `stop-request-discarded`), so CAP-4's file-only signal never holds for a paused run; widen the signal, or halt? — ruling: accept-deviation score 2 — do: Use option 2: stop in force = `stop-request.json` exists, or `journal.jsonl` has `stop-request-discarded` with no `run-resume`/`run-start` after it (journal order; missing/unreadable = no stop). Log a DRIFT against plans/35-2.md and SPEC.md:130, name the signal in the contract 0.1.30 (Story 35.2) paragraph, replace the non-graceful-file test with stale-discard-then-resume (no stop) and discard-after-latest-resume (stop). Leave the resume re-arm unchanged; read only run-dir files, never call bmad-loop. — rule candidate: When a plan reads a bmad-loop control file as state, check the pinned source for every path that deletes it; if it does not survive the run's exit, use the run's journal entry scoped after the latest run-resume/run-start. (observation recorded)
- 2026-10-29T03:23:29Z — trigger: deviation-gt-0 — question: accept the implementer's four pass-1 deviations (fixture config, lazy cli import fallback, three reason forms, no clean-HEAD bun comparison)? — ruling: accept-deviation score 1 — do: Keep all four as implemented at score 1; keep the lazy `await import("./cli")` fallback (production injects `launchStopGraceful` explicitly); note full `bun test` 0 failures meets the bound, no clean-HEAD comparison needed. — rule candidate: In apps/supervisor, a default dependency living in a module that already imports the current module is reached by lazy `await import()`; a score-0 detail when production injects it explicitly. (observation recorded)
- 2026-10-29T03:29:20Z — trigger: high-severity-finding — question: route H1 (task-planning §2 "no spec file and no plan" now never matches; bootstrap blocks on a later story) and H2 (`OPEN_QUESTION_RE` misses `CAP-9 and CAP-10:`) as patch or bad_spec, and accept the §2 edit? — ruling: accept-deviation score 2 — do: Route H1 and H2 as patch with the proposed fixes; record the §2 edit (score 2) and the wider regex (score 1) as deviations; re-render the mirror and update the pins; do not amend the spec; note the contradictions in deferred-work so the next spec pass fixes the source. — rule candidate: When a story spec pins a regex or line-shape for parsing an existing artifact, the planner tests it against every real instance the plan's Risks name before freezing the intent contract; a later mismatch is a contradiction to rule on (patch + deviation), not bad_spec. (observation recorded)
- 2026-10-29T04:04:59Z — trigger: deviation-gt-0 — question: accept the follow-up pass's `cli.ts:750` hygiene pass-through (score 1), and should the bootstrap trigger (SKILL.md:64, task-planning.md:5) widen so a relaunch backfills missing plans? — ruling: accept-deviation score 1 — do: Keep cli.ts:750 as patched and record it at score 1; leave the bootstrap trigger unchanged (option A) and record the relaunch-after-blocked-bootstrap gap as a residual risk. — rule candidate: In task-planning.md Bootstrap mode, add: "A relaunch never re-enters bootstrap to backfill plans; unplanned entries are reported by the `story plans` row and planned at their boundary by Part B." (observation recorded)
- 2026-10-29T04:21:19Z — trigger: deviation-gt-0 — question: accept the pass-4 widening (any Open Questions bullet naming a CAP, CAP-led → lead CAPs only; capability line tail after `E.S`), require CAP-led bullets to count every named CAP, or revert? — ruling: accept-deviation score 1 — do: Keep the patch as implemented (CAP-led bullet → lead CAPs only; any other bullet → every CAP it names; lookahead `(?![\d.])` stays). Record it in the deviation log (planned `^- CAP-(\d+):` / actual as implemented / why: AC1 failed open on the template form and Epic 24/28 lines / may affect: none). Do not apply option (b); proceed to conformance and close out. — rule candidate: In task-planning.md §3, add: "An operator ruling on a SPEC open question is recorded as a design note naming its CAP; an inline **Ruled** inside the question bullet does not count as a note." (observation recorded)

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| dev | 2 | 2026-10-29T02:54:22Z | 2026-10-29T03:44:50Z | ceeb5ff3-ef86-4ab0-9195-20fb282d03e2 | claude-opus-5-5 | medium | 26203360 | 156237 | 13.4077 | completed |
| review | 1 | 2026-10-29T03:44:50Z | 2026-10-29T04:08:17Z | fa0da100-8f42-461d-94b4-b020b67c78b4 | claude-opus-5-5 | medium | 10220570 | 80289 | 6.2152 | completed |
| review | 2 | 2026-10-29T04:08:17Z | 2026-10-29T04:22:45Z | 8cbdd4f4-a862-42bd-8950-08779fbb84aa | claude-opus-5-5 | medium | 8068878 | 71431 | 5.5846 | completed |
| gate | 1 | 2026-10-29T04:22:46Z | 2026-10-29T04:26:49Z | 06a16052-a88c-4924-8730-185a9da796b2 | claude-opus-5-5 | medium | 3310141 | 17499 | 1.8248 | completed |



## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-35-20261029T023850Z-ba09e6` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

This was a second follow-up review pass on the done spec (`followup_review_recommended: true` from pass 3). It reviewed the whole story diff `9dad2dd9ed2c18b3b60e9a44e2ac846d1b9c36f9..worktree` and patched two findings. No deferred-work ledger entry was modified (the orchestrator owns them).

**Summary of this pass.**
- `launch.py check` now reads an open question as any `## Open Questions` bullet that names a CAP. A CAP-led bullet still counts only for its lead CAPs; any other bullet counts for every CAP it names, with the whole bullet as the question. Before, the bmad-spec template's own form (`- Is … in scope for CAP-2?`) and real lines such as Epic 24's `(CAP-9)` were ignored, so the AC1 refusal failed open on them.
- A capability line with text after the story number (`- **CAP-16** (28.5; added by correct-course …)`, Epic 28) now maps its CAP to the story. Before, it mapped to none.
- task-planning §3 and the contract's 0.1.30 Story 35.2 paragraph describe the wider question shape (additive prose; no version bump). This retires pass 3's residual risk that both places named only `- CAP-N:` lines.
- The rest of the story's behaviour is unchanged.

**Files changed (this pass).**
- `plugins/tk-studio/lib/launch.py`: `CAP_LINE_RE` takes any non-digit after `E.S`; `spec_open_questions` counts mid-sentence CAP bullets; `_caps_in` matches whole tokens only.
- `plugins/tk-studio/lib/tests/test_launch.py`: four Story 35.2 tests (mid-sentence and parenthesised questions, a noted CAP named mid-sentence, a bullet naming no CAP, a capability line with a tail).
- `.bmad-loop/plugins/studio-pipeline/task-planning.md`: the §3 open-questions sentence reads "a bullet that names one of the story's CAPs".
- `apps/supervisor/.bmad-loop/plugins/studio-pipeline/task-planning.md`: re-rendered mirror, via `tools/restructure/nest_pipeline.py`.
- `plugins/tk-studio/lib/tests/test_planner_rules.py`: pin for the new wording; the old wording pinned gone.
- `plugins/tk-studio/contracts/driver-contract.md`: the 0.1.30 Story 35.2 paragraph names the wider question shape.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: two pins for that wording.

**Review (this pass).**
- Both layers ran (blind-hunter and edge-case-hunter; band L).
- Patches applied: 2 (0 high, 2 medium, 0 low). Deferred: 0. Rejected: 7 (reasons in the Review Triage Log).
- Consults: 1 (`deviation-gt-0`: accept-deviation score 1).
- Follow-up review recommended: true. There were no patched highs, but the score is 3×2 + 1×0 = 6, which is at least 5.

**Verification.**
- `uv run python -m unittest discover tests` (from `plugins/tk-studio/lib`): Ran 2424, OK (skipped=2). Re-run by this session.
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, `failures: []`. Re-run by this session.
- `bun test test/closeout.test.ts test/resume.test.ts test/autoresume.test.ts` (`TK_STUDIO_ROOT` set): 181 pass, 0 fail. Re-run by this session.
- Full `bun test`: not run this pass, because no supervisor source changed (only the re-rendered planner-text mirror, which `test_nest_pipeline` pins and which passed).
- `launch.py check --directory . --spec _bmad-output/specs/spec-epic-35`:
  - No `open questions` gap.
  - The `story plans` row reads `without a plan: 35-4-the-engine-mcp-before-the-first-flagged-run, 35-5-the-sandbox-and-the-host-agree, 35-6-the-closeout-carries-the-proof, 35-7-the-run-sweep-job-type; un-noted open questions: CAP-7 (35-4-the-engine-mcp-before-the-first-flagged-run)`. This is unchanged.
  - The check ended `blocked` only because of this checkout's live engine (`20261029-024051-cdae`) and the tree that was still dirty at the time.
- Parser over every real SPEC (implementer): Epic 24 now reads CAP-6/9/12 as un-noted questions and Epic 29 now reads CAP-8. Epic 28's CAP-16/17 now map to 28.5/28.6, though Epic 28 has no CAP-naming question. Epics 33–35 are unchanged.

**Residual risks.**
- A SPEC whose capability lines carry no `(N.M)` story number has no per-story refusal. This covers the bmad-spec template as shipped, and Epic 20. The studio's SPECs annotate the story number.
- When a landed story is the epic's last and a graceful stop is in force, the run is still held `paused` with the "next story" reason. The operator ends it with `POST /runs/{id}/cancel`.
- The status page and office do not render the `story-boundary` hold. The reason rides only the event and the notifier line.
- Carried from earlier passes:
  - A relaunch after a `blocked` bootstrap does not backfill later plans (consult option A).
  - AC2's per-story-records half is not built (the planner's pick).
  - The stop-in-force signal depends on bmad-loop's journal kinds.

DRIFT: launch.py open-question parsing reads any `## Open Questions` bullet naming a CAP, and capability lines with a tail after `E.S` — AC1's refusal failed open on the bmad-spec template form and real Epic 24/28 SPEC lines (consult, score 1) — affects: none

## Reconcile

### 2026-10-29 — no-impact

- Score: 2
- Reasoning: Every DRIFT is additive at 0.1.30 and the contract's Story 35.2 paragraph names the widened stop-in-force signal and the wider open-question shape. No later story assumes the changed surfaces. 35.2 touched none of the sources mapped in plans/35-3.md (the only planned later story); it moved its `manifest.json`, `test_driver_contract.py` and contract-tail anchors by 1–9 lines (noise, refreshed in place by this gate), and 35-3's plan already places its paragraph after 35.2's. 35.4–35.7 have no plan yet and are planned against the current code at their boundaries. 35.4 adds a `launch.py check` advisory beside the new `story plans` row, additively.
- Affected: none
- Invariant: none

Gate: Part A no-impact; Part B story accepted, planned 35-3-the-slice-path-hardened (existing plan re-checked: no open question names CAP-5/CAP-6, `check` shows no `open questions` gap; anchors refreshed in place; plan stage row buffered in stages/35-3-the-slice-path-hardened.jsonl)
