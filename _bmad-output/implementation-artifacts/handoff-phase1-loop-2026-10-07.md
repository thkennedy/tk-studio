# Handoff: the supervisor signs you in; the console steps are next (boundary 2026-10-07)

Written for a fresh Claude Code session on the agent PC (TIM-PC-2). It supersedes `handoff-phase1-loop-2026-09-29.md` for the state of Phase 1. The engine mechanics in the 09-28 handoff and in runbook §3.8 still hold. The starter prompt is at the end.

## Where things stand

Everything the 09-29 handoff left open was decided and merged in one interactive session with Tim on 2026-10-06, and one more story was built through the studio's own loop.

| Repo | PR | What | State |
|---|---|---|---|
| tk-studio-supervisor | #3 | Epic 22 (22-1 to 22-3) | merged |
| tk-studio-supervisor | #4 | DW-20 decided; the notifier choice | merged |
| tk-studio-supervisor | #5 | **Story 22.5, sign in from the phone**, plus the hole-1 sync | merged (`72377d8`) |
| tk-studio | #85, #86, #60 | runbook §4, the 09-29 handoff, public-repo wording | merged |
| tk-studio | #87 | Story 22.5 in the plan | merged |
| tk-studio | #88, #91 | `tools/agent-pc/set-supervisor-env.ps1` (v1, then v2) and runbook §4 for 22.5 as built | merged |
| tk-studio | #89 | `provision-engine.sh` pre-answers the auto-mode dialog (hole 2) | merged |
| tk-studio | #90 | runbook: the sbx daemon auto-start trap; `sbx run -d` pins a sandbox (hole 7) | merged |
| tk-studio | #92 | the spec file name in every dispatch note and the executor customization (hole 1) | open at the time of writing; merge when the lib suite and conformance are green |
| the-universe-awaits | | `main` protected like the other two | done |

**The supervisor has still never been started.** Its checkout `C:\GitHub\tk-studio-supervisor` is back on `main` at `72377d8`, `bun install --frozen-lockfile` done. Nothing is running in sbx; the three sandboxes are stopped.

**Decisions Tim made on 2026-10-06** (do not reopen):

- The five answers in the supervisor's `operator-decisions.md` §1–5 are accepted as built.
- DW-20: a login form that sets a session cookie, plus Google and GitHub sign-in. Built as Story 22.5. Constraints in `operator-decisions.md` §7.
- Notifier: both configured; Telegram is the default, through the **Hermes bot** (the setup script reads the token and the home chat from `%LOCALAPPDATA%\hermes\.env`), so a reply reaches Hermes.
- One checkout for development and service: stop the supervisor tab whenever the loop builds the supervisor itself, restart it after.
- 22.5 was launched before the console steps; the console steps and the reboot proof come after it.

## What landed: Story 22.5

Built by `tools/sbx-engine/launch-epic.sh 22 launch3` in `claude-tk-studio-supervisor` (run `20261007-010022-f20c`), every leg on Opus 5.5.

| Story | $ | Minutes | Attempt | Review share | Result |
|---|---|---|---|---|---|
| 22-5 | 13.42 | 36 (dev 26, review 7, gate 2.5) | 1 | about 25% | `f8a26c2`; score 2, verdict adjust-stories (22-4 replan, applied in tk-studio #91) |

What it does: `GET /` without the bearer header answers a sign-in page (token form, "Continue with Google", "Continue with GitHub"). Sign-in sets a seven-day HMAC-signed `HttpOnly; Secure; SameSite=Lax` cookie. OAuth identities are allow-listed, the state cookie is checked before the provider is called, cancel from a cookie session needs the page's CSRF token, and a cookie never authorises `POST /jobs`. `serve` terminates TLS with the Tailscale certificate; `start.ps1` renews it once at start.

| Where | `bun test` | Typecheck |
|---|---|---|
| Linux engine sandbox | 599 pass, 3 skip, 0 fail | clean |
| Windows host, end-to-end suites on | 585 pass, 16 skip, 0 fail | clean |

What changes for the operator: `TK_SUPERVISOR_SESSION_SECRET` is **required** (random, at least 32 bytes). `TK_SUPERVISOR_TLS_{CERT,KEY,NAME}` and `TK_SUPERVISOR_OAUTH_{GOOGLE,GITHUB}_{CLIENT_ID,CLIENT_SECRET,ALLOW}` are optional, all-or-none per group; OAuth needs TLS; the token form refuses over plain http. New DW-21: the certificate is renewed only when `start.ps1` starts.

Metered costs so far (Opus 5.5, list prices): Epic 21 $152.75; Epic 22 22-1 $22.43, 22-2 $17.68, 22-3 $29.25, 22-5 $13.42.

## Tim's steps, from the console, in order

Never from a Claude desktop-app session. The script is `C:\agent-work\tools\set-supervisor-env.ps1` (the same file as `tools/agent-pc/set-supervisor-env.ps1`).

1. `pwsh -File C:\agent-work\tools\set-supervisor-env.ps1 -ShowToken`. It sets the User environment (token, session secret, Telegram through the Hermes bot, an ntfy topic, paths), creates the folders, and puts the `shell:startup` shortcut in place. Safe to re-run.
2. `pwsh -NoExit -File C:\GitHub\tk-studio-supervisor\start.ps1` in the same console.
3. From the phone: `curl -H "Authorization: Bearer <token>" http://100.119.65.48:8787/status`.
4. Enable HTTPS certificates in the Tailscale admin console (DNS → HTTPS Certificates). Re-run the script with `-WithTls`, Ctrl+C the tab, run `start.ps1` again, open `https://tim-pc-2.tail8e370a.ts.net:8787/` on the phone and sign in with the token.
5. Optional: register a Google OAuth web client and a GitHub OAuth app with the callbacks `https://tim-pc-2.tail8e370a.ts.net:8787/auth/google/callback` and `.../auth/github/callback`, set the six `TK_SUPERVISOR_OAUTH_*` variables (the script prints the commands), restart the tab, sign in each way, cancel a run from the page.
6. Reboot, then the smoke of step 3 again. Then the two live DW-10 checks (kill the supervisor mid-run and restart it; restore a deleted transcript from the backup), one real notification, one real robocopy snapshot.
7. Retire the "Docker Sandboxes daemon" sign-in task once a reboot has shown `start.ps1` bringing the daemon up.

## Holes in the dev loops, updated

Numbers follow the 09-29 handoff. Every new one is in the host ledger (`~/.tk-studio/measurements/tim-Tim-PC-2.jsonl`, "Loop deficiency:").

| # | Hole | State on 2026-10-07 |
|---|---|---|
| 1 | spec named `<id>.md` stalls the engine | **fixed in tk-studio #92** (dispatch note + executor customization); the supervisor copies synced in #5. Upstream fix still wanted in bmad-loop |
| 2 | the auto-mode dialog swallowed a nudge | **fixed in #89** (`hasSeenAutoDefaultNudge` pre-seeded; applied to all three sandboxes) |
| 3 | footer tips re-arm the stall grace | open, upstream |
| 4 | `max_tokens_per_story` too low | open; 5,000,000 set by hand in the supervisor's local `policy.toml` |
| 5 | CRLF in sbx-mounted checkouts | fixed for TUA; rule in §3.8 |
| 6 | 150-character spec file names | open; host verification uses `C:\GitHub\<repo>` or a short-path clone |
| 7 | the engine dies with the host `sbx exec` | **mitigated:** `sbx run -d --name <sandbox>` pins the sandbox (§3.8, sbx v0.47.0); `start.ps1` holds engines once it runs |
| 8 | signal tests passed once at the gate | open |
| 9 | no close-out for a landed-but-paused story | open; next to plug |
| 10 | three launches, three behaviours on bootstrap output | open |
| 11, 12 | no Windows leg in the verify gate | open; the host run is attended, before each PR |
| 13 | **new:** an sbx command from a Claude session while the daemon is down auto-starts a daemon that cannot reach the inner engine | rule in §3.5 and §8 (#90): `sbx daemon status` first; start only through the sign-in task or `start.ps1` |

## Next work, in order

1. Tim's console steps above.
2. A follow-up on 22.5 once the live sign-in is done: close DW-20; DW-21 (cert renewal) stays deferred.
3. **Epic 24.3 and 24.4:** cut `throwaway/route-v2` and `throwaway/route-o55` on TUA from `main` at or after `6c64555`; adapt TUA's loop config on them for the sandbox; run the paired stories; then the verdict through `tk-studio-evolve`.
4. **Epic 23**, acceptance on TUA through the supervisor, once it answers on the tailnet. Re-cut `throwaway/supervisor-p1-acceptance` from `main`.
5. Holes 9, 10, 11.

## Gotchas found on 2026-10-06

- `sbx ls`, `exec`, `rm` and `diagnose` all auto-start the daemon when it is down. From a Claude session, run only `sbx daemon status` until it says running; start it with `Start-ScheduledTask -TaskName "Docker Sandboxes daemon"` from PowerShell. Git Bash rewrites `schtasks /Run /TN` switches as paths.
- `sbx run -d --name <sandbox>` against a running sandbox keeps it alive without a restart (same boot, processes intact). `sbx stop <sandbox>` releases it.
- `sbx rm` needs `--force` without a terminal.
- Python on the host does not open `/c/...` paths; use `C:/...`.
- A long Bash command whose heredocs contain apostrophes failed to parse twice in the desktop app. Write scripts and PR bodies to files (scratchpad) and use `gh pr create --body-file`.
- `rm -rf` is on the deny list. Do not create temp folders that need it; the transcribe tool can be imported instead of run into a temp spec folder.
- `winget upgrade Docker.sbx` stops nothing by itself; stop the daemon first, upgrade (UAC), then start it through the task.

## Starter prompt for the next session

```text
This is TIM-PC-2, the tk-studio agent PC. Story 22.5 (sign in from the phone) landed on 2026-10-07 through tk-studio's own loop; supervisor main is 72377d8. The supervisor has never been started; my console steps are listed in the 2026-10-07 handoff.

Read in this order before acting:
1. _bmad-output/implementation-artifacts/handoff-phase1-loop-2026-10-07.md
2. kb/agent-pc-setup-runbook.md §3.5, §3.8 and §4
3. _bmad-output/planning-artifacts/epics.md Epics 23 and 24
4. kb/execution-pipeline-model-routing.md

Rulings already made, do not reopen: everything in the planning pass, the three handoffs, and the 2026-10-06 decisions (operator-decisions.md §1–7 in the supervisor repo). Engines live only in Docker Sandboxes; never bypass on the host. TUA is the reference for game-workflow conflicts.

Hard rules: never --dangerously-skip-permissions on the host; keep the permissions.deny list; branch per run, PR-only, main protected on all three repos; every headless run ends with the status block (AD-11); nothing is done until conformance passes (AD-19); never start daemons, first-run tools or the supervisor from a Claude desktop-app session; from a Claude session run no sbx command but `sbx daemon status` while the daemon may be down; stop the supervisor tab before the loop builds the supervisor itself; run Godot only via $env:GODOT on the host; don't change system or security settings yourself (hand me the exact command). Run needed tool setup yourself without asking. Read my Max quota with the usage tool instead of asking. Record every hole you find in the dev loops in the observation ledger.

Do this, in order, and report briefly after each step:
A. Sanity: tk activate clean for tk-studio, the-universe-awaits and tk-studio-supervisor; the tk-studio lib suite and conformance green; bun test green for the supervisor on the Windows host with TK_STUDIO_ROOT set; `sbx daemon status` running. Report only what fails.
B. Tell me which pull requests are open and whether the supervisor answers (curl /status if I give you the token; never start it yourself).
C. Epic 24.3: cut the two throwaway branches on TUA from main, adapt TUA's loop config on them for the sandbox, pin the sandbox with sbx run -d, and run the paired stories. Then 24.4, the verdict.
D. Epic 23, once the supervisor answers on the tailnet.
E. Plug loop holes 9, 10 and 11.

Address me as Tim-Senpai. Lead every reply with pass/fail and blockers; keep it short.
```
