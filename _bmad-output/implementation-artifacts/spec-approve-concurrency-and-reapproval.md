---
title: 'Approve concurrency and re-approval: wait on an open approve PR (DW-49), drop the superseded cycle''s Jira issues (DW-51)'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
baseline_revision: '6d43bb8ecec75b582c1e8ab55e0df0dd2af09918'
review_loop_iteration: 3
followup_review_recommended: false
context: ['{project-root}/AGENTS.md']
warnings: ['oversized']
deferred:
  - summary: >-
      Two engagements of one project starting their first append in separate supervisor processes at once can both see no holder: the approve lock is per engagement, so the DW-49 wait check is not atomic across processes.
    evidence: |-
      approveStep takes only takeLock(<worktree>.lock) per engagement; serialised() covers one process. Serve and run/drain processes can each run approvePass concurrently. Meets DEFERRAL DISCIPLINE (b): AD-4 id uniqueness.
    location: >-
      apps/supervisor/src/approve.ts approveStep (the DW-49 wait check)
    severity: medium
  - summary: >-
      Two engagements of one project that each still have an earlier approve PR open, both revised and re-approved before either new cycle appends, hold each other through the cross-cycle hold: a mutual WaitOpenPr that only closing or merging one PR releases.
    evidence: |-
      openPrHolder's earlier-open-PR branch (Spec Change Log #3) holds on the other's newest ok pr while gh answers OPEN, symmetrically. Reachable only from approve PRs already open side by side before DW-49 ships, or the deferred cross-process race. A tie-break lets one sync clash with the other's open ids, so it needs an owner ruling. Meets DEFERRAL DISCIPLINE (a): the DW-49 wait the criteria name.
    location: >-
      apps/supervisor/src/approve.ts openPrHolder (the earlier-open-PR hold)
    severity: medium
  - summary: >-
      A first cycle whose sync promoted Jira issues but whose commit/push never landed, then revised and re-approved, re-runs fresh: the kept worktree holding the keys is removed and no origin branch exists, so those issues are orphaned with no drop.
    evidence: |-
      dropSuperseded runs only on the onBranch read-tree cut (the path DW-51 names); the fresh path's removeWorktree drops the only copy of the keys. Pre-existing path not changed by this bundle. Meets DEFERRAL DISCIPLINE (a): AC1's promote to Jira.
    location: >-
      apps/supervisor/src/approve.ts the fresh re-approval path (removeWorktree before the cut)
    severity: medium
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** (DW-49, TKSTUDIO-216) Two engagements of one project approved before either approve PR merges both run `plansync sync` from the same branch-local `plan-counter.yaml` and mint the same EP/ST ids (`reservedEpics` at `approve.ts:484` reserves only `## Epic` numbers). (DW-51, TKSTUDIO-217) A re-approval after `revise` with the earlier PR still open resets the worktree to the default branch's tree (`git read-tree -u --reset`, `approve.ts:624`), so the second sync promotes fresh Jira issues and the first cycle's promoted issues are orphaned.

**Approach:** Owner decision A for both. DW-49: an approve pass for a project WAITS — a named wait reason, retried each tick — while another engagement's approve PR for that project is still open. DW-51: on the re-approval cut from `origin/engagement/ENG-NNN`, before the read-tree reset and the second sync, the first cycle's promoted Jira issues are moved to the project's dropped status (`DNI`, `jirabackend.DNI_STATUS`) with a comment naming the re-approval, through a new additive `track.py drop` verb.

## Boundaries & Constraints

**Always:**
- The wait applies only before a cycle starts (no ok `append` since the newest approve line); a cycle already past `append` (resume / resync) never waits.
- "Another engagement's approve PR is still open" (the holder; widened per Spec Change Log #1 so two syncs never mint the same ids) = another engagement id with `detail.project` equal to this one whose events scoped to ITS newest approve line (`approveLine(readEngagement(t.root, other)).at`) hold an ok `append` with no ok `queued` and no `queued` refusal starting `PrClosed` at or after it. Released when the other's record is absent, has no approve line, or is `cancelled`. When that cycle has an ok `pr` (its URL), `gh pr view <url> --json state` decides: `OPEN`, a gh failure or an unreadable answer holds (wait, ask again next pass); `MERGED`/`CLOSED` releases. With no ok `pr` yet (appended, synced or committed, the PR pending) it holds with no gh call. Also held (Spec Change Log #3), whatever its newest cycle shows: the other engagement's newest ok `pr` event across ALL its cycles with no ok `queued` and no `PrClosed` refusal at or after it, while gh answers `OPEN` (a gh failure holds) — an earlier PR still open after a revise, whose ids are on origin until the re-approval replaces them. A cancelled, absent or never-approved record still releases.
- The wait is recorded as `emitStep(…, "append", false, {reason: "WaitOpenPr: <other id>'s approve PR <url, or 'pending' while no PR exists, or 'unknown (record unreadable)' when the holder's record cannot be read> for project <project> is still open (retried each pass)", wait: true, holder: {engagement, pr}})` (`pr` the URL, or `null` while pending); `emitStep`'s dedupe tells it once; the engagement goes in none of `done`/`refused`/`failed`; the record's state never moves.
- The drop runs only on the onBranch re-approval cut (`onBranch === true`, fresh mode), only when `jiraBound(t.root)`, after `git worktree add` and before `read-tree`. Keys (by provenance, Spec Change Log #2 — no merge-base, no diff filter): the earlier cycle's epic numbers N are the `## Epic N` sections of `<prefix>_bmad-output/planning-artifacts/epics.md` at HEAD (before the reset) whose first body line is `engagement: <ENG>`; the keys are `external.jira.key` of each plan entity at HEAD (`<prefix>_bmad-output/planning-artifacts/plan/*.md`) whose frontmatter `source` is `epics.md#epic-N` or starts with `epics.md#story-N.` for those N, leaving out any key that a plan entity in `<defaultRef>` also carries; deduped and sorted. No keys: no track call. A failed read → `fail("append", "DropFailed: …")`.
- Drop outcome: `status: complete` → continue; the ok `append` event's detail carries `dropped: [keys]` (omitted when none). `null` (transient / `retry: true`) → `fail("append", "DropFailed: …")`; `status: blocked` → `fail("append", "DropRefused: <track's reason>")`; both remove the fresh worktree and are retried at the next pass.
- `track.py drop`: `--directory`, `--engagement ENG-NNN`, `--issue KEY` (repeatable, at least one), `--reason TEXT`, `--dry-run`. Preflight before any write: every issue not already in a `DROPPED_STATUS_NAMES` status must have a transition reaching `DNI_STATUS` (`_reaches`), else `NoTransition` with nothing moved or commented. Per issue: not yet dropped → transition by name to `DNI_STATUS` via `jirabackend.transition_to_name`, then one agent comment `Dropped: <reason>` (no mention); already dropped → no transition, and the comment is posted only when the issue's newest agent comment (`newest_agent_body`) is not that same body, else the issue is named in `skipped[]` — so a retry after a failed comment posts it, and never double-comments. Result `{ok, dry_run, engagement, issues: [{issue, transitioned, commented}], skipped[], notes[], written: []}` with the §3 status block last. Refused `blocked` by name: bad engagement id or no engagement dir (`EngagementNotFound`), no `--issue` (`NoIssue`), a malformed key (`BadIssue`), no `--reason` (`ReasonMissing`), agent-seat gaps (as `close`), `NoTransition` (no transition reaches `DNI`), `JiraRefused: <key>: <error>` (any other non-transient Jira error, e.g. a 404 on a deleted issue). A temporary failure ends `partial`, `ok: false`, `retry: true`. Holds the engagement lock (`_locked`) like `close`.
- The supervisor's reason text names the re-approval: `"<ENG> re-approved after revise (approve <since>): the earlier plan this issue came from is replaced wholesale"`.
- Contract: the new verb rides the open 0.1.34 entry (no version bump), as Epic 38's stories do: the `tk-studio-track` row gains the `drop` verb, the header gains one `0.1.34 (DW-51, additive)` clause after `0.1.34 (Story 38.4, additive)`, and the version notes gain one `**0.1.34 (DW-51, additive).**` note after Story 38.4's.
- Every text-mode open names `encoding="utf-8"`; every `bun test` names `--timeout` (AGENTS.md).

**Block If:**
- The Jira project has no way to identify a dropped status other than `DNI_STATUS` and the code would need a new configurable status name.

**Never:**
- No edit to `deferred-work.md`, `epics.md`, plan files, `stories.yaml`, `.bmad-loop/*.toml`.
- No change to `reservedEpics` semantics, the commit/pr/queued steps, or the merged-branch re-approval path (`onBranch === false`).
- No new `APPROVE_STEPS` entry and no new `ApproveResult` field.
- No contract version bump, no release motion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Wait | ENG-001 PR open (gh OPEN); ENG-002 approved, same project | ENG-002: one `append` false `WaitOpenPr: ENG-001's …`; no plansync call; a second pass adds no event | — |
| Release | ENG-001's PR merged (origin main moved, gh MERGED) | ENG-002 runs append…pr; its EP/ST ids differ from ENG-001's | — |
| Closed PR | ENG-001's `queued` refused `PrClosed` | ENG-002 does not wait | — |
| gh fails | `gh pr view` exits non-zero | treated as open: wait | retried next pass |
| Own cycle resumed | ENG-002 already has ok append this cycle | no wait check | — |
| Re-approval drop | ENG-001 bound, earlier PR open, branch carries EP/ST files with keys | track `drop --engagement ENG-001 --issue <keys…> --reason "…re-approved after revise…"` called before the second sync; append detail `dropped` | — |
| Drop transient | track answers `retry: true` | append false `DropFailed:`; no sync; next pass retries | worktree removed |
| Drop refused | track `blocked` | append false `DropRefused: <reason>` | retried next pass |
| Unbound | no `planning.jira` | no track drop call | — |
| track idempotent | issue already `DNI` with its `Dropped: <reason>` comment newest | skipped, no comment | — |
| track comment retry | issue already `DNI`, newest agent comment differs (the earlier comment failed) | comment posted, no transition | — |
| track preflight | one of two issues has no transition to `DNI` | `NoTransition`, nothing moved or commented | — |
| track non-transient | `GET` on an issue answers 404 | `blocked`, reason starts `track refused: JiraRefused:` | — |
| Default moved | default branch modified an existing plan entity (with a key) after the cut | that key is not dropped; only the earlier cycle's (provenance) keys are | — |
| Second re-approval | revise→approve→revise→approve with the PR open; HEAD carries other engagements' promoted, keyed EP/ST files (pulled in by the first reset) | only ENG's own `## Epic N` entities' keys are dropped; the others' are not | — |
| Mid-cycle holder | ENG-002 has ok `append` (its sync refused), no commit; ENG-001 fresh | ENG-001 waits `WaitOpenPr: ENG-002's approve PR pending …` | — |
| Re-approved holder | ENG-001's first-cycle PR open (gh OPEN); ENG-001 revised and re-approved, its new cycle not yet appended | ENG-002 waits `WaitOpenPr: ENG-001's approve PR <url> …` | — |
| Cancelled holder | ENG-001 holds (commit pending), then its record is `cancelled` | ENG-002 does not wait | — |

</intent-contract>

## Code Map

- `apps/supervisor/src/approve.ts:8-80` -- header doc; add the wait and the drop to the approve-pass description.
- `apps/supervisor/src/approve.ts:479-494` -- `reservedEpics`: the per-project other-engagement event scan pattern to mirror for the open-PR holder (keep it unchanged).
- `apps/supervisor/src/approve.ts:887-915` -- `approveStep`: insert the wait check after the `NotApproved` refusal, before `worktreeSteps`, only when `!okStep(…, "append")`.
- `apps/supervisor/src/approve.ts:857-861` -- `queueStep`'s `gh pr view … --json state,mergedAt` call: reuse the same gh/`lastJsonObject` read for the holder's state.
- `apps/supervisor/src/approve.ts:588-628` -- the onBranch cut and `read-tree` reset; the drop goes between `worktree add` and `read-tree`. `prefix` (`rev-parse --show-prefix`) and `defaultRef` are in scope; `jiraBound` and `frontmatter` are already imported from `./closeout`.
- `apps/supervisor/src/approve.ts:986-996` -- `trackBlock`: the `uvRunner(deps)(root, studioScript(deps,"lib","track.py"), [...])` + `lastJsonObject` + `retry === true → null` pattern for the drop call.
- `apps/supervisor/src/approve.ts:672-675` -- the ok `append` emit; add `dropped` to its detail.
- `apps/supervisor/test/approve.test.ts:96-123` -- `approveDeps`: the "Jira fake" is the `track` answer injected through `uv` (`uvCalls` records `{script, args}`); `servedRepo({bound: true})` binds Jira.
- `apps/supervisor/test/approve.test.ts:640-685` -- the ruling (2) re-approval-with-open-PR test: template for the drop test (needs EP/ST files carrying `external.jira.key` on the first commit — the fake plansync may need to stamp one, or the test can write it into the branch).
- `apps/supervisor/test/approve.test.ts:749-764` -- test "4: two engagements…": now ENG-002 waits while ENG-001's PR is open; rewrite to assert the wait, then merge and assert ENG-002 proceeds with distinct ids.
- `apps/supervisor/test/fakes.ts` -- `fakeGh` (`answer({view, open})`), `fakePlansync`.
- `plugins/tk-studio/lib/track.py:884-966` -- `close_engagement`: the shape to mirror (`_agent_seat`, `_locked`, `jirabackend._current_status`, `transition_to_name`, `transient`, `_finish`); `:1736+` `main()` argparse — add the `drop` subparser and dispatch.
- `plugins/tk-studio/lib/jirabackend.py:104-110` -- `DNI_STATUS`, `DROPPED_STATUS_NAMES`.
- `plugins/tk-studio/lib/tests/test_track.py:43` -- `FakeTrack` Jira fake for the new verb's tests.
- `plugins/tk-studio/contracts/driver-contract.md:5,772` + version notes -- header clause, track row, note; `plugins/tk-studio/lib/tests/test_driver_contract.py:3650-3680` -- the Story 38.4 pinning test to mirror for DW-51.
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- list the `drop` verb if it lists the others.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/track.py` -- add `drop_issues(...)` + the `drop` subparser per Always -- the owner's DNI move needs a seat-holding verb.
- `plugins/tk-studio/lib/tests/test_track.py` -- tests: happy move+comment, already-DNI skipped (no comment), NoTransition, NoIssue, ReasonMissing, bad engagement, transient → partial retry, dry-run.
- `plugins/tk-studio/contracts/driver-contract.md`, `plugins/tk-studio/lib/tests/test_driver_contract.py`, `plugins/tk-studio/skills/tk-studio-track/SKILL.md` -- document and pin the verb (AD-19).
- `apps/supervisor/src/approve.ts` -- the wait (holder helper + `approveStep` check) and the drop (onBranch, before `read-tree`); header doc.
- `apps/supervisor/test/approve.test.ts` -- pin the matrix rows with `fakeGh` and the injected track answer; rewrite test "4".

**Acceptance Criteria:**
- Given ENG-001's approve PR open for project p, when the approve pass runs for ENG-002 (same project), then ENG-002 records exactly one `append` false event whose reason starts `WaitOpenPr: ENG-001`, plansync is not called for it, and a repeated pass adds no event.
- Given ENG-001's PR then merged, when the pass runs, then ENG-002 completes append…pr and its minted EP id differs from ENG-001's.
- Given a Jira-bound re-approval after revise with the earlier PR open and the branch's plan entities carrying keys, when the pass runs, then `track.py drop --engagement ENG-001` is called with every such key and a reason containing `re-approved after revise` before the `plansync sync` call, and the ok `append` detail lists `dropped`.
- Given `track.py drop` on an issue already in `DNI`, when it runs, then no transition and no comment are made and the issue is named in `skipped[]`.
- Given the verify gate, when run, then both steps pass.

## Spec Change Log

### #1 — 2026-11-08 — review pass 1 (bad_spec, consult ruling `apply`)
- Triggering findings: (high) the two-dot drop-key diff `<defaultRef> HEAD` drops live issues of entities the default branch changed after the cut; (medium) the holder counted only ok `commit`/`pr`, so an engagement mid-cycle (ok append/sync, no commit) let a second sync mint the same ids, and a cancelled holder never released; (medium) a comment failing after the DNI move was never posted on retry; (medium) a non-transient Jira error refused without a name; (low) a `NoTransition` part-way left earlier issues dropped.
- Amended (inside <intent-contract>, per consult ruling): the holder definition (ok append, scoped to the holder's newest approve line, released on cancelled/absent record or gh MERGED/CLOSED); drop keys from the merge-base diff, keeping only keys absent at the merge-base; track `drop` preflight, comment-on-retry rule, `JiraRefused`; seven matrix rows.
- Known-bad state avoided: DNI on issues the first cycle never promoted; duplicate EP/ST ids from a mid-cycle engagement; a project waiting forever on a cancelled engagement; a dropped issue with no comment.
- KEEP: the pass-1 implementation (saved at `/tmp/dw-pass1-implementation.patch`, a diff against baseline_revision) is otherwise sound and must survive re-derivation: apply it first (`git apply /tmp/dw-pass1-implementation.patch`) and then change only what this entry amends. Keep: `openPrHolder`/`supersededKeys`/`dropSuperseded` structure and placement; the `WaitOpenPr` event shape with `holder.pr` null while pending (consult: accepted); the injected track fake receiving args; worktree removal on DropFailed/DropRefused; the contract row, header clause and note placement (extend the note's refusal list with `JiraRefused` and the comment-on-retry and preflight rules); the driver-contract pinning test; the SKILL.md entry; the rewritten test "4".

### #2 — 2026-11-08 — review pass 2 (bad_spec, consult ruling `apply`)
- Triggering findings: (high) the merge-base drop-key method drops live, unrelated issues on a SECOND re-approval — a `read-tree --reset` commit is not a merge, so the merge-base stays at the original cut and HEAD carries the default branch's later entities as "added"; (low) `--diff-filter=AM` misses a rename; (medium, patch) the driver contract's approve-pass description (header, line 5: append refused by name `NoScope`, `StoryShape`, `NotApproved`) does not name the DW-49 wait; (low, patch) an unreadable holder record is reported as "PR pending".
- Amended (inside <intent-contract>, per consult ruling): the drop-keys line → provenance (the branch's `## Epic N` sections marked `engagement: <ENG>`, entities by plansync `source`, minus keys the default branch carries); the "Default moved" row; a new "Second re-approval" row; the wait reason's unreadable-record wording. Supersedes #1's drop-key clause only; the rest of #1 and its KEEP list stand.
- Patches to carry: in driver-contract.md's header approve-pass description, name the append wait `WaitOpenPr` (not a failure: retried each pass; `detail.wait: true`, `detail.holder {engagement, pr}`; the holder rule in one clause) inside the 0.1.34 (DW-51, additive) clause or beside the append refusals, and pin it in the DW-51 test in test_driver_contract.py; the unreadable-record holder carries `holder.unreadable: true` and the reason wording above.
- Known-bad state avoided: DNI on other engagements' live issues at a second re-approval; an operator misled about why the project waits.
- KEEP: the pass-2 implementation (saved at `/tmp/dw-pass2-implementation.patch`, a diff against baseline_revision) is otherwise sound: apply it first (`git apply /tmp/dw-pass2-implementation.patch`), then change only what #2 amends. Keep everything #1's KEEP lists plus pass 2's widened holder, the rewritten F2 and "4" tests, the injected-holder resumed test, the cancelled-holder test, the track preflight / comment-retry / JiraRefused code and tests. Replace `supersededKeys`' merge-base/ls-tree logic with the provenance method; rework the "default moved" test to the new rule and add the second re-approval test.

### #3 — 2026-11-08 — review pass 3 (bad_spec)
- Triggering finding: (medium) the holder, scoped to the other engagement's newest approve line, ignores an earlier approve PR still open after a revise + re-approval whose new cycle has not appended yet, so a second engagement can mint the same ids as that open PR.
- Amended (inside <intent-contract>): the holder also holds on the newest ok `pr` across all the other engagement's cycles while gh answers OPEN; a "Re-approved holder" matrix row.
- Patches to carry (review pass 3): (a) an unreadable holder record holds only when that engagement's events (any cycle) show an ok `append` with no later ok `queued` or `PrClosed` refusal, else releases; (b) in `supersededKeys`, a default-branch plan file `git grep` matched whose frontmatter will not parse excludes every candidate key found in its text (never drop a key that may be live); (c) tests: a Jira-bound re-approval whose branch entities carry no keys makes no `track.py drop` call and no `dropped`; a `supersededKeys` read failure gives `append` false `DropFailed:` and removes the worktree; absent-record and never-approved holders release; `track.py drop` with the engagement's `track.lock` already held ends `partial`, `retry: true`; (d) `apps/supervisor/README.md`'s approve-pass description names the `WaitOpenPr` wait, the Jira-bound re-approval drop, `DropFailed`/`DropRefused` and `dropped`; (e) the driver-contract header's DW-49 clause lists the never-approved release and the earlier-open-PR hold, pinned in the DW-51 test.
- Known-bad state avoided: two open PRs carrying the same EP/ST ids across a revise window.
- KEEP: the pass-3 implementation (saved at `/tmp/dw-pass3-implementation.patch`, a diff against baseline_revision) is otherwise sound: apply it first (`git apply /tmp/dw-pass3-implementation.patch`), then change only what #3 amends and carries. Keep everything #1 and #2 keep, the provenance `supersededKeys`, the second re-approval and default-moved tests, `holder.unreadable`.

## Review Triage Log

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 5 (high 1, medium 3, low 1)
- patch: 0
- defer: 1 (medium 1)
- reject: 0
- addressed_findings:
  - `[high]` `[bad_spec]` drop keys from a two-dot diff drop issues of entities the default branch changed — amended to merge-base diff + key-absent-at-merge-base; loopback
  - `[medium]` `[bad_spec]` holder ignores a mid-cycle engagement (ok append, no commit) — holder widened to ok append; loopback
  - `[medium]` `[bad_spec]` a cancelled commit-pending holder blocks the project forever — released on cancelled/absent record; loopback
  - `[medium]` `[bad_spec]` a comment failing after the DNI move is never posted on retry — comment posted when the newest agent comment differs; loopback
  - `[medium]` `[bad_spec]` non-transient Jira error refused without a name; `NoTransition` part-way (low) — `JiraRefused` + preflight; loopback

### 2026-11-08 — Review pass 2
- intent_gap: 0
- bad_spec: 2 (high 1, low 1)
- patch: 2 (medium 1, low 1)
- defer: 0
- reject: 1 (medium 1)
- addressed_findings:
  - `[high]` `[bad_spec]` merge-base drop keys pick up other engagements' entities on a second re-approval — amended to provenance selection; loopback
  - `[low]` `[bad_spec]` rename blind spot of `--diff-filter=AM` — moot under provenance; loopback
  - `[medium]` `[patch]` driver contract does not name the DW-49 `WaitOpenPr` wait — carried into the loopback (Spec Change Log #2)
  - `[low]` `[patch]` unreadable holder record reported as "PR pending" — carried into the loopback (`holder.unreadable`)
- rejected: a deleted/inaccessible earlier issue makes the drop a permanent `JiraRefused` → `DropRefused` — the named refusal is what the consult ruling (pass 1) pinned; the operator sees it by name.

### 2026-11-08 — Review pass 3
- intent_gap: 0
- bad_spec: 1 (medium 1)
- patch: 7 (medium 2, low 5)
- defer: 0
- reject: 1 (low 1)
- addressed_findings:
  - `[medium]` `[bad_spec]` holder ignores an earlier approve PR still open after a revise + re-approval — holder also holds on the newest ok pr across cycles while OPEN; loopback
  - `[medium]` `[patch]` no test for "no keys: no track call" / "failed read → DropFailed" — carried (#3 c)
  - `[medium]` `[patch]` apps/supervisor/README.md approve-pass description not updated — carried (#3 d)
  - `[low]` `[patch]` absent / never-approved release untested; track busy lock untested — carried (#3 c)
  - `[low]` `[patch]` contract header omits the never-approved release — carried (#3 e)
  - `[low]` `[patch]` unreadable record of a finished engagement holds forever — carried (#3 a)
  - `[low]` `[patch]` unparsable default-branch frontmatter lets a live key be dropped — carried (#3 b)
- rejected: gh MERGED with a failed default-branch fetch cuts stale — the fetch failure is followed by the ls-remote/fetch of the engagement branch, which fail by name (OriginUnreachable) when origin is unreachable; not reachable in practice.

### 2026-11-08 — Review pass 4 (attempt 2, resumed)
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 2 (medium 2)
- reject: 2 (medium 2)
- addressed_findings:
  - none
- deferred: mutual WaitOpenPr between two engagements each with an earlier open PR, both re-approved (both layers) — needs an owner tie-break ruling; promoted-but-never-pushed cycle orphaned on a fresh re-approval (blind) — pre-existing path outside the read-tree cut DW-51 names.
- rejected: cross-process race on the holder check (edge) — already deferred in frontmatter; a deleted earlier issue makes the drop a permanent DropRefused (blind) — same finding rejected in pass 2, the named JiraRefused is the consult-pinned behaviour.

## Design Notes

The commit-pending holder (ok `commit`, no `pr` yet) extends "PR still open" to the moment between the push and `gh pr create`: the branch carrying the minted ids is already on origin, and the PR is that commit's purpose. Without it a transient `pr` failure on ENG-001 would let ENG-002 mint the same ids — the clash DW-49 exists to prevent.

`DNI_STATUS` is the dropped status the owner decision names ("dropped/cancelled status (DNI)"); setup creates it every run, so no configuration is added.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 900 bun test --timeout 120000 test/approve.test.ts` -- expected: all pass.
- `cd plugins/tk-studio/lib && uv run python -m unittest tests.test_track tests.test_driver_contract` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK.
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.

## Deviation Summary

### pass 1 (2026-11-08, implementer)

- planned: `approveDeps`'s injected track answer takes no arguments / actual: it receives the track args so the drop test can assert the call and other tests can answer per verb / why: the drop rows need the call's arguments; existing callers unaffected / may affect: none
- planned: `holder: {engagement, pr}` (pr unspecified for the commit-pending case) / actual: `pr` is the PR URL, or `null` when the commit is pushed with no PR yet; the reason says `pending` / why: the spec fixed only the reason text for that case / may affect: none
- planned: "Own cycle resumed" row and the commit-pending holder as separate concerns / actual: one test covers both / why: shared setup / may affect: none

DEVIATION SCORE: 1

DRIFT: approve.test.ts approveDeps track fake now receives the track args — needed to assert the drop call — affects: none
DRIFT: WaitOpenPr holder.pr is null in the commit-pending case — the spec named only the reason text — affects: none
DRIFT: one test covers the resumed-cycle and commit-pending matrix concerns — shared setup — affects: none

### pass 2 (2026-11-08, implementer, after Spec Change Log #1)

- planned: rewrite only test "4" among existing approve tests / actual: also rewrote "F2: an ok append whose sync failed holds its ## Epic N" (now "F2, DW-49") — ENG-002 waits while ENG-001 is mid-cycle, then takes Epic 42 after the merge / why: the widened holder makes F2's old expectation (a second sync beside a mid-cycle one) impossible / may affect: none
- planned: "Own cycle resumed" with a live holder / actual: the test injects one ok `append` `engagement-approve` event for a third engagement via `queue.serviceEvent` / why: under the widened holder two engagements cannot both reach a started cycle through the pass / may affect: none
- planned: drop keys from the three-dot diff + `git show <mb>:<path>` / actual: also one `git ls-tree -r --name-only <mb> -- <plan dir>` to tell an added file from a failed read / why: a git failure becomes `DropFailed` instead of dropping a live issue / may affect: none
- (unspecified gap filled) an existing but unparsable holder record is treated as a pending holder (safe default: wait).

DEVIATION SCORE: 1

DRIFT: test "F2" rewritten for the widened DW-49 holder — its old expectation contradicts the amended holder — affects: none
DRIFT: resumed-cycle test injects a holder event — not constructible through the pass under the widened holder — affects: none
DRIFT: supersededKeys adds a git ls-tree at the merge-base — distinguishes an added file from a failed read — affects: none

### pass 3 (2026-11-08, implementer, after Spec Change Log #2)

- planned: "Default moved" test as in pass 2 / actual: the default branch in that test also carries one of the engagement's own keys (TKS-102), so it also pins "minus keys the default branch carries"; expected `dropped` is `["TKS-101"]` / why: under provenance the old setup could not tell that rule from the provenance filter / may affect: none
- planned: WaitOpenPr named in the contract header / actual: as planned, plus the DW-51 version note's merge-base wording replaced by the provenance rule and the pinning test's phrase updated / why: the note would otherwise describe the superseded method / may affect: none
- planned: no separate test for the unreadable holder record / actual: its check added to the cancelled-holder test (renamed) / why: shared setup / may affect: none

DEVIATION SCORE: 1

DRIFT: Default-moved test also pins the minus-default-keys rule — needed to distinguish it under provenance — affects: none
DRIFT: DW-51 version note reworded to provenance — the note must not describe the superseded method — affects: none
DRIFT: unreadable-holder check folded into the cancelled-holder test — shared setup — affects: none

### pass 4 (2026-11-08, implementer, after Spec Change Log #3)

- planned: exclude text keys when a default-branch file's frontmatter "will not parse" / actual: detected as `frontmatter()` returning `{}` (it never throws), so an empty frontmatter also counts / why: the existing parser swallows errors; errs on keeping a key / may affect: none
- planned: separate absent-record and never-approved release tests / actual: one test looping both variants, each with a fresh queue and repo / why: identical setup / may affect: none
- planned: no test named for #3 (a)'s settled-unreadable release / actual: its check added to the PrClosed test (renamed) / why: that test already produces a settled cycle / may affect: none
- planned: four tests for #3 (c) / actual: also a test for #3 (b) using new `brokenOnMain` and `unkeyed` helper options / why: (b) changed behaviour and needed a pin / may affect: none

DEVIATION SCORE: 1

DRIFT: unparsable default frontmatter detected as an empty parse — the parser never throws — affects: none
DRIFT: absent/never-approved releases share one looping test — identical setup — affects: none
DRIFT: settled-unreadable release folded into the PrClosed test — shared setup — affects: none
DRIFT: extra test and helper options for #3 (b) — the behaviour needed a pin — affects: none

### attempt 2 (2026-11-08, orchestrator)

- Attempt 1 (dev-1) timed out (90 min, journal `session-end status: timeout`) after implementation pass 4; the engine rolled the code back but left this spec (status in-review) and preserved the attempt as commit 433ba4f1e7294ea7fe8190cfec498f9b014aac57. Step-01 routing would have opened a fresh `-2` spec for a non-draft match; this session instead treated the spec as the same work, restored the eight code files from that snapshot verbatim (`git checkout 433ba4f1 -- <files>`, no edits), and resumed at step-04 review pass 4. The untracked spec was the only dirt at the step-01 tree check, and it is this run's own artifact. Why: re-deriving four passes would exceed the session budget on the final attempt. No change to the story's code or contract.
- Verify environment: `bun` is not on the session PATH (`~/.bun/bin`); with it prepended, approve.test.ts passes 75/75. Without it, 35 tests fail spuriously.

## Consult Log

- 2026-11-08T10:44Z — trigger: deviation-gt-0 — question: accept or reject the implementer's three pass-1 deviations (test harness track args, holder.pr null on commit-pending, one test covering two matrix concerns), and at what score? — ruling: accept-deviation score 1 — do: Keep all three deviations as implemented and leave deviation_score: 1; keep the holder {engagement: ENG, pr: null} assertion as the pinned commit-pending shape — rule candidate: When a spec pins an event detail shape with an optional sub-case, the planner writes the null/absent value into Always; merged matrix tests and test-harness signature changes are score 0.
- 2026-11-08T10:47Z — trigger: high-severity-finding — question: the drop-key two-dot diff (A, high) and the commit/pr-only holder (B, medium) are pinned inside <intent-contract> yet contradict the bundle intent; bad_spec, patch, or intent_gap? — ruling: apply — do: Take option 1 (bad_spec): amend the intent-contract (merge-base diff, keys present at HEAD and absent at the merge-base; holder widened to an ok append with no ok queued / PrClosed after it, released on cancelled record or gh MERGED/CLOSED; matrix rows), log in Spec Change Log, revert and re-implement; amend the track.py drop line (an issue in DNI lacking the Dropped comment gets it on retry; non-transient JiraError refused under a named reason); no DRIFT, no HALT — rule candidate: a root cause inside <intent-contract> is bad_spec, not intent_gap, when the upstream intent has exactly one reading that fixes it; planners state 'what this branch changed' diffs in merge-base (A...B) form.
- 2026-11-08T11:11Z — trigger: deviation-gt-0 (pass 2) — question: accept or reject the four pass-2 deviations (F2 test rewrite, injected holder event, git ls-tree at merge-base, unreadable holder record holds), and at what score? — ruling: accept-deviation score 1 — do: Keep all four pass-2 deviations as implemented and leave DEVIATION SCORE: 1; change nothing about the F2 rewrite, the injected ENG-003 event, the ls-tree call, or the unreadable-record hold — rule candidate: when a SPEC amendment widens a hold, the planner lists in the Code Map every existing test whose setup becomes unreachable; rewriting those or injecting events counts as score 0.
- 2026-11-08T11:16Z — trigger: high-severity-finding (review pass 2) — question: the amended merge-base drop-key method drops other engagements' live issues on a second re-approval (read-tree reset commit is not a merge); bad_spec with provenance selection, patch, or escalate? — ruling: apply — do: Take option 1 (bad_spec): rewrite the drop-keys Always line and the Default moved row to provenance (## Epic N sections marked engagement: <ENG> at HEAD before the reset; entities by source epics.md#epic-N / epics.md#story-N.; minus keys a default-branch entity carries; failed read DropFailed); add a second re-approval row; log Spec Change Log #2 superseding #1's drop-key clause; revert and re-implement, review_loop_iteration 2; no DRIFT, no HALT — rule candidate: select an earlier cycle's entities by recorded provenance (engagement marker + plansync source key), never by a merge-base diff, since a read-tree --reset commit does not move the merge-base.
- 2026-11-08T11:29Z — trigger: deviation-gt-0 (pass 3) — question: accept or reject the three pass-3 deviations (Default-moved test pins minus-default-keys, DW-51 note reworded to provenance, unreadable-holder check folded into the cancelled-holder test), and at what score? — ruling: accept-deviation score 1 — do: Keep all three pass-3 deviations and DEVIATION SCORE: 1; leave the reworded note and pinned phrase, no version bump; keep the renamed cancelled-holder test with its unreadable-record assertions — rule candidate: when a Change Log entry replaces a method a same-story note describes on an open contract entry, the planner lists that note and its pinned phrase under Patches to carry; such updates and folded assertions count as score 0.
- 2026-11-08T11:45Z — trigger: deviation-gt-0 (pass 4) — question: accept or reject the four pass-4 deviations (empty parse counts as unparsable, looping release test, settled-unreadable check folded into PrClosed test, extra #3 (b) test + helper options), and at what score? — ruling: accept-deviation score 1 — do: Keep all four pass-4 deviations as implemented; leave DEVIATION SCORE: 1 and do not reopen #3 — rule candidate: when a SPEC says 'will not parse' for a parser that swallows errors, the planner writes 'an empty parse counts as unparsable' into the carried patch; merged/looped tests and extra pin tests count as score 0.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T093348Z-f76978` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** DW-49 (TKSTUDIO-216): before a cycle starts, the approve pass for an engagement waits while another engagement of the same project holds an open approve PR. The holder is a cycle past `append` with no `queued`/`PrClosed` (gh `OPEN` holds, a gh failure holds, `MERGED`/`CLOSED` releases; pending with no PR holds), or an earlier PR still open across cycles. The wait is recorded once as `append` false `WaitOpenPr: …` with `detail.wait: true` and `detail.holder {engagement, pr}`. The record's state never moves. DW-51 (TKSTUDIO-217): on the Jira-bound onBranch re-approval cut, before the `read-tree` reset and the second sync, the earlier cycle's promoted issues are selected by provenance (the `## Epic N` sections marked `engagement: <ENG>`, minus the keys the default branch carries). They are moved to `DNI` through the new additive `track.py drop` verb, with a `Dropped: <ENG> re-approved after revise …` comment. The ok `append` detail carries `dropped`. `DropFailed`/`DropRefused` remove the worktree, and the next pass retries.

**Files changed.**
- `apps/supervisor/src/approve.ts` — `openPrHolder` + the wait in `approveStep`; `supersededKeys`/`dropSuperseded` before the read-tree reset; header doc.
- `apps/supervisor/test/approve.test.ts` — the matrix rows pinned with `fakeGh` and the injected track fake. Tests "4" and "F2" are rewritten.
- `apps/supervisor/README.md` — the approve-pass description names the wait, the drop, `DropFailed`/`DropRefused`, `dropped`.
- `plugins/tk-studio/lib/track.py` — the `drop` verb: preflight, idempotent comment-on-retry, `JiraRefused`, lock.
- `plugins/tk-studio/lib/tests/test_track.py` — tests for the verb.
- `plugins/tk-studio/contracts/driver-contract.md` — the track row's `drop` verb, the 0.1.34 (DW-51, additive) header clause incl. the `WaitOpenPr` wait, the version note.
- `plugins/tk-studio/lib/tests/test_driver_contract.py` — the DW-51 pinning test.
- `plugins/tk-studio/skills/tk-studio-track/SKILL.md` — the `drop` verb.

**Review findings (pass 4).** Patches applied: 0. Deferred: 2 (medium), in the frontmatter `deferred`: a mutual WaitOpenPr between stale open PRs, and a promoted-but-never-pushed cycle orphaned on re-approval. Rejected: 2 (one already deferred, one a repeat rejection that was consult-pinned). Passes 1–3 were bad_spec loopbacks (Spec Change Log #1–#3).

**Follow-up review recommendation:** false. Patched this pass: high 0, medium 0, low 0. Score 0.

**Verification.**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` — Ran 3022 tests, OK (skipped=4).
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` — `ok: true`.
- `cd apps/supervisor && bun test --timeout 120000 test/approve.test.ts` (with `~/.bun/bin` on PATH) — 75 pass, 3 skip, 0 fail.
- `cd apps/supervisor && bun test --timeout 120000` (full suite) — 2078 pass, 95 skip, 2 fail. Both failures are in `test/guards.test.ts` ("sbx: the in-VM wall-clock guard rides the argv"), a file this change does not touch. They concern the `timeout` argv of the sbx command builder, which is environmental and unrelated to approve/track.

**Residual risks.** The three frontmatter deferrals: the cross-process holder race, the mutual wait, and the never-pushed orphan. A deleted earlier Jira issue makes the re-approval a standing `DropRefused` until the operator acts (consult-pinned behaviour).

DRIFT: approve.test.ts approveDeps track fake receives the track args — needed to assert the drop call — affects: none
DRIFT: WaitOpenPr holder.pr is null while the PR is pending — the spec named only the reason text — affects: none
DRIFT: tests merged/rewritten/injected for the widened holder (F2, resumed-cycle, cancelled/unreadable, absent/never-approved, PrClosed) — shared setup or unreachable under the widened hold — affects: none
DRIFT: supersededKeys treats an empty frontmatter parse as unparsable; DW-51 note reworded to provenance — parser never throws; the note must not describe a superseded method — affects: none

## Reconcile

- 2026-11-08 — score 1; reconcile not required.

Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (WaitOpenPr wait pinned at approve.test.ts:772-879; track.py drop verb at track.py:999/1924 with its tests in test_track.py; verify gate green per the Auto Run Result, the 2 full-suite failures being the untouched guards.test.ts sbx timeout argv)
