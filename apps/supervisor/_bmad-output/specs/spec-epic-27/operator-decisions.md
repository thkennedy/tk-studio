# Epic 27: operator decisions on the launch's open questions

Recorded by the attended session on the agent PC, 2026-10-16 (UTC), so the run does not pause on them. **They are provisional.** Tim reviews them in the pull request and may change any of them before merge; each is a default or a name, so a change is mechanical.

A dev session treats these as decided. It does not reopen them, and it does not consult on them. Where a decision names a check only the Windows host can run, the dev session lists it under `unverifiable-here` in the story's Auto Run Result, as Epic 22 did.

## 1. Where Epic 26 lives: `TK_STUDIO_ROOT`, never the installed plugin

The supervisor resolves the studio plugin as `$TK_STUDIO_ROOT/plugins/tk-studio` (`src/env.ts`). It never reads the skills-dir install. Inside the engine microVM `TK_STUDIO_ROOT` is the read-only mount `/c/GitHub/tk-studio` (exported in `~/.profile` by the provisioning); on the host it is `C:\GitHub\tk-studio`. Both are the tk-studio checkout at main `d7cb9b1`, which carries Epic 26 complete:

- `plugins/tk-studio/lib/meter.py harvest --run-dir <run>` (Story 26.4)
- `plugins/tk-studio/lib/plansync.py status --id ST-NNN --status <enum> [--note]` (Story 26.5)
- driver contract 0.1.21 (`plugins/tk-studio/contracts/driver-contract.md` §4 status verb, §5 `advisor` leg)

The skills-dir plugin at `~/.claude/skills/tk-studio` is release 0.3.0 and lags; it is not on the adapter's path and gets a 0.3.1 cut after this epic. Stories 27.3 and 27.5 build against the real verbs at `TK_STUDIO_ROOT`. The suite pins the supervisor's side with fakes, as it always has (a fake `plansync.py` or `meter.py` under a temp `TK_STUDIO_ROOT` is fine in tests; never in the service's own resolution). Do not wait for anything, and do not fake in production code.

## 2. The `ended` event is written when the engine's life ends

Epic 27's thesis is that the service owns the engine's lifetime, so a queue run is not over when `tk-studio-launch` returns.

- **`tk-studio-launch` returning writes a `launched` event**, not `ended`. It carries the launch status block, the engine run id (`.bmad-loop/runs/<id>`), the sandbox name and the in-VM engine pid (Story 27.2). The run stays `running`, and the pacer counts it as live (CAP-2).
- **`ended` is written once**, after the engine completes or is stopped and the close-out has run: the host-verify leg (Story 27.4), the push, the PR or the recorded "no changes". It carries the PR URL. Story 27.5's status pull-back keys on it.
- **A run whose engine paused does not end.** It goes `paused`, keeps its worktree and its pin (CAP-1), and Story 27.3's close-out or `POST /runs/{id}/resume` continues it under the same queue run. The push and the PR still happen on the pause, as CAP-1 says ("completes, pauses or is stopped"); the PR URL is recorded on the `paused` event and again on the eventual `ended` (it is the same PR). The PR opens as a draft while the run is paused and is marked ready at `ended`, so a reviewer can tell a finished branch from one still in flight.
- **A launch that returns `blocked`** (no engine started, as launch1 of this epic did on the dirty tree) ends the run at once: `ended` with the launch's reason, "no changes" when nothing landed.
- **The studio run record** (`jobrun.py finish`) moves with it: `finish` is called at the engine's end with the run's final status (`ok` when every story landed and the host verify is green, `partial` naming the failing command or the stories left, `blocked` for a blocked launch), with the launch status block among its artifacts. A refused `finish` is DW-23's case and keeps the worker's own reason.

## 3. A submission without `base_ref` defaults to the repository's default branch

Resolved at claim from the project checkout: `git symbolic-ref --short refs/remotes/origin/HEAD`, falling back to `gh repo view --json defaultBranchRef`. The resolved name is recorded on the queue run as `base_ref` with `base_ref_source: default`, and then goes through the same protection check as an explicit one (refused `blocked` when the branch is unprotected on GitHub). The in-checkout path is retired: every run gets a worktree, which is the story's title, and no flag keeps the old path alive.

## 4. The tk-studio side is the operator's, after this run

The engine mounts tk-studio read-only, so this repo's run cannot change it. The dev sessions write what tk-studio must change to `_bmad-output/implementation-artifacts/tk-studio-side-epic-27.md` in this repo, one section per story, with the proposed text:

- runbook `kb/agent-pc-setup-runbook.md` §3.8 (retire the "attended host run before each PR" rule in favour of the host-verify leg; the worktree and pin rows) and §4;
- the re-plan note for tk-studio Story 23.3 (the live acceptance on the-universe-awaits, now against Story 27.1);
- the `verify.host` key for tk-studio's and the-universe-awaits' tracked `.tk-studio/config.yaml` (tk-studio: the lib suite and the conformance run as the runbook's host-gate step names them; the-universe-awaits: `scripts/verify.sh`).

The attended session applies them in tk-studio as a follow-up PR on the day the supervisor PR opens. They are listed as `unverifiable-here`, never a blocker. The supervisor's own `verify.host` (`bun test`) is set in this repo's tracked `.tk-studio/config.yaml` by Story 27.4 itself.

## 5. The Windows-only checks are the attended session's, at close-out

As Epic 22 §5. The dev session lists them under `unverifiable-here`; the attended session on the agent PC runs them before the PR and records the results in the PR body and in `deferred-work.md`. They are:

- the win32 `bun test` run;
- the worker-record start-time check (`GetProcessTimes` through `bun:ffi`, or the equivalent, under 50 ms; DW-19);
- the console-hosted host-verify leg (Story 27.4) and the sbx-tier pin, hold, release and kill against the real `sbx` (Story 27.2). The supervisor is never started from a Claude desktop-app session, so these run from the console;
- the TLS renew path (DW-21) as a dry run.

### Worktree visibility is already proven, with one rule the code must follow

`TK_SUPERVISOR_WORK=C:\agent-work` on the host, so worktrees land under `C:\agent-work\worktrees\<project>\<run_id>`. The engine sandbox mounts exactly `C:\agent-work\worktrees` as `/c/agent-work/worktrees` (only the worktrees subfolder; snapshots stay host-only). The two sides see different absolute paths (`C:/GitHub/...` against `/c/GitHub/...`), so a worktree **must be created with relative gitdir paths**:

```
git worktree add --relative-paths <TK_SUPERVISOR_WORK>/worktrees/<project>/<run_id> -b supervisor/run-<run_id> <base_ref>
```

`--relative-paths` needs git 2.48 or later; the host has 2.55.0.windows.3 and the microVM 2.53.0. Proof from this session (2026-10-16): the host created `C:/agent-work/worktrees/tk-studio-supervisor/probe-20261016` with `--relative-paths --detach main`; its `.git` file read `gitdir: ../../../../GitHub/tk-studio-supervisor/.git/worktrees/probe-20261016`; inside the sandbox `git status`, `git rev-parse --git-common-dir` (`/c/GitHub/tk-studio-supervisor/.git`) and a commit all worked, and the host saw the commit. Without the flag the `.git` file holds `C:/GitHub/...` and the engine's git fails in the VM with "not a git repository". The suite pins the `.git` file's content as relative. The checkout's `.git/worktrees/<name>/gitdir` back-pointer is relative too; `git worktree remove` and `prune` run on the host.

## 6. The engine hold is the pattern the attended sessions already use

Story 27.2's pin and hold are what `tools/sbx-engine/launch-epic.sh` in tk-studio does by hand today: `sbx run -d --name <sandbox>` pins, and one `sbx exec <sandbox> bash -lc '...'` held open for the engine's lifetime keeps the microVM up (a sandbox stops when nothing is attached). `sbx` lives at `%LOCALAPPDATA%\DockerSandboxes\bin\sbx.exe`; from Bun spawn it with argv (no shell, so no Git Bash path conversion). From a Claude desktop-app session the attended operator runs no `sbx` command but `sbx daemon status` while the daemon may be down; the supervisor is the console's.
