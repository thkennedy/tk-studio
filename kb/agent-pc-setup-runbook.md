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
single-drive box). Two account models:

- **Hardened** (the default below): the studio runs under a **standard** local
  account named `agent`; your own admin account is only for setup.
- **Single-account**: the studio runs under your own account, and the `agent`
  steps are skipped (§1.6). The first agent PC runs this way (decided
  2026-09-27). The trade-off is spelled out in §1.6.

Commands marked **(admin)** run in an elevated PowerShell; everything else runs
as the *studio account* (`agent`, or yourself on a single-account box). Steps
marked *verify on first run* were not exercised here and should be confirmed
when you do them.

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

   *Single-account box:* skip this step and create only the work folder. Your
   profile, `~/.ssh` and signed-in credentials are then within the agent's
   reach, and a UAC prompt is the only barrier to admin actions, so the §3.2
   deny list and the no-bypass-on-host rule are the main guard.

7. Auto-logon for the studio account, so the interactive session (and its
   console window-station) exists after a reboot. This is what lets the
   supervisor run `claude -p` reliably; headless Task Scheduler runs of
   `claude -p` hang with no console (anthropics/claude-code#96932).

   ```powershell
   winget install --id Microsoft.Sysinternals.Autologon -e
   ```

   Run `Autologon.exe`, enter the studio account, the computer name and the
   password.
   Trade-off: an auto-logged-on, unlocked desktop is only acceptable on a box
   in your own home. Do not set a screen-saver lock; a locked session breaks
   screenshot-based verification. Turn the monitor off instead.

## 2. Tooling (admin, one elevated PowerShell)

**If `winget` is not recognised.** Some clean Windows 11 images ship without
App Installer registered, and registering it by family name can fail with
0x80073CF9. Install it with Microsoft's WinGet module from a normal
(non-elevated) Windows PowerShell, then open a new terminal:

```powershell
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force
Install-Module -Name Microsoft.WinGet.Client -Scope CurrentUser -Force
Repair-WinGetPackageManager -Latest -Force
winget --version
```

All IDs verified against winget on 2026-09-26; every one has a machine-scope
installer (checked 2026-09-27).

```powershell
winget install --id Git.Git -e --scope machine
winget install --id OpenJS.NodeJS.LTS -e --scope machine
winget install --id astral-sh.uv -e --scope machine
winget install --id Python.Python.3.12 -e --scope machine
winget install --id Oven-sh.Bun -e --scope machine
winget install --id GitHub.cli -e --scope machine
winget install --id Microsoft.WindowsTerminal -e --scope machine
winget install --id Microsoft.PowerShell -e --scope machine
winget install --id Tailscale.Tailscale -e --scope machine
winget install --id GodotEngine.GodotEngine.Mono -e --scope machine
winget install --id Microsoft.DotNet.SDK.8 -e --scope machine
winget install --id Gyan.FFmpeg -e --scope machine
winget install --id Docker.sbx -e --scope machine
```

`--scope machine` matters: without it, the portable packages (uv, Bun, FFmpeg,
Godot) install per-user into whichever account runs the elevated shell, where
the `agent` account cannot see them. Docker.sbx installs per-user
(`%LOCALAPPDATA%\DockerSandboxes`) even at machine scope; on the hardened
model, install it again as `agent` (*verify on first run*).

Why each: Git for Windows gives Claude Code its Bash tool and `git`; Node runs
the upstream BMad installer (`npx bmad-method@<pin>`); uv + Python run the
studio's `lib/` and conformance; Bun runs the supervisor (lifted TypeScript);
gh opens PRs; Tailscale is the only way in; Godot Mono for C# projects; .NET 8
for Godot C#; FFmpeg assembles proof videos; Docker Sandboxes is the isolation
tier for bypass-permission runs (microVM, no GPU).

**Godot console binary.** Headless verification needs the `*_console.exe`
build so stdout is readable on Windows (the ClaudeOS mission-runner's Godot
check depended on it). The winget package ships it, but **don't run the
.NET build through the `godot` / `godot_console` links winget puts on
PATH**. Godot looks for its `GodotSharp` assemblies next to the path it was
started from, which is the link in `C:\Program Files\WinGet\Links`. Any C#
project then crashes at startup with `.NET: Assemblies not found` and
signal 11 (only `--version` still works). Point the `GODOT` user
environment variable at the real console exe instead. That's the
Chickensoft convention The Universe Awaits' scripts and launch configs
already use:

```powershell
[Environment]::SetEnvironmentVariable("GODOT", "C:\Program Files\WinGet\Packages\GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe", "User")
```

Open a new terminal and check with `& $env:GODOT --version`. The folder name
carries the version, so update `GODOT` after every
`winget upgrade GodotEngine.GodotEngine.Mono`. Only when a project pins a
different version, download the official Windows zip and unpack it to
`%AGENT_WORK%\tools\godot\`; the zip carries both
`Godot_v4.x_mono_win64.exe` and `Godot_v4.x_mono_win64_console.exe`.

**Blender.** winget ships 5.2.1 today; headless glTF export was broken by the
bundled NumPy until 5.2.2 (research digest 02). Install 5.2.2 or newer from
blender.org, or the portable zip into `%AGENT_WORK%\tools\blender\`. Download
it in a browser: blender.org serves scripted downloads a bot-check page. The
installer does not add Blender to PATH, so add its folder
(`C:\Program Files\Blender Foundation\Blender 5.2`, or the unpacked zip) to
the studio account's PATH and open a new terminal. Verify:

```powershell
blender -b --version
```

EEVEE has no headless mode on Windows; QA renders use Workbench or Cycles.

## 3. Sign in as the studio account for everything below

Hardened model: log off, log on as `agent`. Single-account box: stay signed
in. Open Windows Terminal (PowerShell 7).

### 3.1 GitHub and the work tree

```powershell
gh auth login
git config --global user.name  "Tim Kennedy"
git config --global user.email "kennedy.timothyh@gmail.com"
git config --global core.autocrlf false
```

Git for Windows' system config sets `core.autocrlf=true`, so a repo cloned
before this line (by GitHub Desktop, say) has a CRLF checkout. Every file the
BMad installer then rewrites in LF shows as modified although its content is
unchanged; on the first agent PC that was all 242 files under
`.claude/skills/`. On a clean tree, rewrite the checkout once and confirm
`git ls-files --eol` shows only `w/lf`:

```powershell
git rm --cached -r -q .
git checkout HEAD -- .
```

(`git checkout-index --force --all` is not enough: it skips files whose
cached stat still matches.)

Use a fine-grained GitHub token or the `gh` OAuth flow scoped to the repos the
agent works on. Protect `main` on every repo the agent touches (PR-only,
required checks); the supervisor merges nothing itself.

### 3.2 Claude Code under the Max plan

```powershell
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) stable
```

Pass `stable`: the bare `irm https://claude.ai/install.ps1 | iex` installs the
latest build and rewrites `autoUpdatesChannel` in `settings.json` to `latest`,
overriding the stable pin below. The installer also does not put
`%USERPROFILE%\.local\bin` (where `claude.exe` lands) on PATH; add it to the
studio account's user PATH.

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

Sign up with a personal email: that gets the free Personal plan (up to 6
users, unlimited devices) with no end date. A custom-domain sign-up starts a
14-day Business trial that needs a plan chosen when it ends
(tailscale.com/pricing, 2026-09-27).

Note the tailnet IP and MagicDNS name; every UI below binds to that address.
No router port-forwards, ever. Enable Remote Desktop (Settings → System →
Remote Desktop) and scope its firewall rule to the tailnet **(admin)**:

```powershell
Set-NetFirewallRule -DisplayGroup "Remote Desktop" -RemoteAddress 100.64.0.0/10
```

In the Tailscale admin console, restrict ACLs so only your devices reach this
node. RDP from the iPad or laptop is your break-glass path to the desktop.

Ending an RDP session with a plain disconnect leaves the box's own screen
locked, which breaks screenshot-based verification. Hand the session back
instead, from an elevated PowerShell inside it:

```powershell
tscon (Get-Process -Id $PID).SessionId /dest:console
```

The first agent PC keeps this as a one-click
`C:\agent-work\tools\return-to-console.bat` with a desktop shortcut. It
elevates itself and does nothing when run on the box's own screen. It was
verified on 2026-09-27 from an iPad (Windows App over Tailscale): the RDP
client disconnects and the session reattaches to the console unlocked. The
LocalSessionManager log shows event 25, "reconnection succeeded", from
`LOCAL`. The next RDP reconnect briefly shows an "Unlocking PC" screen while
the session moves back; that's expected.

### 3.4 tk-studio and the BMad base

```powershell
cd D:\agent-work
git clone https://github.com/thkennedy/tk-studio.git
cd tk-studio
claude
```

Trust the folder. The repo's `extraKnownMarketplaces` entry prompts to add the
`tk-studio` marketplace and install the plugin; accept both. The Claude
desktop app loads the plugin's skills without recording a CLI install, so if
you set up from the app (or skipped the prompt), "tk activate" reports plugin
drift ("not installed in the harness") and headless `claude -p /tk-studio:…`
answers "Unknown command". Fix it from the repo root:

```powershell
claude plugin install tk-studio@tk-studio --scope project
git restore .claude/settings.json
```

The install rewrites `.claude/settings.json` with its keys reordered (same
content), hence the restore. Then, inside the session, in this order:

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

Installed in §2; needs the hypervisor features from §1 and a reboot. The
daemon is not running after install, the global network policy must be
initialised once before the first sandbox, and `sbx` needs a Docker sign-in:

```powershell
sbx version
sbx login
cd $HOME
sbx daemon start -d
sbx policy init balanced
sbx diagnose
cd D:\agent-work\<repo>
sbx run claude
```

**Start the daemon from a writable working directory**, as with `cd $HOME`
above. It keeps the directory it was started from, and its layer unpacker
(`mkfs.erofs`) creates its temp file there, ignoring `TEMP` and `TMPDIR`.
Started from `C:\Windows\System32` (an admin terminal's default), every image
pull fails with `failed to initialize diskbuf: No space left on device`
(reproduced 2026-09-27 on sbx v0.45.1). Don't start it from a Claude desktop
app session either: a daemon started that way never reached its internal
engine (`Cannot connect to the Docker daemon at …docker.sock`). Sign in
before starting it.

**Never let an sbx command auto-start the daemon from a Claude session.** When the daemon is down, every sbx command but `sbx daemon status` starts one in the caller's context. From a Claude desktop-app session that daemon runs inside the app's container: it reads the sandbox records but cannot reach the inner engine, `sbx ls` lists nothing, and every `sbx exec` fails with `backend unavailable` (first agent PC, 2026-10-06, right after the v0.47.0 upgrade). Check `sbx daemon status` first. If it is not running, start it through the sign-in task from PowerShell, `Start-ScheduledTask -TaskName "Docker Sandboxes daemon"`; Git Bash rewrites the switches of `schtasks /Run /TN` as paths.

`balanced` is deny-by-default plus an allow list of AI services and package
registries (`allow-all` and `deny-all` are the alternatives; `sbx policy
reset` starts over). `sbx diagnose` should end with no failures. The CLI has
no `--version` flag.

The daemon does **not** come back on its own after a reboot (verified
2026-09-27). Until the supervisor's `start.ps1` (§4.3) starts it, register a
sign-in task that starts it from the home folder. Task Scheduler launches it
outside any Claude desktop app session, and the daemon outlives the task:

```powershell
$action    = New-ScheduledTaskAction -Execute "$env:LOCALAPPDATA\DockerSandboxes\bin\sbx.exe" -Argument "daemon start -d" -WorkingDirectory $env:USERPROFILE
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"; $trigger.Delay = "PT30S"
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName "Docker Sandboxes daemon" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
```

`sbx run claude` reaching a Claude prompt inside the microVM was verified on
2026-09-27. Still *verify on first run*: inside the microVM Claude Code may
run with bypass, and `~/.ssh` and cloud credential folders are blocked by
default. There is no GPU, so this tier is for code and asset-script work,
not engine runs.

### 3.6 The first Godot project ("slice zero")

Create an empty Godot 4 C# project once in the editor at
`D:\agent-work\slice-zero`, commit it to a new GitHub repo with `main`
protected, then `tk install` and `tk onboard` it (§3.4). Confirm headless
launches work with the console binary:

```powershell
& $env:GODOT --headless --path D:\agent-work\slice-zero --quit
```

This is the target for the supervisor's acceptance run (plan §3, Phase 1).
`the-universe-awaits` is the measured C#/Godot reference project if you want a
non-empty target later.

*The first agent PC skipped slice zero:* its target is The Universe Awaits,
cloned to `C:\GitHub\the-universe-awaits`, where the Godot project lives under
`game\`. Build it once (`dotnet build TheUniverseAwaits.sln`), then run
`& $env:GODOT --headless --path game --quit`, which prints `TUA.Game shell
ready` and exits 0. Do both first runs from your own terminal: they create
Godot's and NuGet's AppData folders, which a Claude desktop app session would
create privately (§8).

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

### 3.8 The bmad-loop engine lives in Docker Sandboxes

The execution engine is bmad-loop. It starts its dev sessions with
`bypassPermissions`, and the studio's pipeline routing writes that flag into
the engine's policy. So the engine only ever runs inside a Docker Sandboxes
microVM (§3.5), never on the host, and never in WSL. This was verified end to
end on 2026-09-28: tk-studio Epics 20 and 24 and the supervisor's Epic 21 were
all built this way.

**Create one sandbox per project.** It mounts the project read-write and the
tk-studio checkout read-only; tk-studio's own sandbox needs only its own
mount. Run this from your home folder, never from `System32` (§3.5):

```powershell
cd $HOME
sbx create --name claude-<project> claude C:\GitHub\<project> C:\GitHub\tk-studio:ro
```

Claude inside the sandbox authenticates through the global `anthropic` sbx
secret, which is the Max login. No sign-in is needed per sandbox.

**Provision it once** with `tools/sbx-engine/provision-engine.sh`. It is
idempotent, and it sets up:

- a git identity for the engine's own commits
- tmux
- bmad-loop at the `bmad.lock` pin with the `[tui]` extra
- Bun, when `WITH_BUN=1` is set
- the .NET SDK, when `WITH_DOTNET=<channel>` is set
- Godot (mono, Linux), when `WITH_GODOT=<version>` is set: the binary under
  `~/godot`, a `godot` command on PATH, and `GODOT` in the profile
- `TK_STUDIO_ROOT`
- the tk-studio plugin at user scope
- the sandbox's own studio store, with the project registered as developer

From Git Bash, set `MSYS_NO_PATHCONV=1`, or Git Bash rewrites `/c/...`
arguments to `C:/...`:

```bash
MSYS_NO_PATHCONV=1 sbx exec claude-<project> bash -lc 'GIT_NAME="Tim Kennedy" GIT_EMAIL="<noreply email>" bash /c/GitHub/tk-studio/tools/sbx-engine/provision-engine.sh /c/GitHub/<project> /c/GitHub/tk-studio'
```

**C# / Godot projects need a network rule first.** The `balanced` policy
blocks NuGet and the .NET download hosts (verified 2026-09-28), and the VM's
Ubuntu packages only .NET 10, so a game project's sandbox cannot restore or
build. Approving a network rule is the operator's call. Scope it to the one
sandbox, from your terminal:

```powershell
sbx policy allow network --sandbox claude-<project> "api.nuget.org,globalcdn.nuget.org,dot.net,builds.dotnet.microsoft.com,dotnetcli.azureedge.net"
```

Then provision with `WITH_DOTNET=8.0 WITH_GODOT=4.7.2`. Godot for Linux comes
from the GitHub release, which the policy already allows. It runs through
`$GODOT`, and through `godot` on PATH for project gates that call it by name.

Proved on 2026-09-28 in `claude-the-universe-awaits`: .NET SDK 8.0.425,
Godot 4.7.2 mono, and `TUA_ENGINE_GATE=1 bash scripts/verify.sh` green (1030
xunit tests, 137 engine tests).

**The engine reads the Windows checkout's line endings.** The sandbox mounts
the host checkout, so a file under `* text=auto` arrives with CRLF. A test
that compares text byte for byte fails in the sandbox and on the host, while
a WSL-native clone passes. Pin such formats to LF in the project's
`.gitattributes` (the-universe-awaits PR #2 did this for `*.tss`), then
delete and check out the affected files again.

**Project setup.** Run this once per project, on the host:

1. `tk install` at the pin, with the full module set, then `tk onboard`.
2. `bmad-loop init --cli claude` inside the sandbox. Then change the four hook
   commands in `.claude/settings.json` to
   `uv run --no-project python "$CLAUDE_PROJECT_DIR"/.bmad-loop/bmad_loop_hook.py <Event>`.
   On the Windows host `python3` is the Microsoft Store stub, and every
   desktop-app session runs these hooks.
3. Add the studio pipeline:
   - the gate plugin in `.bmad-loop/plugins/studio-pipeline/`
   - the executor customization `_bmad/custom/bmad-build-auto.toml`
   - `.tk-studio/budget-bands.yaml`
   - `.bmad-loop/routing.toml`

   Copy them from tk-studio. `tk-studio-supervisor` shows the adaptation for
   a non-Python repo.
4. Gitignore:
   - `.bmad-loop/{runs,cache,archive}/`
   - `.bmad-loop/policy.toml`
   - `.bmad-loop/routing.current.json`
   - `_bmad/render/`
   - `_bmad/config.user.yaml`
   - `_bmad-output/implementation-artifacts/supervision/`

**Running an epic:**

1. Cut a run branch from `main` in the project checkout: `loop/epic-<N>`. The
   loop commits locally and never pushes.
2. Launch with `tools/sbx-engine/launch-epic.sh`, held through a background
   `sbx exec`. **A sandbox stops when nothing is attached**, and a detached
   engine and its tmux server die with it. The script keeps the exec
   attached while `bmad-loop run` lives. The supervisor's `start.ps1` takes
   this over in §4.
3. Epic 20 needed two launch passes: the first wrote SPEC.md, `stories.yaml`
   and the first plan, then ended `blocked` on the dirty tree. Commit that
   output and launch again. The Epic 24 launch committed its own bootstrap.
4. Each landed story is metered by the studio pipeline's `post_commit` hook
   (`lib/meter.py`). The hook copies transcripts out of the microVM into
   `<run_dir>/transcripts/` and records one `observation`.
5. When the run completes, open a PR from `loop/epic-<N>` into `main`.

**When a run pauses:**

- **On an escalation whose story did no work** (a missing fact, a render
  halt): fix the cause, then re-arm it with `tools/sbx-engine/resume-run.sh`.
- **On a story that already committed** (its spec says `status: done`, but
  the engine's close-out failed): commit the engine's staged harvest by hand,
  run `bmad-loop archive <run>`, and launch again. It skips stories that are
  done.
- **At the reconcile gate** (deviation score of 2 or more, no verdict): this
  is an attended step. Run `.bmad-loop/plugins/studio-pipeline/reconcile.md`,
  record the verdict on the spec, and carry any `adjust-stories` notes into
  the unstarted entries' `invoke_dev_with`. Then close it the same way.

**Pin an engine sandbox alive (sbx v0.47.0 and later).** `sbx run -d --name <sandbox>` keeps a local sandbox running after every session disconnects, until `sbx stop <sandbox>`. Verified 2026-10-06 on the first agent PC: the same boot, no restart, the sandbox still `running` 50 s after the last `sbx exec` ended. Run it once after `launch-epic.sh` has attached, and the engine no longer dies with the host-side `sbx exec` that started it (the hole the 2026-09-29 handoff lists as number 7). `sbx stop` releases the pin when the run is over.

## 4. The studio supervisor

The supervisor is the ruling-4 independent driver. It consumes the driver
contract from outside the plugin (AD-2): the contract code lifted from
ClaudeOS, plus a durable SQLite queue, a lock per checkout, guards it enforces
itself, a pacer, crash recovery, an HTTP API and a status page. It was built on
2026-09-28 through the studio's own launch pipeline (plan Epics 21 and 22).

- **Repo:** `thkennedy/tk-studio-supervisor`, private, `main` protected. Bun
  and TypeScript.
- **Clone path:** `C:\GitHub\tk-studio-supervisor`, beside tk-studio.
- **Full reference:** the repo's `README.md` (commands, API routes, queue and
  restart rules, worker tiers).

### 4.1 Install

```powershell
cd C:\GitHub
git clone https://github.com/thkennedy/tk-studio-supervisor.git
cd tk-studio-supervisor
bun install --frozen-lockfile
$env:TK_STUDIO_ROOT = 'C:\GitHub\tk-studio'
bun test
```

With `TK_STUDIO_ROOT` set and `uv` on PATH, `bun test` also runs the
end-to-end suites. They use a throwaway store, project and queue, and a faked
worker, so they touch nothing real. On the first agent PC: 545 pass, 16 skip,
0 fail. The skips are POSIX-only cases and the symlink cases.

### 4.2 Environment

Set these in the studio account's **User** environment. `start.ps1` reads the
User scope each time it starts, so a change needs no new logon.

| Variable | Needed | What it holds |
|---|---|---|
| `TK_STUDIO_ROOT` | always | the tk-studio checkout, `C:\GitHub\tk-studio` |
| `TK_SUPERVISOR_DB` | always | the queue database file. It must lie outside every git checkout, the studio store and `TK_STUDIO_ROOT`, for example `C:\agent-work\supervisor\queue.db` |
| `TK_SUPERVISOR_BIND` | always | this machine's Tailscale IPv4 address (`tailscale ip -4`). Anything outside `100.64.0.0/10` is refused |
| `TK_SUPERVISOR_TOKEN` | always | the API's bearer token. Never logged, never rendered |
| `TK_SUPERVISOR_SESSION_SECRET` | always | signs the browser's session cookie (Story 22.5). Random, at least 32 bytes, else `serve` refuses with `SessionSecretWeak`. Never logged, never rendered |
| `TK_SUPERVISOR_PORT` | no | the API's port, default `8787` |
| `TK_SUPERVISOR_TRANSCRIPT_BACKUP` | no, warned when unset | the nightly backup's `claude-projects` folder (§6). A resume restores a missing transcript from it, and every host run's transcript is copied into it |
| `TK_SUPERVISOR_NOTIFY` | no | the notification target: `ntfy` or `telegram`. Unset sends nothing |
| `TK_SUPERVISOR_NTFY_URL` | with `ntfy` | the full topic URL. The topic is its secret |
| `TK_SUPERVISOR_TELEGRAM_TOKEN` | with `telegram` | the bot token |
| `TK_SUPERVISOR_TELEGRAM_CHAT` | with `telegram` | the chat id that receives the message |
| `TK_SUPERVISOR_WORK` | for editor-in-the-loop runs | the work folder that holds the snapshots, `C:\agent-work` |
| `TK_SUPERVISOR_CONFIG` | no | the per-job tier config. Unset runs every job on the host tier |
| `TK_SUPERVISOR_TLS_CERT`, `TK_SUPERVISOR_TLS_KEY`, `TK_SUPERVISOR_TLS_NAME` | for https and the phone sign-in (§4.5) | the `tailscale cert` certificate and key files and the machine's MagicDNS name. All three or none (`TlsConfigIncomplete`); set them only after the files exist (`TlsCertUnreadable`) |
| `TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID`, `_CLIENT_SECRET`, `_ALLOW` | for Google sign-in | all three or none (`OAuthConfigIncomplete`); needs the TLS variables (`OAuthNeedsHttps`). `_ALLOW` is the one Google account allowed |
| `TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID`, `_CLIENT_SECRET`, `_ALLOW` | for GitHub sign-in | the same rules; `_ALLOW` is the one GitHub login allowed |

Set them from your own PowerShell 7 terminal. The token line makes a random
token and stores it without printing it:

```powershell
[Environment]::SetEnvironmentVariable('TK_STUDIO_ROOT', 'C:\GitHub\tk-studio', 'User')
New-Item -ItemType Directory -Force C:\agent-work\supervisor | Out-Null
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_DB', 'C:\agent-work\supervisor\queue.db', 'User')
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_BIND', (tailscale ip -4), 'User')
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_TOKEN', [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)), 'User')
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_TRANSCRIPT_BACKUP', 'C:\agent-work\backups\claude-projects', 'User')
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_WORK', 'C:\agent-work', 'User')
[Environment]::SetEnvironmentVariable('TK_SUPERVISOR_SESSION_SECRET', [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)), 'User')
```

The same, as one script that also wires the notifier (Telegram through the
Hermes bot by default, an ntfy topic generated and ready; the supervisor's
`operator-decisions.md` §6) and puts the Startup shortcut of §4.3 in place:
`tools/agent-pc/set-supervisor-env.ps1` in this repo, run once from your own
PowerShell 7 terminal. It generates the token and the topic and keeps them on
a re-run; `-ShowToken` prints the token once, for the phone, and `-WithTls` fetches
the Tailscale certificate and sets the TLS variables (§4.5).

The worker never sees the API token or the notifier's credentials: the
supervisor removes them, and `ANTHROPIC_API_KEY`, from every worker's
environment. The Max login pays (ruling 3).

### 4.3 Start at logon

Run the supervisor **console-hosted in the studio account's interactive
session**. Never register it as a "run whether user is logged on or not" task
(§8), and never start it from a Claude desktop-app session (the app's AppData
virtualisation, §8).

Put a shortcut in `shell:startup` (Win+R, `shell:startup`) with this target:

```text
wt.exe -w studio nt --title supervisor pwsh -NoExit -File C:\GitHub\tk-studio-supervisor\start.ps1
```

Add a second tab for `hermes dashboard` (§3.7). `start.ps1` prints the same
command with the repo path filled in, then:

1. Reads the variables of §4.2 from the User environment. A missing
   `TK_SUPERVISOR_BIND` or `TK_SUPERVISOR_TOKEN` stops it and names the
   variable, never a value.
2. With the three TLS variables set, runs `tailscale cert` once for the MagicDNS
   name into the certificate files (bounded at 120 s; a failure is a warning, and
   `serve` uses the files as they are).
3. Starts the API keeper in the same console. The keeper restarts the API with
   a back-off whenever it exits, so `/status` answers while long runs are
   driven.
4. Starts the Docker Sandboxes daemon from `$HOME` when `sbx ls` shows it is
   not running.
5. Runs one recovery pass: a run left behind by a killed supervisor resumes
   from its transcript, or ends `partial` with the reason named.
6. Loops the pacer: a tick, then a drain of the API's submissions, then a
   sleep of `-IntervalSeconds` (default 60).

Right after logon Tailscale may not have its address yet. The keeper warns and
retries, and the pacer runs on. Ctrl+C in the tab stops the pacer and the API.

### 4.4 Retire the sbx sign-in task

`start.ps1` starts the sbx daemon, so the "Docker Sandboxes daemon" sign-in
task of §3.5 is no longer needed. Retire it after one reboot has shown the
supervisor tab bringing the daemon up:

```powershell
Unregister-ScheduledTask -TaskName "Docker Sandboxes daemon" -Confirm:$false
```

### 4.5 Smoke test

From another device on the tailnet, after a reboot and auto-logon:

```powershell
curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/status
```

It answers JSON: the run counts by state, the live runs, and the checkout
locks that are held. With the TLS variables set, the same call is
`https://<TLS_NAME>:8787/status`; the certificate is a public one, so `curl`
needs no `-k`.

**The status page from a phone (Story 22.5).** `GET /` without the bearer
header answers a sign-in page: a form for the API token, "Continue with
Google" and "Continue with GitHub". Sign-in sets a seven-day `HttpOnly`,
`Secure` session cookie, so it works only over https. The operator's steps,
once:

1. Enable HTTPS certificates in the Tailscale admin console (DNS → HTTPS
   Certificates). Then set the TLS variables (`set-supervisor-env.ps1 -WithTls`,
   or by hand `tailscale cert --cert-file <TLS_CERT> --key-file <TLS_KEY>
   <TLS_NAME>` followed by the three variables) and restart `start.ps1`. Open
   `https://<TLS_NAME>:8787/` on the phone and sign in with the token.
2. For Google and GitHub: register a Google OAuth web client and a GitHub
   OAuth app with the callbacks `https://<TLS_NAME>:8787/auth/google/callback`
   and `https://<TLS_NAME>:8787/auth/github/callback`, set the six
   `TK_SUPERVISOR_OAUTH_*` variables (`_ALLOW` is the one Google account and
   the one GitHub login allowed), and restart `start.ps1`.

There is no sign-out: a session ends at its expiry, or rotate
`TK_SUPERVISOR_SESSION_SECRET` and restart to end every session at once. The
certificate is renewed only when `start.ps1` starts (supervisor DW-21), so a
box that stays up past the certificate's 90 days needs the tab restarted.

### 4.6 What runs where

| Tier | Where the worker runs | Permission mode |
|---|---|---|
| host (default) | `claude -p` in the supervisor's console session, under the Max login | `auto`, or `acceptEdits` when the job asks. A bypass request is refused before anything starts |
| sbx | `claude -p` inside the project's Docker Sandboxes microVM (§3.8) | bypass is allowed there |

The tier comes from the submission or from `TK_SUPERVISOR_CONFIG`, never from
the plugin. The supervisor never chooses a model: model and effort are
forwarded as the job or the submission gives them (AD-14).

## 5. Hardening checklist

- [ ] Hardened model: `agent` is a standard user; admin account never signs
      into agent tools. Single-account box: the trade-off in §1.6 is accepted
      and the deny list below is in place.
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

Back up `~/.claude/projects` and `~/.tk-studio` to the work drive every
night. Copy with `/E`, never `/MIR`: `/MIR` mirrors deletions, so a
transcript GC (#62041) or a bad cleanup would be copied into the backup the
next night and the copy lost too. `/E` only adds and updates; prune the
backup by hand if it ever grows too large.

`D:\agent-work\tools\nightly-backup.cmd` (`C:\agent-work` on a single-drive
box):

```bat
@echo off
set "DEST=D:\agent-work\backups"
set "LOG=%DEST%\robocopy.log"
set RC=0
robocopy "%USERPROFILE%\.claude\projects" "%DEST%\claude-projects" /E /R:2 /W:5 /NP /LOG+:"%LOG%"
if %ERRORLEVEL% GEQ 8 set RC=1
robocopy "%USERPROFILE%\.tk-studio" "%DEST%\tk-studio" /E /R:2 /W:5 /NP /LOG+:"%LOG%"
if %ERRORLEVEL% GEQ 8 set RC=1
exit /b %RC%
```

Robocopy exit codes 0–7 mean success; the script maps 8 and above to 1, so
Task Scheduler's *Last Run Result* only shows a failure for a real one.
Register the task as the studio account. It needs no stored password: it
runs while that account is signed in, which auto-logon (§1.7) guarantees,
and a run missed while the box was off happens at the next start.

```powershell
$action    = New-ScheduledTaskAction -Execute cmd.exe -Argument '/c "D:\agent-work\tools\nightly-backup.cmd"'
$trigger   = New-ScheduledTaskTrigger -Daily -At 3:30am
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName "Claude transcript backup" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
Start-ScheduledTask -TaskName "Claude transcript backup"
```

Check that `(Get-ScheduledTaskInfo "Claude transcript backup").LastTaskResult`
is `0` and the transcripts are under `backups\claude-projects`. Verified on
the first agent PC on 2026-09-27 (with `C:\agent-work`).

## 7. Smoke checklist (all as the studio account)

| Check | Command | Pass looks like |
|---|---|---|
| Claude Code | `claude doctor` | version, auto-update stable, no settings errors |
| Studio health | in Claude Code: "tk activate" | four planes green, no drift |
| Lib + conformance | `cd tk-studio\plugins\tk-studio\lib; uv run python -m unittest discover tests` then `uv run ..\contracts\conformance\runner.py run` | all tests pass; conformance ok over every surface |
| Godot headless | `& $env:GODOT --headless --path <proj> --quit` | exits 0, prints engine banner |
| Blender headless | `blender -b --version` | ≥ 5.2.2 |
| Sandbox tier | `sbx run claude` in a repo | Claude Code prompt inside the microVM |
| Tailnet reach | from iPad: RDP to the MagicDNS name | desktop visible |
| Hermes | `hermes gateway status`; message the Telegram bot | connected; reply within seconds |
| Dashboard | browse `http://<tailscale-ip>:9119` from iPad | basic-auth prompt, then Status tab |
| Supervisor | from another tailnet device: `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/status` | JSON with `ok: true`, the run counts and the held locks |
| Supervisor tests | `cd C:\GitHub\tk-studio-supervisor; $env:TK_STUDIO_ROOT='C:\GitHub\tk-studio'; bun test` | 0 fail, the end-to-end suites included |

## 8. Known Windows failure modes and what this runbook does about them

| Failure | Source | Mitigation here |
|---|---|---|
| `claude -p` from Task Scheduler hangs with no console window-station | anthropics/claude-code#96932 (open 2026-09-25) | auto-logon + Startup-folder console host (§1.7, §4) |
| Silent REPL exit after 10–30 min of dense Bash | #55424 | supervisor resumes from the `.jsonl` transcript; dense scripted work goes to the `sbx` tier |
| Native installer resolves `bash` to the WSL stub; hooks hang | #37634 | `CLAUDE_CODE_GIT_BASH_PATH` set (§3.2) |
| Startup GC deleted transcripts | #62041 | nightly robocopy with `/E`, never `/MIR`, which would mirror the deletion into the backup (§6) |
| Cleanup script followed junctions and deleted 48k files | r/ClaudeAI, 2026-09-25 | standard user, deny list, no bypass on host, no junctions in agent worktrees, snapshots |
| Blender headless glTF export fails on 5.2.1 | research digest 02 | install ≥ 5.2.2 (§2) |
| Godot .NET started through winget's `godot_console` link crashes: `.NET: Assemblies not found`, signal 11 | first agent PC, 2026-09-27 | `GODOT` user env var pointing at the real console exe (§2) |
| EEVEE cannot render headless on Windows | research digest 02 | Workbench/Cycles for QA renders |
| Hermes dashboard Chat tab needs a PTY | Hermes windows-native docs | use Telegram to talk; dashboard for viewing (§3.7) |
| Hermes hub on Claude OAuth drains extra-usage credits | NousResearch/hermes-agent#47260 | hub on Nous Portal, worker on Max (§3.7) |
| Windows Update restarts mid-run | — | active hours + notify-only policy (§1.4) |
| `winget` missing on a clean image; App Installer registration fails 0x80073CF9 | first agent PC, 2026-09-26 | `Repair-WinGetPackageManager` (§2) |
| Portable winget packages install per-user into the elevated account | winget default scope | `--scope machine` on every install (§2) |
| Claude desktop app sessions write into a private AppData copy: files created under `%LOCALAPPDATA%`/`%APPDATA%` land in `Packages\Claude_<id>\LocalCache` and no other program sees them | MSIX file-write virtualisation, first agent PC 2026-09-26 | install tools only with winget or installers that write outside AppData; never unpack tools into AppData from an app session |
| Desktop app's Bash tool gets an unparseable mixed `;`/`:` PATH; nothing resolves | first agent PC, 2026-09-26 (portable Git, no `CLAUDE_CODE_GIT_BASH_PATH`) | not seen again with winget `Git.Git` plus the §3.2 setting |
| Bare Claude installer switches `settings.json` to the `latest` channel and leaves `~\.local\bin` off PATH | first agent PC, 2026-09-27 | install with the `stable` argument; add the PATH entry (§3.2) |
| CRLF checkout makes every BMad-installer rewrite show as modified | first agent PC, 2026-09-26 | `core.autocrlf false` before cloning; one-time re-checkout otherwise (§3.1) |
| Plugin skills work in the desktop app but headless `claude -p /tk-studio:…` is "Unknown command" (no CLI install record) | first agent PC, 2026-09-27; "tk activate" plugin plane | `claude plugin install tk-studio@tk-studio --scope project` (§3.4) |
| A detached bmad-loop engine and its tmux server die within a minute | sbx v0.45.1: the sandbox stops when no `exec` or session is attached (first agent PC, 2026-09-28) | hold an `sbx exec` for the engine's lifetime (`tools/sbx-engine/launch-epic.sh`, §3.8) |
| The loop's close-out commit fails with "Author identity unknown" after the story landed | the engine's shell has no git identity, even though the agent session has one (The Universe Awaits hit the same in WSL) | `provision-engine.sh` sets `user.name` and `user.email` (§3.8) |
| `bmad-loop list` fails on `pyte` / `rich`, so launch's live-engine check fails | bmad-loop installed without its `[tui]` extra | install `bmad-loop[tui]` at the pin (§3.8) |
| `bmad-build` / `bmad-build-auto` HALT: "ambiguous config value `planning_artifacts`" | BMAD-METHOD#2718: bmm + gds both declare the key | studio-managed base patch, re-applied by `tk install` (`kb/bmad-base-patches.md`) |
| Every host session's hooks fail after `bmad-loop init` | init wrote `python3 …` hooks (the Store stub on Windows), or 0.12.0's absolute sandbox path | hooks through `uv run --no-project python` (§3.8); bmad-loop pinned |
| A test fake written as a `.cmd` shim fails to start: `spawn … EINVAL` | Node and Bun refuse to spawn a `.cmd` or `.bat` without a shell, and the supervisor spawns without one (first agent PC, 2026-09-29) | real tools must be `.exe` (`claude`, `uv`, `sbx`, `bun` and `robocopy` all are); the supervisor's test fakes are compiled executables (`test/fakes.ts`) |
| The supervisor's tests pass in the Linux engine and fail on the Windows host | the loop's verify gate runs on Linux only: a lowercased path (21-4), 29 end-to-end failures and a `~\` separator (22-2, 22-3) | run `bun test` on the Windows host, in a clone, after every landed story and before every merge (§3.8) |
| A supervisor signalled while it starts a worker dies and leaves the worker running (POSIX) | its signal handlers were installed after `spawn()` returned, and `spawn()` returns after the child is already running | fixed in the supervisor: the handlers are installed before the spawn. win32 is not affected: a worker there is not detached and ends with its supervisor |
| A supervisor killed within half a second of starting a worker leaves no record of that worker | on win32 the worker record waits on a PowerShell read of the start time, about 0.5 s (supervisor DW-19, open) | the worker still ends with its supervisor on win32, and the run ends `partial` naming no session |
| The status page will not open in a phone browser | it sat behind the same bearer header as the API, and an address bar cannot send one | Story 22.5: the page signs the operator in (token form, Google, GitHub) over https with a session cookie (§4.5); over plain http, the bearer header or a client that sends it |
| `serve` refuses to start with `SessionSecretMissing` or `SessionSecretWeak` | Story 22.5 made the session cookie's signing secret required, at least 32 bytes | set `TK_SUPERVISOR_SESSION_SECRET` (the setup script does, §4.2) |
| `serve` refuses to start with `TlsConfigIncomplete`, `TlsCertUnreadable`, `OAuthConfigIncomplete` or `OAuthNeedsHttps` | the TLS trio and each OAuth trio are all-or-none, the certificate files must exist, and OAuth redirects need https | set all three or none; run `tailscale cert` before the TLS variables (`-WithTls`); set the TLS variables before any OAuth trio (§4.5) |
| The token form on the sign-in page refuses over http | the session cookie is `Secure`, so a browser never keeps it over http | set the TLS variables; the bearer header still works over http |
| https fails with an expired certificate on a box up longer than 90 days | `tailscale cert` runs only when `start.ps1` starts (supervisor DW-21) | restart the supervisor tab before the certificate expires |
| A bmad-loop story is finished and committed, but the engine calls its session stalled | the dev session named its spec `<id>.md`; the engine resolves `<id>-*.md` and reads the story as pending (2026-09-28) | each `stories.yaml` entry names the file pattern; rename the file and commit if it happens (§3.8) |
| An engine nudge is swallowed and the sandbox's default permission mode changes to `auto` | Claude Code showed "Make auto mode your default?" in a bypass session, and the nudge's keystrokes answered it (2026-09-28) | `provision-engine.sh` marks the dialog seen (`hasSeenAutoDefaultNudge` and its two siblings in the sandbox's `~/.claude.json`, confirmed in the 2.1.284 binary); engine sessions pass the mode explicitly; if it ever shows again, put `permissions.defaultMode` back in the sandbox's `~/.claude/settings.json` |
| An sbx command issued from a Claude session while the daemon is down auto-starts a daemon that cannot reach the inner engine (`backend unavailable`, `sbx ls` empty) | first agent PC, 2026-10-06, after `winget upgrade Docker.sbx` to v0.47.0 | `sbx daemon status` before any other sbx command from a session; start the daemon only through the sign-in task or `start.ps1` (§3.5, §4.3) |

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
