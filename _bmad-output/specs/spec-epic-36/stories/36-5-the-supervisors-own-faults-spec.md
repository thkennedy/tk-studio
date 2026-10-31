---
title: "The Supervisor's Own Faults"
type: 'bugfix'
created: '2026-10-31'
status: 'done'
baseline_revision: '8546cf3a9024acd4455ead26a7291acb5385b9fc'
deviation_score: 2
reconcile_verdict: no-impact
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-epic-36/plans/36-5.md'
warnings: ['oversized', 'multiple-goals']
deferred:
  - summary: >-
      Runs carrying own_block still count toward stop.max_runs in evaluate_stop, so repeated supervisor faults can stop a job through max_runs.
    evidence: |-
      evaluate_stop's new filter applies only to on_status; counted still includes own-marked runs. AC1 names on_status, so whether max_runs should change is outside this story; deferral rule (a), the criterion's "next submission is woken".
    location: >-
      plugins/tk-studio/lib/jobrun.py evaluate_stop
    severity: medium
---

<intent-contract>

## Intent

**Problem:** As the operator, I want the supervisor to stop causing the blocks it then refuses to clear: a run that blocks before any engine starts releases the checkout lock and an `on_status [blocked]` stop skips a block of the supervisor's own making, the tick never respawns holds, `submit` refuses a sandbox-tier job whose target skill is absent from the skills store, a core's own `blocked` status lifts into the run state, the pin-restart bounded per sandbox with the engine sandbox's `/tmp` pruned at the pin, a pacer pass visible while it runs, and doctor reading a process-level end over the routine tee lines.

**Approach:** So that the supervisor's own faults are recorded as its own and never cost a hand-deleted lock row, a 1.26 USD host claim or 133 hold events (holes 90, 94, 98; DW-105, DW-109, DW-113, DW-38; DW-55, DW-56, DW-58, DW-60, DW-63). The shapes are settled in `plans/36-5.md` "Settled shape" 1-8 and SPEC.md's CAP-13 and CAP-15 design notes.

**Acceptance criteria (verbatim, epics.md Story 36.5):**

AC1. **Given** a run that ends `blocked` before an engine started, and a job whose `stop.on_status` holds `blocked` **When** the close-out runs and the next submission arrives **Then** the checkout lock is released (no unverified engine holder for later claims to re-probe), `cancel` answers it, and the stop skips a block whose reason is the supervisor's own (placement, lock, pin, render) so the next submission is woken, the loop-caused blocks of holes 90 and 93 the test cases (DW-105); a sandbox-tier job whose target skill is absent from the skills store (`sbx skills ls`, or the store's `plugin.json`) is refused at `submit` naming the release and the import, and a status block missing `intent` is reported malformed, not absent (DW-113, hole 98)

AC2. **Given** the one-minute tick beside a live serve, and a core job whose JSON status is `blocked` **When** `recoverQueue` → `respawnHolds` runs, and when `jobrun.execute_core` records the run **Then** the tick spawns no hold (the serve process, which lives, owns them) or detaches and records its holds so the serve adopts them, one test that a tick beside a live serve spawns none, and a run's `hold` events count the restarts, not the ticks (DW-109, hole 94); the core's own `status` lifts into the run `state` so `stop.on_status: ["blocked"]` fires for `atlassian-sync-back` and every shipped core (DW-38)

AC3. **Given** the pin, the pacer and doctor **When** a sandbox stays logged out across several queued runs, a pass runs long, and the newest log ends on a tee line **Then** the pin-restart episode is bounded per sandbox across the queue, any run's open pin-restart since the sandbox's last healed probe counting (`sandbox.ts openPinRestart`; DW-56, DW-58), the pin prunes `tk-sup-*` and `tmp.*` from the engine sandbox's `/tmp` (`cli.ts pinBeforeClaim`; DW-60), the slow-pass warning, the notifier line and `pacer.json` are written while the pass runs (`log.ts runUnderLog`; DW-63), and doctor ranks a keeper, pacer or serve end or a non-zero exit above the routine `[tick]`/`[drain] stopped (exit 0)` lines (`doctor.py _last_end`; DW-55); the supervisor suites and the lib suite cover each with fakes; the contract (0.1.31, additive) names the refusal and the lifted status; the entries close by this PR

## Boundaries & Constraints

**Always:** Follow `plans/36-5.md` Settled shape 1-8, its Files list as the boundary, and its "Anchors after 36.4" (re-grep; older line numbers predate 36.1-36.4). Set `own_block` where the block is built, never by matching reason text. Keep the store check after `requireTier` on the claim path (`test/drain.test.ts` pins `placement:TierRequired`). Contract changes are additive on 0.1.31: the 36.5 paragraph goes between 36.4's paragraph and `## 8. Conformance`. Studio Python is stdlib-only, writes are atomic, every headless surface ends in a status block. Name `encoding=` on every text-mode open, tests included (`AGENTS.md`; `e2e_text_encoding`). No test pins a live planning artifact (`test_planning_pins_guard`). Glob patterns in the prune argv are `find`'s inside the VM, never a host shell. Keep new argv in `sandbox.ts` and new `Queue` methods beside their neighbours, with no new import edge (36.7 owns the cycles).

**Block If:** The real `sbx skills ls` is unavailable AND no store folder source exists (`bad_spec` consult). Forcing `keepEngine: true` would release a lock a live engine holds, i.e. a `launched` event or recorded engine name exists on the path (the veto stands; consult `deviation-gt-0` if a block path with a live engine turns up). The Files list must grow past the band: `halt` consult, never a silent split.

**Never:** Push, tag, PR, release motion, or version bumps of the gate. Edit `epics.md`, canonical plan files, `stories.yaml`, `.bmad-loop/routing.toml`, `.bmad-loop/policy.toml`, or anything under `implementation-artifacts/supervision/`. Run a supervisor by hand, or an engine on the host. Change `events/taxonomy.v1.json` (no `hold`/`pin-restart` entries exist; queue events in prose). Add to `test/command-line.test.ts`. Sniff reason prefixes for `own_block`. A serve-owned `watchHolds` (option A is rejected in Settled shape 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| M1 own block, no engine | Run ends `blocked` with `own_block` (hole 90: pin; hole 93 case), no `launched` event, no recorded engine name | Lock released; no `{id: null}` holder; launch probe skipped; next claim queues no `lock-wait` | - |
| M2 engine veto | Same end, but a `launched` event or engine name exists | Engine holder path unchanged; lock not released | - |
| M3 terminal cancel | `cancel` on a terminal run with a `kind='engine'` lock row naming it | 200, row released, `lock-released {holder: {id: null}, own_block}` | Terminal run with no row keeps the existing 409 `RunTerminal` |
| M4 stop skip | Job `stop.on_status: ["blocked"]`; last run `blocked` with `own_block` | `mirror`, `recover` and `jobrun.py evaluate_stop` all skip; next submission woken | Engine's own `blocked` (no marker) still stops |
| M5 skill absent, submit | Sbx-tier job, target skill not in `sbx skills ls` | `refusal("skills-store:SkillMissing", …)` naming store, release (or `unknown`) and `sbx skills import`; `POST /jobs` 400 by name | Verb missing: host store folder listing, says so |
| M6 skill absent, claim | Same at the drain claim, after `requireTier` | Claim refusal `skill-missing:<skill>`; run stays `queued` | `placement:TierRequired` still wins first |
| M7 malformed block | Balanced object, string `status`, no string `intent` | `conformance failure (AD-11): status block malformed: missing intent`, ended `partial`, no resume | Truly absent block keeps `MISSING_STATUS_BLOCK` and its resume |
| M8 tick beside live hold | Recorded hold pid and start alive | `recoverQueue` → `respawnHolds` spawns none, writes no `hold` event | Dead pid with live engine: exactly one respawn and one event |
| M9 core status | Core JSON `status: blocked` / `partial` / `complete` | Run `state` is that status, `reason` from block; `on_status` stop fires for `blocked` | `ok: false` no status → `blocked` with `reason: "core answered ok: false without a status"`; `ok: true` no status → `complete` |
| M10 pin bound | Sandbox logged out across several queued runs | At most one open `pin-restart` per sandbox until a healed signal; another run's open restart counts | Healed (`probe_after: null` or clean `pinned`) reopens the bound |
| M11 prune | Successful pin | `sbx exec` `find /tmp …` argv with no shell; `pinned` detail `tmp_pruned: true` | Live other run: `"skipped: <why>"`; failure: `"error: <clipped>"`, pin still succeeds |
| M12 long pass | Pass exceeds `SLOW_PASS_MS` while child is alive | Warning, one notifier line and `pacer.json` `running` written before exit; `finish` does not repeat, removes `running` | Short pass: no timer output, exact old pacer keys |
| M13 doctor | Tail with `[keeper]`/`[pacer]`/`[serve]` end, `uncaught`, or non-zero exit, then routine `[tick]`/`[drain] stopped (exit 0)` | `_last_end` names the process-level line | Only routine lines: falls back to the routine line |

</intent-contract>

## Code Map

The investigation is `plans/36-5.md` `## Code Map` (with its "Anchors after 36.4" and "Facts the story must start from"): read it in full and start from it. Its `## Files` list is the boundary. Added from this session:

- `apps/supervisor/test/drain.test.ts` -- not in the plan's Files, but the plan's Anchors name it as the claim path's pin; a `skill-missing` claim case belongs there or in `queue.test.ts`/`api.test.ts`. Touching it is a file outside Files: report it as a deviation.
- `_bmad-output/specs/spec-epic-36/stories/36-4-the-host-leg-goes-red-for-code-only-spec.md` -- Verification/Design Notes hold the gate's environment facts, repeated below.

## Tasks & Acceptance

**Execution:**
- `apps/supervisor/src/queue.ts`, `cli.ts`, `api.ts`, `server.ts` -- `own_block` end detail, lock release with the engine veto, terminal cancel, both stop skips (Settled shape 1) -- DW-105.
- `apps/supervisor/src/cli.ts`, `sandbox.ts`, `server.ts` -- store check at `submitJob` and claim refusal; malformed block not resumed (Settled shape 2) -- DW-113.
- `apps/supervisor/src/sandbox.ts` -- detached, unref'd recorded hold; pid+start adoption (Settled shape 3) -- DW-109.
- `plugins/tk-studio/lib/jobrun.py`, `plugins/tk-studio/contracts/job.schema.json` -- lifted status, `finish --own-block`, `evaluate_stop` skip (Settled shapes 1, 4) -- DW-38, DW-105.
- `apps/supervisor/src/queue.ts`, `sandbox.ts` -- `Queue.openPinRestartOn(sandbox)`, guard (d) (Settled shape 5) -- DW-56, DW-58.
- `apps/supervisor/src/sandbox.ts`, `cli.ts` -- prune argv and helper at both pin sites (Settled shape 7) -- DW-60.
- `apps/supervisor/src/log.ts`, `page.ts`, `api.ts` -- slow-pass timer, `TeeIo` seam, `running?` (Settled shape 6) -- DW-63.
- `tools/installer/cli/tk_studio_cli/doctor.py` -- `_last_end` ranking -- DW-55.
- `apps/supervisor/test/{queue,sandbox,log,status-block,preflight,api,page,web}.test.ts`, `plugins/tk-studio/lib/tests/{test_jobrun,test_installer_doctor,test_driver_contract}.py` -- one or more tests per matrix row M1-M13, each named with `Story 36.5` -- proof.
- `plugins/tk-studio/contracts/driver-contract.md` -- 0.1.31 (36.5) clause, Stories row, paragraph, guard (d), `pacer`, lifted status, `own_block`, the refusal, malformed block; `test_0_1_31_story_36_5_…` -- AD-19.
- `apps/supervisor/README.md`, `kb/agent-pc-setup-runbook.md` -- the plan's rows -- docs.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- DW-38, 55, 56, 58, 60, 63, 105, 109, 113 → `status: resolved 2026-10-31 by this story's PR (36.5: …)` -- "the entries close by this PR".

**Acceptance Criteria:**
- AC1-AC3 above, each proven by the matrix tests or a command's output. Live-tier proofs are `unverifiable-here` with the exact operator command: the hold count on a live run, the win32 survival of a detached hold, and the real `sbx skills ls` capture, each through the Consult Log.
- Given the merged change, when the operator deploys it, then this story changes the **serve process** (`POST /runs/{id}/cancel`, `POST /jobs`, `GET /status`'s pacer): the operator stops the supervisor tab before the loop builds `apps/supervisor` and restarts it through the scheduled task after the merge.

## Spec Change Log

## Review Triage Log

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 5, low 2)
- defer: 1 (high 0, medium 1, low 0)
- reject: 1 (high 0, medium 1, low 0)
- addressed_findings:
  - `[medium]` `[patch]` `recover`'s already-terminal path dropped `own_block` (both layers): `resumeEligible` answers it, `restartResumer` forwards it, two M4 tests.
  - `[medium]` `[patch]` M5/M6 read the real skills store and would go red on the Windows host: isolated with an empty `LOCALAPPDATA`, proven on the real store layout.
  - `[medium]` `[patch]` `hasMalformedStatusBlock` took any string `status`: narrowed to §3 values, tests added.
  - `[medium]` `[patch]` AC2's "every shipped core" had no test: `test_story_36_5_every_shipped_core_stops_on_its_real_blocked_output`; it exposed the `execute_core` decode failure, also fixed.
  - `[medium]` `[patch]` A marked run past a worker could skip the probe beside a live engine (the implementer's report, consult ruling reject-deviation): `ownBlockRulesOutEngine`, four M2 tests, one per veto site, each site's revert seen failing.
  - `[low]` `[patch]` The refusal named an undocumented import form: reads `tk-studio update, then sbx skills import --force`.
  - `[low]` `[patch]` `apps/supervisor/README.md` contradicted the new behaviour on cancel, `pacer`, the refusals and the pin rule: rows updated.
- rejected: a lacking listing with no readable store folder refuses (both layers): the consult ruled reading (A), carried as a named residual.
- deferred, rule (a) (AC1's "the next submission is woken"): own-marked runs still count toward `stop.max_runs`.

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 5, low 2)
- defer: 0
- reject: 2 (high 0, medium 2, low 0)
- addressed_findings:
  - `[medium]` `[patch]` M10: a cold pin never recorded a healed signal, so an old episode stayed open and a later logout got no restart (both layers): with an episode open, a cold pin probes and records `probe_clean`; contract sentence added; tests added.
  - `[medium]` `[patch]` M4: `own_block: "auth"` landed on a block the worker wrote, matched by the auth regex, so its `on_status` stop was skipped (both layers): marked only where the supervisor's `authBlock` becomes the status block; test extended.
  - `[medium]` `[patch]` AC2: a live hold whose start time was unreadable, or whose group survived, counted as dead and could respawn every tick (edge-case-hunter): `respawnHolds` reads `workerMayRun`; three tests through the real probe.
  - `[medium]` `[patch]` AC1: no test reached the `worktree` (hole 93), `placement` or `engine-mcp` marker build sites (blind-hunter): three `runJob` tests in `drain.test.ts`; each site's mutation failed only its own test.
  - `[medium]` `[patch]` AC1's store check left three stale pins in `command-line.test.ts`, seen only with `TK_STUDIO_ROOT` set (this session's whole-suite run, not a layer): the pins edited in place, two consults.
  - `[low]` `[patch]` M7: the `--own-block` assertion could never fail (blind-hunter): reads the `finish` argv.
  - `[low]` `[patch]` `SKILL_MISSING_RESOLVES` took over `LOCK_RESOLVES`'s doc comment (blind-hunter): moved.
- rejected: own-marked runs count toward `stop.max_runs` (blind-hunter): already this story's deferral, DW-157, not filed twice.
- rejected: a lacking listing with no readable store folder refuses (both layers): the 13:09:40Z consult ruled reading (A), carried as a named residual; not consulted twice.

### 2026-10-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3 (high 0, medium 1, low 2)
- defer: 0
- reject: 9 (high 0, medium 3, low 6)
- addressed_findings:
  - `[medium]` `[patch]` M4: `finishRun`'s failed-`finish` returns carried a marker that never landed, so `mirror` could skip the stop and release the lock for a state it never described (edge-case-hunter): both returns take `own_block` only from the `status` read; five `status-block.test.ts` tests, one consult.
  - `[low]` `[patch]` AD-11: `--own-block` used argparse `choices`, so a bad kind answered with usage text (blind-hunter): `choices` removed, the module's check answers; a CLI test.
  - `[low]` `[patch]` The contract's "neither source readable, nothing refused" had no test past `skillInStore` (blind-hunter): one claim-path test and one `submit` test.
- rejected: a lacking listing with no readable store folder refuses (both layers): the 13:09:40Z consult ruled reading (A), carried as a named residual; not consulted twice.
- rejected: the plain `run` path has no store check (blind-hunter): AC1 names `submit`; the claim path is checked, and the deviation is already accepted.
- rejected: own-marked runs count toward `stop.max_runs` (edge-case-hunter): already this story's deferral, DW-157, not filed again.
- rejected: the detached hold lost `HOLD_TIMEOUT_S` (blind-hunter): that value is setTimeout's ceiling of about 24.8 days, not a working bound, and Settled shape 3 spells this spawn.
- rejected: the stage file's removal loses the plan records (blind-hunter): the spec's `## Stage Log` carries both plan rows; the reviewer's diff excluded the spec.
- rejected: two processes' `respawnHolds` can race during the probe (edge-case-hunter): the window is one probe between a tick and an operator's `recover`, and neither a tick-per-event count nor the adoption rule changes.
- rejected: an overlapping same-tag pass removes `running` (edge-case-hunter): the runbook's scheduled tasks are `MultipleInstances IgnoreNew` (`kb/agent-pc-setup-runbook.md:502`, `:1530`).
- rejected: a second step's slow pass overwrites `running` (edge-case-hunter): Settled shape 6 names one `running` object.
- rejected: a killed pass leaves `running` behind (edge-case-hunter): the next same-tag pass removes it.

## Design Notes

Gate environment (36-4): `bun` is at `~/.bun/bin/bun`, not on `PATH`: `export PATH="$HOME/.bun/bin:$PATH"`. `apps/supervisor/node_modules` may be absent: `bun install --frozen-lockfile` there first and commit nothing it produces. Typecheck with `bun node_modules/typescript/bin/tsc --noEmit`. `test/tier.test.ts` and `guards.test.ts` fail at baseline with the five `TK_ATLASSIAN_*` variables set (this environment sets them): unset them for the whole-suite run. On bun 1.4.3 the preload's 30 s default reaches only a run's first file: pass `--timeout 30000` on multi-file runs. Bound anything that can hang with `timeout -k 5 <s>`.

The `sbx skills ls` format is not recorded in the repo: the parser takes one name per line, first whitespace-separated token, and gets pinned to the operator's capture when it lands. This is the plan's settled reading, not an open question.

## Verification

**Commands:**
- From `plugins/tk-studio/lib`: `uv run python -m unittest discover tests` -- expected: OK.
- From `plugins/tk-studio/lib`, bun on `PATH`: `uv run python ../contracts/conformance/runner.py run` -- expected: `ok: true`.
- From the project root: `uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster` -- expected: OK.
- From `apps/supervisor`, `TK_ATLASSIAN_*` unset: `bun test --timeout 30000` -- expected: 0 fail; and `bun node_modules/typescript/bin/tsc --noEmit` -- expected: clean.
- From `apps/supervisor`: `bun test --timeout 30000 -t "Story 36.5"` -- expected: matrix tests pass, none skipped.

**Manual checks (if no CLI):**
- Operator, through the Consult Log: `sbx skills ls` capture; a live run's `hold` event count across ticks on win32.

## Deviation Summary

### pass 1 (implementer, score 2)

- planned: `test/drain.test.ts` not in the plan's Files / actual: the M6 claim cases live there / why: the Code Map names it as the claim path's pin and says to report it / may affect: none
- planned: invert the unverified-holder case at `queue.test.ts` :1108 / actual: that case stays as a no-marker fail-closed test, and new M1 cases cover the own block / why: without `own_block` the fail-closed path is still correct / may affect: none
- planned: `own_block` values `render` (resume path) and `lock` are set where built / actual: both are declared and honoured but no code path sets them / why: `render` needs `closeout.ts`, outside Files, and no rename-race end exists; a lock refusal leaves the run `queued`, so it never ends blocked / may affect: 36-7
- planned: `endAfterDriveFailure`'s `resolve:`/`registry:` StartErrors are marked / actual: only `WorktreeFailed`, the engine-MCP refusal and post-claim placement are marked / why: those two errors are thrown before the claim and never reach it; other post-claim verb errors can't be typed without sniffing text, so they stay unmarked / may affect: none
- planned: `auth` on `invokeSkill`'s auth reasons / actual: a worker's 401 on a `tk-studio-launch` run is not marked / why: that worker may have started an engine, so the launch probe keeps judging the lock (the Block If's veto, narrowed without a consult) / may affect: none
- planned: terminal `cancel` releases any `kind='engine'` row naming the run / actual: only an unverified row (no engine id) with no engine on the run's record; a named engine keeps the 409 / why: releasing a live engine's lock would break the veto / may affect: none
- planned: a `pinned` whose probe was clean / actual: new detail `probe_clean: true`, plus a new `pinned` event when a clean probe closes an open episode even if a pin stands / why: `pinned` carried no probe and a standing pin writes no event, so the healed signal would be missed / may affect: none
- planned: a repeat restart patches its event in place, `openPinRestart(queue, runId, sb)` / actual: signature is `openPinRestart(queue, sb)` and the patch path is gone; two 33.3 tests changed to the per-sandbox rule / why: guard (d) makes the patch unreachable / may affect: none
- planned: `InvokeOptions.pin` carries the failure kind implicitly / actual: added a `pinOwnBlock` read-after seam on `RunRecorder` and the invoke options / why: `enginemcp.test.ts`, outside Files, pins `pin` as a string / may affect: none
- planned: the store check per Settled shape 2 / actual: three additions: neither source readable logs one line and refuses nothing; a listing that lacks the skill still defers to the store folder; the plain `run` verb is not checked / why: nothing proves absence, plugin-level listings are possible, and the spec names only `submit` and the claim / may affect: none
- planned: `refusal("skills-store:SkillMissing", …)` / actual: one message string, `skills-store:SkillMissing: …`, with the name added to `NAMED_REFUSALS` / why: `refusal()` takes a message, and its second argument is `problems` / may affect: none
- planned: `evaluate_stop` skip / actual: it also falls back to the last run without a marker, and `status` now answers `own_block` / why: "skip a run" read literally, and `recover`'s twin reads the marker through `status` / may affect: none
- planned: `test/web.test.ts` modified, and the `api.ts` pacer reader changed / actual: neither needed a change; `api.ts` passes `running` through unchanged / why: the exact-key pin still holds when `running` is absent / may affect: none
- planned: amend the 0.1.28 guard (d) text in place / actual: the 36.5 paragraph restates it and the old text stays / why: the contract's additive paragraph convention / may affect: 36-7
- planned: `bun install --frozen-lockfile` clean / actual: it reported `Failed to link typescript: EPERM`, but the `typescript` package installed and `tsc` ran directly / why: environment; nothing it produced was committed / may affect: none

DRIFT: `test/drain.test.ts` touched (M6 claim cases) — the Code Map names it as the claim path's pin — affects: none
DRIFT: the unverified-holder test kept, not inverted — no-marker fail-closed stays correct — affects: none
DRIFT: `own_block` `render` and `lock` declared and honoured, set by no path — `closeout.ts` is outside Files, and a lock refusal never ends blocked — affects: 36-7
DRIFT: `resolve:`/`registry:` StartErrors unmarked — thrown before the claim; other post-claim errors can't be typed without sniffing — affects: none
DRIFT: a `tk-studio-launch` worker's 401 unmarked — the worker may have started an engine — affects: none
DRIFT: terminal `cancel` releases only an unverified row with no engine on record — a named engine's lock must not be released — affects: none
DRIFT: `pinned` gains `probe_clean: true` and an episode-closing `pinned` event — no healed signal existed on a standing pin — affects: none
DRIFT: `openPinRestart(queue, sb)` signature, patch path removed, two 33.3 tests changed — guard (d) makes the patch unreachable — affects: none
DRIFT: `pinOwnBlock` seam on `RunRecorder` — `enginemcp.test.ts` pins `pin` as a string — affects: none
DRIFT: store check fails open on no readable source and defers to the store folder; `run` unchecked — nothing proves absence — affects: none
DRIFT: refusal as one message string plus `NAMED_REFUSALS` — `refusal()`'s signature — affects: none
DRIFT: `evaluate_stop` falls back to the last unmarked run; `status` answers `own_block` — the skip read literally; `recover` reads through `status` — affects: none
DRIFT: `web.test.ts` and `api.ts` unchanged — not needed — affects: none
DRIFT: guard (d) restated in the 36.5 paragraph, old text kept — additive convention — affects: 36-7
DRIFT: `bun install` EPERM on the typescript link — environment — affects: none

### pass 1 correction (consult ruling)

The launch-401 entry's "may affect: none" above is replaced by this residual, per the ruling (the section is append-only, so the correction is written here rather than over the entry): a `tk-studio-launch` worker's 401 leaves the run unmarked, the stop can fire, and an unverified row waits for `cancel`.

## Consult Log

- 2026-10-31T13:01:42Z — trigger: deviation-gt-0, file-outside-files — question: accept the deviation set (unset `render`/`lock`, store check fail-open and folder deferral, launch 401 and terminal cancel narrowed to the veto, `drain.test.ts`)? — ruling: accept-deviation score 2 — do: accept the whole set, no behaviour changes; correct `driver-contract.md` prose at :2295-2296 (no path sets `lock` or `render` today) and :2308 (a listing lacking the skill also defers to the store folder); replace the launch-401 entry's "may affect: none" with the residual; keep the `sbx skills ls` capture `unverifiable-here`, and take the `bad_spec` consult if it shows neither source exists — rule candidate: an AC's enumerated `own_block`-style value no code path can reach is declared, documented in the contract as set by no path today, and scored 2, with no consult needed; a store or registry check refuses only on proven absence and logs when no source can answer.
- 2026-10-31T13:09:40Z — trigger: deviation-gt-0 — question: `sbx skills ls` exits 0 lacking the skill with no readable store folder: refuse (A) or `unknown` (B)? — ruling: apply — do: keep reading (A), no change to `skillInStore` or the `fake({ exit: 0, stdout: "", stderr: "" })` pin; record the residual beside the `unverifiable-here` capture: a plugin-level listing plus an unreadable store folder refuses every sbx job, by name, until the capture lands; if the capture shows plugin-level names, a lacking listing stops being proof and this check is re-pinned; "proven absence" in the earlier rule candidate includes a listing that answered — rule candidate: a store or registry check treats any source that answers (exit 0, even if empty) as evidence; "nothing refused" applies only when no source can answer, and an unpinned output format is carried as a named residual on the operator's capture, not as a fail-open.
- 2026-10-31T13:25:39Z — trigger: deviation-gt-0 (plan Block If) — question: a marked run with no recorded engine may skip the probe beside a live engine in `recover`/`mirror`; accept with a residual or patch? and pass 2's deviations? — ruling: reject-deviation — do: add `ownBlockRulesOutEngine(run)` = `noEngineRecorded(run) && run.worker_pid == null`, used at `queue.ts:1919`, `:2174`, `:2491`, `cli.ts:1734`; leave `noEngineRecorded` and terminal `cancel`, keep the marker and both stop skips, add "and no worker recorded" to the contract's 36.5 `own_block` sentence; add three `queue.test.ts` tests (`drivenLaunch`, `setWorker`, `own_block: "pin"`); accept all six pass 2 deviations at score 1 as `DRIFT:` lines plus the residual — rule candidate: a marker that skips a safety probe must be conditioned on a recorded fact that makes the probed thing impossible (no worker ever spawned), never on where the block was built.
- 2026-10-31 (follow-up review) — trigger: deviation-gt-0, file-outside-files — question: AC1's store check turns three pins red in `test/command-line.test.ts` (:1366, :1396, :1463; the suite no gate runs, outside Files): update them or carry them red? and the patch pass's deviation? — ruling: accept-deviation score 1 — do: option A, edit only those pins and add no test (:1366 exactly one `skills ls`; :1396 `verbs.slice(0, 9)` with both listings first, comment :1394 naming them; :1463 `fx.calls()` `[]` and `fx.sbxCalls()` the submit's one `skills ls` after both drains); record DRIFT, file-outside-files, score 1, and re-run that file with `TK_STUDIO_ROOT` set and `TK_ATLASSIAN_*` unset plus `tsc --noEmit`, consulting again if anything else there goes red; accept the patch pass's `workerMayRun` import, three extra tests and contract sentence at score 1; no operator ruling, AC1 settles `submit` — rule candidate: a story's Files list implicitly includes in-place edits to existing `command-line.test.ts` assertions that an AC's new sbx call makes stale (no new tests), and a story adding an sbx call on a pinned path runs that suite with `TK_STUDIO_ROOT` set before commit.
- 2026-10-31 (follow-up review) — trigger: file-outside-files, the previous ruling's "consult again" — question: that ruling's nine-slot value for `command-line.test.ts:1396` is red, the ninth verb being `exec`; what should the pin say? — ruling: accept-deviation score 1 — do: `verbs.slice(0, 10)` toEqual `["skills","skills","ls","run","auth","stop","run","auth","exec","auth"]`, :1394's comment naming the /tmp prune, nothing else edited; print the recorded args once with a temporary edit, then remove it: slot nine equals `pruneTmpArgv("s-restart")`, slot ten the auth probe, else report and change nothing; re-run expecting 109 pass, 0 fail, `tsc` exit 0; the review pass does not stop, the prune joins the score-1 DRIFT line, and any other red there is a new consult — rule candidate: when a consult dictates an exact call-sequence pin, derive it from the nearest existing sequence pin in the suites and the recorded calls, not by appending to the old list.
- 2026-10-31 (second follow-up review) — trigger: deviation-gt-0 — question: on `finishRun`'s failed-`finish` returns, accept the marker read from the studio record even when this pass recorded none, plus the test path and two extra tests? — ruling: accept-deviation score 1 — do: option A, keep the patch, the status value the only marker source on both returns; if `status-block.test.ts` lacks it, add a case (no marker from this pass, a refused `finish`, a studio run carrying `own_block`, a recorded worker) asserting `mirror` skips the stop and still takes the launch probe, no own release; record `DRIFT:` lines for all three, correcting the trigger (`finish` no-ops on a same-state `blocked`, so this path needs a different worker state or a failed `finish` call), and one residual: a no-op `finish` on an own-marked run returns no marker, so `mirror` can still stop where `evaluate_stop` skips — rule candidate: when a supervisor summary reports a run's state from the studio record, it takes `own_block` from that same read and never from a marker of a `finish` that did not land; a safety skip stays gated by `ownBlockRulesOutEngine`.

## Stage Log

| stage | pass | started | ended | session_id | model | effort | tokens_in | tokens_out | cost_usd | outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| plan | — | 2026-10-30T20:25:52Z | 2026-10-30T20:48:44Z | — | claude-opus-5-5 | high | — | — | — | done |
| plan | — | 2026-10-31T11:30:47Z | 2026-10-31T11:32:13Z | — | claude-opus-5-5 | high | — | — | — | done |
| dev | 1 | 2026-10-31T12:20:54Z | 2026-10-31T13:50:24Z | df2bbc37-7a69-46a7-afdc-2cb0911322f2 | claude-opus-5-5 | medium | 14674439 | 271440 | 19.1219 | completed |
| review | 1 | 2026-10-31T13:50:25Z | 2026-10-31T14:45:16Z | e0e14913-3303-4032-881b-0c7033349138 | claude-opus-5-5 | medium | 7829751 | 140103 | 9.1286 | completed |
| review | 2 | 2026-10-31T14:45:17Z | 2026-10-31T15:27:06Z | 7f68f94e-5739-46b8-a95a-d7988aff017e | claude-opus-5-5 | medium | 4980545 | 101480 | 7.2225 | completed |
| gate | 1 | 2026-10-31T15:27:07Z | 2026-10-31T15:31:16Z | 6dbe3824-4080-4b9e-8d8a-f303936422bf | claude-opus-5-5 | medium | 1318216 | 25304 | 2.0565 | completed |
| host-leg | 1 | 2026-10-31T15:31:30Z | 2026-10-31T16:14:39Z | — | — | — | — | — | — | red |
| close-out | 1 | 2026-10-31T16:14:39Z | 2026-10-31T16:14:45Z | — | — | — | — | — | — | draft PR |
| re-run | 1 | 2026-10-31T16:17:01Z | 2026-10-31T17:03:08Z | — | — | — | — | — | — | green |
| merge | — | 2026-10-31T17:03:45Z | 2026-10-31T17:03:45Z | — | — | — | — | — | — | merged |

## Deviation Summary, pass 2

(The section above stays append-only. This is its `### pass 2`, placed after the Consult Log because that log was appended first.)

- planned: M5/M6 isolation proven with `LOCALAPPDATA` holding `tk-studio/skills/<skill>/` / actual: also the real `DockerSandboxes/sandboxes/state/agent-skills/tk-studio/skills/<skill>/` layout, with a pre-fix baseline / why: the requested layout is never read / may affect: none
- planned: drive each core through `execute_core` / actual: through `jobrun.wake`, which calls it / why: both shipped cores are `cron`, and `submit` executes only one-shot jobs / may affect: none
- planned: fix `jobrun.py` only if a core's output would not lift / actual: `execute_core`'s `subprocess.run` gained `encoding="utf-8", errors="replace"` / why: a Windows decode failure left a core run stuck `running` / may affect: core runs on the Windows host, whose output now decodes as UTF-8
- planned: one M4 test / actual: two, one through the real `restartResumer` / why: a fake cannot prove the `status` read or the forward / may affect: none
- planned: matrix M7 "string `status`" / actual: §3 values only / why: a worker quoting `{"status":"success"}` must keep its resume / may affect: none
- planned: `sbx skills import <release archive>` / actual: `tk-studio update, then sbx skills import --force` / why: the runbook's documented form / may affect: none

DRIFT: `execute_core` decodes core output as UTF-8 — a Windows decode failure left a core run stuck `running` — affects: none
DRIFT: the shipped-core test drives through `jobrun.wake` — shipped cores are `cron` — affects: none
DRIFT: two M4 tests — a fake cannot prove the forward — affects: none
DRIFT: M5/M6 isolation proven with the real store layout — the requested layout is never read — affects: none
DRIFT: M7 narrowed to §3 status values — a quoted non-§3 object keeps its resume — affects: none
DRIFT: refusal text reads `tk-studio update, then sbx skills import --force` — the runbook's form — affects: none
DRIFT: residual: a resumed launch whose probe fails hands the lock to an unverified engine, as it did before 36.5, and `cancel` answers it — the veto takes precedence — affects: none

### Deviation Summary, pass 3

- planned: the `endDriven` probe-live test asserts the lock goes to the engine, three M2 tests / actual: an added unverified-probe case, a close-out assertion on the `mirror` test, and a fourth M2 test for `recover` / why: without them, reverting those call sites passed every test / may affect: none

DRIFT: M2 tests go past the ruling's three — reverting a veto site otherwise passed every test — affects: none

### Deviation Summary, follow-up review

- planned: the plan's Files as the boundary / actual: three existing pins edited in `test/command-line.test.ts`, with no test added / why: AC1's `skills ls` at `submit` and the claim, and M11's prune, made them stale; two consults accepted it / may affect: none
- planned: `sandbox.ts` needs no import change / actual: `workerMayRun` added to the existing `./queue` import / why: it was not imported; no new edge / may affect: none
- planned: the requested tests / actual: three more (the recorder carrying a cold pin's clean probe, a cold-pin probe that throws, a worker `partial` under an auth failure) / why: they pin behaviour the patches rely on / may affect: none

DRIFT: `command-line.test.ts` pins :1366, :1396 and :1463 edited in place, :1396 including the /tmp prune — AC1's store check and M11 made them stale; no test added — affects: none
DRIFT: `workerMayRun` added to the `./queue` import in `sandbox.ts`, and three tests past the brief — needed by the hold patch, and pinning the patches' behaviour — affects: none

### Deviation Summary, second follow-up review

- planned: the refused-finish tests drive the real path / actual: `finishRun` then the real `mirror`, with a fake verb runner / why: the real `selfFinish` fixture lives only in `command-line.test.ts`, where no test may be added / may affect: none
- planned: two refused-finish tests / actual: also two `finish failed:` cases, and the consult's recorded-worker case / why: the fail-closed rule had no test; the consult asked for the last / may affect: none
- planned: keep `own_block` when the run carries it / actual: the status value is used even when this pass recorded no marker; it arises with a different worker state or a failed `finish` call, because `finish` no-ops on a same-state `blocked` / why: the summary's state already comes from that read, and `evaluate_stop` reads the same record / may affect: none

DRIFT: refused-finish tests use a fake verb runner — the real fixture is only in `command-line.test.ts` — affects: none
DRIFT: three tests past the brief's two — the fail-closed rule and the consult's recorded-worker case — affects: none
DRIFT: a failed `finish` reports the studio record's `own_block` even when this pass recorded none — `state` comes from the same read, and `evaluate_stop` reads that record — affects: none
DRIFT: residual: a no-op `finish` on an own-marked run returns no marker, so `mirror` can still stop where `evaluate_stop` skips — consult ruling — affects: none

## Auto Run Result

Status: done

Studio: activated as developer; working set bmm, tea, bmb, bmad-loop, gds; drift drift; fixes: run `uv run <plugin>/lib/plansync.py sync-back --directory /c/agent-work/worktrees/tk-studio/q-run-epic-36-20261031T121930Z-29f699` and declare the atlassian-sync-back job in .tk-studio/config.yaml jobs; nothing to do on a box with no engine sandbox; on the engine box set TK_SUPERVISOR_CONFIG to the supervisor config naming jobs.<project>/<job>.sandbox; routing implementer=claude-opus-5-5 reviewers=claude-opus-5-5 consult=claude-opus-5-5; knowledge spine absent

**Summary.** This was a second follow-up review over the whole diff from `8546cf3`, up to `7dadff6`. The story's behaviour stands; it found one behaviour fault and two small gaps, all patched:
- A failed `finish` no longer carries a marker that never landed. The summary's `own_block` now comes only from the studio record (M4).
- A bad `--own-block` value now answers with the JSON status block, not argparse usage (AD-11).
- "Neither source readable, nothing refused" now has tests on the claim and `submit` paths.

**Serve process changes.** Unchanged from the story: the operator stops the supervisor tab before the loop builds `apps/supervisor`, and restarts it through the scheduled task after the merge.

**Files.**
- `apps/supervisor/src/cli.ts`: the marker on `finishRun`'s failed-`finish` returns.
- `plugins/tk-studio/lib/jobrun.py`: `--own-block` validated by the module.
- `apps/supervisor/test/status-block.test.ts`, `drain.test.ts`, `api.test.ts`, `plugins/tk-studio/lib/tests/test_jobrun.py`: the proofs.

The deferred-work ledger was not touched, per this run's instruction, and no deferral was filed.

**Review.** Both layers ran (band L), each given the code diff by file path, without the spec, ledger and stage files. Patches 3 (medium 1, low 2), deferred 0, rejected 9, 0 bad_spec, 0 intent_gap. One consult, `accept-deviation score 1`; the frontmatter `deviation_score` stays 2 from the story's passes. Follow-up review: true (patched high 0, medium 1, low 2; score 3 x 1 + 2 = 5, threshold 5). Nothing has re-reviewed this pass's patches.

**Verification (run by this session).**
On the final tree:
- `bun test --timeout 30000`, `TK_ATLASSIAN_*` unset: 1837 pass, 95 skip, 0 fail.
- The same with `TK_STUDIO_ROOT` set, which runs the e2e suite: 1919 pass, 7 skip, 0 fail.
- `tsc --noEmit`: exit 0.
- `bun test --timeout 30000 -t "Story 36.5"`, `TK_STUDIO_ROOT` set: 60 pass, 1 skip, 0 fail. The skipped test was not identified.

After the source patches, before the last change (one test added to `status-block.test.ts`), and not repeated:
- `uv run python -m unittest discover tests`: 2758 tests, OK (skipped=4).
- `runner.py run`, bun on `PATH`: exit 0, `ok: true`, `failures: []`.
- `tests.test_release_roster`: 86 tests, OK.

Reported by the implementer and not repeated here: each new test failed with its fix reverted or its check broken. Two limits: in the first refused-finish test the `own_block` assertion trips first, so its stop assertions were not seen failing on their own; in the recorded-worker test only the `closeout: skipped` assertion catches the mutated `mirror` site, because `endDriven` has its own probe and veto.

**Unverifiable here (the operator's, through the Consult Log).**
- `sbx skills ls` on the host: paste the output. The parser stays unpinned until then.
- On a live sandbox run on the Windows host, count the run's `hold` events across several ticks: they must not grow per tick, and the recorded hold pid must outlive the tick that spawned it. A hold that dies with the tick means Settled shape 3 fails there.

**Residual risks.**
- New: a no-op `finish` on an own-marked run returns no marker, so `mirror` can still stop where `evaluate_stop` skips (consult ruling).
- New: the recorded-worker test does not cover a probe answering not live, or a probe that fails.
- The spec's Verification command leaves `TK_STUDIO_ROOT` unset and `tools/verify_host.py` excludes `command-line.test.ts`, so no gate runs the e2e suite. The new `api.test.ts` store test also skips without `TK_STUDIO_ROOT`.
- A cold pin with an episode open adds one login probe. With none open it adds nothing.
- A live hold with an unreadable start time is left alone, so a pid reused with an unreadable start time could leave an engine without a hold until that pid ends.
- Own-marked runs still count toward `stop.max_runs` (DW-157, open).
- A plugin-level listing plus an unreadable store folder refuses every sbx job, by name, until the capture lands (consult ruling).
- AC1 lists `lock` and `render`, but no code path sets either; the contract says so.
- A `tk-studio-launch` worker's 401 stays unmarked: the stop can fire, and an unverified row waits for `cancel`.
- A resumed launch whose probe fails hands the lock to an unverified engine, as before 36.5, and `cancel` answers it.
- A supervisor death after spawning a worker but before `onSpawn` records it leaves `worker_pid` null, so the probe is still skipped. Read from the code, not tested.
- The store check is not on the plain `run` verb, and when no source can answer it logs one line and refuses nothing.

DRIFT: refused-finish tests use a fake verb runner — the real fixture is only in `command-line.test.ts` — affects: none
DRIFT: three tests past the brief's two — the fail-closed rule and the consult's recorded-worker case — affects: none
DRIFT: a failed `finish` reports the studio record's `own_block` even when this pass recorded none — `state` comes from the same read, and `evaluate_stop` reads that record — affects: none
DRIFT: residual: a no-op `finish` on an own-marked run returns no marker, so `mirror` can still stop where `evaluate_stop` skips — consult ruling — affects: none

## Reconcile

### 2026-10-31 — no-impact

- Score: 2
- Reasoning: Every deviation stays inside 36.5's own surface, and 36-6 and 36-7 rely on none of it. The two `affects: 36-7` lines (`lock` and `render` set by no path; guard (d) restated beside the old text) touch no sentence of `plans/36-7.md`, whose contract surface is unchanged and which neither sets nor reads `own_block`. The diff from `8546cf3` adds no supervisor value-import edge (one `type OwnBlock` name and `node:child_process`), so 36-7's cuts and SCC allowlist stand. Later plans' line anchors moved, which both plans already tell the dev session to re-grep. The contract changes are the additive 0.1.31 paragraph, and the consults accepted the set, so no AD, contract surface or ruling is contradicted.
- Affected: none
- Invariant: none

Gate: Part A no-impact; Part B story accepted, planned 36-6-setup-and-the-launch-check-by-evidence
