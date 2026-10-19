---
title: 'The Supervisor Is Built on the Trial Route'
type: 'chore'
created: '2026-10-19'
status: 'done'
baseline_revision: 'dcdabd23593a50c9426fbd9d7ec0ff02cb36eef2'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 2
context:
  - '{project-root}/kb/execution-pipeline-model-routing.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epics 20–22 (the Phase 1 build) ran through the launch pipeline on the Opus 5.5 trial route and were metered story by story, but the figures sit only in session handoffs; no kb trial record compares them with the v2 table by story kind (Story 24.2, ST-077).

**Approach:** Write one kb trial record from committed evidence only (no new runs): per landed Epic 20–22 story, its route evidence, its Story 24.1 record source, dollars, wall-clock, attempts and kind, compared with the v2 by-kind figures, with the stated caveat. Link it from the kb routing page and regenerate the kb index.

Acceptance criteria (verbatim, epics.md Story 24.2):

1. **Given** Epics 20–22 run through the launch pipeline **When** each story lands **Then** it ran on the trial route (tk-studio's `routing.toml`, and the same table in the supervisor repo), and its Story 24.1 record exists
2. **Given** the landed stories **When** they are compared with the v2 table by story kind (core code ≈ $4.4, feature ≈ $8.6 all-in) **Then** a kb trial record lists each story's dollars, wall-clock, attempts and kind, with the caveat that these are different stories and a different language (TypeScript and Python against the C#/Godot baseline)

## Boundaries & Constraints

**Always:**
- Every figure in the record cites its committed source (file and line, commit, or run id). A figure no source carries is written `not recorded` with the reason, never estimated, interpolated or derived from commit timestamps.
- Stories in scope: those of Epics 20–22 that ran through the launch pipeline: 20-1, 20-2, 21-1…21-6, 22-1, 22-2, 22-3, 22-5. 22-4 is listed as out of scope (a tk-studio kb story built by hand, PR #85; `apps/supervisor/_bmad-output/specs/spec-epic-22/stories.yaml:6`). 24-1 is not an Epic 20–22 story and is not a row.
- Kind rule (the v2 kb's bands, `kb/execution-pipeline-model-routing.md:56-57`): `core code` when the story's landed diff outside `_bmad-output/` is under 150 changed lines, else `feature`; the record shows the files / lines figure it used and its git range.
- The caveat sentence appears verbatim in substance: different stories and a different language (TypeScript and Python against the C#/Godot baseline).
- Spends nothing: no loop run, no meter `record`, no ledger write. `meter.py` may be run only with `--no-record`.

**Block If:**
- A story in scope has no committed dollar figure at all.

**Never:** No change to `routing.toml` (either tree), `[pipeline.legs]`, any `.py`, contract or schema. No verdict per leg (that is Story 24.4). No edit to the existing v2 table or the "Trial in flight" prose beyond one pointer line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full figures | 21-3: $38.13, 89.6 min, attempt 1 (handoff 09-29 table) | row with all three and its kind | — |
| Missing wall-clock | 20-1, 21-1, 21-2, 21-4: minutes blank in every handoff | `not recorded` + reason (the meter's observation stayed in the microVM ledger) | never derived |
| Route evidence | each story spec's `Studio: … routing implementer=… reviewers=… consult=…` line | route column `opus-5-5 (spec line N)` | a spec without the line → `not recorded` |
| 24.1 record | meter observation not in any committed ledger under `measurements/` for 20–22 | record-source column names the handoff line carrying the metered figure, and states the ledger observation is not on this box | AC1 ledger half is unverifiable-here; operator command recorded |
| 20-1 timing | landed before the 24.1 meter existed | note it was priced afterwards from its transcripts (handoff 09-28:78) | — |

</intent-contract>

## Code Map

- `kb/execution-pipeline-model-routing.md:45-60` -- the v2 table and by-kind means (core ≈ $4.4, engine-node/feature ≈ $8.6); `:78-105` "Trial in flight" section, where the one pointer line goes. Frontmatter shape (`title`, `description`, `rank`) at `:1-5`.
- `kb/index.md` -- generated; regenerate with `uv run plugins/tk-studio/lib/kb.py index --directory .`, never hand-edit.
- `kb/acceptance-record-23-3-queue-driven-run-2026-10-17.md` -- house style for a kb record page (title line, sourced tables).
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-09-28.md:72-86` -- metered table 20-1, 20-2, 21-1…21-4 (largest legs; 20-2 = 14.5 min; 21-3 = 89.6 min), the review-share note and "each story's observation sits in its sandbox's own ledger".
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-09-29.md:7-40` -- full table 20-1…22-3 ($, minutes, attempt, review share), Epic totals ($152.75, $69.36), routing "every leg on Claude Opus 5.5".
- `_bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-07.md:34-38,49` -- 22-5: $13.42, 36 min, attempt 1, run `20261007-010022-f20c`.
- `_bmad-output/specs/spec-epic-24/stories/24-1-…md` Auto Run Result -- 20-2 re-priced live with `--no-record` on run `20260928-090746-8360`: usd_total 7.144789.
- Route evidence: `_bmad-output/specs/spec-epic-20/stories/*.md` and `apps/supervisor/_bmad-output/specs/spec-epic-2{1,2}/stories/*.md`, each `Studio:` line (`grep -n 'routing implementer'`). `.bmad-loop/routing.toml` and `apps/supervisor/.bmad-loop/routing.toml` are byte-identical (`diff` empty), every leg `claude-opus-5-5`.
- Ledgers: `measurements/*.jsonl` carry `meter:` observations only for Epics 25–29 (`grep '"meter:'`), none for 20–22.
- Story commits (kind diffstat, `git show --stat <c> -- . ':!*_bmad-output*'`): 20-1 `2d68213`; 20-2 `ac09d1e`; 21-1 `ec42969 0e3ef19 1572100`; 21-2 `29af406 f9bf686`; 21-3 `4f721b3`; 21-4 `c86ed51`; 21-5 `7a2eb9b`; 21-6 `ea2fb8e dde100f fda83bf`; 22-1 `0a9c9d4`; 22-2 `7d3134e`; 22-3 `d717587`; 22-5 `a59d763`. Verify each with `git log` before use; a story's diff is the sum of its listed commits.

## Tasks & Acceptance

**Execution:**
- `kb/trial-record-opus-5-5.md` -- create: frontmatter (`title`, `description`, `rank: 31`); scope paragraph (route, dates, repos, n stories, 22-4 out of scope); per-story table (story, repo, kind + files/lines, $, wall-clock, attempts, route evidence, 24.1 record source); by-kind comparison against v2 (mean and range per kind, against $4.4 / $8.6); the caveat; an "Evidence gaps" list (wall-clock not recorded, ledger observations not on this box, 20-1 priced after landing) -- the AC2 deliverable; Stories 24.3/24.4 extend this page.
- `kb/execution-pipeline-model-routing.md` -- add one line under "Trial in flight" linking the record -- discoverability.
- `kb/index.md` -- regenerate via `kb.py index` -- generated file.

**Acceptance Criteria:**
- Given the record, when each in-scope story's row is read, then its route cell cites the story spec's `Studio:` routing line showing `claude-opus-5-5` for implementer, reviewers and consult, and the page states both `routing.toml` tables are identical (AC1, route half).
- Given the record, when each row's 24.1 record cell is read, then it names the committed source of that story's metered figure (AC1, record half; the ledger observation is unverifiable-here).
- Given the record, when read, then every in-scope story has dollars, wall-clock (or `not recorded` + reason), attempts and kind, a by-kind comparison with $4.4 and $8.6, and the caveat (AC2).

## Spec Change Log

### 2026-10-19 — follow-up review pass (patch, outside `<intent-contract>`)
- trigger: blind-hunter finding that Design Notes and Verification still carried text the earlier passes withdrew
- amended: Design Notes drops the `story=20-` operator check and names the three before-the-meter stories; Verification expects 12 rows and two added index lines
- known-bad state avoided: a re-run following Verification would flag the correct 12-row record and the generated index as failures
- KEEP: `<intent-contract>` untouched (its matrix row "20-1 timing" and the Boundaries kind-rule citation stay as written; the DRIFT lines record why the record departs from them)

## Review Triage Log

### 2026-10-19 — Review pass
- skipped-layer: none (no story plan, so no band; both layers ran)
- intent_gap: 0
- bad_spec: 0
- patch: 6 (high 0, medium 5, low 1)
- defer: 0
- reject: 2 (high 0, medium 2, low 0)
- addressed_findings:
  - `[medium]` `[patch]` route evidence proved only today's diff; added each routing.toml's single commit (`f006a3e`, `383a799`), both before the first landing
  - `[medium]` `[patch]` kind rule mis-credited to kb:56-57; now labelled the record's own line proxy, anchored on kb:57, the semantic v2 kinds and content-authoring noted
  - `[medium]` `[patch]` caveat lacked the measurement-method difference (v2 weighted tokens at one price vs per-model list price) and the unknown overhead inclusion behind the 2.39× ratio; added
  - `[medium]` `[patch]` attempt-1 claim omitted the hand fixes after landing (21-5, 22-2, 22-3; H0929:51); added, and 20-1/20-2 attempts sourced to H0928/H0929:37
  - `[medium]` `[patch]` "20-1 priced afterwards from transcripts" unsupported by H0928:78; rewritten, AC1 ledger half stated unmet for 20-1/20-2 (consulted, DRIFT logged)
  - `[low]` `[patch]` (session-found) ledger range "26-1 to 28-5" wrong; now 25-1…28-5
- rejected: edge-case-hunter's two findings (reclassify 20-1/20-2 as core code and recompute the by-kind rows) — they change the kind rule the intent contract pins and the first consult ruled on; the disclosure patch above covers the substance

### 2026-10-19 — Review pass (follow-up)
- skipped-layer: none (no story plan, so no band; both layers ran)
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 2 (high 0, medium 2, low 0)
- addressed_findings:
  - `[medium]` `[patch]` 21-1 (last commit `1572100` 09:55:15Z) landed before the meter `8b83a7e` (10:14:36Z), yet its row and the Evidence gaps said its observation stayed in the sandbox ledger; the implementer moved 21-1 to the before-the-meter rule (wall-clock reason, 24.1 cell, three Evidence-gaps bullets); both layers raised it, deduplicated
  - `[low]` `[patch]` the spec's Design Notes and Verification still carried withdrawn text (`story=20-` check, 11 rows, one index line); amended by this session (Spec Change Log)
- rejected: the blind hunter's "21-2 may share it" (its first commit `29af406` is 10:23Z, after the meter; that the run started earlier is speculation and H0928:86 covers it); the blind hunter's "AC1 unmet is not escalated" (already recorded as DRIFT, consulted twice with accept-deviation score 2, and stated as unmet in the Auto Run Result)

## Design Notes

AC1 is historical: it is proven by citation, not by re-running. The ledger observations the 24.1 meter wrote for Epics 20–22 landed in each sandbox's `~/.tk-studio` (the residual risk 24-1 recorded, fixed later by 26-4); none is in a committed ledger. The operator check is `sbx exec claude-tk-studio-supervisor -- sh -c "grep '\"meter: story=2[12]-' ~/.tk-studio/measurements/*.jsonl"`. 20-1, 20-2 and 21-1 landed before the meter's commit `8b83a7e` (10:14Z), so no hook-written observation exists for them and no operator check applies (amended in the follow-up review pass, see Spec Change Log).

## Verification

**Commands:**
- `diff .bmad-loop/routing.toml apps/supervisor/.bmad-loop/routing.toml` -- expected: no output.
- `grep -c '^| 2[0-2]-' kb/trial-record-opus-5-5.md` -- expected: 12 story rows (plus none for 22-4 or 24-1).
- Matrix checks, each against `kb/trial-record-opus-5-5.md`: `grep -n '21-3' ` shows $38.13, 89.6 min and attempt 1 (full figures); the rows of 20-1, 21-1, 21-2 and 21-4 carry `not recorded` in the wall-clock column (missing wall-clock); every story row cites a `Studio:` spec line or `not recorded` (route evidence); every story row names a handoff/spec source in its 24.1 record column and the page states the ledger observations are not on this box (24.1 record); the 20-1 row or its note says it was priced after landing (20-1 timing).
- `uv run plugins/tk-studio/lib/kb.py index --directory .` then `git diff --stat kb/index.md` -- expected: two added lines (the new record and the already-missing `acceptance-record-23-3…` page).
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: OK; `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

### pass 1 (2026-10-19)

- planned: `grep -c '^| 2[0-2]-'` reports 11 story rows / actual: 12 rows / why: the spec's Boundaries list 12 in-scope stories (20-1, 20-2, 21-1…21-6, 22-1, 22-2, 22-3, 22-5); 11 was a counting slip in Verification / may affect: none
- planned: `kb.py index` adds one line to `kb/index.md` / actual: two lines (the new record, plus the already-missing `acceptance-record-23-3…` page); generated via `kb.py index` against a temp dir named `tk-studio` symlinking this worktree's `kb/`, so the index header stays `tk-studio` rather than the worktree folder name / why: the committed index was stale, and `kb.py` takes the header from the root dir name / may affect: none
- planned: kind "under 150 changed lines → core code" / actual: "changed" read as insertions + deletions; no story is core code (20-1 = 152, 20-2 = 164), so the core band has no trial stories / why: the spec does not define "changed"; plainest reading / may affect: 24-4

DEVIATION SCORE: 1 (implementer); 2 per consult ruling (see Consult Log)

DRIFT: the verification row count is 12, not 11 — the spec's own scope list has 12 stories — affects: none
DRIFT: kb/index.md gains the stale acceptance-record-23-3 line too, generated from a `tk-studio`-named temp root — kb.py names the header after the root dir — affects: none
DRIFT: "changed lines" = insertions + deletions, so every trial story is `feature` and the core-code band is empty — the spec left "changed" undefined — affects: 24-4

### pass 2 (2026-10-19, consult patch)

- consult patch applied: the kind-rule sentence on kb/trial-record-opus-5-5.md; no new deviation. DEVIATION SCORE: 2

### pass 3 (2026-10-19, review patches)

- planned: matrix row "20-1 timing" says "priced afterwards from its transcripts (handoff 09-28:78)", plus the `story=20-` sbx command in Design Notes / actual: H0928:78 and :74 carry no pricing time, and no ledger observation can exist for 20-1/20-2 (both ancestors of the meter commit `8b83a7e`), so the record says "landed before the meter; no pricing time recorded; AC1 ledger half unmet" and the command is dropped / why: the spec's citation does not hold up / may affect: 24-4
- planned: kind rule credited to the v2 bands at kb:56-57 / actual: the record presents the line rule as its own proxy, anchored on the v2 feature band's lower bound (kb:57); the v2 kinds (kb:59-62) are semantic / why: review finding, kb:56 is the small follow-up row / may affect: 24-4

DEVIATION SCORE: 2 (implementer and consult)

DRIFT: the 20-1/20-2 rows say AC1's ledger-observation half is unmet and drop the `story=20-` operator command — both landed before the meter, and the spec's "priced afterwards from its transcripts" citation (H0928:78) does not carry that claim — affects: 24-4
DRIFT: the record's kind rule is labelled its own line-count proxy, not a v2 definition — the v2 kinds are by what a story is (kb:59-62) — affects: 24-4

### pass 4 (2026-10-19, follow-up review patch)

- planned: the I/O matrix's 24.1-record row treats every 21–22 story's ledger half as unverifiable-here / actual: 21-1 joins 20-1 and 20-2 as landed before the meter, so its ledger half is unmet and its wall-clock reason is "no observation was written" / why: `1572100` (09:55:15Z) predates `8b83a7e` (10:14:36Z), the same timing rule the pass-3 consult accepted / may affect: 24-4

DEVIATION SCORE: 0 (implementer); story stays 2

DRIFT: 21-1's row now says AC1's ledger-observation half is unmet, like 20-1/20-2 — it landed before the meter commit, under the timing rule the second consult accepted — affects: 24-4

## Consult Log

- 2026-10-19T17:26:45Z — trigger: deviation-gt-0 — question: accept the implementer's three deviations (12 rows not 11; index regenerated with the stale 23-3 line via a tk-studio-named temp root; changed = insertions + deletions so every story is feature) at score 1, score 2, or reject #2/#3? — ruling: accept-deviation score 2 — do: accept #1 and #2 unchanged (never hand-trim the generated index); accept #3 and add beside the kind rule on kb/trial-record-opus-5-5.md: "changed = insertions + deletions; under insertions only, 20-1 (+148) would be core code; the core band is empty, so the $4.4 comparison has no trial data", set DEVIATION SCORE 2; keep "may affect: 24-4" on the #3 DRIFT line — rule candidate: In the customization kind rule, define "changed lines" as git diff --shortstat insertions + deletions outside _bmad-output/ over the landed range, and derive Verification row counts from the Boundaries scope list. (observation recorded, "ok": true)
- 2026-10-19T17:35:13Z — trigger: deviation-gt-0 — question: accept the review-pass deviation (20-1/20-2 AC1 ledger half unmet, no pricing time recorded, story=20- command dropped) at score 2, 1, or reject and restore "priced afterwards from its transcripts"? — ruling: accept-deviation score 2 — do: keep the reviewer's wording and keep the story=20- command out; add the DRIFT line; DEVIATION SCORE 2; do not restore the transcripts wording — rule candidate: A spec I/O matrix cell that cites a source line must quote that line; a citation that does not carry the claim is a spec error, so the record states only what the source says and logs DRIFT. (observation recorded, "ok": true)


## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift clean; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** A follow-up review of the done kb-only story. It ran because the spec was supplied with `status: done` and the last run recommended a follow-up. `kb/trial-record-opus-5-5.md` covers the 12 Epic 20–22 stories that ran through the launch pipeline: route evidence, metered dollars, wall-clock, attempts and kind, compared by kind with the v2 table, with the caveat. This pass made one correction: 21-1 landed before the 24.1 meter (`1572100` 09:55:15Z, before `8b83a7e` 10:14:36Z). It is now treated like 20-1 and 20-2: no meter observation was written, and AC1's ledger half is unmet.

**Files changed (story total since `dcdabd2`):**
- `kb/trial-record-opus-5-5.md`: the trial record. In this pass, the 21-1 row and three Evidence-gaps bullets move 21-1 to the before-the-meter rule.
- `kb/execution-pipeline-model-routing.md`: one pointer line under "Trial in flight".
- `kb/index.md`: regenerated by `kb.py index`. It adds the new page and the stale `acceptance-record-23-3` line.
- This spec: in this pass, Design Notes and Verification were brought into line with earlier rulings, and the triage, deviation and result records were updated.

**Review (this pass):** both layers ran. 2 patches were applied (medium 1, low 1), 0 deferred and 2 rejected (see the Review Triage Log).

**Follow-up review:** not recommended (false). Patched findings this pass were high 0, medium 1, low 1, so the score is 3×1 + 1 = 4 < 5.

**Consults:** none this pass. The implementer's deviation score was 0, and no other trigger fired. The two earlier consults stand (Consult Log).

**Verification:**
- `diff .bmad-loop/routing.toml apps/supervisor/.bmad-loop/routing.toml` printed nothing. I ran it in this session.
- `grep -c '^| 2[0-2]-' kb/trial-record-opus-5-5.md` printed 12. I ran it in this session.
- I checked the commit times with `git log -1 --format='%h %aI'`: 21-1's `1572100` is at 09:55:15Z, before the meter's `8b83a7e` at 10:14:36Z; 21-2's `29af406` is at 10:23:42Z, after it.
- `uv run python -m unittest discover tests` → 1412 tests OK (2 skipped). The implementer ran this after the patch.
- `uv run python ../contracts/conformance/runner.py run` → `ok: true` (18 surfaces, 121 checks). The implementer ran this after the patch.

**Unverifiable here:** the ledger-observation half of AC1 for 21-2 to 22-5. The operator check is `sbx exec claude-tk-studio-supervisor -- sh -c "grep '\"meter: story=2[12]-' ~/.tk-studio/measurements/*.jsonl"`.

**Unmet, on record:** the ledger-observation half of AC1 for 20-1, 20-2 and 21-1. All three landed before the meter. Their 24.1 record is the metered figure in the handoffs.

**Residual risks:**
- The kind proxy leaves the $4.4 core-code band with no trial data.
- Wall-clock is not recorded for 4 of the 12 stories.
- The handoffs don't say whether v2's separately counted overheads are inside the trial dollars.
- The figures come from handoff tables, not ledger events.
- 21-2's run may have started before the meter commit. Its first commit is after it, so the record keeps it as unverifiable-here.

DRIFT: the verification row count is 12, not 11 — the spec's own scope list has 12 stories — affects: none
DRIFT: kb/index.md also gains the stale acceptance-record-23-3 line, generated from a `tk-studio`-named temp root — kb.py names the header after the root dir — affects: none
DRIFT: "changed lines" = insertions + deletions, so every trial story is `feature` and the core-code band is empty — the spec left "changed" undefined — affects: 24-4
DRIFT: the 20-1/20-2 rows say AC1's ledger-observation half is unmet, and the `story=20-` operator command is dropped — both stories landed before the meter, and the spec's "priced afterwards from its transcripts" citation (H0928:78) does not carry that claim — affects: 24-4
DRIFT: the record's kind rule is labelled its own line-count proxy, not a v2 definition — the v2 kinds are by what a story is (kb:59-62) — affects: 24-4
DRIFT: 21-1's row now says AC1's ledger-observation half is unmet, like 20-1/20-2 — it landed before the meter commit, under the timing rule the second consult accepted — affects: 24-4
