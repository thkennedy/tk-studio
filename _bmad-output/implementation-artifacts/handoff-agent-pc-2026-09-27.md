# Handoff: agent PC provisioned, start Phase 1 (boundary 2026-09-27)

Written for a fresh Claude Code session on the agent PC (TIM-PC-2). It
supersedes `handoff-agent-pc-2026-09-26.md` for the machine's state. The
plan, the rulings and the research are unchanged. The starter prompt for the
next session is at the end.

## Where things stand

- **Phase 0 (provisioning) is done.** `kb/agent-pc-setup-runbook.md` now
  describes this box as built, via PRs #62, #68 and #69. It covers the
  single-account variant and its trade-off, the fixes found while
  provisioning, and results verified on first run. Every step only Tim could
  do (sign-in, auto-logon, RDP, Tailscale, BIOS, Windows Update, sandbox,
  first game build, Hermes) was ticked and then checked on the machine.
- **Repo:** `main` is at `a9a4cd6`. The plugin is **0.2.13**, released with
  tag `tk-studio--v0.2.13` and a verified asset. The contract is **0.1.16**.
  There are 719 lib tests and conformance is ok over 18 surfaces.
  `main` is **protected**: a PR is required (0 approvals), and admins bypass,
  so the release motion (`tools/release_archive.py`) still pushes directly.
  Everything else goes through a PR.
- **Merged at this boundary:**
  - #62 runbook fixes
  - #63 tk-studio developer working set
  - #64 same-pin install churn fix
  - #65 and #67 base regenerations
  - #66 the `address` field in the resolver (`assistant-preference`
    resolves to the Claude account name, "Tim-Senpai")
  - #68 and #69 runbook fixes and verified results

  #60 (older public-prep wording) is still open and is not part of this
  work.
- **Studio:** `tk activate` is clean on all four planes for both registered
  projects, `tk-studio` and `the-universe-awaits` (`~/.tk-studio/registry`).
  The tk-studio developer working set is bmm, tea, bmb, bmad-loop, gds.
- **The Universe Awaits** is at `C:\GitHub\the-universe-awaits` (private,
  Godot 4.7 C#, Godot project under `game\`).
  - `dotnet build TheUniverseAwaits.sln` succeeds, and
    `& $env:GODOT --headless --path game --quit` prints
    `TUA.Game shell ready` with exit 0.
  - Its developer working set is skill-level: loop-supervisor, gds-*,
    bmad-loop, and review skills. It declares `run-epic-0` … `run-epic-N`
    jobs in `.tk-studio/config.yaml`.
  - It carries its own bmad-loop orchestrator in `.bmad-loop/`.
  - **Its `main` is not protected.**
- **Ledger:** `~/.tk-studio/measurements/tim-Tim-PC-2.jsonl` holds 25
  events: 12 install-outcome, 9 drift-detection, 4 onboarding-funnel. There
  is **no job-run event yet**. Phase 0's closing condition, the first job-run
  event after Phase 1, is still pending.

## The machine as built (TIM-PC-2, Dell Precision 7865)

| Area | State |
|---|---|
| Account | Single account `tim`: a Microsoft account and local admin. Auto-logon is on; Windows Hello-only sign-in is off. There is no `agent` user; the trade-off is in runbook §1.6. |
| Remote access | Tailscale `100.119.65.48`, `tim-pc-2.tail8e370a.ts.net`, Personal plan, key expiry disabled. RDP is on, with its firewall scoped to `100.64.0.0/10`; verified from the iPad (Windows App). End sessions with the desktop shortcut **Return to PC screen** (`C:\agent-work\tools\return-to-console.bat`), which hands the session back to the console unlocked. |
| Toolchain | winget `--scope machine`: Git, Node 24, uv, Python 3.12, Bun, gh, Terminal, pwsh 7, Tailscale, Godot 4.7.2 Mono, .NET 8 SDK, FFmpeg, Docker sbx. Blender 5.2.2 is on PATH. `core.autocrlf=false`; checkouts are LF. |
| Claude Code | CLI 2.1.274 (stable) in `~/.local/bin`, Max login. tk-studio is installed at project scope for this repo and at user scope for every other project. `~/.claude/settings.json` has the stable channel, `CLAUDE_CODE_GIT_BASH_PATH` and the §3.2 deny list. |
| Godot | Always `& $env:GODOT` (user env var → the real console exe). Never the winget `godot` / `godot_console` links. |
| Docker Sandboxes | sbx v0.45.1, signed in, policy `balanced`. The daemon is started at sign-in by the scheduled task **Docker Sandboxes daemon**, from the home folder. `sbx run claude` is verified. |
| Hermes | 0.21.5 in `%LOCALAPPDATA%\hermes`, Nous Portal provider, a Telegram bot for this box, gateway run by the `Hermes_Gateway` task at logon. `skills.write_approval` and `memory.write_approval` are true; `approvals.cron_mode` is deny. The dashboard is **not** set up yet. |
| Work folder | `C:\agent-work\{backups,tools}`. The **Claude transcript backup** task runs daily at 03:30 (robocopy `/E` of `~/.claude/projects` and `~/.tk-studio`). |
| Windows | Active hours 10:00–04:00; the Update policy is notify-only (AUOptions=2). BIOS AC Behavior is Power On. |

## Gotchas on this box (each cost time on 2026-09-26/27)

- **The Claude desktop app is an MSIX package.** New top-level folders a
  desktop-app session creates under `%LOCALAPPDATA%` or `%APPDATA%` go to a
  private copy (`AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache`) that
  no other program sees, and child processes inherit that context.
  - Never start daemons (sbx, the Hermes gateway, the supervisor) from a
    desktop-app session.
  - Never do the first run of a tool that creates AppData folders (Godot,
    NuGet, npm) from one either.
  - Give Tim the command, or launch it through Task Scheduler.
  - A desktop-app sbx daemon never reached its engine.
  - The supervisor must start from the `shell:startup` / console-hosted path
    in runbook §4.
- **sbx daemon:** start it from a writable directory (`cd $HOME`). Started
  from `C:\Windows\System32`, every pull fails with
  `failed to initialize diskbuf: No space left on device`.
- **Godot .NET through the winget link crashes:** `.NET: Assemblies not
  found`, signal 11. Use `$env:GODOT`. After a winget upgrade of Godot,
  update `GODOT`, because the folder name carries the version.
- **Plugin updates need a version bump.** `claude plugin update` keys on the
  version, so plugin changes reach headless runs only after the release
  motion (`tools/release_archive.py`: bump ×3 → `claude plugin tag --push` →
  `run` → archive-record commit).
- **The Bash deny rule `rm -rf *` is a guardrail.** Don't find another way
  around it; delete specific files instead. The PowerShell tool can be
  disabled in a session. Then call `powershell.exe` from Bash, and write
  anything non-trivial to a `.ps1` in the scratchpad (inline quoting breaks).
- **UAC prompts need Tim present.** Never exercise an elevation path as a
  "test" from a session.
- **The 2026-09-26 gotchas still apply:**
  - Bash heredocs mangle non-ASCII.
  - Never write canonical plan files with PowerShell `Set-Content` (it adds
    a BOM).
  - Use `git grep ':(exclude)…'`.
  - Use the scoped plugin-update form.
  - `claude -p` from a headless Task Scheduler job hangs.
  - Never bypass on the host; bypass only in `sbx`.
  - Hermes never spawns `claude -p` and never runs on Claude OAuth.

## Open items

Plan §6, as of this boundary:

1. **Supervisor repo name.** Open; Phase 1 proposes it.
2. **One Telegram bot per box, or Bot Mode.** This box has its own bot, so
   it's one bot per box for now.
3. **Drive convention.** Resolved: `C:\agent-work` (single-drive box).
   Repos live in `C:\GitHub`.
4. **ClaudeOS dashboard on the main PC.** Open.
5. **Retiring the main PC's Hermes.** Open.

Also open:

- **Protect `the-universe-awaits` `main`** before the supervisor touches it.
  Same rule as tk-studio (PR-only, admins bypass). It's Tim's call; ask.
- **Hermes dashboard** (runbook §3.7): basic auth on the tailnet IP. Tim
  chooses the password.
- **sbx still to verify:** bypass mode inside the microVM, and that
  credential folders are blocked by default.

## Next work: Phase 1, the studio supervisor

The scope and acceptance criteria are plan §3 Phase 1, verbatim. The
standing decision is that **the acceptance target is the-universe-awaits on
a throwaway branch**; there is no blank "slice zero" project. Phase 3's
vertical-slice job creates its own later.

Plan the work through the studio:
1. The BMad planning skills for the brief and the epics and stories.
2. `tk plan sync`.
3. The launch pipeline.

Measure every acceptance run into the ledger before starting the next phase.
The salvage sources are in ClaudeOS, tagged `retired-as-driver-2026-09-26`
at github.com/thkennedy/ClaudeOS: `connectors/tk-studio/{server,client,conformance}.ts`
and `scripts/studio-jobs-tick.ts`. Clone ClaudeOS here only to lift them.

## Starter prompt for the next session

```text
This is TIM-PC-2, the dedicated Windows 11 agent PC for tk-studio. Phase 0 is done: the machine is provisioned, verified, and the runbook now describes it as built. It runs under my normal admin account (single-account variant, runbook §1.6); treat the runbook as accurate for this box.

You have no memory from other sessions beyond this repo and your auto-memory. Read in this order before acting:
1. _bmad-output/implementation-artifacts/handoff-agent-pc-2026-09-27.md (current state, box gotchas, open items)
2. _bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md (rulings, target shape, Phases 0-4 with acceptance criteria)
3. kb/agent-pc-setup-runbook.md §3.4-§4 and §8 (studio, sandbox, Hermes, supervisor hosting, failure modes)
4. _bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/research.md sections 4, 6, 7. The digests are the evidence; do not re-run the web research.

Rulings already made, do not reopen: engine Godot; payer Max plan (claude -p under the Max login, Hermes bills to Nous Portal); driver is an independent supervisor served on this box over HTTP via Tailscale; hub split (the supervisor is extracted from ClaudeOS; Hermes is front door only and never runs claude -p; ClaudeOS is retired, tagged retired-as-driver-2026-09-26 at github.com/thkennedy/ClaudeOS, clone it only to lift connectors/tk-studio/{server,client,conformance}.ts and scripts/studio-jobs-tick.ts). Phase 1's acceptance target is the-universe-awaits (C:\GitHub\the-universe-awaits) on a throwaway branch; no blank project.

Hard rules on this machine: never --dangerously-skip-permissions on the host, bypass only inside Docker Sandboxes; keep the permissions.deny list in ~/.claude/settings.json and never route around it; branch per run, PR-only, main protected on every repo the agent touches; the supervisor and Hermes stay outside the plugin as driver-contract consumers (AD-2); every headless run ends with the status block (AD-11); nothing is done until conformance passes (AD-19). Never start daemons or first-run tools from a Claude desktop app session (see the handoff's MSIX gotcha); hand me the command or use Task Scheduler. Run Godot only via $env:GODOT. Do not change system or security settings yourself; hand me the exact command.

Do this, in order, and report briefly after each step:

A. Sanity: "tk activate" clean for tk-studio and the-universe-awaits; from plugins/tk-studio/lib run the lib tests (719 expected) and contracts/conformance/runner.py run (ok over 18 surfaces); sbx daemon status running. Report only what fails.

B. Ask me whether to protect the-universe-awaits main now (PR required, admins bypass, same as tk-studio) and apply it only on my yes.

C. Start Phase 1, the studio supervisor, through the studio itself. Using the plan's section 3 Phase 1 scope and acceptance criteria verbatim, draft the product brief and the epics and stories for the supervisor with the installed BMad planning skills, then run "tk plan sync". Propose the supervisor's repo name (plan open item 1) with a one-line reason, and propose the exact throwaway branch and job definition you will use against the-universe-awaits for acceptance (its .tk-studio/config.yaml already declares run-epic jobs; say which one and why). Stop for my confirmation before creating any repository or writing any code.

Address me as Tim-Senpai. Lead every reply with pass/fail and blockers; keep it short.
```
