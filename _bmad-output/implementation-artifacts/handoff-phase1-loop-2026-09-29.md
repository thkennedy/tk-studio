# Handoff: the supervisor is built (boundary 2026-09-29)

Written for a fresh Claude Code session on the agent PC (TIM-PC-2). It supersedes `handoff-phase1-loop-2026-09-28.md` for the state of Phase 1. The engine mechanics in that file and in runbook §3.8 still hold. The starter prompt is at the end.

## Where things stand

**The supervisor's code is complete.** Epics 21 and 22 (supervisor stories 21-1 to 21-6 and 22-1 to 22-3) were built through the studio's launch pipeline, every leg on Claude Opus 5.5.

| Repo | PR | State on 2026-09-29 |
|---|---|---|
| tk-studio-supervisor | #2, Epic 21 | merged (`c67a408`) |
| tk-studio-supervisor | #3, Epic 22 | open, waiting for Tim |
| the-universe-awaits | #2, `.tss` files pinned to LF | merged (`6c64555`) |
| tk-studio | #84, Godot in the sandbox provisioning | merged (`d09fba8`) |
| tk-studio | #85, Story 22.4, runbook §4 as built | open, waiting for Tim |

**Verification of the supervisor's final code** (`loop/epic-22`):

| Where | `bun test` | Typecheck |
|---|---|---|
| Linux engine sandbox | 559 pass, 3 skip, 0 fail | clean |
| Windows host, end-to-end suites on (`TK_STUDIO_ROOT` set) | 545 pass, 16 skip, 0 fail | clean |

**The supervisor has never been started on the host.** It is started only from the console, never from a Claude desktop-app session. Everything in "Tim's steps" below is still to do.

**The TUA engine is unblocked.** Tim added the sandbox-scoped NuGet and .NET network rule. The sandbox `claude-the-universe-awaits` has .NET SDK 8.0.425 and Godot 4.7.2 mono, and `TUA_ENGINE_GATE=1 bash scripts/verify.sh` is green there (1030 xunit tests, 137 engine tests).

**Quota.** Claude can read it: load the deferred tool `mcp__ccd_session_mgmt__get_usage`. On 2026-09-28 at about 19:15Z it read 16% weekly (all models) and 7% Fable, with the weekly reset at 2026-09-29T05:00Z.

## What the trial has measured

Metered at list prices, every leg on Opus 5.5, usage deduplicated by `message.id`.

| Story | $ | Minutes | Attempt | Review share |
|---|---|---|---|---|
| 20-1 | 3.97 | | 1 | |
| 20-2 | 7.14 | 14.5 | 1 | |
| 24-1 | 18.43 | | re-driven | |
| 21-1 | 19.45 | | 1 | |
| 21-2 | 12.13 | | 1 | |
| 21-3 | 38.13 | 89.6 | 1 | 45% |
| 21-4 | 20.02 | | 1 | |
| 21-5 | 27.49 | 62.5 | 1 | 51% |
| 21-6 | 35.53 | about 116, with a 30-minute stall | 1 | 40% |
| 22-1 | 22.43 | 54 | 1 | 50% |
| 22-2 | 17.68 | 47 | 1 | 53% |
| 22-3 | 29.25 | 75 | 1 | 44% |

Epic 21 cost $152.75 and Epic 22 cost $69.36. "Review share" is the reviewer subagents plus the follow-up review and gate sessions. It is the strongest routing lever for the Epic 24 verdict.

Every supervisor story landed on its first attempt. Two defects still got through the gate and were fixed by hand: the signal race in 21-5, and the Windows-only test failures in 22-2 and 22-3.

## Holes in the dev loops

Each one is in the host's observation ledger (`~/.tk-studio/measurements/tim-Tim-PC-2.jsonl`), with a description that starts "Loop deficiency:". None has a fix in tk-studio yet unless the table says so.

| # | What happened | Hole to plug |
|---|---|---|
| 1 | A dev session named its spec `<id>.md`. The engine resolves `<id>-*.md`, read the finished story as pending, and called the session stalled (21-6). | Pin the file name in the customization or the manifest, and refuse a wrong name at the `pre_commit` gate. Worked around in Epic 22 by a note in every `stories.yaml` entry. |
| 2 | Claude Code showed "Make auto mode your default?" in a bypass session. The engine's nudge was typed into the dialog, which flipped the sandbox's default permission mode. | Pre-answer the dialog in `provision-engine.sh`. |
| 3 | The engine's stall grace re-arms on any growth of the pane log, and Claude Code's rotating footer tips grow it. The second nudge came about ten minutes late. | Upstream bmad-loop issue. |
| 4 | The supervisor's `max_tokens_per_story` was the template's 2,000,000; stories measure 3.9M to 4.4M weighted. | Check the policy limits against the budget bands at launch. Raised to 5,000,000 by hand (machine-local). |
| 5 | An sbx engine reads the Windows checkout, where `* text=auto` files are CRLF. TUA's gate was red on 2 tests. | Report unpinned byte-exact formats at onboarding. Fixed for TUA; the rule is in runbook §3.8. |
| 6 | Spec file names run to about 150 characters. A clone in a deep folder fails on Windows. | Short ids for file names, or `core.longpaths`. Host verification uses a short-path clone. |
| 7 | The engine lives only as long as one host `sbx exec` started from a desktop-app session. | The supervisor's `start.ps1` holds engines once it runs (Story 22.3). |
| 8 | 21-5 landed with a timing race, because its signal tests passed once at the gate. One story later they failed on every run and the run paused. | Run process and signal tests more than once at the gate. On `verify-red`, measure the failure rate on the baseline first. |
| 9 | When a run pauses after the work is committed, the engine's close-out never runs. Closing 21-6 by hand took seven steps. | One script or launch verb that closes a landed story by hand. |
| 10 | A headless launch ended by asking a question, with no status block. Three launches behaved three ways on their own bootstrap output. | One rule for the bootstrap output, and a conformance drive for the dirty-tree case. |
| 11 | The verify gate has no Windows leg. Three Windows-only findings reached the branch. | A Windows leg: `bun test` on the host, in a clone of the story commit, before the story is accepted. |
| 12 | The loop wrote the win32 test paths from Linux. The first host run failed 29 tests. | Same as 11. |

## Next work, in order

1. **Tim's steps, from the console.** They are listed in supervisor PR #3 and in runbook §4 (Story 22.4):
   - review and merge supervisor PR #3 and the runbook PR
   - review `operator-decisions.md` in the Epic 22 spec folder (variable names, port `8787`, the editor-in-the-loop flag)
   - set the `TK_SUPERVISOR_*` variables, add the `shell:startup` shortcut, reboot, and run the smoke `curl` from another device
   - run the two live DW-10 checks (kill the supervisor mid-run and restart it; restore a deleted transcript from the backup)
   - decide DW-20: how the status page is opened from a phone browser
   - retire the "Docker Sandboxes daemon" sign-in task once `start.ps1` has brought the daemon up across a reboot
2. **Epic 24.2 to 24.4, the Opus 5.5 trial.**
   - 24.2 has its data: the table above.
   - 24.3, the paired runs on TUA, needs `throwaway/route-v2` and `throwaway/route-o55` cut from one recorded TUA commit on `main` at or after `6c64555` (the LF fix). TUA's loop config still assumes the main PC's WSL (`TK_STUDIO_ROOT=/mnt/d/Code/tk-studio`, no `policy.toml`). Change it only on the throwaway branches.
   - 24.4, the verdict, goes through `tk-studio-evolve`, then the shipped defaults, then a release.
3. **Epic 23, acceptance on TUA through the supervisor.** It needs the supervisor running (step 1). `throwaway/supervisor-p1-acceptance` was cut at `2945fad`, before the LF fix: cut it again from `main`, or merge `main` into it.
4. **Plug the holes above** in tk-studio, as stories or direct PRs. Numbers 1, 2, 9, 10 and 11 cost the most time.
5. **Upgrade sbx** from v0.45.1 when its release notes show no breaking change and nothing is running in sbx. v0.46.0's notes were empty on 2026-09-28. Tim's standing approval covers this.

## Supervisor deferred work that is still open

| Entry | Severity | What |
|---|---|---|
| DW-3 | high, narrowed | A worker that outlives a killed supervisor. Closed for every case but the ones named in the entry. |
| DW-10 | high, narrowed | The two live console checks of 21-6. |
| DW-6 | medium | Studio runs started outside the queue are invisible to the pacer. |
| DW-12, DW-13 | medium | Two narrow races between a cancel and a claim. |
| DW-15 | medium | A run resumed after a restart under-reports its cost on the page. |
| DW-19 | medium | On win32 the worker record waits about 0.5 s on a PowerShell start-time read. |
| DW-20 | medium | The status page cannot be opened from a phone's browser. Needs Tim's decision. |
| DW-2, DW-4, DW-9, DW-11, DW-14, DW-16, DW-18 | low | Follow-up reviews still recommended, and the pacer's view of kept locks. |

## Gotchas found on 2026-09-28 and 2026-09-29

- **Verify on the host in a short-path clone**, for example `C:\agent-work\verify\<name>`. Never run tests in the engine's checkout while it runs, and never in a deep folder.
- **Set `TK_STUDIO_ROOT` for the host run**, or the end-to-end suites are skipped and the run proves little.
- **A `.cmd` cannot be spawned without a shell** on Windows (EINVAL). Test fakes are compiled executables (`test/fakes.ts`).
- **A win32 worker ends with its supervisor.** It is not detached, so recovery reports it `not running`.
- **The Monitor tool expires after 30 minutes.** Re-arm it, and include session ends in its filter so that silence means something. The launch's own background task reports the end of the run either way.
- **A desktop-app restart on Tim-PC does not touch the engine.** The session runs on Tim-PC-2. A restart of the app on Tim-PC-2 would.
- **The launch session may stop on its own bootstrap output.** Commit the SPEC it wrote on the run branch and launch again.

## Starter prompt for the next session

```text
This is TIM-PC-2, the tk-studio agent PC. The studio supervisor's code is complete (Epics 21 and 22, built through tk-studio's own launch pipeline on Claude Opus 5.5). It has not been started on the host yet.

Read in this order before acting:
1. _bmad-output/implementation-artifacts/handoff-phase1-loop-2026-09-29.md (state, the holes in the loops, next work)
2. kb/agent-pc-setup-runbook.md §3.8 and §4
3. _bmad-output/planning-artifacts/epics.md Epics 23 and 24
4. kb/execution-pipeline-model-routing.md (the Opus 5.5 trial)

Rulings already made, do not reopen: everything in the 2026-09-26 planning pass and in both handoffs. Engines live only in Docker Sandboxes; never bypass on the host. When a game-workflow conflict needs a call and I'm away, resolve it the way The Universe Awaits works.

Hard rules: never --dangerously-skip-permissions on the host; keep the permissions.deny list and never route around it; branch per run, PR-only, main protected on tk-studio and the supervisor; every headless run ends with the status block (AD-11); nothing is done until conformance passes (AD-19); never start daemons, first-run tools or the supervisor from a Claude desktop-app session; run Godot only via $env:GODOT on the host; don't change system or security settings yourself (hand me the exact command). Run needed tool setup yourself without asking. Read my Max quota with the usage tool instead of asking. Record every hole you find in the dev loops in the observation ledger.

Do this, in order, and report briefly after each step:
A. Sanity: tk activate clean for tk-studio, the-universe-awaits and tk-studio-supervisor; the tk-studio lib suite and conformance green; bun test green for the supervisor on the Windows host with TK_STUDIO_ROOT set; sbx daemon running. Report only what fails.
B. Tell me which pull requests are still open, and whether I have started the supervisor (curl its /status if I give you the address; never start it yourself).
C. Epic 24.3: cut the two throwaway branches on TUA from main, adapt TUA's loop config on them for the sandbox, and run the paired stories. Then 24.4, the verdict.
D. Epic 23, once the supervisor answers on the tailnet.
E. Plug the loop holes listed in the handoff, most costly first.

Address me as Tim-Senpai. Lead every reply with pass/fail and blockers; keep it short.
```
