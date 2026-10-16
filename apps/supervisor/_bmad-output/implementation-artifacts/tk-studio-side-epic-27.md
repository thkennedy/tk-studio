# Epic 27: what tk-studio must change (the hand-over)

The engine mounts tk-studio read-only, so this run cannot change it (operator-decisions §4). Each story writes the tk-studio side here, with the proposed text. The attended session applies it in tk-studio as a follow-up PR on the day the supervisor PR opens. Every item is `unverifiable-here`, never a blocker.

## Story 27.1

### Re-plan of tk-studio Story 23.3 (the live acceptance on the-universe-awaits)

Story 23.3 was planned against Story 23.2, which cut a branch in the project checkout. Story 27.1 supersedes 23.2: every supervisor run now works in its own git worktree and ends as a pull request. Proposed replacement for 23.3's acceptance, in tk-studio's canonical plan:

> **Story 23.3: live acceptance on the-universe-awaits, against supervisor Story 27.1.** **Given** the supervisor on the agent PC with `TK_SUPERVISOR_WORK=C:\agent-work`, the engine sandbox mounting `C:\agent-work\worktrees` read-write as `/c/agent-work/worktrees`, and `main` protected on GitHub, **When** a `run-epic` job for the-universe-awaits is submitted with no `base_ref`, **Then** the run resolves `base_ref` to `main` (`base_ref_source: default`), cuts `C:\agent-work\worktrees\the-universe-awaits\<run id>` on `supervisor/run-<run id>` with a relative gitdir, materialises it (`tk install` at the pin, policy and routing copied, `tk activate` clean), launches the engine with `--project` the worktree, writes `launched`, and when the engine ends pushes the branch and opens one PR against `main` whose body carries the launch status block, the engine run id, the landed commits and the metered cost; the `ended` event carries the PR URL; the worktree is removed; the checkout at `C:\GitHub\the-universe-awaits` never changes branch. A pause leaves the run `paused` with a draft PR and the worktree kept.

Checks only the Windows host can run, for the attended session: the win32 worktree path and long-path behaviour; real `gh` against GitHub branch protection (`gh api repos/{owner}/{repo}/branches/main` answering `protected`); the sbx mount showing the worktree inside the microVM, and git working there through the relative gitdir.

### Runbook `kb/agent-pc-setup-runbook.md` §3.8: the worktree rows

Proposed rows for the supervisor section:

| Item | Value |
|---|---|
| `TK_SUPERVISOR_WORK` | Required for every run (no longer only for editor-in-the-loop snapshots). `C:\agent-work`. Worktrees land in `C:\agent-work\worktrees\<project>\<queue run id>`, snapshots in `C:\agent-work\snapshots\…`. |
| Engine sandbox mount | `C:\agent-work\worktrees` read-write, as `/c/agent-work/worktrees` (only that subfolder; snapshots stay host-only). |
| git | 2.48 or later on the host and in the microVM (`git worktree add --relative-paths`). |
| `gh` | Logged in on the host for the supervisor's user (the protection check and each run's PR). `GH_BIN` overrides the binary. |
| Default branches | Protected on GitHub for every project the supervisor runs against with no `base_ref`; an unprotected default branch is refused `blocked`. |
| Clean-up | `git worktree remove` and `git worktree prune` run on the host. A worktree kept by a failed close-out or a paused run is listed by `git worktree list` in the checkout. |
