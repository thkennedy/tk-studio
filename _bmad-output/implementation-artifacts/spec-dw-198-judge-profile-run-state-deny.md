---
title: 'DW-198/DW-199: the judge profile denies the run state beside the media, level by level'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_revision: 'dd5dac6ba7549b4de2ed6392cf48bf6c22ff0f80'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** `judgeDenyRules` (`apps/supervisor/src/hostverify.ts:788`) skips `.bmad-loop` (`JUDGE_MEDIA_TOP`) wholesale, so the playable judge can Read, Edit and Write the engine run's transcripts, tasks, bundles and journal beside its media folder (DW-198 read side, DW-199 write side).

**Approach:** Deny level by level along the media path: at each directory from the served root down to the media folder's parent (`.bmad-loop/runs/<engine>/`), emit `Edit`/`Read`/`Write` deny rules for every sibling of the next media path component, leaving only the media chain itself open.

## Boundaries & Constraints

**Always:**
- `judgeDenyRules(root, media)` takes the media path relative to `root` (POSIX, e.g. `.bmad-loop/runs/<engine>/playable`; split on `/` and `\` so a Windows-joined path works too). Level 0 is the served root (existing behaviour: fixed three + every entry except the first media component); each deeper level `L` = the first `k` media components, listing `root/L` and denying every entry except component `k+1`, as `./L/<name>/**` (directory) or `./L/<name>` (file or dangling link).
- Rule strings stay POSIX (`./.bmad-loop/tasks/**`), built by string concatenation, never `path.join`; per target `Edit(t)`, `Read(t)`, `Write(t)`; targets sorted and deduped as today.
- The media folder itself and its contents are covered by no rule; no rule is `Bash`/`Bash(…)` or bare `Edit`/`Read`/`Write`; no `**/` or `./**` wildcards.
- `defaultJudge`'s profile write stays atomic (tmp + rename), `encoding: "utf-8"`, beside the media at `<root>/<dirname(media)>/judge-deny.settings.json`; rules computed before the write.
- Any level that cannot be listed throws (the leg's existing judge `catch` → `inconclusive`, `infrastructure: sbx: …`).

**Block If:** satisfying the gate requires changing the `judge.json` contract, `playable_judge.py`, `validateDenyProfile`/`vmDenyProfile`, or the `PlayableJudge` call shape.

**Never:** deny Bash; deny the media folder or any of its ancestors on the media chain; edit the deferred-work ledger; touch files beyond `apps/supervisor/src/hostverify.ts` and `apps/supervisor/test/hostverify.test.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Run state beside media | `.bmad-loop/{tasks/, journal.jsonl, runs/{other/, e1/{transcripts/, tasks.yaml, playable/}}}` | Edit+Read+Write denied for `./.bmad-loop/tasks/**`, `./.bmad-loop/journal.jsonl`, `./.bmad-loop/runs/other/**`, `./.bmad-loop/runs/e1/transcripts/**`, `./.bmad-loop/runs/e1/tasks.yaml`, plus the top-level set | none |
| Media chain | same | no rule covers `.bmad-loop`, `.bmad-loop/runs`, `.bmad-loop/runs/e1` as a whole, nor anything under `playable/` | none |
| Unlistable level | a media-chain level missing/unreadable | throws | default judge → `inconclusive`, `infrastructure: sbx: …` |

</intent-contract>

## Code Map

- `apps/supervisor/src/hostverify.ts:776-811` -- `JUDGE_DENY_PROFILE`, `JUDGE_DENY_FIXED`, `JUDGE_MEDIA_TOP`, `judgeDenyRules(root)`, `writeJudgeDenyProfile(root, media)` (calls `judgeDenyRules(root)` at :803 — pass `media`). `JUDGE_MEDIA_TOP` becomes derivable from the media path's first component; drop or keep as documentation.
- `apps/supervisor/src/hostverify.ts:60-67` -- module header DW-68 sentence: update to say siblings along the media chain are denied (doc only).
- `apps/supervisor/src/hostverify.ts:930` -- `mediaRel = \`.bmad-loop/runs/${engineId}/playable\`` (POSIX), passed as `args.payload.media` (:1020). Read-only.
- `apps/supervisor/test/hostverify.test.ts:1139-1157` -- default-judge argv/profile test: its expected `deny` list must now include the run-level siblings present in the fixture (inspect what `fixture()` leaves under `.bmad-loop/runs/20261027-eng/` and `.bmad-loop/` — e.g. the profile's tmp is never present; other files may be).
- `apps/supervisor/test/hostverify.test.ts:1316-1338` -- the two pure `judgeDenyRules` tests: update to the two-arg signature; the "every rule scoped to one top-level entry" regex and the "no rule names `.bmad-loop`" assertion become "no rule covers the media chain".

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/hostverify.ts` -- change `judgeDenyRules` to `(root, media)` with the level-by-level sibling denial; pass `media` from `writeJudgeDenyProfile`; update its doc comment and the module header -- DW-198/DW-199.
- `apps/supervisor/test/hostverify.test.ts` -- update existing DW-68 tests to the new signature and expectations; add a fixture-tree test (the matrix's first two rows): siblings at `.bmad-loop/`, `.bmad-loop/runs/` and `.bmad-loop/runs/<engine>/` denied for all three tools (dir and file forms), no rule covers the media folder or its files (assert per rule that the media path and a file inside it are not under the rule's target), and the default-judge test still finds the profile written beside the media with those siblings in its deny list -- pins the fix.

**Acceptance Criteria:**
- Given a worktree whose `.bmad-loop/` holds run state beside the media chain, when the default judge's profile is written, then it denies `Edit`/`Read`/`Write` for every sibling at each level along the media path and the profile still passes `validateDenyProfile` and sits at `.bmad-loop/runs/<engine>/judge-deny.settings.json`.
- Given that profile, when inspected, then no rule covers the media folder or a file inside it, and no rule denies Bash or is a bare `Edit`/`Read`/`Write`.
- Given the existing DW-68/DW-69 hostverify tests, when the suite runs, then they stay green (updated only where the expected deny list grows).

## Spec Change Log

## Review Triage Log

skipped-layer: edge-case-hunter — S-band story (2 files, ~80 new lines; no story plan, band judged from the diff)

### 2026-11-09 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 0
- addressed_findings:
  - `[low]` `[patch]` the deny list is a snapshot listed when the profile is written (entries created later stay open) but the doc comments said the run state "is denied" unqualified — module header and `judgeDenyRules` doc now name the snapshot (doc only)

## Design Notes

Deny beats allow in Claude Code, so the media chain can only stay open by never being covered; hence sibling enumeration per level rather than `Read(./.bmad-loop/**)` plus an allow. On a re-run the previous `judge-deny.settings.json` is itself a sibling of `playable/` and gets denied — intended (DW-199's profile half is moot anyway: `--settings` is read at session start). Best effort, not a seal: Bash stays open, as ruled for DW-68.

## Verification

**Commands:**
- `cd apps/supervisor && timeout -k 5 600 bun test --timeout 60000 test/hostverify.test.ts test/tier.test.ts test/conformance.test.ts` -- expected: all pass
- `cd plugins/tk-studio/lib && uv run python -m unittest discover tests` -- expected: green
- `cd plugins/tk-studio/lib && uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`

## Deviation Summary

### pass 1 (2026-11-09)

- planned: the default-judge test's expected deny list grows to include whatever run-level siblings `fixture()` leaves under `.bmad-loop/` and `.bmad-loop/runs/20261027-eng/` / actual: the fixture leaves nothing beside the media chain when the profile is written, so the test seeds those siblings itself before `hostVerify` and expects them in the deny list / why: otherwise the test could not show "those siblings in its deny list" as the Tasks require / may affect: none

DRIFT: the default-judge test seeds its own run-state siblings (the fixture leaves none) — needed to show them in the written profile's deny list — affects: none

## Consult Log

- 2026-11-09T11:33:25Z — trigger: deviation-gt-0 — question: accept the default-judge test seeding its own run-state siblings (fixture() leaves none)? — ruling: accept-deviation score 1 — do: keep the seeded siblings and expected deny list as in the diff; leave the pass-1 Deviation Summary entry and DRIFT line; change neither fixture() nor production code — rule candidate: when a spec says a test must show state that the fixture leaves, and the fixture leaves none, seed it in the one test as a score-1 deviation without a consult (observe record: ok)

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-sweep-20261109T095041Z-480ca3` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

Summary: `judgeDenyRules(root, media)` now denies `Edit`/`Read`/`Write` level by level along the media path: at the root and at `.bmad-loop/`, `runs/` and `<engine>/`, every sibling of the next media component is denied (directory `./L/<n>/**`, file `./L/<n>`), so the engine run's transcripts, tasks, bundles and journal are closed to the judge while the media chain stays open (DW-198 read side, DW-199 write side). Best effort: a snapshot listed at profile-write time; Bash stays open.

Files changed:
- `apps/supervisor/src/hostverify.ts` -- `judgeDenyRules` takes the media path and denies siblings per level; `writeJudgeDenyProfile` passes it; `JUDGE_MEDIA_TOP` removed; doc comments and module header updated.
- `apps/supervisor/test/hostverify.test.ts` -- DW-68 tests moved to the two-arg signature with a `covers()` media-chain check; new DW-198/DW-199 fixture-tree test (dir/file forms, Windows-joined media path, unlistable level throws); default-judge test seeds run state and expects it in the written profile.

Review findings: patches applied 1 (low, doc); deferred 0; rejected 0.
Follow-up review recommendation: false (patched high 0, medium 0, low 1; score 1).

Verification:
- `bun test --timeout 60000 test/hostverify.test.ts test/tier.test.ts test/conformance.test.ts` -- 207 pass, 2 skip, 0 fail (bun from `~/.bun/bin`).
- `uv run python -m unittest discover tests` -- 3077 tests OK (4 skipped).
- `uv run python ../contracts/conformance/runner.py run` -- `ok: true`.
- Matrix audit: rows 1-2 by the DW-198/DW-199 test and the default-judge test; row 3 by the unlistable-level throw assertion plus the existing write-failure → `inconclusive` test.

DRIFT: the default-judge test seeds its own run-state siblings (the fixture leaves none) — needed to show them in the written profile's deny list — affects: none

Residual risks: entries created under the media chain after the profile is written are not covered (`--settings` is read once); Bash stays open (as ruled for DW-68).

## Reconcile

- 2026-11-09 — score 1; reconcile not required.
- Gate: Part A not-required; Part B not applicable (sweep DW bundle DW-198/DW-199, unit `dw-judge-profile-run-state-deny` has no stories.yaml entry; ACs spot-checked as met: DW-198/DW-199 `judgeDenyRules` and default-judge tests in `apps/supervisor/test/hostverify.test.ts`, Auto Run Result gates green)
