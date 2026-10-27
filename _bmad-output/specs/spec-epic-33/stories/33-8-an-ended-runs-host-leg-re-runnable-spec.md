---
title: "An Ended Run's Host Leg, Re-runnable"
type: 'feature'
created: '2026-10-27'
status: 'done'
baseline_revision: 'e34482bbfad4e0358c3c037669d698d0204bd960'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-epic-33/plans/33-8.md'
warnings: ['oversized']
deferred: []
deviation_score: 1
reconcile_verdict: not-required
---

<intent-contract>

## Intent

**Problem:** Hole 52: a red host leg on an ended run can be re-run today only by the hand recipe (cut a worktree, run `verify.host`, flip the PR).

**Approach:** One supervisor motion — `POST /runs/{id}/verify` (bearer only) and the cli verb `verify <run id>` — cuts a fresh worktree from the ended run's pushed branch tip, runs the project's `verify.host` there exactly as the close-out does (`hostVerify`), records a new `host-verify` event, removes the worktree, and on green marks a draft PR ready. The run's terminal state never changes (CAP-15 changes `host_verify` only).

Story text (epics.md "### Story 33.8", authoritative, transcribed verbatim):

- **AC1:** **Given** an ended run with a pushed branch and a PR (`partial` with `host_verify: red`, or any ended run) **When** `POST /runs/{id}/verify` arrives (the bearer only) or the cli verb `verify <run id>` runs **Then** the supervisor cuts a fresh worktree from the branch's tip, runs the project's `verify.host` there exactly as the close-out does, records a new `host-verify` event with the result, removes the worktree, and on green marks a draft PR ready and ends the run's `host_verify` state `green` (the run's terminal state is unchanged; the plan pull-back sees the PR as before); a live run, an external run or a run with no branch is a 409 by name; a leg already running for the run is 409 `VerifyRunning`; contract 0.1.28 names the route
- **AC2:** **Given** the verb **When** it is tested **Then** `bun test` covers the worktree, the recorded event, the draft-to-ready flip and every refusal with fakes; the README's route table and the runbook's "when a host leg is red" steps name it

## Boundaries & Constraints

**Always:** Follow `plans/33-8.md` "Settled shape" 1–7 exactly (module, refusal order, lease, leg, route, verb, docs). Reuse `hostVerify`/`verifyCommand`/`materialise`/`gh`/`runner`/`runBranch`/`priorPr`/`openPrUrl` unchanged. The route is bearer only (never added to `cookieRoute`). Contract changes are additive under 0.1.28 (no version bump, no surface-table row). Bun test temp folders only via `test/tmp.ts` `tempDir`. Secrets never reach an event, line or file; refusal details pass `redact`.

**Block If:** the re-run must change the run's terminal state, its `ended` event, or `closeOut`/`sweepEngines`; the derived `host_verify` (board/inbox/office) does not turn green from a later green `host-verify` so a reader must change; the route must be reachable by a cookie session; a production file outside Files must change.

**Never:** edit `apps/supervisor/src/worktree.ts` or `hostverify.ts`; use `gh pr ready --undo` or edit the PR body; put tests in `test/command-line.test.ts`; push, tag, release; bump the gate x3 versions; write SPEC.md, epics.md, stories.yaml or the plan.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Green re-run | `partial` run, red `host-verify`, branch on origin, draft PR on `ended` | detached `<worktree>.verify` at remote tip, materialised, one green `host-verify` with `rerun{by,head,worktree:"removed",pr,pr_ready:"marked"}`, folder gone, `gh pr view` then `gh pr ready <pr>`; state/`ended` unchanged; board `host_verify` green | none |
| Red re-run | as above, leg red | red `host-verify`; no `gh pr ready`, no `--undo` | none |
| PR states | ready / closed / none / only on `gh pr list` | `"already"` / `"not open"` / `pr: null` no ready call / list adopts open PR | — |
| Leftover `.verify` | folder exists | removed before the cut | best effort |
| Cut/materialise fails | `WorktreeFailed` | 500 `VerifyFailed`, lease released, no `host-verify` | — |
| Refusals | missing / `external` / `queued`·`running`·`paused` / no worktree, branch absent, ls-remote fails / live lease | 404 RunNotFound / 409 ExternalRun / 409 RunNotEnded / 409 NoBranch / 409 VerifyRunning | dead owner's lease taken over |
| Route body | non-`{}` / unparsable | 400 SchemaError / 400 MalformedJson | cookie session 401; GET 405 |
| Verb | 0 or 2+ args | usage, exit 2 | green 0, red/skipped 1, refusal 2 |

</intent-contract>

## Code Map

The plan's Code Map (`_bmad-output/specs/spec-epic-33/plans/33-8.md`, "Code Map") is the investigation; anchors re-checked 2026-10-27 at HEAD e34482b: `hostverify.ts` `verifyCommand` :92, `hostVerify` :152; `queue.ts` `ownerLive` :976, `releaseCloseOut` :1650, `takeEndedCloseOut` :1669, `note` :2146; `api.ts` resume header :21, `postResume` :758; `test/api.test.ts` resume describe :1059.

- `apps/supervisor/src/hostleg.ts` (new) -- refusals, `rerunHostLeg`, the leg, the PR flip.
- `apps/supervisor/src/queue.ts` -- `takeVerifyLeg`, `releaseVerifyLeg` mirroring `takeEndedCloseOut`.
- `apps/supervisor/src/api.ts` -- header line, `ApiDeps.verify`, `postVerify`, path match after resume.
- `apps/supervisor/src/cli.ts` -- `verify` verb in `main` and `USAGE`.
- `apps/supervisor/src/worktree.ts`, `hostverify.ts`, `board.ts`, `inbox.ts`, `office.ts` -- read only.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/queue.ts` -- add `takeVerifyLeg`/`releaseVerifyLeg` (Settled shape 3).
- `apps/supervisor/src/hostleg.ts` -- new module (Settled shape 1, 2, 4; started handle `{run_id, state, head, done}`).
- `apps/supervisor/src/api.ts` -- route (Settled shape 5).
- `apps/supervisor/src/cli.ts` -- verb (Settled shape 6).
- `apps/supervisor/test/hostleg.test.ts` (new), `test/queue.test.ts`, `test/api.test.ts` -- the tests listed in the plan's Verify.
- `apps/supervisor/README.md`, `plugins/tk-studio/contracts/driver-contract.md`, `kb/agent-pc-setup-runbook.md` -- Settled shape 7.

**Acceptance Criteria:**
- Given AC1, when the leg runs on fakes, then `hostleg.test.ts` shows the cut, the event, the removal, the flip and an unchanged terminal state, and the board's `hostVerifyOf` reads green.
- Given AC1's refusals, when each is provoked, then route and verb answer the named code (409 by name; `VerifyRunning` while leased).
- Given AC2, when docs are read, then the README route table has `POST /runs/{id}/verify`, the contract has a 0.1.28 Story 33.8 paragraph naming the route, and the runbook has **When a host leg is red** naming it.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2 (high 0, medium 1, low 1)
- defer: 0
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` a `.verify` folder deleted while its git worktree registration remains made every re-run 500 `VerifyFailed`; `rerunHostLeg` now always runs `git worktree prune` before `git worktree add` (hostleg.ts), with a test.
  - `[low]` `[patch]` the verb printed `{ok:false, error:<free text>}` with no `detail` on a non-refusal throw; it now prints `{ok:false, error:"VerifyFailed", detail}` (cli.ts `verifyVerb`), with a test.
- rejected: the contract's Story/rulings row lacks 33.8 (the row has not been extended since 33.2; the 0.1.28 header entry and paragraph name 33.8); inbox/office not tested green (they read the same latest-`host-verify` rule as the board, read only, untouched); `SchemaError` in `VerifyRefusal` (the plan's settled type); a dead `host-verify-leg` clause in `takeVerifyLeg` (harmless, the plan's wording); force-push race between `ls-remote` and fetch (rare, answers 500 with the lease released, retryable); a throwing leg recorded `skipped` (the plan's Settled shape 4).

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- green; `uv run python ../contracts/conformance/runner.py run` -- `ok: true`.
- From `apps/supervisor`, one `bun test <file>` per file under a fresh removed `TMPDIR`: hostleg, queue, api, worktree, closeout, hostverify, board, office, web, hygiene -- all pass; `bun x tsc --noEmit` -- clean.
- `git diff --stat -- .claude _bmad` -- empty; `/tmp/tk-sup-*` count does not grow.

**Manual checks (if no CLI):**
- `unverifiable-here`: on the agent PC after the release carrying 33.8, a fixed red leg re-run via `POST /runs/<id>/verify` records a green `host-verify` and its draft PR turns ready (needs live `gh`, a real `verify.host`, an sbx run).

## Deviation Summary

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version) | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

### pass 1 (2026-10-27, implementer)

- planned: `takeVerifyLeg(runId, self)` / actual: `takeVerifyLeg(runId, self = selfOwner(), by?)` / why: the lease event carries `by`, which the two-argument signature cannot supply / may affect: none
- planned: `HostLegDeps extends WorktreeDeps` with `self?` and `now?` / actual: only `self?` / why: nothing in the leg reads a clock / may affect: none
- planned: the verb tested through an injected queue and leg seam in `main` / actual: `main` delegates to a new exported `verifyVerb(args, seams)` tested with seams; `main` tested for the usage exits only / why: `main(argv)` has no injection point / may affect: none
- planned: runbook paragraph after step 5 of the epic list / actual: after step 6 (the list's last), still before **When a supervisor run pauses** / why: the list has 6 steps; inserting between 5 and 6 breaks the numbering / may affect: none
- planned: leftover `.verify` cleared before the cut / actual: as planned, plus a half-made `.verify` is removed on a cut or materialise failure before `VerifyFailed` / why: leave no folder behind on the failure path / may affect: none

DEVIATION SCORE: 1

DRIFT: `takeVerifyLeg` gains a third `by?` parameter — the lease event records `by` — affects: none
DRIFT: `HostLegDeps` omits `now?` — no clock is read — affects: none
DRIFT: verb seams tested via exported `verifyVerb`, `main` only for usage exits — `main` has no injection point — affects: none
DRIFT: runbook paragraph after step 6 not 5 — the list has six steps — affects: none
DRIFT: a half-made `.verify` is removed on cut/materialise failure — no folder left behind — affects: none

## Consult Log

- 2026-10-27T03:21:17Z — trigger: deviation-gt-0 — question: accept the implementer's five in-Files deviations (takeVerifyLeg by? param; HostLegDeps without now?; verifyVerb seam; runbook paragraph after step 6; half-made .verify removed on failure)? — ruling: accept-deviation score 1 — do: keep all five as built; optionally narrow `by?` to `"api" | "cli"`; carry on to review — rule candidate: The developer may make a plan-named signature, deps field or test seam fit the plan's own stated event or test requirement, or place a doc paragraph by the anchor the plan meant, without a consult, when no file outside Files and no contract surface changes; score 1.

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run tk-studio update (the installer rewrites the skills-dir plugin folder at the roster's plugin version) | nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** Hole 52 closed: `POST /runs/{id}/verify` (bearer only, 202) and `bun src/cli.ts verify <run id>` re-run an ended run's host leg. The leg cuts a detached `<worktree>.verify` at the pushed branch tip, materialises it, runs `hostVerify` with the sweep's guard, removes it, records one `host-verify` event with `rerun{by, head, worktree, pr, pr_ready?}`, and on green marks an open draft PR ready. A `host-verify-leg` lease event serialises legs (`VerifyRunning`). Refusals: RunNotFound 404, ExternalRun/RunNotEnded/NoBranch/VerifyRunning 409, VerifyFailed 500, SchemaError/MalformedJson 400. The run's terminal state and `ended` event are never touched; the board's derived `host_verify` turns green from the new event.

**Files changed.**
- `apps/supervisor/src/hostleg.ts` (new) — refusals, `rerunHostLeg`, the leg, the PR flip.
- `apps/supervisor/src/queue.ts` — `takeVerifyLeg`, `releaseVerifyLeg`.
- `apps/supervisor/src/api.ts` — header line, `ApiDeps.verify`, `postVerify`, the path match.
- `apps/supervisor/src/cli.ts` — `verify` verb, `verifyVerb` seam, `USAGE`.
- `apps/supervisor/test/hostleg.test.ts` (new, 15 tests), `test/queue.test.ts` (+3), `test/api.test.ts` (+4).
- `apps/supervisor/README.md` — route row and verb.
- `plugins/tk-studio/contracts/driver-contract.md` — 0.1.28 header entry and Story 33.8 paragraph (no bump, no surface-table row).
- `kb/agent-pc-setup-runbook.md` — **When a host leg is red**, events-table `host-verify` `rerun` note and `host-verify-leg` row.

**Review.** Blind Hunter and Edge Case Hunter (band L). 2 patches applied (medium 1, low 1), 0 deferred, 6 rejected. Follow-up review: false (patched high 0, 3×1 + 1×1 = 4 < 5).

**Verification.** Studio gate: `uv run python -m unittest discover tests` 2078 OK (2 skipped); conformance `ok: true`. Per-file `bun test` under fresh TMPDIRs: hostleg 15, queue 101, api 102, worktree 102, closeout 60, hostverify 23, board 23, office 77, web 27, hygiene 43 — 0 failures; `bun x tsc --noEmit` clean; `git diff --stat -- .claude _bmad` empty; `/tmp/tk-sup-*` 104 → 104. Every I/O matrix row has a passing test.

**unverifiable-here** (operator, agent PC, after the release carrying 33.8 is installed): fix a red host leg, then from `apps/supervisor` run `curl -X POST -H "Authorization: Bearer <token>" http://<supervisor>/runs/<id>/verify` (or `bun src/cli.ts verify <id>`), and confirm a green `host-verify` event on `GET /runs/<id>/events` and the draft PR turned ready.

**Residual risks.** The route's leg runs inside `serve`; if `serve` dies mid-leg the dead owner's lease is taken over and the leftover folder cleared by the next re-run. The PR body's `## Host verify` keeps the original result (planned). `apps/supervisor/node_modules` was populated by `bun install --frozen-lockfile` (EPERM on two links; git-ignored).

DRIFT: `takeVerifyLeg` gains a third `by?` parameter — the lease event records `by` — affects: none
DRIFT: `HostLegDeps` omits `now?` — no clock is read — affects: none
DRIFT: verb seams tested via exported `verifyVerb`, `main` only for usage exits — `main` has no injection point — affects: none
DRIFT: runbook paragraph after step 6 not 5 — the list has six steps — affects: none
DRIFT: a half-made `.verify` is removed on cut/materialise failure — no folder left behind — affects: none

## Reconcile

- 2026-10-27 — score 1; reconcile not required.
Gate: Part A not-required; Part B epic complete: no next story (33-8 accepted)
