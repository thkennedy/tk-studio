---
title: Agent PC setup runbook — clean Windows 11 to a working studio box
description: Step-by-step provisioning of the dedicated always-on Windows 11 agent machine that runs Claude Code under the Max plan, the tk-studio plugin at the pin, Godot and Blender headless, Docker Sandboxes, Tailscale, the Hermes front door, and (once extracted) the studio supervisor — with the hardening, verification, and known Windows failure modes.
rank: 35
---

# Agent PC setup runbook — clean Windows 11 to a working studio box

The provisioning half of the 2026-09-26 plan
([planning-pass-agent-pc-and-supervisor-2026-09-26.md](../_bmad-output/planning-artifacts/briefs/planning-pass-agent-pc-and-supervisor-2026-09-26.md)).
Evidence for every design choice is in the research run
`_bmad-output/planning-artifacts/research/agent-studio-next-level-2026-09-26/`
(digest 03 official primitives, 04 agent-box patterns, 06 local Hermes, 08 Hermes upstream).

**Rulings this runbook implements:** engine Godot · payer Max plan · driver = an
independent supervisor served on this box over HTTP to the main PC, iPad and
phone · Hermes = front door and dispatcher only · ClaudeOS retired as driver.

Conventions: `%AGENT_WORK%` is `D:\agent-work` (use `C:\agent-work` on a
single-drive box). The studio runs under a **standard** local account named
`agent`; your own admin account is only for setup. Commands marked **(admin)**
run in an elevated PowerShell from the admin account; everything else runs as
`agent`. Steps marked *verify on first run* were not exercised here and should
be confirmed when you do them.

---

## 0. Before you start

- Windows 11 Pro, fully updated, wired network, on a UPS or at least a wall
  outlet that never sleeps. Pro matters: Hyper-V / Windows Hypervisor Platform
  and Group Policy for update behaviour are Pro features.
- Have ready: your Claude Max login, GitHub login, Tailscale login, Nous Portal
  login (Hermes), and a Telegram account.
- The box needs a real GPU for Godot and Blender renders. None of the sandboxes
  below pass a GPU through, which is why engine work runs on the host.

## 1. Windows baseline (admin)

1. Rename the PC to something you will recognise on the tailnet
   (Settings → System → About → Rename).
2. Power and sleep: never sleep, no hibernate, monitor may turn off.

   ```powershell
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /hibernate off
   powercfg /change monitor-timeout-ac 10
   ```

3. BIOS: enable "power on after power loss" (name varies by board) so the box
   comes back after an outage.
4. Windows Update: set active hours to your working day so forced restarts do
   not kill a run mid-story (Settings → Windows Update → Advanced options →
   Active hours). Optional on Pro: `gpedit.msc` → Computer Configuration →
   Administrative Templates → Windows Components → Windows Update → Manage end
   user experience → *Configure Automatic Updates* = **2, notify for download
   and auto install**, so nothing installs behind your back.
5. Virtualisation for Docker Sandboxes (reboot afterwards):

   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All -NoRestart
   Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart
   ```

6. Create the standard `agent` account and its work drive. Do **not** add it
   to Administrators.

   ```powershell
   $pw = Read-Host -AsSecureString "agent password"
   New-LocalUser -Name agent -Password $pw -PasswordNeverExpires -AccountNeverExpires
   Add-LocalGroupMember -Group Users -Member agent
   Add-LocalGroupMember -Group "Remote Desktop Users" -Member agent
   New-Item -ItemType Directory -Path D:\agent-work | Out-Null
   icacls D:\agent-work /grant "agent:(OI)(CI)F" /T
   ```

   Standard users cannot read each other's profiles by default, so your admin
   profile, its `~/.ssh` and cloud credentials are already out of the agent's
   reach. Keep it that way: never sign your personal accounts in as `agent`.

7. Auto-logon for `agent`, so the interactive session (and its console
   window-station) exists after a reboot. This is what lets the supervisor run
   `claude -p` reliably; headless Task Scheduler runs of `claude -p` hang with
   no console (anthropics/claude-code#96932).

   ```powershell
   winget install --id Microsoft.Sysinternals.Autologon -e
   ```

   Run `Autologon.exe`, enter `agent`, the computer name and the password.
   Trade-off: an auto-logged-on, unlocked desktop is only acceptable on a box
   in your own home. Do not set a screen-saver lock; a locked session breaks
   screenshot-based verification. Turn the monitor off instead.

## 2. Tooling (admin, one elevated PowerShell)

All IDs verified against winget on 2026-09-26.

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id astral-sh.uv -e
winget install --id Python.Python.3.12 -e
winget install --id Oven-sh.Bun -e
winget install --id GitHub.cli -e
winget install --id Microsoft.WindowsTerminal -e
winget install --id Microsoft.PowerShell -e
winget install --id Tailscale.Tailscale -e
winget install --id GodotEngine.GodotEngine.Mono -e
winget install --id Microsoft.DotNet.SDK.8 -e
winget install --id Gyan.FFmpeg -e
winget install --id Docker.sbx -e
```

Why each: Git for Windows gives Claude Code its Bash tool and `git`; Node runs
the upstream BMad installer (`npx bmad-method@<pin>`); uv + Python run the
studio's `lib/` and conformance; Bun runs the supervisor (lifted TypeScript);
gh opens PRs; Tailscale is the only way in; Godot Mono for C# projects; .NET 8
for Godot C#; FFmpeg assembles proof videos; Docker Sandboxes is the isolation
tier for bypass-permission runs (microVM, no GPU).

**Godot console binary.** Headless verification needs the `*_console.exe`
build so stdout is readable on Windows (the ClaudeOS mission-runner's Godot
check depended on it). Download the official Windows zip for the version the
project pins and unpack it to `%AGENT_WORK%\tools\godot\`; the zip carries both
`Godot_v4.x_mono_win64.exe` and `Godot_v4.x_mono_win64_console.exe`.

**Blender.** winget ships 5.2.1 today; headless glTF export was broken by the
bundled NumPy until 5.2.2 (research digest 02). Install 5.2.2 or newer from
blender.org, or the portable zip into `%AGENT_WORK%\tools\blender\`. Verify:

```powershell
blender -b --version
```

EEVEE has no headless mode on Windows; QA renders use Workbench or Cycles.

## 3. Sign in as `agent` for everything below

Log off, log on as `agent`. Open Windows Terminal (PowerShell 7).

### 3.1 GitHub and the work tree

```powershell
gh auth login
git config --global user.name  "Tim Kennedy"
git config --global user.email "kennedy.timothyh@gmail.com"
git config --global core.autocrlf false
```

Use a fine-grained GitHub token or the `gh` OAuth flow scoped to the repos the
agent works on. Protect `main` on every repo the agent touches (PR-only,
required checks); the supervisor merges nothing itself.

### 3.2 Claude Code under the Max plan

```powershell
irm https://claude.ai/install.ps1 | iex
```

Open a new terminal, then:

```powershell
claude --version
claude doctor
claude
```

The first `claude` opens the browser login; sign in with the Max account. The
native install auto-updates in the background; pin it to the stable channel and
add the guardrails in `%USERPROFILE%\.claude\settings.json`:

```json
{
  "autoUpdatesChannel": "stable",
  "env": {
    "CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe"
  },
  "permissions": {
    "deny": [
      "Bash(rm -rf *)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git clean*)",
      "Bash(git reset --hard*)"
    ]
  }
}
```

Rules that hold on this box:

- **Never `--dangerously-skip-permissions` on the host.** Anthropic's own
  guidance for native Windows is a container or VM. Bypass runs happen only
  inside Docker Sandboxes (§3.5). Host runs use `--permission-mode auto` or
  `acceptEdits` with the deny list above.
- The PowerShell tool already refuses `Remove-Item` on drive roots and the
  profile in every mode; leave `CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT`
  unset.
- Back up transcripts nightly (§6); a startup GC once deleted thousands
  (anthropics/claude-code#62041).

### 3.3 Tailscale

```powershell
tailscale up
tailscale ip -4
```

Note the tailnet IP and MagicDNS name; every UI below binds to that address.
No router port-forwards, ever. Enable Remote Desktop (Settings → System →
Remote Desktop) and scope its firewall rule to the tailnet **(admin)**:

```powershell
Set-NetFirewallRule -DisplayGroup "Remote Desktop" -RemoteAddress 100.64.0.0/10
```

In the Tailscale admin console, restrict ACLs so only your devices reach this
node. RDP from the iPad or laptop is your break-glass path to the desktop.

### 3.4 tk-studio and the BMad base

```powershell
cd D:\agent-work
git clone https://github.com/thkennedy/tk-studio.git
cd tk-studio
claude
```

Trust the folder. The repo's `extraKnownMarketplaces` entry prompts to add the
`tk-studio` marketplace and install the plugin; accept both. Then, inside the
session, in this order:

1. **"tk activate"** — read-only health check. On a fresh machine it guides the
   per-user store standup (`~/.tk-studio`, registry, ledger). Follow the exact
   fix commands it prints; it applies nothing itself.
2. Open the game project (§3.6) and run **"tk install"** — installs the BMad
   base at the `bmad.lock` pin, non-interactive, verify-at-pin.
3. **"tk onboard"** — proposes the role × project working set with evidence
   and records it only on your confirmation.

The store on this box is its own per-machine store (AD-20) and its own
measurement ledger file (AD-12); nothing is copied from the main PC.

Plugin updates later: `claude plugin marketplace update tk-studio` then
`claude plugin update tk-studio@tk-studio --scope project` (the bare name
fails on current CLIs).

### 3.5 Docker Sandboxes (the bypass tier)

Installed in §2; needs the hypervisor features from §1 and a reboot.

```powershell
sbx --version
cd D:\agent-work\<repo>
sbx run claude
```

*Verify on first run.* Inside the microVM Claude Code may run with bypass;
`~/.ssh` and cloud credential folders are blocked by default and there is no
GPU, so this tier is for code and asset-script work, not engine runs.

### 3.6 The first Godot project ("slice zero")

Create an empty Godot 4 C# project once in the editor at
`D:\agent-work\slice-zero`, commit it to a new GitHub repo with `main`
protected, then `tk install` and `tk onboard` it (§3.4). Confirm headless
launches work with the console binary:

```powershell
& "D:\agent-work\tools\godot\Godot_v4.7-stable_mono_win64_console.exe" --headless --path D:\agent-work\slice-zero --quit
```

This is the target for the supervisor's acceptance run (plan §3, Phase 1).
`the-universe-awaits` is the measured C#/Godot reference project if you want a
non-empty target later.

### 3.7 Hermes (front door only)

Install into the current default layout (`%LOCALAPPDATA%\hermes`; the main PC
still has the old `~/.hermes` layout at 0.18.0):

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
hermes setup --portal
hermes model
```

`--portal` logs in to Nous Portal, sets it as provider and enables the Tool
Gateway. Pick a Portal-billed model for the hub. **Do not** point Hermes at
Claude OAuth: the Max plan is the worker's (`claude -p`) budget and a Claude-OAuth
hub is unresolved in Nous's own tracker (NousResearch/hermes-agent#47260).

Telegram (simpler than the Discord intents that never connected on the main PC):
create a bot with @BotFather, get your numeric id from @userinfobot, then in
`%LOCALAPPDATA%\hermes\.env`:

```text
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_ALLOWED_USERS=<your numeric id>
```

or run `hermes gateway setup` and choose Telegram. Then:

```powershell
hermes gateway install
hermes gateway status
```

`gateway install` registers the Windows Scheduled Task that keeps the gateway
(and its cron tick) alive. Message the bot to confirm.

Gate the learning loop in `%LOCALAPPDATA%\hermes\config.yaml` before the first
real session, so nothing is written without your review:

```yaml
skills:
  write_approval: true
memory:
  write_approval: true
approvals:
  cron_mode: deny
```

Leave the curator on its default (dry consolidation off). BMad artifacts and
the studio's run workspaces stay the source of truth; Hermes learns intake
conventions and your preferences, nothing more.

Dashboard on the tailnet, with basic auth (the gate fails closed on any
non-loopback bind):

```powershell
$env:HERMES_DASHBOARD_BASIC_AUTH_USERNAME = "tim"
$env:HERMES_DASHBOARD_BASIC_AUTH_PASSWORD = "<strong password>"
$env:HERMES_DASHBOARD_BASIC_AUTH_SECRET   = "<32+ random bytes>"
hermes dashboard --host <tailscale-ip>
```

Put those three in the agent user's environment permanently and start the
dashboard from the same Startup shortcut as the supervisor (§4). The **Chat**
tab needs a POSIX PTY and shows a WSL2 banner on native Windows; every other
tab (sessions, cron, config, skills, MCP, logs, analytics) works. You talk to
Hermes through Telegram; the dashboard is for looking. If Git Bash is not
found: `setx HERMES_GIT_BASH_PATH "C:\Program Files\Git\bin\bash.exe"`.

Hermes never spawns `claude -p` for pipeline work on this box. Its one job
toward the studio is turning your intent into a job JSON and POSTing it to the
supervisor (plan Phase 2).

## 4. The studio supervisor (plan Phase 1; placeholder until extracted)

The supervisor is the ruling-4 independent driver: the ~1.5k lines of
contract-consuming TypeScript lifted from ClaudeOS plus a durable queue and an
HTTP API. When its repo exists:

```powershell
cd D:\agent-work
git clone https://github.com/thkennedy/<supervisor-repo>.git
cd <supervisor-repo>
bun install
```

Run it **console-hosted in the interactive `agent` session**, never as a
"run whether user is logged on or not" task. Simplest: a shortcut in
`shell:startup` for the `agent` user that runs

```text
wt.exe -w studio nt --title supervisor pwsh -NoExit -File D:\agent-work\<supervisor-repo>\start.ps1
```

and a second tab for `hermes dashboard`. `start.ps1` binds the API to the
tailnet IP with a bearer token from the agent's environment, backs up
transcripts, and starts the pacer. Smoke test from another device:

```powershell
curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:<port>/status
```

## 5. Hardening checklist

- [ ] `agent` is a standard user; admin account never signs into agent tools.
- [ ] Inbound firewall: nothing open except RDP scoped to `100.64.0.0/10`; no
      router forwards; Tailscale ACL limited to your devices.
- [ ] Optional outbound allowlist for the `agent` account (Anthropic, GitHub,
      Nous, Godot/NuGet/npm/PyPI registries). Fiddly on Windows; do it after
      the smoke tests pass, not before.
- [ ] `permissions.deny` list in place; no bypass on host; bypass only in
      `sbx`.
- [ ] Every repo: `main` protected, PR-only, required checks; the agent's
      GitHub token is repo-scoped.
- [ ] Branch or worktree per run; the supervisor snapshots a Godot project
      with `robocopy` before any editor-in-the-loop run.
- [ ] Windows Update active hours set; auto-restart cannot land mid-run.
- [ ] Weekly full-box checkpoint (Hyper-V export or a disk image) once the
      supervisor is in.

## 6. Nightly transcript backup (robocopy needs no console)

```powershell
schtasks /Create /SC DAILY /ST 03:30 /RU agent /TN "Claude transcript backup" /TR "robocopy \"%USERPROFILE%\.claude\projects\" \"D:\agent-work\backups\claude-projects\" /MIR /R:2 /W:5 /LOG+:D:\agent-work\backups\robocopy.log"
```

Keep `~/.tk-studio` in the same job once the store exists (add a second
`robocopy` line to a `.cmd` and point the task at it).

## 7. Smoke checklist (all as `agent`)

| Check | Command | Pass looks like |
|---|---|---|
| Claude Code | `claude doctor` | version, auto-update stable, no settings errors |
| Studio health | in Claude Code: "tk activate" | four planes green, no drift |
| Lib + conformance | `cd tk-studio\plugins\tk-studio\lib; uv run python -m unittest discover tests` then `uv run ..\contracts\conformance\runner.py run` | all tests pass; conformance ok over every surface |
| Godot headless | console exe `--headless --path <proj> --quit` | exits 0, prints engine banner |
| Blender headless | `blender -b --version` | ≥ 5.2.2 |
| Sandbox tier | `sbx run claude` in a repo | Claude Code prompt inside the microVM |
| Tailnet reach | from iPad: RDP to the MagicDNS name | desktop visible |
| Hermes | `hermes gateway status`; message the Telegram bot | connected; reply within seconds |
| Dashboard | browse `http://<tailscale-ip>:9119` from iPad | basic-auth prompt, then Status tab |
| Supervisor | `curl …/status` from another device | JSON status |

## 8. Known Windows failure modes and what this runbook does about them

| Failure | Source | Mitigation here |
|---|---|---|
| `claude -p` from Task Scheduler hangs with no console window-station | anthropics/claude-code#96932 (open 2026-09-25) | auto-logon + Startup-folder console host (§1.7, §4) |
| Silent REPL exit after 10–30 min of dense Bash | #55424 | supervisor resumes from the `.jsonl` transcript; dense scripted work goes to the `sbx` tier |
| Native installer resolves `bash` to the WSL stub; hooks hang | #37634 | `CLAUDE_CODE_GIT_BASH_PATH` set (§3.2) |
| Startup GC deleted transcripts | #62041 | nightly robocopy (§6) |
| Cleanup script followed junctions and deleted 48k files | r/ClaudeAI, 2026-09-25 | standard user, deny list, no bypass on host, no junctions in agent worktrees, snapshots |
| Blender headless glTF export fails on 5.2.1 | research digest 02 | install ≥ 5.2.2 (§2) |
| EEVEE cannot render headless on Windows | research digest 02 | Workbench/Cycles for QA renders |
| Hermes dashboard Chat tab needs a PTY | Hermes windows-native docs | use Telegram to talk; dashboard for viewing (§3.7) |
| Hermes hub on Claude OAuth drains extra-usage credits | NousResearch/hermes-agent#47260 | hub on Nous Portal, worker on Max (§3.7) |
| Windows Update restarts mid-run | — | active hours + notify-only policy (§1.4) |

## 9. Retiring ClaudeOS on the main PC (done 2026-09-26, one step left)

On the main PC the `ClaudeOS Dream`, `ClaudeOS Mission Watchdog` and
`ClaudeOS Review Watcher` tasks are disabled and the supervisor's `vite`
(:8081) and voice-lab (:8099) processes are stopped. The `ClaudeOS Supervisor`
task itself is registered with an S4U principal and refuses changes without
elevation; disable it from an **elevated** PowerShell once:

```powershell
schtasks /Change /TN "ClaudeOS Supervisor" /DISABLE
```

Then push ClaudeOS's 19 unpushed commits and tag the state, and remove the
stale `D:\Code\ClaudeOS-studio-pipeline` worktree (`git worktree remove`).
Nothing on the agent PC depends on ClaudeOS.
