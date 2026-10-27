---
title: 'A Stale Render View Never Halts a Story'
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: '8d6345f9e0ae8bc903242510ffcaebf60e7b7175'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-6.md'
warnings: [oversized]
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** Inside the sandbox a freshly rendered skill snapshot (`_bmad/render/<skill>/<slug>/<generation>/`) can look half-written across the sbx mount while the host sees it complete (hole 65). The dev session HALTs, writes a `blocked` spec, and bmad-loop pauses the run on a CRITICAL escalation that waits for an operator.

**Approach:** The supervisor's paused-run pass (`closeOutPaused`) recognises that one halt before the 31.5 block logic runs. It removes the snapshot folder and the untracked `blocked` draft, resumes once through `resumePaused`, records `auto-resume` and sends one notifier line. A second such pause on the same story is left for the operator. No upstream skill is forked.

**Story acceptance criteria (verbatim, epics.md Story 33.6):**
- AC1: **Given** a run paused on a CRITICAL escalation whose reason says the skill render failed and names the snapshot folder under `_bmad/render/` **When** the paused-run pass runs and the host sees that folder complete (every file the manifest names is present and non-empty) **Then** the pass removes the snapshot folder and the dev session's untracked `blocked` spec draft, resumes the run once (`POST /runs/{id}/resume`'s path), records `auto-resume {reason: stale-render-view, snapshot, attempt: 1}` and notifies one line; a second such pause on the same story is left for the operator with the reason naming the first attempt; the upstream skills are untouched (no fork)
- AC2: **Given** the pass **When** it is tested **Then** `bun test` covers the recognition (the reason text, the folder check), the single-attempt rule and the untouched other pauses with fixtures; the runbook's hole-65 row names the behaviour

## Boundaries & Constraints

**Always:**
- Follow `plans/33-6.md` §Settled shape 1–5 exactly: the recognition, the folder check, the single-attempt rule, the three lines and the unchanged `{closed, awaiting}` return.
- The recognition runs before `devBlocked`/`escalationBlocked` in `closeOutPaused`. A declined attempt 2 falls through to the 31.5 block logic unchanged.
- The resume runs under the close-out lease, through an injectable `PausedDeps.resume` that defaults to `resumePaused`. `ResumeRefused` is caught and recorded, never thrown.
- Deletion is bounded to one folder under `<servedRoot>/_bmad/render/` (`isWithin` after `resolve`) and one untracked spec, and only after the full recognition and the folder check pass. Git is called with argv only.
- Tests use `test/tmp.ts` `tempDir`, never `mkdtempSync`.

**Block If:**
- bmad-loop's resume refuses a re-armed escalation whose spec was removed.
- The recognition needs a field that the `paused` event does not carry.
- The Files list must grow, for example a `queue.ts`, office or page change.

**Never:**
- Edit `.claude/` or `_bmad/` (no upstream skill or renderer fork).
- Change `closeout.test.ts`, `hygiene.ts`, `cli.ts`, `office.ts`, `page.ts`, `queue.ts` or `worktree.ts`.
- Compare hashes in the folder check.
- Bump the contract version.
- Put anything in a line beyond the run id, the story key, the snapshot path and the time.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Attempt 1 | Escalation pause; reason quotes a renderer message and one snapshot path; host folder complete; draft `blocked` and untracked | The folder and the draft are removed; `resume` is called once; `auto-resume {reason, snapshot, story_key, engine_run_id, attempt: 1, resumed: true, notify}`; one line; no `track-block` | — |
| Refused resume | As above, but `resume` throws `ResumeRefused` | `resumed: false`, `error: "<code>: <detail>"`, the refused line; the run stays paused; the next pass does not resume again | Caught, recorded |
| Attempt 2 | A new `paused` event on the same story after attempt 1 | One `attempt: 2` event with `first_at` and one line; nothing removed or resumed; then the 31.5 block logic runs; a third pass adds nothing | — |
| Incomplete folder | A manifest output is missing or empty; the manifest is unparsable; `outputs` is empty | Nothing is removed, resumed or recorded by this step; today's behaviour | — |
| Not this halt | Another stage; no dev-session prefix; two distinct folders; `..` or outside `_bmad/render/`; a tracked spec, or one that is not `blocked` | Today's behaviour, exactly | — |
| Removal fails | `rmSync` throws | No event; no resume; the next pass retries | Swallowed |

</intent-contract>

## Code Map

The plan's Code Map (`plans/33-6.md`) is the investigation. Its anchors were confirmed on 2026-10-27:
- `apps/supervisor/src/closeout.ts` -- `pausedStory` :92, `frontmatter` :101, `findSpec` :118, `storySpec` :145, `PausedDeps` :194, `devBlocked` :431, `escalationBlocked` :446, `awaitRuling` :487 (the notifier and `none`-skip precedent), `closeOutPaused` :510 (the lease, the `not-landed` branch, the `finally` release), `resumePaused` :610.
- `apps/supervisor/src/hygiene.ts` -- `isWithin` :78, `NOTICE_MAX_BYTES` :167, `sendText`, `claimRefusedLine` :283 (the one-line clip precedent). Import only.
- `apps/supervisor/src/worktree.ts` -- `runner(deps)` :99 (argv-only git). Import only.
- `apps/supervisor/src/resolution.ts:58,155` -- the precedent for an injectable resume.
- `apps/supervisor/test/closeout.test.ts` -- fixtures `pausedRun` :49, `passDeps` :88, `kinds`/`ev` :131/:144; the 31.5 escalation baseline :742-790. Read only.
- `apps/supervisor/test/tmp.ts` -- `tempDir`.
- `apps/supervisor/README.md:140-145`; `plugins/tk-studio/contracts/driver-contract.md` (the 0.1.28 paragraphs near :264/:298); `kb/agent-pc-setup-runbook.md` §8 hole rows (:1358-1363).
- Upstream (read only): `_bmad/scripts/render_skill.py` `_verify_existing` messages; the pause reason is `CRITICAL escalation from dev session: <Auto Run Result body ≤2000 chars>`.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/closeout.ts` -- add the header outcome bullet; add the exported `staleRenderView`, `snapshotComplete` and line composers; add `PausedDeps.resume`; add the step in `closeOutPaused` before the 31.5 block -- AC1.
- `apps/supervisor/test/autoresume.test.ts` -- add the new suite covering every case in plan §Verify "Tests to write" -- AC2.
- `apps/supervisor/README.md` -- add one sub-bullet under the paused-run pass -- documents AC1.
- `plugins/tk-studio/contracts/driver-contract.md` -- add a `**0.1.28 (Story 33.6, additive).**` paragraph for `auto-resume` (its shape, the once-per-story rule, the line); no version bump -- AD-19.
- `kb/agent-pc-setup-runbook.md` -- add a §8 hole-65 row beside hole 62, with the text in plan §Files -- AC2.

**Acceptance Criteria:**
- Given the five files changed, when `git diff --stat -- .claude _bmad` runs, then it is empty.
- Given the change, when the studio gate and the per-file `bun test` runs execute, then all are green, `closeout.test.ts` is unchanged, and the count of `tk-sup-*` folders in /tmp does not grow.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 4, low 4)
- defer: 0
- reject: 2 (high 0, medium 1, low 1)
- addressed_findings:
  - `[medium]` `[patch]` A partial removal was never retried. The folder is now renamed aside first, the draft is removed with a rename-back on failure, and the copy is deleted best effort. Tests cover a failed rename and a failed draft removal.
  - `[medium]` `[patch]` Any non-zero `git ls-files --error-unmatch` exit counted as untracked. Now only exit 1 does; exit 128, a timeout and a non-repo are not recognised (tested).
  - `[medium]` `[patch]` The default `resumePaused` path under the held close-out lease was untested. A test with the un-injected resume now shows `engine-resume`, `running` and `resumed: true`.
  - `[medium]` `[patch]` The runbook's hole-65 operator step omitted the untracked `blocked` draft. The row now says to remove both, then resume.
  - `[low]` `[patch]` The renderer-message list was never tested on its own. Each of the four messages is now tested without a `render_skill.py` mention, plus a negative case.
  - `[low]` `[patch]` A trailing sentence period broke the folder match, and `_bmad` had no left boundary. Both are fixed and tested.
  - `[low]` `[patch]` A bound project with an incomplete folder was untested. That test is added, and the misnamed "incomplete snapshot" test is renamed.
  - `[low]` `[patch]` The closeout.ts header's outcome count was stale. It is fixed.
- rejected:
  - Deleting the snapshot without a tracked check: `_bmad/render/` is gitignored (.gitignore:9), and the plan bounds the deletion to it.
  - A failed attempt-1 `queue.note` is swallowed: this follows the `/* not recorded */` precedent (closeout.ts:329,655). A failing queue write is systemic plumbing, not this story's behaviour.

### 2026-10-27 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 0, low 3)
- defer: 0
- reject: 4 (high 0, medium 1, low 3)
- addressed_findings:
  - `[low]` `[patch]` `closeOutPaused` read the attempt events before `takeForCloseOut`, so a concurrent pass (serve and the sweep) could record a duplicate `attempt: 2` event and line for one pause. The pass now re-reads the events under the lease and re-derives the attempt. Two race tests are added.
  - `[low]` `[patch]` The default-resume test waited on a fixed `Bun.sleep(20)` for the hand-back's `launched` event. It now polls for up to 5 s.
  - `[low]` `[patch]` The two chmod-based removal-failure tests failed when run as root. They now also skip when `process.getuid?.() === 0`.
- rejected:
  - A refused resume leaves a bound project with no Jira block. The spec's "Refused resume" matrix row pins this outcome: the run stays paused, the refused line is sent, and the draft is already removed per AC1.
  - The attempt-1 record is written last, after the removal, the resume and the notify. Settled shape 3 pins one attempt-1 event that carries `resumed` and `notify`, which forces this order. A second resume needs a supervisor crash in that window or a failing queue write, both systemic.
  - Fall through to the 31.5 block when a removal keeps failing. The "Removal fails" matrix row pins "No event".
  - Add "generation collision or corruption at" to the recognised messages. Plan §Settled shape 1 pins the four `_verify_existing` messages (plans/33-6.md:23-28,55). A `render_skill.py` mention is still recognised.

## Design Notes

The single-attempt key is any `auto-resume` event with this `story_key` and `attempt: 1`, regardless of the engine run id. The attempt-2 record is idempotent per pause: it is written at most once since the latest `paused` event. The draft is the spec at the served root, which is the host side of the same mount (answers SPEC Open Question 3).

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && for f in test/autoresume.test.ts test/closeout.test.ts test/resume.test.ts; do d=$(mktemp -d); TMPDIR=$d ~/.bun/bin/bun test $f; rm -rf $d; done` -- expected: all pass
- `cd apps/supervisor && ~/.bun/bin/bun x tsc --noEmit` -- expected: no errors
- `git diff --stat -- .claude _bmad apps/supervisor/test/closeout.test.ts` -- expected: empty

## Deviation Summary

### pass 1 (2026-10-27, implementer)
- planned: `staleRenderView(run, events)`, synchronous and read-only / actual: `staleRenderView(run, events, deps = {})` returning a Promise / why: the untracked check needs the async argv-only git runner from deps / may affect: none
- planned: after a declined attempt 2 the 31.5 block logic runs unchanged / actual: one line changed to `const run = taken ? queue.get(r.run_id) : queue.takeForCloseOut(r.run_id, self)` / why: attempt 2 already holds the close-out lease, and a second `takeForCloseOut` by the same live owner is refused, which would skip the block / may affect: none
- planned: a one-line clip done the way `claimRefusedLine` does it / actual: a local `oneLine` byte-clip in closeout.ts that reuses the exported `NOTICE_MAX_BYTES` and `TRUNCATED_MARKER` / why: `clipBytes` is not exported and hygiene.ts may not change / may affect: none

DEVIATION SCORE: 1

DRIFT: `staleRenderView` takes deps and is async — the untracked git check is async via the deps runner — affects: none
DRIFT: the 31.5 block reuses the lease attempt 2 already holds instead of taking it again — a same-owner re-take is refused — affects: none
DRIFT: a local `oneLine` clip in closeout.ts instead of hygiene's unexported `clipBytes` — hygiene.ts is read-only for this story — affects: none

### pass 2 (2026-10-27, implementer, tests only)
- Test-only: the removal-fails test locks the snapshot folder and its `references/` subfolder (0o555), not the snapshot's parent folder. With only the parent locked, the recursive delete removes the files before it fails, so the retry cannot be shown. This is not a spec deviation, and no DRIFT line is added.
- The consult's DO is applied: the attempt-2 test asserts the 31.5 `track-block` on the leased run and the lease's release.

### pass 3 (2026-10-27, implementer, review patches)
- planned: plan §Settled shape 3 removes the snapshot folder with a recursive `rmSync`, then the draft / actual: the folder is first renamed aside atomically to a sibling `<generation>.stale-<pid>-<ms>`; then the draft is removed, and the folder is renamed back if that fails; then the renamed folder is removed best effort / why: a partial recursive delete, or a failed draft delete after the folder is gone, defeats the next pass's recognition, which contradicts the plan's "the next pass tries again" (review finding) / may affect: none. The end state matches §Settled shape 3; a best-effort `<generation>.stale-<pid>-<ms>` sibling may remain under the gitignored `_bmad/render/`.
- Test-only: the default-resume test injects `spawn`/`pidPolls`/`sleep`, cast into `PausedDeps`, because `resume.test.ts` has no `resumePaused` fakes. The removal-fails tests lock the snapshot's parent folder or the spec's parent folder (POSIX; skipped on win32). These are not spec deviations.

DEVIATION SCORE: 1

DRIFT: the snapshot is renamed aside before it is deleted, with a rollback if the draft removal fails — a plain recursive delete could not keep "a failed removal retries on the next pass" — affects: none

### pass 4 (2026-10-27, implementer, follow-up review patches)
- planned: after the take, re-check the events and, if attempt 1 now exists, behave as the attempt-2 path would / actual: also requires `snapshotComplete(s.dir)` before `noteSecondHalt` on the post-take attempt-2 path / why: a pass that loses the race to a concurrent attempt 1 whose resume was refused would otherwise record `attempt: 2` and send a line naming a snapshot already removed. A fresh pass stops at the same guard (consult: accept-deviation score 1).
- Test-only: the two race tests wrap `fx.queue.takeForCloseOut` so that it records the competing `auto-resume` event first, then delegates.

DEVIATION SCORE: 1

DRIFT: post-take attempt 2 also requires the snapshot to still be complete, the same guard a fresh pass applies, so a pass that loses the race to a refused attempt 1 records nothing — affects: none

## Consult Log

- 2026-10-27T01:12:33Z — trigger: deviation-gt-0 — question: accept or reject the three pass-1 deviations (async staleRenderView with deps; reusing the attempt-2 lease in the 31.5 path; a local oneLine clip) — ruling: accept-deviation score 1 — do: keep all three as implemented; add a test that after attempt 2 the 31.5 block still records on the leased run and the lease is released at the end of the pass; record the deviations with their reasons, and do not change hygiene.ts — rule candidate: when a plan says "as <private helper> does" and makes that helper's file import-only, a local copy built on the exported constants conforms at score 1; a step that already holds the close-out lease passes it on instead of calling takeForCloseOut again
- 2026-10-27T01:22:38Z — trigger: deviation-gt-0 — question: accept or reject the pass-3 review patch that renames the snapshot aside before removal (rollback when the draft removal fails), plus two test-only deviations — ruling: accept-deviation score 1 — do: keep the rename-aside, then remove the draft, then best-effort remove sequence and the two test-only deviations; record that the end state matches §Settled shape 3 and that a best-effort `<generation>.stale-<pid>-<ms>` sibling may remain under the gitignored `_bmad/render/` — rule candidate: a destructive multi-step removal that must be retryable may rename aside, roll back on failure and best-effort delete without a consult (score 1), when the leftover stays inside the plan's delete bound
- 2026-10-27T01:31:47Z — trigger: deviation-gt-0 — question: accept or reject the follow-up patch's extra `snapshotComplete(s.dir)` re-check before `noteSecondHalt` on the post-take attempt-2 path — ruling: accept-deviation score 1 — do: keep the post-take re-check exactly as written; record it as score 1 with the reason "post-take attempt 2 also requires the snapshot to still be complete, the same guard a fresh pass applies, so a pass that loses the race to a refused attempt 1 records nothing"; keep both race tests, no other change — rule candidate: When a check is repeated after taking the close-out lease, repeat every guard of the fresh-pass path, not just the event-log checks, so a pass that loses a race acts exactly as a fresh pass would

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version) | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a follow-up review pass of the committed story (`090fd92`). The supervisor's paused-run pass (`closeOutPaused`) auto-resumes a dev-session halt on a stale render view once per story. It removes the snapshot folder under `<servedRoot>/_bmad/render/` and the untracked `blocked` draft, resumes through `resumePaused` under the close-out lease, and records `auto-resume` with `attempt: 1` plus one line. A second such pause records `attempt: 2` and one line, then falls through to the 31.5 block logic. This pass makes the attempt checks race-safe under the lease and removes two test fragilities.

**Files changed (this pass):**
- `apps/supervisor/src/closeout.ts`: the attempt-1 and attempt-2 branches are merged into one lease take that re-reads the events, then re-derives the attempt and the snapshot guard.
- `apps/supervisor/test/autoresume.test.ts`: two race tests; the default-resume test polls for up to 5 s instead of sleeping 20 ms; the chmod tests skip when run as root.

**Files changed (story total since `8d6345f`):** `apps/supervisor/src/closeout.ts`, `apps/supervisor/test/autoresume.test.ts` (new), `apps/supervisor/README.md`, `plugins/tk-studio/contracts/driver-contract.md` (the 0.1.28 auto-resume paragraph, no version bump) and `kb/agent-pc-setup-runbook.md` (the hole-65 row).

**Review:** blind-hunter and edge-case-hunter both ran (band L). 3 patches were applied (all low), 0 were deferred and 4 were rejected. Follow-up review: patched high 0, medium 0, low 3; score 3×0 + 3 = 3 < 5, so `followup_review_recommended: false`.

**Verification:**
- `uv run python -m unittest discover tests`: 2078 tests, OK (2 skipped).
- `runner.py run`: `ok: true`.
- `bun test`, per file, each under a fresh TMPDIR with `TK_STUDIO_ROOT` set and `~/.bun/bin` on PATH:
  - autoresume: 29 pass
  - closeout: 52 pass
  - resume: 81 pass
- `bun x tsc --noEmit`: clean.
- `git diff --stat -- .claude _bmad apps/supervisor/test/closeout.test.ts`: empty.
- `tk-sup-*` in /tmp: 104 before and 104 after.

**Residual risks:**
- Without `~/.bun/bin` on PATH, `closeout.test.ts` fails 18 tests. This is environmental and pre-existing: the committed code fails the same way.
- The removal-fails tests skip on win32 and when run as root.
- A supervisor crash between the resume and the attempt-1 write could allow a second auto-resume. The pinned event shape forces this order.
- A best-effort `.stale-*` sibling may remain under the gitignored `_bmad/render/`.

**unverifiable-here** (the live halt): on the agent PC, after the release carrying this story is installed, the next stale-render halt should show `auto-resume` with `attempt: 1` on `GET /runs/{id}`, one notifier line, and the story re-driven.

DRIFT: `staleRenderView` takes deps and is async — the untracked git check is async via the deps runner — affects: none
DRIFT: the 31.5 block reuses the lease attempt 2 already holds instead of taking it again — a same-owner re-take is refused — affects: none
DRIFT: a local `oneLine` clip in closeout.ts instead of hygiene's unexported `clipBytes` — hygiene.ts is read-only for this story — affects: none
DRIFT: the snapshot is renamed aside before it is deleted, with a rollback if the draft removal fails — a plain recursive delete could not keep "a failed removal retries on the next pass" — affects: none
DRIFT: post-take attempt 2 also requires the snapshot to still be complete, the same guard a fresh pass applies, so a pass that loses the race to a refused attempt 1 records nothing — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
- Gate: Part A not-required; Part B story accepted, planned 33-7-a-resumed-engines-graceful-stop-ends-complete-and-the-pacers
