---
title: 'The Re-run Is a Whole Leg'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '961d5ee8da952d6e68f328883e4689914bef2b15'
review_loop_iteration: 0
followup_review_recommended: false
deviation_score: 1
reconcile_verdict: not-required
context:
  - '{project-root}/_bmad-output/specs/spec-epic-35/plans/35-1.md'
  - '{project-root}/_bmad-output/specs/spec-epic-35/SPEC.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** 33.8's verify verb (`POST /runs/{id}/verify`, `bun src/cli.ts verify <id>`) re-runs the host leg in a detached throwaway `.verify` worktree: it never edits the PR body (so a fixed-forward PR reads Red at merge — hole 88, DW-82) and never commits the art and proof a slice re-run places (DW-76, B9).

**Approach:** Make the re-run a whole leg by reusing the close-out's own motions: cut `.verify` on the run branch at origin's tip, run the leg, on a slice run commit + push placed art/proof via the exported `proofCommit`, regenerate the PR body through `prBody`/`prSection` (with a one-line `Legs:` history), flip ready on green / `--undo` on red, record `rerun` on the `host-verify` event. Contract 0.1.30 (additive) opens Epic 35.

**Acceptance criteria (transcribed verbatim from epics.md §Story 35.1):**

AC1. **Given** a run whose close-out ended `partial` on a red host leg and a fix pushed to its branch **When** `POST /runs/{id}/verify` runs the leg green **Then** the PR body's `## Host verify` section and its status block carry the latest leg's result (the first leg's text replaced, a one-line history of the legs kept), the PR is marked ready, and the `host-verify` event names `rerun: true`; a red re-run rewrites the section red, leaves the PR a draft and says why (`apps/supervisor/src/hostleg.ts:20, :108`)

AC2. **Given** a slice run (`type: run-vertical-slice`) **When** the re-run's assets step places art or its playable step writes proof **Then** the re-run commits and pushes them on the run's branch as the close-out does (`host leg: placed assets and proof (run <id>)`, `worktree.ts proofCommit`), so the `.verify` worktree is no longer throwaway for a slice (DW-76 decided: the re-run is a whole leg), and the per-leg proof store (`<store>/sheets/`, 34.8's DRIFT) is read by the closeout and the PR body the same way

AC3. **Given** the supervisor suites and conformance **When** they run **Then** the body rewrite, the slice re-run's commit and the ready/draft transitions are covered with fakes (`test/hostleg.test.ts`, `test/worktree.test.ts`, the `e2e_vertical_slice` drive); the contract (0.1.30, additive) names the re-run's commit and the PR-body rule; DW-76 and DW-82 close by this PR

## Boundaries & Constraints

**Always:**
- Settled shapes (planner, SPEC.md Design notes, plan §Settled shape) are binding:
  - `rerun` member stays `{by, head, worktree, pr, pr_ready?}` (present on a re-run only; `rerun: true` = its presence; the cli verb prints `rerun: true`) and gains `commit?: {sha, frames, sheet?} | "skipped: <why>" | "error: <clipped>"`, `pushed?: "<branch>" | "error: <clipped>"`, `pr_body?: "edited" | "error: <clipped>"`, `pr_draft?: "undone" | "already" | "not open" | "error: <clipped>"`.
  - First line under `## Host verify` is `Legs: <k> — ` + entries oldest first joined by `; ` (`close-out <green|red|skipped> <recorded_at>`, `re-run <green|red|skipped> <recorded_at> (by <api|cli>)`); legs = the run's `host-verify` events after its latest `launched` plus the one being written; the close-out's first body carries `Legs: 1 — close-out …`. One renderer: `prSection(v, proof?, legs?)`.
  - Status block re-rendered by `prBody` from the record (`launchedCloseOutInput`); no new field in the fenced block.
  - Slice commit condition = exactly the close-out's (`worktree.ts:545`: slice, ran leg, `assets.verdict === "green"`), via the same exported `proofCommit`, before push and body edit, on playable pass and fail alike; red slice re-run commits nothing; commit/push failure → `rerun.commit`/`rerun.pushed: "error: …"`, leg still recorded, PR left as it was.
  - Cut: `git worktree add --relative-paths -B supervisor/run-<id> <path> <origin tip>`, never detached; push `git push origin <branch>` never forced; a refusal because another worktree holds the branch is `VerifyFailed` naming it. A non-slice re-run uses the same cut and commits nothing.
- Order in `runLeg`: leg → (slice) proof commit + push → PR body rewrite + ready/draft flip → remove worktree → event.
- Red re-run "says why" = `redReason(verify)` in the body section/event.
- Lift the body-edit and flip motions out of `closeOut` into exported helpers that both `closeOut` and `hostleg.ts` call — no duplication.
- House rules: atomic writes, credentials never in events (clip/redact), stdlib-only Python, AD-11 status blocks.
- Contract bump to **0.1.30** additive; the 19 `**0.1.29**` header pins in `test_driver_contract.py` flip to `**0.1.30**`; add `test_0_1_30_story_35_1_rerun_whole_leg`.

**Block If:**
- "its status block" turns out to need a new fenced field (consult `bad_spec`, never invent).
- The developer wants to delete a stale worktree holding the branch instead of `VerifyFailed` (consult).
- `launchedCloseOutInput` yields no cost on an ended run and the body would regress from a metered figure to `not metered` with no archived cost (consult).
- The Files list must grow beyond the plan's list.

**Never:** `git push --force`; touching the run's state, `ended` event or engine (CAP-15); changing `delivery.ts`, `board.ts`, `inbox.ts`; widening the commit condition (35.3's); a second contract bump; editing epics.md, stories.yaml, the canonical plan, routing/policy toml, or anything under `implementation-artifacts/supervision/`; push/tag/PR/release.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Green re-run, draft PR | close-out red, fix pushed, PR draft | body edited (`Legs: 2 — close-out red …; re-run green … (by api)`, Green section), `gh pr ready`, `rerun.pr_ready: marked`, `rerun.pr_body: edited` | — |
| Red re-run, open ready PR | leg red | body edited red with reason, `gh pr ready --undo`, `pr_draft: undone`, no plain `pr ready` | — |
| Red re-run, already draft | leg red | body edited, `pr_draft: already` | — |
| Skipped re-run | leg skipped | section rendered skipped; no ready flip | — |
| No PR | none recorded/listed | no edit, no flip | — |
| PR not open | merged/closed | `pr_ready`/`pr_draft: not open`; body edit not attempted | — |
| Slice green assets | slice run, assets green, playable writes report | commit `host leg: placed assets and proof (run <id>)` pushed to origin branch; `rerun.commit.sha`; body embeds sheet | push fail → `pushed: "error: …"` |
| Slice red verify.host | slice, host red | nothing committed (`commit: "skipped: …"` or absent) | — |
| Stale local branch | local `supervisor/run-<id>` behind | `-B` resets to origin tip; push fast-forwards | another worktree holds it → `VerifyFailed` naming it |
| gh edit fails | `gh pr edit` exit≠0 | `pr_body: "error: <clipped>"`; leg recorded | never throws |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-35/plans/35-1.md` §Code Map) is the investigation; anchors re-confirmed 2026-10-27:

- `apps/supervisor/src/hostleg.ts` -- whole file (181 lines). Header :1-25 (rule at :18-22 rewritten); `HostLegRerun` :48-52; `markReady` :109-119 (add red twin `--undo`); `rerunHostLeg` cut :144 (`--detach` → `-B <branch>`); `runLeg` :157-181 (new order).
- `apps/supervisor/src/worktree.ts` -- `prBody` :380 (passes `legs`), `hostCommitMessage` :418, `proofCommit` :423 (export), `originWebUrl` :487 (export), slice-commit condition :545, `withBody`/`editBody` closures :579-593 and the flips :600-621 (lift into exported helpers), `launchedCloseOutInput` :656 (exported; body input for the re-run).
- `apps/supervisor/src/hostverify.ts` -- `redReason` :662, `PrProof` :688, `prSection` :690 (gains `legs?`; `LegHistoryEntry` type), `recordedVerify` ~:684 (latest-after-launched rule).
- `apps/supervisor/src/api.ts` :25-30, `apps/supervisor/src/cli.ts` ~:2602-2626 `verifyVerb` -- comments + new printed `rerun` fields.
- `apps/supervisor/test/hostleg.test.ts` -- `fixture()` :27-85 (gh fake: add `pr edit` capturing the body file inside the fake, `pr ready --undo`); AC1 tests :104 green, :133 red, :143 PR states, :154 no PR; 34.8 block :316-332. Slice fakes recipe: `test/worktree.test.ts:2112-2260`, `test/hostverify.test.ts:861+`.
- `apps/supervisor/test/worktree.test.ts` -- close-out body cases :516-1100; proof commit :2112-2260.
- `plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py` :39-40 (`SUITES`, `FILTER`); `manifest.json` :153-159 (`note`, `timeout: 120`).
- `plugins/tk-studio/contracts/driver-contract.md` -- line 5 header cell, line 6 rulings, 0.1.28 paragraph :377-404 (leave), slice host-leg paragraph :1487-1530 (add the 0.1.30 paragraph after).
- `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 19 `**0.1.29**` pins; `test_0_1_29_story_34_8_vertical_slice` `assertNotIn("**0.1.30**")` must move.
- `_bmad-output/implementation-artifacts/deferred-work.md` DW-76 :587-593, DW-82 :635-641; `kb/agent-pc-setup-runbook.md` :1292 row, :890-930 recipe.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- `LegHistoryEntry` type; `prSection(v, proof?, legs?)` renders the `Legs:` line first under the heading.
- `apps/supervisor/src/worktree.ts` -- export `proofCommit`, `originWebUrl`; lift `editPrBody` and the ready/`--undo` flips into exported helpers used by `closeOut`; `prBody` takes and passes `legs`; close-out's first body carries `Legs: 1 — close-out …`.
- `apps/supervisor/src/hostleg.ts` -- cut with `-B` on the run branch; slice commit + push; body rewrite via `prBody(launchedCloseOutInput(...), commits from git log base_ref..HEAD, legs)`; green ready / red `--undo`; new `rerun` fields; header comment.
- `apps/supervisor/src/cli.ts`, `apps/supervisor/src/api.ts` -- print `rerun: true` + new fields; comments.
- `apps/supervisor/test/hostleg.test.ts`, `apps/supervisor/test/worktree.test.ts` -- tests named `Story 35.1: …` covering every I/O row (body rewrite text, both flips, slice commit on origin tip with proof folder + art, `-B` cut on a stale branch, the history line, helpers).
- `plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py`, `manifest.json` -- add `test/hostleg.test.ts`, filter `Story 34.8|Story 35.1`, note; stay under 120 s.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py` -- 0.1.30 bump + paragraph; pins + new test.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-76, DW-82 `status: resolved 2026-10-27 by this story's PR (35.1: …)`.
- `kb/agent-pc-setup-runbook.md` -- `host-verify` row and fix-forward recipe updated.

**Acceptance Criteria:** AC1–AC3 above, each proven by a named `Story 35.1` test or the gate output.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 1, medium 1, low 5)
- defer: 0
- reject: 3: (low 3)
- addressed_findings:
  - `[high]` `[patch]` green re-run marked a draft ready after a failed `gh pr edit` (a ready PR over a Red body, hole 88) — consult F1: ready only when `pr_body: edited`, red `--undo` regardless; tests updated/added
  - `[medium]` `[patch]` `-B` cut silently reset a local run branch holding commits not on origin — consult F2: `VerifyFailed` naming the branch and `git log --oneline <tip>..<local>`; test added; contract + runbook clause
  - `[low]` `[patch]` contract 0.1.30 said "a red slice re-run commits nothing", contradicting playable-fail-still-commits — reworded to the settled shape
  - `[low]` `[patch]` contract cost fallback named an unreachable "read fails" branch — aligned with the code
  - `[low]` `[patch]` held-branch refusal test passed on the fixed phrase — the message names the holding worktree's path, asserted
  - `[low]` `[patch]` no test for a failed slice proof commit — `commit: error: …`, nothing pushed, PR untouched, leg recorded
  - `[low]` `[patch]` a `gh pr view` error on a skipped re-run was dropped — recorded as `pr_body: error: gh pr view …`
- rejected: metered cost "thrown away" when the worktree exists (`launchedCloseOutInput` already reads it into `costUsd`, worktree.ts:689); the Legs entry's `recorded_at` vs the event's `at` differ by the leg's tail seconds (cosmetic; `Queue.note` takes no `at`, queue.ts:2180, outside Files); the slice drive's `BOUND_S` (measured 3.9 s against 60 s)

### 2026-10-28 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 1, medium 1)
- defer: 0
- reject: 2: (low 2)
- addressed_findings:
  - `[high]` `[patch]` a red slice re-run whose proof commit or push failed skipped the red `--undo`, leaving a ready PR over a stale Green body (hole 88) — consult (high-severity-finding) reading (ii): red still reads `prState` and `--undo`es an open ready PR (`pr_draft`), no body edit, `pr_body` unset; green with a failed commit/push unchanged; test added
  - `[medium]` `[patch]` a failed push left the local run branch one supervisor commit ahead of origin, so every later re-run was `VerifyFailed` (F2's refusal) — consult reading (ii): `git reset --hard <cut tip>` in the `.verify` worktree on a push failure after a real commit (a failed reset appended to `pushed`); test that the next re-run is not refused; contract 0.1.30 paragraph, runbook recipe and contract-test pins reworded (no new value)
- rejected: the cost carry-back overriding a record figure with an old `not metered` (unreachable: the close-out rendered the same record-only figure when no metered cost was read, worktree.ts:693-705, and the consult ruling chose carry-back); the 0.1.30 header clause omitting F1/F2 (a summary, not a contradiction; the paragraph states and pins both)

### 2026-10-28 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (low 1)
- defer: 0
- reject: 8: (low 8)
- addressed_findings:
  - `[low]` `[patch]` contract 0.1.30 contradicted itself when a red slice re-run's commit/push failed and `gh pr view` also failed ("`pr_body` unset" vs "`pr_body: error: gh pr view …` whatever the verdict"); the code follows the consult-ruled reading (unset) — the unreadable-state clause now states that after a failed commit or push `pr_body` stays unset and only a red leg's `pr_draft` carries the error; one phrase pin added to `test_0_1_30_story_35_1_rerun_whole_leg`; no new value, version unchanged
- rejected: metered cost "read and thrown away" (`launchedCloseOutInput` reads it into `costUsd`, worktree.ts:698-699; rejected before); `Legs:` `recorded_at` vs the event's `at` (cosmetic, rejected before); the slice drive's bound (measured ~8 s against `BOUND_S` 60; the manifest note's coverage claims are hostleg.ts cases, which are in `SUITES`); rollback only on a failed push (`proofCommit` cannot throw after its `git commit`: the later `rev-parse` failure yields `sha: "committed"`, which still takes the reset path, worktree.ts:490-497); a crash between the proof commit and the push leaves the branch ahead (recorded residual risk; auto-resetting a branch ahead would contradict consult F2); no test for the failed-rollback `; local branch left ahead` suffix (plumbing on a double-failure path); no red commit-refused `--undo` test (the same `!committed.ok && isRed` branch the push-refused test drives); the verb's printed fields unasserted (plumbing; AC1 names the event); the 0.1.30 header summary omitting the ahead-branch refusal (rejected before)

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && ~/.bun/bin/bun test test/hostleg.test.ts test/worktree.test.ts test/hostverify.test.ts test/status-block.test.ts` -- expected: all pass
- `cd apps/supervisor && ~/.bun/bin/bun test` -- expected: no new failures vs baseline
- `uv run python plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py` (project root) -- expected: ok

**Environment (this box):** bun lives at `~/.bun/bin`; run every bun command with `export PATH=$HOME/.bun/bin:$PATH` (the test fakes' `#!/usr/bin/env bun` shebangs need it; without it ~200 tests fail spuriously). `node_modules` is installed (`bun install --frozen-lockfile --backend=copyfile`). Baseline at `baseline_revision`: whole suite 1459 pass / 83 skip / 25 fail — the 25 are pre-existing (Story 32.8 delivery tests, hole 84 / 35.5, and the sbx `invokeSkill`/release tests), listed in `/tmp/bun-baseline-35-1-fails.txt`; the four named story files are not among them. "No new failures" = the post-change fail set is a subset of that list.

## Deviation Summary

### pass 1 (2026-10-28, implementer)

- planned: flip "the 19 `**0.1.29**` header pins" / actual: 27 `assertIn("**0.1.29**", header)` pins plus the semver regex pin flipped to 0.1.30; the 7 Epic 34 `assertNotIn("**0.1.30**")` became `assertNotIn("**0.1.29**")`; the new test carries `assertNotIn("**0.1.31**")` / why: the plan's count was low; every header pin fails after the bump / may affect: later Epic 35 stories extending 0.1.30 (pins only)
- planned: plan text names `host_commit?` / actual: the settled shape's `rerun.commit` (+ `pushed`, `pr_body`, `pr_draft`) / why: settled shape binding over plan prose / may affect: none
- planned: red "says why" in the section/event, no field named / actual: top-level `reason: redReason(verify)` on a red re-run's event (as a skipped leg's `reason`), printed by the verb; `rerun` shape unchanged / why: the binding `rerun` shape has no reason field / may affect: 35-6
- planned: lift body-edit and flips into exported helpers / actual: also exported `withBodyFile` shared by `pr create` and `editPrBody` / why: one temp-file motion / may affect: none
- planned: (unspecified) `gh pr view` failure / actual: no body edit, error on `pr_ready`/`pr_draft`, as "not open" / why: unknown state is not treated as open / may affect: none

DRIFT: contract-test pin count 27+regex, not 19 — the bump fails every header pin — affects: none
DRIFT: red re-run's reason is a top-level `reason` on the `host-verify` event — the settled `rerun` shape has no reason field — affects: 35-6
DRIFT: `withBodyFile` exported beside `editPrBody` — one temp-file motion for create and edit — affects: none
DRIFT: a failed `gh pr view` skips the body edit — unknown PR state is not treated as open — affects: none

### pass 2 (2026-10-28, implementer, consult ruling applied)

- planned: carry the old `## Metered cost` back "when the run's worktree is gone" / actual: whenever no metered cost is read (worktree gone, or present without `run.json`) / why: the ruling's own condition ("so `launchedCloseOutInput` cannot read a metered cost") / may affect: none
- planned: a failed read falls back to the record-only figure / actual: a failed `gh pr view` edits no body (D5's rule), the record-only figure used only when the old body has no section / why: an unreadable PR is never edited / may affect: none

DRIFT: re-run body carries the old `## Metered cost` back when no metered cost is readable — consult ruling (ii), the record would regress the figure — affects: none

### pass 3 (2026-10-28, implementer, review patches)

- planned: patches 3/4 contract text only / actual: `test_0_1_30_story_35_1_rerun_whole_leg` pins updated (the removed phrase, plus pins for the F1, F2, cost and `gh pr view` clauses) / why: the pinned phrase was the one patch 3 corrected / may affect: none
- planned: change the ~:398 test for F1 / actual: plus a test that a red re-run with a failed edit still `--undo`es / why: the ruling's other half / may affect: none

Pass 3 was not consulted again: both entries are mechanical consequences of the second consult's applied ruling, which this score-1 class already covers (never consult twice on the same question).

DRIFT: green ready-flip skipped when the body edit failed — consult F1, a ready PR must not carry a stale Red body — affects: none
DRIFT: a local run branch ahead of origin refuses the re-run `VerifyFailed` — consult F2, `-B` would orphan unpushed run work — affects: none

### pass 4 (2026-10-28, implementer, follow-up review patches)

- planned / actual: both consult-ruled patches as instructed (hostleg.ts, hostleg.test.ts, contract 0.1.30 paragraph wording + its test pins, runbook recipe); all within the plan's Files / why: — / may affect: none. Implementer deviation score 0.

DRIFT: a red slice re-run whose commit or push failed still `--undo`es the PR (body untouched), narrowing the settled "PR left as it was" to the body and the green flip — follow-up consult B, hole 88 — affects: none
DRIFT: a failed push rolls the re-run's own proof commit back to the cut tip — follow-up consult A, else F2 refuses every retry — affects: none

### pass 5 (2026-10-28, implementer, follow-up review 2 patch)

- planned / actual: contract 0.1.30 wording for the stacked failed-commit/push + unreadable-PR case, plus one test pin; only `driver-contract.md` and `test_driver_contract.py`, both in the plan's Files / why: — / may affect: none. Implementer deviation score 0.

## Consult Log

- 2026-10-28T00:18Z — trigger: deviation-gt-0 — question: accept D1–D5 (D3 top-level `reason` on a red re-run's event) and rule on the Block-If cost fallback (record-only vs read-back of the PR body's `## Metered cost`) — ruling: accept-deviation score 1 — do: keep D1–D5 as implemented, each score 1; option (ii): when the run's worktree is gone and `launchedCloseOutInput` reads no metered cost, carry the existing PR body's `## Metered cost` section back unchanged from `gh pr view <pr> --json body`, the record-only figure only when the old body has no such section or the read fails; add one hostleg test (ended run, no worktree, PR body with a metered figure, rewritten body keeps it) — rule candidate: a re-run that rewrites a PR body keeps any section it cannot rebuild from records by reading that section back from the live body; it never swaps in a smaller or missing figure
- 2026-10-28T00:29Z — trigger: high-severity-finding — question: (F1) green re-run with a failed `gh pr edit`: mark ready anyway or leave the PR as it was; (F2) `-B` over a local run branch ahead of origin: reset or refuse — ruling: apply — do: F1 reading (b): `markPrReady` only when `rerun.pr_body === "edited"`, else PR left as it was with `pr_ready` unset (no new value), red `--undo` regardless; test ~:398 asserts no `gh pr ready`/no `pr_ready`. F2 reading (b): before the cut, a local `supervisor/run-<id>` not an ancestor of origin's tip → `VerifyFailed` naming the branch and `git log --oneline <tip>..<local>`; behind/equal moved by `-B`; a `Story 35.1:` test for branch-ahead. Record both as rulings, no new contract value — rule candidate: in host-leg PR motions a failed earlier step skips the green ready-flip but never the red `--undo`, and a re-run never moves a local run branch that is not an ancestor of origin's tip

- 2026-10-28T00:47Z — trigger: high-severity-finding — question: follow-up review: (B) a red slice re-run whose proof commit/push fails skips the red `--undo` (ready PR over a stale Green body); (A) a failed push leaves the local run branch ahead so every later re-run is `VerifyFailed` — ruling: apply — do: B reading (ii): on `committed.ok` false and a red leg, still read `prState` and `markPrDraft` an open ready PR (`pr_draft` undone/already/not open/error), no body edit, `pr_body` unset; green with a failed commit/push untouched; a `Story 35.1:` test (ready PR, red slice re-run, failed push → one `gh pr ready --undo`, no `gh pr edit`, `pr_draft: undone`). A reading (ii): on a push failure after a real commit, `git reset --hard <at.head>` in the `.verify` worktree before returning; `rerun.pushed`/`rerun.commit.sha` kept; a failed reset appends `; local branch left ahead: <clipped>` to `pushed`; a test that a second re-run after a failed push is not `VerifyFailed`; no new contract value; one header sentence — rule candidate: a host-leg re-run rolls back its own unpushed proof commit to the tip it was cut at before it releases the branch, and on a red leg always attempts `--undo` whatever earlier step failed; only the body edit and the green ready-flip depend on earlier steps succeeding

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was the second follow-up review pass on the committed story (d7f8804, 28f9091). The re-run is a whole leg. It cuts `.verify` on `supervisor/run-<id>` at origin's tip with `-B`. On a green-assets slice run it commits and pushes the placed art and proof through `proofCommit`. It then rewrites an open PR's body through `prBody`, with the `Legs:` history line. It marks the PR ready on green after a successful edit and `--undo`es on red. Finally it records `rerun` on the `host-verify` event. Contract 0.1.30 holds; DW-76 and DW-82 are resolved. In this pass the code did not change. The only fix was the contract text: it now says which rule wins when a failed commit or push and an unreadable PR happen together.

**Files changed (this pass)**
- `plugins/tk-studio/contracts/driver-contract.md`: 0.1.30 paragraph. The unreadable-PR clause now excludes the failed-commit/push path, where `pr_body` stays unset. No new value, and the version is unchanged.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: one phrase pin added to `test_0_1_30_story_35_1_rerun_whole_leg`.
- Story files from earlier passes (unchanged here): `hostleg.ts`, `worktree.ts`, `hostverify.ts`, `api.ts`, `cli.ts`, `hostleg.test.ts`, `worktree.test.ts`, `e2e_vertical_slice.py`, `manifest.json`, `driver-contract.md`, `test_driver_contract.py`, `deferred-work.md`, `agent-pc-setup-runbook.md`.

**Review findings (this pass).** 1 patch applied (low 1). None deferred. 8 rejected (low 8). Both layers ran (band L). Both reviewers raised the patched finding; it is merged here. See the Review Triage Log.

**Follow-up review recommendation:** false. Patched counts were high 0, medium 0, low 1, giving a score of 3×0 + 1×1 = 1.

**Verification** (all re-run by this session)
- `uv run python -m unittest discover tests` (lib): 2367 tests, OK (2 skipped).
- `uv run python ../contracts/conformance/runner.py run`: `ok: true`, `failures: []`.
- `cd apps/supervisor && bun test test/hostleg.test.ts test/worktree.test.ts test/hostverify.test.ts test/status-block.test.ts`: 224 pass, 2 skip, 0 fail.
- `uv run python plugins/tk-studio/contracts/conformance/e2e_vertical_slice.py`: `ok: true` on every step, about 8 s against `BOUND_S` 60.
- The whole `bun test` suite was not re-run: no TypeScript changed in this pass. The previous pass measured 25 failures, all pre-existing (they match `/tmp/bun-baseline-35-1-fails.txt`).

**Residual risks**
- If the process is killed between the proof commit and the push, the local branch is left ahead. The next re-run is then `VerifyFailed`, naming the branch and the commit (F2), and an operator runs `git branch -f supervisor/run-<id> origin/supervisor/run-<id>`.
- A `Legs:` entry's `recorded_at` for the leg being written can differ from the event's `at` by the leg's tail seconds. This is cosmetic.
- AC3's "DW-76 and DW-82 close by this PR" is `unverifiable-here`. The operator opens the PR (`gh pr create` from this branch) and fills `#N` into both DW status lines.

DRIFT: contract-test pin count 27+regex, not 19 — the bump fails every header pin — affects: none
DRIFT: red re-run's reason is a top-level `reason` on the `host-verify` event — the settled `rerun` shape has no reason field — affects: 35-6
DRIFT: `withBodyFile` exported beside `editPrBody` — one temp-file motion for create and edit — affects: none
DRIFT: a failed `gh pr view` skips the body edit — unknown PR state is not treated as open — affects: none
DRIFT: re-run body carries the old `## Metered cost` back when no metered cost is readable — consult ruling (ii), the record would regress the figure — affects: none
DRIFT: green ready-flip skipped when the body edit failed — consult F1, a ready PR must not carry a stale Red body — affects: none
DRIFT: a local run branch ahead of origin refuses the re-run `VerifyFailed` — consult F2, `-B` would orphan unpushed run work — affects: none
DRIFT: a red slice re-run whose commit or push failed still `--undo`es the PR (body untouched), narrowing the settled "PR left as it was" to the body and the green flip — follow-up consult B, hole 88 — affects: none
DRIFT: a failed push rolls the re-run's own proof commit back to the cut tip — follow-up consult A, else F2 refuses every retry — affects: none

## Reconcile

- 2026-10-28 — score 1; reconcile not required. (One DRIFT names 35-6: a red re-run's reason is a top-level `reason` on the `host-verify` event; 35-6's planner reads it from this spec.)
- Gate: Part A not-required; Part B story accepted, planned 35-2-every-story-gets-its-plan-and-its-records
