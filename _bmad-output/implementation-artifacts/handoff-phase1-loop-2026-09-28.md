# Handoff: Phase 1 through the studio's own loop (boundary 2026-09-28)

Written for a fresh Claude Code session on the agent PC (TIM-PC-2). It
supersedes `handoff-agent-pc-2026-09-27.md` for the Phase 1 state. The
machine facts in that file still hold. The plan, rulings and research are
unchanged. The starter prompt is at the end.

## Where things stand

**The plan.**
- tk-studio `_bmad-output/planning-artifacts/epics.md`, Epics 20–24 (EP-020..024, ST-061..079).
- Brief: `briefs/brief-studio-supervisor-2026-09-27/`.
- Contract numbering: 0.1.17 went to the base patches (#76). Epic 20's driver roster is 0.1.18.

**Merged in tk-studio main.** The plugin is **0.2.16** and the contract **0.1.18**. The lib suite is 792 green on Windows and on Linux, and conformance is ok over 18 surfaces.

| PR | What it did |
|---|---|
| #71 | The plan: Epics 20–24 |
| #72 | bmad-loop at the v0.9.1 pin, with portable hooks |
| #73 | The pipeline routes to `claude-opus-5-5`; tk-studio's `.bmad-loop/routing.toml` puts every leg on Opus 5.5 (the Opus 5.5 trial) |
| #74 | The `studio-pipeline` gate plugin, `transcribe.py`, `task-planning.md`, and the `bmad-build-auto` customization |
| #76 | Studio-managed **base patches** (`base-patches/patches.json`, `lib/basepatch.py`), re-applied by `tk install` and reported by `tk activate`. The first patch fixes the `render_skill.py` duplicate-key HALT (BMAD-METHOD#2718), which broke bmm + gds, so every game project. Tracked in tk-studio#75. TUA adopted it in the-universe-awaits PR #1. |
| #77 | DW-4: a job's core path is judged under both path flavours |
| #78 | Plan fix for 21.1 |
| #79 | **Epic 20** (loop-built): `finish` records `total_cost_usd`; contract 0.1.18 adds the driver roster |
| #80 | **Story 24.1** (loop-built): `lib/meter.py`, `prices.json`, and the `post_commit` meter hook |
| #81, #82 | **Runbook §3.8, the bmad-loop engine lives in Docker Sandboxes**, plus `tools/sbx-engine/{provision-engine,launch-epic,resume-run}.sh` |

**The supervisor repo.** `thkennedy/tk-studio-supervisor` is private, `main` is protected, and it is cloned to `C:\GitHub\tk-studio-supervisor`.
- It is onboarded as a studio project: full base at the pin, planning backend `bmad-files`, developer working set bmm, tea and bmad-loop.
- It carries Epics 21–22, transcribed verbatim from tk-studio with their numbers, under local ids EP-001..002 and ST-001..010.
- Stack: Bun and TypeScript.

**Supervisor PR #2 is open and unmerged; Tim reviews it.** Branch `loop/epic-21`, stories 21-1..21-4:
- **21-1:** the ClaudeOS lift, byte-verified against the tag.
- **21-2:** conformance runs through the supervisor.
- **21-3:** the SQLite durable queue.
- **21-4:** host and sbx worker tiers, with cost captured.
- **Test results:** Linux 259 pass. Windows 216 pass, 43 skip, 0 fail, after the attended fix `ec939bb` (`canonicalPath` no longer lowercases; locks key on `checkoutKey`).
- **DW-5 (high):** all six end-to-end suites are disabled on win32 (`canRunE2E`), but Windows is the production host. Story 22.3 owns making them green on Windows.

**Tim's quota.** He was at 15% weekly usage on 2026-09-28, with the reset about 10.5 h away (around 13:00Z). The overnight spend was fine. Claude can't read the quota, so ask Tim instead of pausing to save it.

## Next work, in order

1. **Epic 21, stories 21-5 (guards and pacer) and 21-6 (crash resume).** Relaunch on `loop/epic-21`; the relaunch skips done stories. Then:
   - verify on both Linux and the Windows host;
   - update PR #2, or open a follow-up PR.
2. **Epic 22 in the supervisor.**
   - Cut `loop/epic-22` from supervisor `main`. Merge PR #2 first if Tim approved it, otherwise branch from `loop/epic-21`.
   - Launch Epic 22 with `tk-studio-launch`.
   - 22.3 (start at logon) must carry DW-5.
   - 22.4 is tk-studio runbook §4, written in tk-studio, attended or through its own loop.
   - Hand start-at-logon items to Tim as commands: the Startup shortcut and the tailnet bind/token. Never start the supervisor from a desktop-app session (MSIX).
3. **The TUA engine**, which Epic 23 and Story 24.3 need. The sandbox `claude-the-universe-awaits` exists, with tk-studio mounted read-only, Godot 4.7.2 Mono in `~/godot`, tmux, bmad-loop, the plugin and its own store.
   - **Blocked:** the sandbox cannot restore or build C#. The `balanced` policy blocks NuGet and the .NET hosts, and the VM's Ubuntu 26.04 ships only .NET 10, while TUA's `global.json` pins 8.0.400. Tim runs the sandbox-scoped rule from runbook §3.8:
     ```bash
     sbx policy allow network --sandbox claude-the-universe-awaits "api.nuget.org,globalcdn.nuget.org,dot.net,builds.dotnet.microsoft.com,dotnetcli.azureedge.net"
     ```
     Then run `provision-engine.sh` with `WITH_DOTNET=8.0`, set `GODOT` to the Linux binary, and prove `bash scripts/verify.sh` green in the sandbox.
   - **TUA's loop config assumes the main PC's WSL:**
     - `.bmad-loop/profiles/claude.toml` sets `TK_STUDIO_ROOT=/mnt/d/Code/tk-studio` and uses bypass arguments. Bypass is fine in sbx.
     - `.bmad-loop/policy.toml` is absent (machine-local).
     - TUA's own seam check and `apply-route.py` are in use.
     - Change these **only on throwaway branches**; TUA `main` stays unprotected until Tim decides otherwise.
4. **Epic 24.2–24.4, the Opus 5.5 trial.** 24.1 is done. The run stopped gracefully and is resumable.
   - The paired runs (24.3) use `throwaway/route-v2` and `throwaway/route-o55`: stories 2-1 and 2-2, from one recorded TUA commit.
   - Then 24.4, the verdict, goes through `tk-studio-evolve`, then the shipped defaults, then a release.
5. **Epic 23, acceptance on TUA.** After the supervisor (Epics 21–22) is usable. The throwaway branch `throwaway/supervisor-p1-acceptance` is already cut at `2945fad`. The job is `run-epic-2`.

## Opus 5.5 trial data so far

Metered: every leg on Opus 5.5, list prices, usage deduplicated by `message.id`.

| story | $ | largest legs | notes |
|---|---|---|---|
| 20-1 | 3.97 | session 2.29 | landed on attempt 1 |
| 20-2 | 7.14 | session 2.37, implementer 1.69, reviewers 1.69 | 14.5 min |
| 24-1 | 18.43 | reviewers 6.31, review 3.63, implementer 3.60 | escalation, then a re-drive |
| 21-1 | 19.45 | implementer 6.54, reviewers 5.38, review 3.70 | L-size lift, six review passes |
| 21-2 | 12.13 | session 3.70, implementer 3.36, reviewers 2.60 | |
| 21-3 | 38.13 | implementer 13.65, reviewers 10.26, review+gate 6.73 | 89.6 min |
| 21-4 | 20.02 | | reconciled by the gate in-loop |

The v2 baseline, with Sonnet sessions and Opus checks on C#/Godot, measured about $4.4 for a core-code story and $8.6 all-in for a feature story. These stories are larger and in another language, so it is not like for like. Across stories, **the review legs (reviewer subagents plus follow-up review and gate sessions) are 36–54% of spend**. That is the strongest lever for the verdict. The paired runs are the real comparison. Each story's `observation` sits in its sandbox's own ledger (`~/.tk-studio/measurements/agent-<sandbox>.jsonl`).

## How the engine works (runbook §3.8 is the full text)

**Sandboxes.** There is one sandbox per project, and Claude authenticates through the global `anthropic` sbx secret (the Max login).

| Sandbox | Mounts |
|---|---|
| `claude-tk-studio` | tk-studio |
| `claude-tk-studio-supervisor` | the supervisor (rw), tk-studio (ro) |
| `claude-the-universe-awaits` | TUA (rw), tk-studio (ro) |

**A sandbox stops when nothing is attached, and the engine dies with it.** Always run the launch or resume scripts through a **background** `sbx exec` that stays attached for the engine's lifetime. In Git Bash, prefix with `MSYS_NO_PATHCONV=1`.
```bash
MSYS_NO_PATHCONV=1 "$LOCALAPPDATA/DockerSandboxes/bin/sbx.exe" exec claude-tk-studio-supervisor bash -lc 'ROOT=/c/GitHub/tk-studio-supervisor bash /c/GitHub/tk-studio/tools/sbx-engine/launch-epic.sh 21 launch5'
```
Watch `.bmad-loop/runs/<run>/journal.jsonl` with Monitor. `launch-epic.sh` writes its output to `<project>/.bmad-loop/cache/epic-<N>-<tag>/`.

**Run branches.** Each run goes on `loop/epic-<N>`, cut from `main`. The loop commits locally and never pushes. When a run completes, verify on the host and open a PR.

**Closing a pause:**
- **An escalation on a story with no landed work** (a missing fact, a render halt): supply the fact in the repo (the kb or the plan), commit it, then run `tools/sbx-engine/resume-run.sh <run>`.
- **A story that committed but whose close-out failed** (spec `status: done`):
  1. Commit the staged harvest by hand.
  2. Copy `journal.jsonl` and `state.json` to `.bmad-loop/cache/trial-data/<run>/`.
  3. Run `bmad-loop archive <run>`.
  4. Launch again.
- **The reconcile gate** (deviation score ≥ 2, no verdict): in the supervisor, `gate_enabled = true` in its machine-local `policy.toml` now reconciles in-loop. Elsewhere, reconcile by hand:
  1. Read the spec's Deviation Summary against the later stories.
  2. Set `reconcile_verdict` and write a `## Reconcile` section.
  3. Add `adjust-stories` notes to the unstarted entries' `invoke_dev_with`, and close the entries in `replan-queue.md`.
  4. Close the story as in the previous bullet.
- **Stopping for a checkpoint:** `bmad-loop stop --graceful <run>` finishes the current story first.

**Metering an archived run.** Extract it under `.bmad-loop/cache/restored-runs/`, never under `runs/`, because an extracted run would take the checkout lock again. Then run `uv run meter.py story --run-dir <dir> --story-key <key> --repo-root <root>` inside the sandbox.

**Plugin releases.** Use the release motion: bump ×3 → `claude plugin tag plugins/tk-studio --push` → `uv run tools/release_archive.py run` → commit the archive record → push main. Then run `claude plugin marketplace update tk-studio` and `claude plugin update tk-studio@tk-studio --scope project|user` on the host, and the same update **inside every sandbox**.

## Gotchas found on 2026-09-28

- **bmad-loop version.** Keep it at the `bmad.lock` pin, v0.9.1, with the `[tui]` extra. 0.12.0 writes sandbox-only hook paths. Without `[tui]`, `bmad-loop list` fails, and so does launch's live-engine check.
- **Hooks.** In tracked settings, hooks must call `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py`, because `python3` on the Windows host is the Microsoft Store stub.
- **Git identity.** The engine's shell needs its own git identity, which `provision-engine.sh` sets. Otherwise the close-out commit fails.
- **Launch bootstrap.** A first launch writes SPEC, `stories.yaml` and a plan. If the output is left uncommitted, the readiness check refuses the dirty tree: commit it, then launch again. The Epic 24 launch committed its own.
- **Planner escalations are refuse-to-guess working as intended.** Examples: 24-1 prices, 21-1's private ClaudeOS repo, and 21.1's core-target criterion. Answer with a sourced fact in the repo, never a guess.
- **The ClaudeOS salvage** is staged, byte-verified, in the supervisor's `.bmad-loop/cache/claudeos-salvage/`, which is gitignored. It includes `PROVENANCE.txt`.
- **`TK_STUDIO_ROOT` points at the live tk-studio checkout** in the supervisor and TUA sandboxes (read-only mount). Keep the tk-studio checkout on `main`, or on a branch with working libs, while those engines run.
- **Deny list.** `rm -rf` is denied on the host. Delete specific files, or copy into a fresh directory instead.
- **Windows is the supervisor's production host, and the loop verifies only on Linux.** Always run `bun test` on the Windows host before merging supervisor work.

## Open follow-ups (not blocking)

- **Upstream renderer patch.** tk-studio#75 tracks the upstream fix; I added a comment with the verified repro and the proposed patch to BMAD-METHOD#2718. Retire the patch when it is fixed at the pin.
- **Ship the pipeline resources as installable content.** The `studio-pipeline` plugin, the customization and the budget bands are now copied per project. There is an observation for this in the ledger.
- **Launch should commit its own bootstrap output.** Also logged as an observation.
- **TUA's seam check is not generalised** for tk-studio or the supervisor.
- **Supervisor deferrals:** DW-1 is routed to 21-5; DW-5 is high. tk-studio DW-5 (a repeat `finish` emits twice) stays open at low.
- **ClaudeOS retirement.** Runbook §9's last step, the main-PC `ClaudeOS Supervisor` task, is still Tim's.

## Starter prompt for the next session

```text
This is TIM-PC-2, the tk-studio agent PC. Phase 1 (the studio supervisor) is being built through tk-studio's own launch pipeline: bmad-loop v0.9.1 running in Docker Sandboxes engines, with every leg on Claude Opus 5.5 as a measured routing trial.

Read in this order before acting:
1. _bmad-output/implementation-artifacts/handoff-phase1-loop-2026-09-28.md (state, engine mechanics, gotchas, next work)
2. kb/agent-pc-setup-runbook.md §3.8 (the engine in sbx) and §4
3. _bmad-output/planning-artifacts/epics.md Epics 20-24 (the plan; the supervisor repo carries 21-22 transcribed)
4. kb/execution-pipeline-model-routing.md (the Opus 5.5 trial and the price table)

Rulings already made, do not reopen: everything in the 2026-09-26 planning pass and in the handoff. Supervisor repo thkennedy/tk-studio-supervisor (Bun/TS). Engines live only in Docker Sandboxes; never bypass on the host. Keep the gds + loop fix as the studio-managed base patch (BMAD-METHOD#2718). When a game-workflow conflict needs a call and I'm away, resolve it the way The Universe Awaits works.

Hard rules: never --dangerously-skip-permissions on the host; keep the permissions.deny list and never route around it; branch per run, PR-only, main protected on tk-studio and the supervisor; every headless run ends with the status block (AD-11); nothing is done until conformance passes (AD-19); never start daemons or first-run tools from a Claude desktop-app session; run Godot only via $env:GODOT on the host; don't change system or security settings yourself (hand me the exact command). Run needed tool setup yourself without asking. You can't see my Max quota: ask me for it instead of pausing to save it.

Do this, in order, and report briefly after each step:
A. Sanity: tk activate clean for tk-studio, the-universe-awaits and tk-studio-supervisor; the tk-studio lib suite and conformance green; sbx daemon running and the three sandboxes listed. Report only what fails.
B. Tell me whether supervisor PR #2 is still open. If I approved or merged it, carry on from main; if not, build 21-5/21-6 on loop/epic-21.
C. Resume supervisor Epic 21 (21-5, 21-6) through the launch pipeline, verify on Linux and on the Windows host (bun test), and open or update the PR. Then launch Epic 22, with 22.3 owning DW-5 (e2e suites green on Windows).
D. If I've run the TUA sandbox network rule, provision .NET 8 there and prove TUA's verify gate in the sandbox; otherwise remind me of the command.

Address me as Tim-Senpai. Lead every reply with pass/fail and blockers; keep it short.
```
