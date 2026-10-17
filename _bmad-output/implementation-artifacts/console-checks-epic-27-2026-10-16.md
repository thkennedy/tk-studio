# Epic 27: the console-only checks (command sheet for Tim, 2026-10-16)

All of this runs in **your own console** (a pwsh tab in Windows Terminal), never from a Claude session. The supervisor tab keeps running the whole time: the pacer's `drain` picks up what you submit. One-time setup in the tab you use:

```powershell
cd C:\GitHub\tk-studio-supervisor
$B = "https://$env:TK_SUPERVISOR_TLS_NAME:8787"
$H = @{ Authorization = "Bearer $env:TK_SUPERVISOR_TOKEN" }
Invoke-RestMethod -Headers $H "$B/status"          # already answered 200 from my session today: 3 complete, 3 blocked, nothing live
```

`GET /runs/<run_id>` is the window on every check below: `Invoke-RestMethod -Headers $H "$B/runs/<run_id>" | ConvertTo-Json -Depth 8` lists the run's events in order. The status page (`$B/` in a browser, signed in) shows the same.

## Check 1. Pin and release on the real sbx (cheap: a skill job, no engine)

Target the supervisor's own project and sandbox: `claude-tk-studio-supervisor` is the only sandbox that mounts `C:\agent-work\worktrees`, and every supervisor run now works in a worktree there. (`claude-tk-studio` and `claude-the-universe-awaits` get that mount when they are recreated: 28.3 and 23.3.)

```powershell
bun src/cli.ts submit studio-health --directory C:\GitHub\tk-studio-supervisor --tier sbx --sandbox claude-tk-studio-supervisor
```

Note the `run_id` it prints. Within one pacer pass (60 s) the tab claims it. Watch:

```powershell
sbx ls                                              # claude-tk-studio-supervisor: running while the run lives
git -C C:\GitHub\tk-studio-supervisor worktree list # C:/agent-work/worktrees/tk-studio-supervisor/<run_id> on supervisor/run-<run_id>
Invoke-RestMethod -Headers $H "$B/runs/<run_id>" | ConvertTo-Json -Depth 8
```

Expected events, in order: `claimed`, `pinned {sandbox}`, `materialised`, `worker {pid, guard_s}`, `host-verify` (`bun test` from the worktree, exit 0, or `skipped` naming why), `ended` (`no changes`: a health check lands nothing), `pin-released`. Then `sbx ls` shows the sandbox `stopped` again and `git worktree list` shows the worktree gone. A `pin-failed` event names the sbx error verbatim.

## Check 2. The engine hold, the host-verify leg, the PR and the plan pull-back (a real engine run)

These need a `run-epic` job, so they ride on the first real supervisor run. My recommendation: **Story 23.3's own acceptance on the-universe-awaits** (`run-epic-1`, no `base_ref`), once I have recreated `claude-the-universe-awaits` with the worktrees mount, the NuGet rule and `WITH_DOTNET=8.0 WITH_GODOT=4.7.2` (the network rule is yours to approve; I hand you that command when the sandbox is ready). The alternative is Stories 28.3 and 28.4 on the merged tree after `claude-tk-studio` is recreated.

```powershell
bun src/cli.ts submit run-epic-1 --directory C:\GitHub\the-universe-awaits --tier sbx --sandbox claude-the-universe-awaits
```

Watch, in this order:

1. `base_ref` resolved to `main` with `base_ref_source: default` on the run (an unprotected `main` is refused `blocked`; TUA's `main` reads `protected: true` on GitHub today, so this passes).
2. `materialised`, then `launched {engine run id, sandbox, engine pid}`, then `hold` (the supervisor's own `sbx exec claude-the-universe-awaits tail --pid=<engine pid> -f /dev/null`). `sbx ls` shows the sandbox running; the worktree is visible from inside the VM:

   ```powershell
   sbx exec claude-the-universe-awaits bash -lc 'cd /c/agent-work/worktrees/the-universe-awaits/<run_id> && git status -sb && cat .git'
   ```

   (`.git` reads `gitdir: ../../../../GitHub/the-universe-awaits/.git/worktrees/<run_id>`: the relative gitdir rule.)
3. When the engine completes: `host-verify {exit, duration, tail}` (TUA's `bash scripts/verify.sh`, console-hosted, in the worktree; confirm `where bash` in the tab resolves Git Bash, not `C:\Windows\System32\bash.exe`), then `ended {pr}` with the PR URL, the PR body carrying the launch status block, the engine run id, the landed commits and the metered cost; the worktree removed; `pin-released`; `sbx ls` stopped.
4. The plan pull-back: a `plan-status` event per phase, `{phase: review, ok: true}` when the PR opens and `{phase: done}` after you merge it. For a TUA run it may say `skipped` (TUA's plan is pre-transcribed, no `ST-*` entities); the pull-back into tk-studio's plan is exercised by the first supervisor run on tk-studio (28.3/28.4). The hand-launched Epic 26 and 27 runs never fired it, so I am moving ST-088 to ST-097 to `done` by hand with `plansync.py status` in this session's docs PR.

## Check 3. The kill through sbx exec (optional, costs one launch leg, about 3 USD)

Cancel a run while its engine is alive. Do it on a throwaway, not on check 2's real work: submit check 2's job, wait for `launched`, then within a few minutes:

```powershell
Invoke-RestMethod -Method Post -Headers $H "$B/runs/<run_id>/cancel" | ConvertTo-Json -Depth 8
sbx exec claude-the-universe-awaits bash -lc 'cat /proc/<engine pid>/stat'    # expect: No such file or directory
sbx ls                                                                        # stopped once pin-released lands
```

Expected: `engine-kill` with the TERM outcome and the KILL to the group, `engine-gone`, the studio run ended, `pin-released`, `ended {cancelled}`. The close-out still pushes the run branch; if a draft PR opened for the bootstrap commit, close it and delete `supervisor/run-<run_id>` on GitHub. Resubmitting the same job afterwards re-bootstraps from `main` (the SPEC and manifest are on the closed branch, not on `main`).

## Check 4. The certificate renewal (the exit-75 path)

The certificate at `C:\agent-work\supervisor\tls\tim-pc-2.tail8e370a.ts.net.crt` is valid to **2027-01-06** (82 days today), so `serve` will not ask for a renewal before **2026-12-23** (14 days out). There is no dry-run flag: the exit-75 leg is driven by the certificate's real `notAfter`, and the keeper's branch is pinned by the suite. What you can check today:

1. The renewal command itself, unattended, into a scratch folder (proves HTTPS certificates are enabled on the tailnet and `tailscale cert` needs no browser):

   ```powershell
   New-Item -ItemType Directory -Force C:\agent-work\scratch\cert-dry-run | Out-Null
   tailscale cert --cert-file C:\agent-work\scratch\cert-dry-run\test.crt --key-file C:\agent-work\scratch\cert-dry-run\test.key tim-pc-2.tail8e370a.ts.net
   $LASTEXITCODE                                                   # 0
   Remove-Item -Recurse -Force C:\agent-work\scratch\cert-dry-run
   ```

2. The supervisor-scope events (none of `cert-renew-*` expected yet):

   ```powershell
   bun -e "const {Database}=require('bun:sqlite'); const db=new Database(process.env.TK_SUPERVISOR_DB,{readonly:true}); console.log(db.query('select * from service_events order by seq desc limit 10').all())"
   ```

The real exit-75 restart happens by itself in the week of 2026-12-23; the `cert-renew-requested` and `cert-renewed` events in that table are the record. If you want it sooner, the only way is a short-lived certificate in `TK_SUPERVISOR_TLS_CERT` on a test tab, which I do not recommend on the live service.

## Order I suggest

Check 1 now (ten minutes, nothing at risk). Check 2 when TUA's sandbox is recreated (I ping you with the network-rule command). Check 3 only if you want the kill proven before 28.3; otherwise the first tripped guard or cancel on a real run proves it. Check 4 part 1 any time.
