---
title: 'Approve pulls the served checkout fast-forward-only and copies the quote''s per-epic USD from the record (DW-46, DW-50)'
type: 'bugfix'
created: '2026-11-08'
status: 'done'
deviation_score: 1
reconcile_verdict: not-required
baseline_revision: 'bcc0e82b645d9c3522c8037517bc5216fed24093'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['multiple-goals', 'oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** 32.5's quote writes `epics.<predicted EP>.usd_estimate` into the served root's shared, uncommitted `.tk-studio/budget-bands.yaml`. (DW-46) That dirty copy can block the plan pull-back once the approve PR merges, and the supervisor never pulls the served checkout before `queueStep` submits the first run against it. (DW-50) Two engagements quoted before either approves predict the same EP id, so the shared entry holds only the later quote's figure, and approve's re-key (`moved`) can delete the other engagement's band.

**Approach:** Owner decision TKSTUDIO-214 (ENG-A), option A, as one change:
1. The quote records each proposed epic's p85 USD as `quote.basis.epics[].usd_estimate` in the engagement record and stops writing the bands file.
2. Approve's `job` step copies the figures from `record.quote.basis.epics[]` onto the minted EP ids and never reads the served root's bands file.
3. Approve's `queued` step does a fast-forward-only pull of the served checkout before it submits the first run. A dirty checkout is a named refusal.

## Boundaries & Constraints

**Always:**
- Every `basis.epics[]` entry carries `usd_estimate`: a number when `figures["epic_usd"]` has its `k`, else `null`.
- The quote's result keeps `bands` `{EP-NNN: usd}`: the same estimates, now meaning the ones recorded in the record. `written[]` names only the record.
- Approve keys its copy by `k` → minted id, so a `null` `ep_id` no longer prevents the copy. Its `no_band` reasons are `no minted EP id` and `no usd_estimate`.
- Approve writes the estimates into the worktree's bands file with `rekeyBands(text, estimates)` and no `moved` list, so no other epic's entry is ever removed. `rekeyBands`'s signature and its byte shape stay as they are.
- The pull runs only after `gh` reports `MERGED` and before `deps.submit`:
  - A dirty checkout is refused with `DirtyCheckout: <root> has uncommitted changes (<up to 3 paths>)`. Dirty means a tracked file is modified or staged: `git status --porcelain --untracked-files=no` prints something.
  - A checkout whose current branch is not the PR step's `base` is refused with `NotOnBase: <root> is on <branch>, the PR merged into <base>`.
  - Otherwise the pull is `git pull --ff-only origin <base>`. A non-zero exit is refused with `PullFailed: <clipped stderr>`.
  - Each refusal goes through the existing `fail()` (step `queued`, ok false, retried at the next pass, de-duplicated by `emitStep`), and `deps.submit` is not called.
- Contract surface (AD-19): update `driver-contract.md` and `test_driver_contract.py` in the same change. Text-mode opens name `encoding="utf-8"`. Every `bun test` names `--timeout`.

**Block If:**
- Conformance or the lib suite cannot pass without changing a contract surface outside the quote, approve and engage passages named in the Code Map.

**Never:**
- Do not edit the deferred-work ledger, `epics.md`, the plan files or `stories.yaml`.
- Do not delete `quote.epic_bands_text`. test_quote.py pins the board and approve test literals with it.
- Do not add a fallback that reads the served bands file for records quoted before this change. Such a record gets `no_band: no usd_estimate`.
- Do not stash, reset or clean the served checkout.
- No version bumps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quote lands | scope with 1 epic, counter next 33 | `basis.epics == [{k:1,title,stories:2,ep_id:"EP-033",usd_estimate:<p85>}]`; `bands {"EP-033": <p85>}`; bands file bytes unchanged / not created; `written == [record]` | none |
| Quote, counter unreadable | `ep_id` null | entry still has `usd_estimate`; `bands {}` | none |
| Quote, unparseable bands file | garbage `budget-bands.yaml` | quote completes; file untouched | no `QuoteUnwritable` |
| Two engagements, same predicted EP | ENG-A and ENG-B each quoted with EP-033 | each record holds its own figure; approving either copies its own figure to its minted id; the served bands file holding another value for EP-033 is ignored | none |
| Approve copies | `basis.epics[0].usd_estimate: 40.0`, minted EP-034, base bands has EP-033 entry for another epic | the worktree bands gain `EP-034: 40.0`; the EP-033 entry is kept; job detail `bands {"EP-034":40}` | none |
| Legacy record | basis entry without `usd_estimate` | `no_band [{k,n,ep_id,reason:"no usd_estimate"}]`, no bands write | none |
| Merged, clean, behind | origin/main ahead by the merge commit | served HEAD == origin/main, then submit called | none |
| Merged, dirty | a tracked file modified in the served root | `queued` ok false, `DirtyCheckout: …`, submit not called; after the operator restores the file, the next pass queues | retried each pass |
| Merged, untracked only | engagement.yaml/scope.md untracked | not dirty, pull proceeds | none |
| Merged, diverged | a local commit not on origin/main | `PullFailed: …`, no submit | retried |
| Wrong branch | served root on `feature` and base `main` | `NotOnBase: …`, no submit | retried |

</intent-contract>

## Code Map

- `plugins/tk-studio/lib/engage.py`:
  - `quote()` 1562–1766. `epics` are built at 1657–1660 as `{k,title,stories,ep_id}`; add `usd_estimate` from `figures["epic_usd"]` (keyed by int `k`).
  - `estimates`, the bands read and `epic_bands_text` are at 1694–1712. Drop the bands read and write (1742–1749). Fix the dry-run note and summary at 1713–1718.
  - The module doc 130–137 and the docstring 1566–1570 describe the bands write. Rewrite both.
- `plugins/tk-studio/lib/quote.py`:
  - The module doc 24–27 names a stale `write_epic_bands`. Say that `epic_bands_text` is the byte-shape reference approve mirrors, and that the quote no longer writes it.
- `apps/supervisor/src/approve.ts`:
  - The header 20–21, 36–38 and 47–52 says the inputs and bands are read from the served root. Rewrite it.
  - The job step 690–749: `servedBands` 723–727, the `noBand` reasons 734–737, the `rekeyBands(..., moved)` call 744.
  - `queueStep` 846–871. Insert the pull between the `MERGED` check (861) and `deps.submit`.
  - Use the `git(deps, cwd, args, timeoutS)` helper (463). The PR base is `stepDetail(okStep(..., "pr")).base`.
- `apps/supervisor/test/approve.test.ts`:
  - `QUOTE.basis.epics` 39–43 gains `usd_estimate`.
  - `servedRepo` 68–83 currently leaves the bands file uncommitted-modified (77). Remove that write; that dirty file is the DW-46 state.
  - `gitInit` (fakes.ts:399) sets no upstream, which is why the pull names `origin <base>`.
  - Tests to adjust: 130 (main flow, bands 161, detail 170), 231 (null ep_id now copies), 304 and 740 (`rekeyBands` pure, keep).
- `plugins/tk-studio/lib/tests/test_engage.py`:
  - `QuoteTestCase` 1399. Tests 1445, 1640, 1652, 1742 and 1760 assert the bands write and its refusals. Rewrite them to the new behaviour (the file untouched; a garbage bands file no longer refuses).
- `plugins/tk-studio/lib/tests/test_quote.py` `BandsFileTest` 261–363: keep.
- `plugins/tk-studio/contracts/driver-contract.md`:
  - Line 5, a single ~65 KB line. Its Story 32.5 quote clause (~33.3k–35.5k chars) has the bands refusal and the "writes `epics.<EP-NNN>.usd_estimate` … into `.tk-studio/budget-bands.yaml`" passage. Its Story 32.6 approve clause has the job re-key (~37.9k) and the `queued` step (~38.3k): add the pull and the three refusals there.
  - Also line 116 (`GET /engagements/{id}` `basis.epics[]` shape) and line 774 (the tk-studio-engage row: bands, `QuoteUnwritable` "the record or the bands").
  - Board 160–167 stays: the board still reads the committed bands file.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`:
  - 1184–1230 (32.5 clause phrases), 1243–1272 (engage row), 1285 (`basis.epics[]` shape), 1320–1350 (32.6 clause). Re-pin them to the new phrases.
- Prose: `kb/quote-band.md` 65–80, `kb/engagement-loop.md:40`, `plugins/tk-studio/skills/tk-studio-engage/SKILL.md` 238–240/259/326, `apps/supervisor/README.md:153`.

## Tasks & Acceptance

**Execution:**
- `plugins/tk-studio/lib/engage.py` -- per-epic `usd_estimate` in `basis.epics[]`; no bands read or write; docs -- DW-50 and DW-46 at the source.
- `plugins/tk-studio/lib/quote.py` -- module doc only.
- `plugins/tk-studio/lib/tests/test_engage.py` -- rewrite the bands tests. Add: two engagements predicting EP-033 each keep their own `usd_estimate`, and the bands file's bytes are identical before and after both quotes.
- `apps/supervisor/src/approve.ts` -- copy from the record; no `moved`; the pull plus `DirtyCheckout`/`NotOnBase`/`PullFailed` in `queueStep`; header doc.
- `apps/supervisor/test/approve.test.ts` -- clean fixture. New tests:
  - the served root's bands file modified uncommitted to `EP-033: 999.0` (the 32.5-era DW-46 state): the job step's copy still comes from the record (detail `bands {"EP-034": 40}`), and the queued step then refuses with `DirtyCheckout` naming `.tk-studio/budget-bands.yaml`;
  - the copy comes from `usd_estimate`;
  - the other epic's entry is kept;
  - a legacy record gets `no usd_estimate`;
  - merged and behind → pulled, then submitted;
  - dirty → refusal, then queued after the restore;
  - untracked-only proceeds;
  - diverged → `PullFailed`;
  - wrong branch → `NotOnBase`.
- `driver-contract.md`, `test_driver_contract.py`, kb, SKILL.md and README -- the matching text.

**Acceptance Criteria:**
- Given an engagement in scoping with a scope, when `engage.py quote` runs, then the record's `quote.basis.epics[]` entries carry `usd_estimate`, and `.tk-studio/budget-bands.yaml` is neither created nor modified.
- Given two engagements quoted with the same predicted EP id, when each is approved, then each minted epic's band equals its own record's `usd_estimate`, and no previously present bands entry is removed.
- Given the approve PR merged, when the `queued` step runs, then the served checkout is fast-forwarded to `origin/<base>` before `deps.submit`. Given a dirty tracked file, it emits the `DirtyCheckout` refusal and does not submit.

## Deviation Summary

### pass 1 (2026-11-08)

- planned: engage.py notes to fix were the dry-run note/summary / actual: also reworded the counter-unreadable note "no epics band written" → "no EP id predicted" / why: the quote no longer writes a band, the old text was false / may affect: none
- planned: no `git status`-failure case among the refusals / actual: a non-zero `git status` exit in the queued step is reported as `PullFailed: git status exit …` / why: the step must fail by name, not throw; only three named refusals exist / may affect: none
- planned: approve.ts header, job step, queueStep / actual: also removed the now-unused `js-yaml` `loadYaml` import and reworded the PR body ("the re-keyed budget band" → "the budget band copied from the quote") and one doc comment / why: they described the removed re-key / may affect: none
- planned: README.md:153 only / actual: also README.md:154 and the contract's 32.6 clause "the board draws the re-keyed band" → "the copied band" / why: consistent wording / may affect: none

DRIFT: engage.py counter-unreadable note reworded — the old text described a band write that no longer exists — affects: none
DRIFT: `git status` failure in queueStep reported as PullFailed — the step must refuse by name and the spec names only three refusals — affects: none
DRIFT: approve.ts unused loadYaml import removed and PR body/doc wording changed — they described the removed re-key — affects: none
DRIFT: README.md:154 and contract 32.6 "re-keyed band" → "copied band" — consistent wording with the copy — affects: none

## Consult Log

- 2026-11-08T10:11:08Z — trigger: deviation-gt-0 — question: accept the implementer's four score-1 deviations (git-status failure folded into PullFailed; note/doc/contract wording)? — ruling: accept-deviation score 1 — do: keep all four entries, deviation_score 1; ensure a queued-step test covers a non-zero `git status` exit → `PullFailed: git status …`, submit not called (add if missing) — rule candidate: In a story enumerating named refusals, a preliminary-probe failure maps to the nearest enumerated refusal name without a consult; prose edits keeping a spec-named contract clause consistent with the new behaviour are part of its contract-surface update (score 0).

## Spec Change Log

## Review Triage Log

### 2026-11-08 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high 0, medium 0, low 1)
- defer: 0
- reject: 6 (high 0, medium 2, low 4)
- addressed_findings:
  - `[low]` `[patch]` queueStep ran the status/branch/pull block before the `NoSubmitter` guard, so an unwired submitter still fast-forwarded the served checkout. Moved the guard ahead of the pull.
- rejected (one line each):
  - The untracked file that blocks the pull goes unnamed (both layers). By design (Design Notes): `PullFailed` carries git's stderr, which names the overwritten path.
  - The hardcoded `"main"` base fallback. The ok `pr` step always records `base` (approve.ts:839), and `prStep` already falls back the same way (approve.ts:814).
  - The contract history was rewritten in place with no new entry. Sweep precedent 75697973 (DW-96) amends the clause in place with a DW tag, and this change tags DW-46/DW-50 the same way. The spec says no version bump.
  - `NotOnBase`/`PullFailed` untested. False: tests exist at approve.test.ts:1404 and :1419.
  - A staged-only change is untested. Plumbing: `git status --porcelain` lists staged entries, and the DEFERRAL DISCIPLINE rejects it.
  - `rekeyBands` keeps its `moved` parameter. The spec keeps its signature, and the call site passes none.

## Design Notes

- Untracked files do not count as dirty. Engagement records and `scope.md` live untracked in the served root, and an untracked file that would block the merge makes `git pull --ff-only` fail anyway (`PullFailed`).
- The pull names `origin <base>` rather than relying on an upstream: the test fixture and fresh clones have none.
- Dropping `moved` is the DW-50 fix itself. Removing the predicted key could delete another engagement's minted band.
- In-flight engagements quoted before this change lose their band copy (`no usd_estimate`). The owner chose the record as the only source.

## Verification

**Commands:**
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: OK
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`
- `cd apps/supervisor && bun test --timeout 30000 test/approve.test.ts test/board.test.ts` -- expected: 0 fail
- `cd apps/supervisor && bunx tsc --noEmit -p .` (if a tsconfig exists) -- expected: no errors

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261108T093348Z-f76978` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary:** Owner decision TKSTUDIO-214 (ENG-A), option A, resolving DW-46 and DW-50:
- The quote now records each proposed epic's p85 USD as `quote.basis.epics[].usd_estimate` (or `null`) in the engagement record, and neither reads nor writes `.tk-studio/budget-bands.yaml`.
- Approve's `job` step copies those figures, matched by `k`, onto the minted EP ids. It never reads the served bands file and never removes another entry (no `moved`).
- Approve's `queued` step, once the PR is merged and the submitter is wired, refuses a dirty tracked checkout (`DirtyCheckout`) or an off-base branch (`NotOnBase`). Otherwise it runs `git pull --ff-only origin <base>` (`PullFailed` on a non-zero exit, including a `git status` failure), and only then submits.

**Files changed:**
- `plugins/tk-studio/lib/engage.py`: `usd_estimate` per basis epic; bands read, write and refusals removed; docs and notes.
- `plugins/tk-studio/lib/quote.py`: module doc.
- `plugins/tk-studio/lib/tests/test_engage.py`: bands tests rewritten; new tests for no file created, an unreadable counter, and two engagements predicting EP-033.
- `plugins/tk-studio/lib/tests/test_driver_contract.py`: re-pinned the quote, engage-row, `basis.epics[]` and 32.6 phrases.
- `plugins/tk-studio/contracts/driver-contract.md`: the 32.5 quote clause, the 32.6 job and queued clauses, line 116, the engage row.
- `apps/supervisor/src/approve.ts`: copy from the record; no `moved`; the ff-only pull and three named refusals; header and PR-body text.
- `apps/supervisor/test/approve.test.ts`: clean served fixture; 10 new or changed DW-46/DW-50 tests.
- `apps/supervisor/README.md`, `kb/quote-band.md`, `kb/engagement-loop.md`, `plugins/tk-studio/skills/tk-studio-engage/SKILL.md`: prose.

**Review:** 1 patch applied (low), 0 deferred, 6 rejected. Follow-up review recommendation: false (patched high 0, medium 0, low 1; score 1 < 5).

**Verification:**
- Lib suite `uv run python -m unittest discover tests`: 3008 tests, OK (4 skipped).
- Conformance `runner.py run`: `ok: true`.
- `bun test --timeout 30000 test/approve.test.ts test/board.test.ts`: 0 fail (bun must be on PATH: the fake `gh` shebang calls `bun`).
- `bunx tsc --noEmit`: clean.
- Matrix audit: every row covered by a test that ran and passed.

**Deviations:**
- DRIFT: engage.py counter-unreadable note reworded — the old text described a band write that no longer exists — affects: none
- DRIFT: `git status` failure in queueStep reported as PullFailed — the step must refuse by name and the spec names only three refusals — affects: none
- DRIFT: approve.ts unused loadYaml import removed and PR body/doc wording changed — they described the removed re-key — affects: none
- DRIFT: README.md:154 and contract 32.6 "re-keyed band" → "copied band" — consistent wording with the copy — affects: none

**Residual risks:**
- Engagements quoted before this change get `no_band: no usd_estimate` at approval. The owner chose the record as the only source.
- A served checkout still holding a 32.5-era modified bands file refuses `DirtyCheckout` until an operator restores it. One holding an untracked bands file the PR adds refuses `PullFailed`, and git's stderr names the file.

## Reconcile

- 2026-11-08 — score 1; reconcile not required.

Gate: Part A not-required (score 1); Part B not applicable: sweep DW bundle, not a stories.yaml story (no manifest entry, no plan, no next story to plan); the spec's ACs were spot-checked as met (quote usd_estimate, no bands write; approve copies by k with no removal; ff-only pull with DirtyCheckout/NotOnBase/PullFailed tests incl. the consult's git-status case at approve.test.ts:1428)
