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
the studio account's PATH and open a new terminal. Then point the `BLENDER`
user environment variable at the exe; `assets.py greybox` (Story 34.6, the
asset ladder's greybox rung, [kb/asset-ladder.md](asset-ladder.md)) reads
it first and falls back to `blender` on PATH:

```powershell
[Environment]::SetEnvironmentVariable("BLENDER", "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe", "User")
```

Open a new terminal. Verify:

```powershell
blender -b --version
& $env:BLENDER -b --version
```

EEVEE has no headless mode on Windows; QA renders use Workbench or Cycles.

**The asset mirror and the generated rung (Story 34.7).** The ladder's cc0
rung (`assets.py match`) reads a mirror of CC0 kits on this box:
`C:\agent-work\assets\<kit>` (one folder per Kenney, Quaternius or Poly
Haven kit, each with its licence file), indexed with
`assets.py mirror-index --kit <dir> --category <cat>`. The engine never
downloads kits; mirroring them is the operator's step. Another root is set
by name, as a User variable (read from `HKCU\Environment` like the Meshy
key, so no new terminal is needed):

```powershell
[Environment]::SetEnvironmentVariable("TK_ASSETS_MIRROR", "C:\agent-work\assets", "User")
```

The generated rung (`assets.py generate`) is off by default. It turns on
only when the project's `.tk-studio/budget-bands.yaml` sets
`assets: {credit_cap: <Meshy credits>}` (per `generate` invocation) and the
Meshy key exists as a User environment variable, never in a file:

```powershell
[Environment]::SetEnvironmentVariable("TK_ASSETS_MESHY_KEY", "<the Meshy API key>", "User")
```

The details, and the visual gate's thresholds, are in
[kb/asset-ladder.md](asset-ladder.md).

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

The plugin comes from the installer, not from a marketplace. Run the README's
one-line bootstrap (it installs the pinned `uv` and the `tk-studio` meta-CLI
and puts only the studio's `bin` folder on PATH):

```powershell
irm https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/install.ps1 | iex
```

Open a new PowerShell window, so the new PATH applies, then install:

```powershell
tk-studio install
sbx skills import --force
```

`tk-studio install` writes the plugin to `%USERPROFILE%\.claude\skills\tk-studio`
from the roster's SHA-256-verified release zip, and Claude Code loads it in
place as `tk-studio@skills-dir`; headless `claude -p /tk-studio:…` resolves
it too (the Story 25.2 probe). It also removes any user-scope
`tk-studio@<marketplace>` copy, which would shadow the folder. The
`sbx skills import --force` step copies the folder into the shared store the
engine sandboxes mount (§3.5): that store is a copy, not a live view. On a
fresh box it cannot work yet, because §3.5 has not signed in to Docker or
set up the `sbx` daemon and policy: skip it here and run it once §3.5 is
done. On a box where §3.5 is already done, run it now.
`tk-studio doctor` reports the folder's mode and runs the smoke checks, each
with its fix. Until the first `cli--v` release is recorded in the roster, the
bootstrap stops with `CliNotShipped` (after installing `uv`). Meanwhile, clone
the checkout first (just below), then from its root run
`uv run --project tools/installer/cli tk-studio install` (no `--link`).

The box still works in a checkout of this repo (the engine sandboxes mount
it, §3.8):

```powershell
cd D:\agent-work
git clone https://github.com/thkennedy/tk-studio.git
cd tk-studio
claude
```

Trust the folder. Then, inside the session, in this order:

1. **"tk activate"** — read-only health check. On a fresh machine it guides the
   per-user store standup (`~/.tk-studio`, registry, ledger). Follow the exact
   fix commands it prints; it applies nothing itself.
2. Open the game project (§3.6) and run **"tk install"** — installs the BMad
   base at the `bmad.lock` pin, non-interactive, verify-at-pin.
3. **"tk onboard"** — proposes the role × project working set with evidence
   and records it only on your confirmation.

The store on this box is its own per-machine store (AD-20) and its own
measurement ledger file (AD-12); nothing is copied from the main PC.

Plugin updates later: `tk-studio update`, then `sbx skills import --force` for
the engine sandboxes (once §3.5 is done).

**Moving from the marketplace install.** `tk-studio install` uninstalls only
user-scope marketplace copies; a project- or local-scope copy is only
reported. A box
set up under the old §3.4 (`claude plugin install tk-studio@tk-studio --scope
project`, TIM-PC-2 included) keeps that copy, and it shadows the skills-dir
folder. From the checkout:

```powershell
claude plugin uninstall tk-studio@tk-studio --scope project
tk-studio install
sbx skills import --force
```

For a local-scope copy, use `--scope local` in the uninstall instead. The
import refreshes the engine sandboxes' store (skip it until §3.5 is
done). `claude plugin list` should then show `tk-studio@skills-dir` and no
`tk-studio@tk-studio`. Check it there: "tk activate" sees only user-scope
marketplace copies, not project- or local-scope ones. If "tk activate" then reports
the plugin plane `shadowed`, run the fix it prints.

**Developers who clone** (working on tk-studio itself): link the folder to the
checkout instead of writing it from the release zip. `--link` links the plugin
only and installs no other app. From the checkout root:

```powershell
uv run --project tools/installer/cli tk-studio install --link D:\agent-work\tk-studio
```

The engine sandboxes need `sbx skills import --force` after it too (once
§3.5 is done): their store is a copy, also of a linked folder. A later plain
`tk-studio install` or `update` replaces the link with the release zip's
folder; re-run `install --link <checkout>` (then `sbx skills import --force`)
to get it back.

The repo's `.claude-plugin/marketplace.json` is now only a developer catalog,
for browsing it or pinning a tag in a dev checkout:

```powershell
claude plugin marketplace add thkennedy/tk-studio#tk-studio--v<X.Y.Z>
```

Every `tk-studio install` or `update` runs `claude plugin marketplace remove
tk-studio`, so this catalog is gone after the next install or update; re-add
it afterwards if you want it. Never install `tk-studio@tk-studio` from it
beside the folder: a marketplace copy named `tk-studio` shadows the skills-dir
folder, so use `install --link` instead.

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

**The shared skills mount (experimental).** sbx mounts its shared skills store
at `/home/agent/.claude/skills` in every sandbox created for Claude Code, and
that is how the engine sandboxes load the tk-studio plugin (§3.8, AD-21). The
store is a copy, not a live view of the host's `~/.claude/skills`:
`sbx skills import` fills it (at
`%LOCALAPPDATA%\DockerSandboxes\sandboxes\state\agent-skills`), and an
import replaces each skill directory whole. The access mode
(`--skills readonly|readwrite|off` on `sbx create` or `sbx run`) is applied
only when the sandbox is created: changing it means `sbx rm` and create again.
Always create engine sandboxes `--skills readonly`, since a `readwrite`
sandbox can change what every other sandbox loads. **Never run `sbx reset`**
on the agent PC: it clears the shared store, and every sandbox loses the
plugin until the next `sbx skills import`. Source:
https://docs.docker.com/ai/sandboxes/workflows/agent-skills/ (read
2026-10-15; the page says read-only is the default, but an earlier rendering
said read-write since sbx 0.37.0, so pass the flag explicitly).

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

**Create one sandbox per project.** Run every `sbx create` from your home
folder, never from `System32` (§3.5).

*tk-studio and the supervisor: one sandbox, one mount.* Since the supervisor
moved into `apps/supervisor` (AD-21, Story 28.3), the one sandbox
`claude-tk-studio` mounts `C:\GitHub\tk-studio` read-write and serves both
loops: the plugin's (the repository root) and the supervisor's (the nested
project `apps/supervisor`). It needs no second, read-only tk-studio mount:
`TK_STUDIO_ROOT` lies inside the one mount. The cut-over to this layout was
the merge of PR #118 through protected `main` on 2026-10-16 (Epic 28).

```powershell
cd $HOME
sbx create --skills readonly --name claude-tk-studio claude C:\GitHub\tk-studio
```

Provision it with bun for the nested project, giving the same path as the
project and the studio mount (`TK_STUDIO_ROOT` stays the outer root,
`/c/GitHub/tk-studio`). The skills-mount check runs from the repository root
and, because `apps/supervisor/.tk-studio/config.yaml` exists, from
`apps/supervisor` too: a project-scope plugin copy under
`apps/supervisor/.claude` is seen only from there, and either check failing
stops the provisioning.

```bash
MSYS_NO_PATHCONV=1 sbx exec claude-tk-studio bash -lc 'WITH_BUN=1 GIT_NAME="Tim Kennedy" GIT_EMAIL="<noreply email>" bash /c/GitHub/tk-studio/tools/sbx-engine/provision-engine.sh /c/GitHub/tk-studio /c/GitHub/tk-studio'
```

`launch-epic.sh` and `resume-run.sh` pick the project per epic through `ROOT`:

- a supervisor epic: `ROOT=/c/GitHub/tk-studio/apps/supervisor`
- a plugin epic: `ROOT=/c/GitHub/tk-studio`

Both scripts refuse (exit 2, naming `ROOT`) a `ROOT` that holds neither
`.tk-studio/config.yaml` nor `.bmad-loop/`.

**Retire `claude-tk-studio-supervisor`.** That sandbox mounted the old
`C:\GitHub\tk-studio-supervisor` checkout read-write and tk-studio read-only.
The supervisor no longer lives there, so a loop in it builds a checkout that
is no longer the source. Export its ledger and harvest its run dirs first
(the recreate steps below, with `<project>` = `tk-studio-supervisor`), then:

```powershell
sbx rm claude-tk-studio-supervisor
```

**Two loops in one sandbox hold each other's launcher.** `launch-epic.sh` and
`resume-run.sh` hold the sandbox while `pgrep -f "bmad-loop run"` (or
`run|resume|resolve`) finds **any** engine in it. With a plugin run and a
supervisor run both live in `claude-tk-studio`, each launcher holds for the
other loop's engine too. The mutual hold itself only lengthens the wait: the
launcher returns when the last engine ends, so its `engine-gone` stamp records
when the last engine in the sandbox ended, which may be the other loop's.

The real hazard is the checkout: both engines work in the same checkout and
the same `.git` (the repository root, and `apps/supervisor` inside it). So run
one loop at a time, and do not run `launch-epic.sh` beside a supervisor run on
the same sandbox (§4, the "Engine hold" row), until Story 28.5 serialises the
two loops on the one checkout; it is not in force yet. Engines started by
`launch-epic.sh` or `resume-run.sh` directly never pass through the
supervisor's lock.

*Every other project: one sandbox, two mounts.* A project outside this
repository (a Godot game, for example) keeps the two-mount form: the project
read-write and the tk-studio checkout read-only.

```powershell
cd $HOME
sbx create --skills readonly --name claude-<project> claude C:\GitHub\<project> C:\GitHub\tk-studio:ro
```

`--skills readonly` mounts the shared skills store (§3.5) read-only at
`/run/sbx/skills-shared` and links each entry into `/home/agent/.claude/skills`
(verified 2026-10-15 on sbx 0.47.0), where Claude Code loads the plugin as
`tk-studio@skills-dir`. Run `tk-studio install` (or `update`) on the host and
then `sbx skills import --force` before creating the sandbox, so the store
holds the plugin. Check the flag with `sbx create --help` on the box; the docs call the
feature experimental.

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
- verifies the read-only skills mount (`tools/sbx-engine/check-skills-mount.sh`):
  the mount is present and read-only, it holds
  `tk-studio/.claude-plugin/plugin.json`, `tk-studio@skills-dir` loads, and no
  marketplace copy `tk-studio@<m>` (any marketplace but `skills-dir`) shadows
  it (the listing runs from the project, so a project-scope copy counts). Any failure stops
  provisioning with one line naming `/home/agent/.claude/skills` and its fix.
  The plugin is no longer installed per sandbox. A sandbox provisioned before
  this change still has `tk-studio@tk-studio` at user and project scope, and
  the `tk-studio` marketplace the old provisioning registered. Inside it, run
  `claude plugin uninstall tk-studio@tk-studio --scope user`, then the same
  with `--scope project` from the project, then `claude plugin marketplace
  remove tk-studio` so the copy cannot come back. The check names these
  commands and never runs them. Project scope lives in the project checkout's
  `.claude/settings.json`, a tracked host file (the sandbox mount is
  read-write), so that removal is a change to commit in that project
- the sandbox's own studio store, with the project registered as developer

From Git Bash, set `MSYS_NO_PATHCONV=1`, or Git Bash rewrites `/c/...`
arguments to `C:/...`. For a two-mount project (for `claude-tk-studio`, the
one-mount command above):

```bash
MSYS_NO_PATHCONV=1 sbx exec claude-<project> bash -lc 'GIT_NAME="Tim Kennedy" GIT_EMAIL="<noreply email>" bash /c/GitHub/tk-studio/tools/sbx-engine/provision-engine.sh /c/GitHub/<project> /c/GitHub/tk-studio'
```

**The "sandbox store" drift case.** The sandbox store (the shared skills
store a sandbox mounts) can differ from the host's `~/.claude/skills`: the
store is a copy, so a `tk-studio install` or `update` on the host does not
reach the sandboxes until it is imported again. Inside the sandbox, `tk
activate` shows it on the plugin plane as `stale` (an older version). When
the store is empty the plugin does not load, so `tk activate` is not
available: `check-skills-mount.sh` reports it first, and the drift check run
from the studio checkout mount
(`uv run /c/GitHub/tk-studio/plugins/tk-studio/skills/tk-studio-activate/scripts/drift_check.py --directory <project>`)
shows it as `missing`. The fix, from PowerShell on the host: run
`tk-studio install` (or `update`), then `sbx skills import --force`. The docs
say a sandbox mounts the store each time it starts, so a stopped sandbox picks
the import up on its next start, with no recreate; in a running one, start a
new agent session, and if the plugin plane still shows `stale`, `sbx stop` the
sandbox (no run in flight) and start it again. A sandbox created without `--skills readonly`
(or with `--skills off`) has to be recreated with it.

**Recreating a sandbox without losing the cost record.** The sandbox's own
studio store, and the measurement ledger in it, dies with the sandbox
(loop deficiency 23). Before any `sbx rm`, with no run in flight, do these
steps in order, all from the host:

1. Export the sandbox's ledger, from Git Bash on the host:

   ```bash
   MSYS_NO_PATHCONV=1 sbx exec claude-<project> bash -lc 'cat ~/.tk-studio/measurements/*.jsonl' > ~/.tk-studio/measurements/sandbox-claude-<project>-$(date +%Y%m%d).jsonl
   ```

   The redirect creates the file even when `sbx exec` fails or the glob
   matches nothing, so check that the export is non-empty before going on.
   A rerun on the same day overwrites the file, so a second recreate of the
   same sandbox on the same day overwrites the first export: rename (or merge)
   the earlier export before exporting again.

   ```bash
   test -s ~/.tk-studio/measurements/sandbox-claude-<project>-$(date +%Y%m%d).jsonl && wc -l ~/.tk-studio/measurements/sandbox-claude-<project>-$(date +%Y%m%d).jsonl
   ```

2. Harvest each run dir's meter observations into the host ledger, from the
   tk-studio checkout, once per run dir:

   ```bash
   uv run --no-project python plugins/tk-studio/lib/meter.py harvest --run-dir /c/GitHub/<project>/.bmad-loop/runs/<run-id>
   ```

   A harvest refusal (exit 2) names the unreadable `observation.json` and
   appends nothing. Fix that file or move it aside, then run the harvest
   again. The run dirs live on the host checkout, under
   `/c/GitHub/<project>/.bmad-loop/runs/` (`ls` lists them), so they and
   their `observation.json` files survive the recreate.

3. Only then remove the sandbox with `sbx rm claude-<project>`, and create it
   again with the create command above.

The harvest goes after the export so that a harvest refusal never blocks the
export. The exported file lands in the host store as an extra file;
`measurepush.py` pushes only this machine's own ledger, so the export is kept
but never pushed, and merging it into the repo's `measurements/` is the
operator's call. Meter rows can appear in both the exported file and the
harvested ledger (with different `user`/`machine`); that double count is
known and not deduped, and the export is what carries stories metered before
Story 26.4 (only `metered.json`, no `observation.json`, such as Epic 26's
26-1 to 26-3) and every non-meter observation.

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

   Copy them from tk-studio. `apps/supervisor` shows the adaptation for
   a non-Python project.
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
   `<run_dir>/transcripts/` and records one `observation`. It also writes
   that observation to `<run_dir>/transcripts/<story>/observation.json` on
   the mounted checkout, and the host harvests it with `meter.py harvest`
   (Story 26.4).
5. **When the run completes** (a supervisor run): the supervisor runs the project's
   `verify.host` (its tracked `.tk-studio/config.yaml`, read at the run's base,
   never from the plugin) on the host in the run's worktree, console-hosted,
   under the job's wall-clock guard, and records a `host-verify` event (exit,
   duration, the last lines of output). Green, or no `verify.host` (the event
   says skipped and why): the PR opens ready. Red: the run ends `partial`
   naming the command and its last lines, the branch is still pushed, and the
   PR opens as a draft whose `## Host verify` section carries the failures; the
   notification names them. No attended host run before the PR is needed: fix
   the failures named on the draft PR (supervisor Story 27.4). A game project
   also declares `verify.engine` beside `verify.host` in the same file (TUA:
   `verify.engine: bash scripts/engine-gate.sh`, the headless import then the
   GoDotTest suite); after a green `verify.host` the supervisor runs it in the
   same worktree with the folder of `$env:GODOT` first on PATH and records the
   verdict as `engine` on the same `host-verify` event (`green`, `red`, or
   `skipped` with why). An engine red is a red leg: `partial`, the draft PR,
   the reason ``host verify red (engine): …`` (Story 34.1). The folder of
   `GODOT` goes first on PATH so a binary in that folder resolves by name, but
   the box's console exe is not named `godot` (§2): the project's command
   calls the engine through `$GODOT`, as TUA's `engine-gate.sh` does. Set the
   `GODOT` user variable (§2) and start the supervisor after it: a supervisor
   started before it has no `GODOT`. A run started
   by hand (`launch-epic.sh`) still needs the host suite run by hand
   (`uv run python tools/verify_host.py`, the same command the key names)
   before its PR from `loop/epic-<N>` into `main`.
6. Spec files are `stories/<id>-spec.md`: the id already carries the title
   slug, so the path stays short for Windows. The planner records settled
   shapes (schema entries, files or tags for an artifact a later story or
   an operator produces) in the SPEC's `## Design notes`, and never halts the
   dev session on them (Story 26.2).

**When a host leg is red** (a supervisor run ended `partial` naming
`verify.host`, its draft PR carrying the failures). Read the draft PR's
`## Host verify` section (or the run's `host-verify` event) and fix the
cause: on the branch (push the fix to `supervisor/run-<id>`), or on the box
(a roster row, an environment fault). A fix to `verify.host` itself only
counts once it is on the run's base in the checkout: the command is read at
`base_ref` there, as the close-out reads it. Then re-run the leg with
`POST /runs/<id>/verify` (bearer only, body empty or `{}`), or from
`apps/supervisor` with `bun src/cli.ts verify <id>`. The supervisor cuts a
fresh worktree from the branch's tip on origin, runs `verify.host` there,
removes it, and records a new `host-verify` event (its `rerun` names the
tip, the worktree's removal, the PR and `pr_ready`). Green marks the draft
PR ready and the board's `host_verify` turns green; the run stays `partial`
(its terminal state never changes). Red leaves the PR a draft: read the new
event and fix again. A run still live is `409 RunNotEnded`, one with no
pushed branch `409 NoBranch`, and a re-run already going `409
VerifyRunning` (supervisor Story 33.8). This replaces the hand recipe (cut
a worktree, run `verify.host`, flip the PR by hand).

**When a supervisor run pauses** (the queue run is `paused`; its worktree,
lock, pin and draft PR are kept). After every engine-end sweep (each tick) the
supervisor reads the story the engine paused on (`launch.py status` →
`run.paused_story_key`) and its spec in the run's worktree (supervisor Story
27.3):

- **The story landed** (its spec says `status: done`, paused at the commit
  gate or on an escalation) **and a verdict is recorded** (`reconcile_verdict`
  other than `escalate`): nothing to do by hand. The supervisor commits the
  engine's staged harvest on the run branch, harvests the story's meter
  observation to the host ledger (`meter.py harvest`), archives the engine run
  (`bmad-loop archive`, through `sbx exec`), and launches the epic again under
  the same queue run (a `close-out` event); the launch skips `done` stories. A
  failed step is a `close-out-failed` event on the run, retried next tick.
- **The story landed with no verdict, or `escalate`** (the reconcile gate): an
  attended step. The supervisor sends one notification and the run's card says
  "awaiting a ruling". Run `.bmad-loop/plugins/studio-pipeline/reconcile.md`
  in the run's worktree (`<TK_SUPERVISOR_WORK>\worktrees\<project>\<queue
  run id>`), record the verdict on the spec (and carry any `adjust-stories`
  notes into the unstarted entries' `invoke_dev_with`); the next tick closes
  it out as above.
- **The story did no work** (a missing fact, a render halt): fix the cause in
  the run's worktree, then `POST /runs/<queue run id>/resume` (bearer only;
  body `{"restore_patch": "<path relative to the worktree>"}` optional). The
  supervisor runs `bmad-loop resolve --no-interactive --resume
  [--restore-patch …]` through `sbx exec` as its own child (the hold) and the
  run goes `running` (`engine-resume`). A story whose spec is `done` is
  refused `409 StoryLanded`: the close-out above handles it.

**When a hand-started run pauses** (an engine started with `launch-epic.sh`,
outside the supervisor), the attended recipe still applies:

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

**Supervisor runs: the worktree, the pin, the hold (Epic 27).** A supervisor run never works in the checkout. The rows below are what the supervisor does on its own; the hand pattern that follows is for an engine started with `launch-epic.sh`.

| Item | Value |
|---|---|
| `TK_SUPERVISOR_WORK` | Required for every run (no longer only for editor-in-the-loop snapshots): `C:\agent-work`. Worktrees land in `C:\agent-work\worktrees\<project>\<queue run id>` on `supervisor/run-<queue run id>`, snapshots in `C:\agent-work\snapshots\…`. |
| Engine sandbox mount | `C:\agent-work\worktrees` read-write, as `/c/agent-work/worktrees` (only that subfolder; snapshots stay host-only). Recreate the sandbox with it (§3.5). |
| git | 2.48 or later on the host and in the microVM: worktrees are cut with `git worktree add --relative-paths`, so the worktree's `.git` file resolves on both sides (a `C:/` path in it fails inside the VM). Host 2.55 and VM 2.53 on 2026-10-16. The flag writes `extensions.relativeworktrees` into the project's shared `.git/config`, and the .NET 8 SDK's source-control query (Microsoft.Build.Tasks.Git, part of every `dotnet build`) refuses that extension in every checkout of the repository, the main one included: a .NET project sets `EnableSourceControlManagerQueries=false` in its root `Directory.Build.props` (hole 48; TUA carries it). |
| Store stubs | A stock Windows PATH carries App execution aliases in `%LOCALAPPDATA%\Microsoft\WindowsApps` (`bash.exe`, `python.exe`, `python3.exe`) that only print an install prompt and exit 49. The host verify leg puts Git's `usr\bin` first on its PATH and spawns a bare `bash` by its full path there (holes 46 and 52: Windows resolves a bare name through the parent's PATH, so the prefix alone still ran the stub, exit 127 with nothing printed); `python3` still resolves to the stub on this box (Python 3.12 installs `python.exe` and the `py` launcher only), so a project script that needs Python probes `python3`, `python` and `py` for one that runs (hole 50; TUA's `make-toy-world.sh`). The doctor does not check the stubs yet. |
| `gh` | Logged in on the host for the supervisor's user (the protection check and each run's PR). `GH_BIN` overrides the binary. |
| Default branches | Protected on GitHub for every project the supervisor runs against with no `base_ref` (it defaults to the repository's default branch); an unprotected default branch is refused `blocked`. |
| Engine secrets | The Atlassian binding's variables (`TK_ATLASSIAN_SITE`, `TK_ATLASSIAN_AGENT_EMAIL`, `TK_ATLASSIAN_AGENT_TOKEN`) are User environment variables on the box (`setx`, never a file in a checkout); the supervisor passes every `TK_ATLASSIAN_*` into the sandbox by name on each worker spawn (`sbx exec -e NAME`), reading the User environment from the registry for any its console lacks (hole 60: a tab restarted inside a running Windows Terminal inherits the terminal's stale environment), so a `setx` is enough, no restart is needed for a new or rotated secret, and the value never appears on a command line. The Atlassian token is a *scoped* token: it works only through `https://api.atlassian.com/ex/{jira\|confluence}/<cloud id>/…` (Basic `email:token` or Bearer), never against the site URL; the cloud id comes from `<site>/_edge/tenant_info`. |
| Sandbox pin | An sbx run starts with `sbx run -d --name <sandbox>` from the supervisor before its login probe; a failed pin ends the run `blocked` naming it. The supervisor runs in the console (`start.ps1`), and so does every `sbx` call it makes; it is never started from a Claude desktop-app session. |
| Engine hold | Once a launch returns, the supervisor holds `sbx exec <sandbox> tail --pid=<engine pid> -f /dev/null` open for the engine's life (the pid from `<worktree>\.bmad-loop\runs\<id>\engine.pid`). Do not run `launch-epic.sh` beside a supervisor run on the same sandbox. A supervisor restart respawns the hold (`recover`, every tick). |
| Release | `sbx stop <sandbox>` once the run's engine ended and its close-out ran, only when no other queued, running, paused or external run records the same sandbox. A paused run keeps its pin. |
| Kill | A cancel or a tripped guard kills the engine's process group inside the VM by its recorded pid (`sbx exec <sandbox> kill -TERM -- -<pid>`, then `-KILL`); an engine still alive afterwards keeps the run's lock and pin (DW-3) until a later probe shows its pid gone. Check by hand with `sbx exec <sandbox> cat /proc/<pid>/stat`. |
| Hand starts | `jobrun.py submit\|wake` and the MCP `tk_job` surface on a supervised project are recorded `external` on the next tick and paced around until the studio run ends; prefer `POST /jobs`. The supervisor writes a `starter.lock` per served project in the store (`~/.tk-studio/projects/<key>/starter.lock`) on each tick and claim, and `serve` rewrites it every minute. While that lock is live (the supervisor's pid running, or `since` under 15 minutes old), `jobrun.py submit\|wake` and the MCP `tk_job` surface refuse a hand start with `StarterLocked` and mint nothing. To start one anyway, pass `--force-starter` or set `TK_STUDIO_IGNORE_STARTER_LOCK=1`; the forced run is recorded `external` as above. |
| Clean-up | `git worktree remove` and `git worktree prune` run on the host. A worktree kept by a failed close-out or a paused run is listed by `git worktree list` in the checkout. |

**Pin an engine sandbox alive by hand (sbx v0.47.0 and later).** `sbx run -d --name <sandbox>` keeps a local sandbox running after every session disconnects, until `sbx stop <sandbox>`. Verified 2026-10-06 on the first agent PC: the same boot, no restart, the sandbox still `running` 50 s after the last `sbx exec` ended. Run it once after `launch-epic.sh` has attached, and the engine no longer dies with the host-side `sbx exec` that started it (the hole the 2026-09-29 handoff lists as number 7). `sbx stop` releases the pin when the run is over.

## 4. The studio supervisor

The supervisor is the ruling-4 independent driver. It consumes the driver
contract from outside the plugin (AD-2): the contract code lifted from
ClaudeOS, plus a durable SQLite queue, a lock per git checkout (§4 table), guards it enforces
itself, a pacer, crash recovery, an HTTP API and a status page. It was built on
2026-09-28 through the studio's own launch pipeline (plan Epics 21 and 22).

- **Repo:** `apps/supervisor` in `thkennedy/tk-studio` (AD-21; `main`
  protected). Bun and TypeScript. It is a nested studio project with its own
  `_bmad/`, `_bmad-output/`, `.tk-studio/config.yaml` (`verify.host: bun
  test`), `.bmad-loop/` and `.claude/`.
- **Path:** `C:\GitHub\tk-studio\apps\supervisor`, inside the tk-studio
  clone.
- **Full reference:** `apps/supervisor/README.md` (commands, API routes, queue
  and restart rules, worker tiers).

| Item | Value |
|---|---|
| Checkout lock | (28.5) One lock per git checkout: its key is the project root's canonical, case-folded `git rev-parse --show-toplevel`, read once at submission and recorded on the run (a root outside git keys by itself). `apps\supervisor` and `C:\GitHub\tk-studio` therefore share one lock: the second queued run shows `lock-wait` naming the first on `/status`, and the two never run at once. The lock row and the status page still name the project root that holds it. The `starter.lock` stays per project. |
| Served subpath | (28.5) A project below its git top-level is served at `<worktree>\<prefix>` (`git rev-parse --show-prefix`, for example `C:\agent-work\worktrees\<project>\<run id>\apps\supervisor`): the worker's cwd, `payload.directory`, the sbx VM path, `tk install`/`tk activate`, the copied runtime, the engine's `.bmad-loop`, and `verify.host` and `verify.engine` (34.1; both read from `<base>:<prefix>.tk-studio/config.yaml`, run there). The worktree itself is still cut at the repository's top, and the push, PR and `git worktree remove` run there. A project at its top-level is unchanged. |
| Studio web | (30.2) The supervisor serves the built web at `/app` on its own origin, behind the bearer or the session cookie (a browser without a session gets the sign-in page and returns to the page it asked for). It lives in the installer's slot `<root>\studio-web\<version>\`, found through `current.json`'s `"studio-web".path`, else in the checkout's `apps\studio-web\dist`. Built by the release motion (`uv run python tools/release_archive.py run --app studio-web --version X.Y.Z`: `bun install --frozen-lockfile` and `bun run build` from the tag, `dist`'s contents zipped) or by hand: `cd apps\studio-web; bun install --frozen-lockfile; bun run build`. Not built: `GET /app` answers `503 WebNotBuilt` naming that command, and the status page shows a note saying so. |
| The home | (30.6) The web is the home: a signed-in `GET /` answers the built web's `index.html` (the Office screen first, then whichever screen this browser last showed: Office, Board or Status). Build it as the row above says (`cd apps\studio-web; bun install --frozen-lockfile; bun run build`, the command a `503 WebNotBuilt` names) or install a release; until it is built, `GET /` answers the read-only status page with its "not built" note, never a 503. The read-only page moved to `GET /status`: a browser (an `Accept` naming `text/html`) gets the page, without JavaScript; anything else (`curl`, `set-supervisor-env.ps1`, §4.5) gets the same JSON as before. The web's Status screen links it. |
| Pacer | (33.7) `start.ps1` runs tick, drain, then sleeps `-IntervalSeconds` (default 60). Each step runs under the log tee with `--pass` and logs `pass: <ms> ms, exit <code>`. A step over 10 min logs `warning: pass <step> took … driving <run ids>` and sends one notifier line. The last pass is in `<TK_SUPERVISOR_WORK>\supervisor\pacer.json` and on `GET /status` as `pacer {last_tick_ms, last_drain_ms, last_pass_at}`, and the status page shows its line. |

### 4.1 Install

```powershell
cd C:\GitHub\tk-studio\apps\supervisor
bun install --frozen-lockfile
$env:TK_STUDIO_ROOT = 'C:\GitHub\tk-studio'
bun test
```

The tk-studio clone (§3) already holds it; there is no separate clone for
the supervisor. The old `C:\GitHub\tk-studio-supervisor` folder stays on the
box: the §4.2 environment script still reads it, and archiving
`thkennedy/tk-studio-supervisor` on GitHub removes nothing locally.

Claude Code applies a project's `.claude/settings.json` permission rules
only in a trusted folder, and a headless worker cannot answer the trust
dialog (supervisor DW-22, 2026-10-09). Trust is inherited: a folder inside a
trusted folder is trusted too, with no dialog and no record of its own in
`~/.claude.json` (Claude Code 2.1.292, checked on the box 2026-10-17, loop
hole 35), so `apps\supervisor` is covered by the tk-studio checkout's trust
from §3 and needs no step of its own. Every other project the supervisor
will drive on this box is trusted once: open `claude` in it, accept "Yes, I
trust this folder", and `/exit`. `tk-studio doctor` reports each registered
root as trusted itself or through an ancestor. Still unverified: which
`.claude/settings.json` (the nested root's or the git root's) a session
started in the nested root loads.

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
| `TK_SUPERVISOR_ENGINE_MCP_PORT` | no (Story 34.5) | the engine MCP forwarder's port on `TK_SUPERVISOR_BIND`, default `8788` (§4.8). Nothing else listens in the 8000 range |
| `TK_SUPERVISOR_TRANSCRIPT_BACKUP` | no, warned when unset | the nightly backup's `claude-projects` folder (§6). A resume restores a missing transcript from it, and every host run's transcript is copied into it |
| `TK_SUPERVISOR_NOTIFY` | no | the notification target: `ntfy` or `telegram`. Unset sends nothing |
| `TK_SUPERVISOR_NTFY_URL` | with `ntfy` | the full topic URL. The topic is its secret |
| `TK_SUPERVISOR_TELEGRAM_TOKEN` | with `telegram` | the bot token |
| `TK_SUPERVISOR_TELEGRAM_CHAT` | with `telegram` | the chat id that receives the message |
| `TK_SUPERVISOR_WORK` | always (Epic 27) | the work folder: every run's worktree under `worktrees\<project>\<run id>`, editor-in-the-loop snapshots under `snapshots\…`, the supervisor log under `supervisor\logs\supervisor-<date>.log` (Story 33.1; unset, no log file is written); `C:\agent-work`. The engine sandbox mounts its `worktrees` subfolder read-write (§3.8) |
| `TK_SUPERVISOR_CONFIG` | no | the per-job tier config. Unset runs every job on the host tier |
| `TK_SUPERVISOR_TLS_CERT`, `TK_SUPERVISOR_TLS_KEY`, `TK_SUPERVISOR_TLS_NAME` | for https and the phone sign-in (§4.5) | the `tailscale cert` certificate and key files and the machine's MagicDNS name. All three or none (`TlsConfigIncomplete`); set them only after the files exist (`TlsCertUnreadable`) |

The owner's account (Story 29.1) is not a variable: its record (the username
and the password's hash) is the store's,
`<TK_STUDIO_HOME or ~/.tk-studio>\supervisor\account.json`, written on the
first visit (§4.5). Nothing here holds a password.

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

**The script knows only the old clone.** The cut-over (Epic 28) left
`set-supervisor-env.ps1` unchanged, and the User environment with it
(`TK_STUDIO_ROOT` is still the outer root `C:\GitHub\tk-studio`). The script
points at `C:\GitHub\tk-studio-supervisor`, stops with `missing:` when that
folder is absent, and writes the Startup shortcut at the old clone's
`start.ps1`. So:

- keep the local `C:\GitHub\tk-studio-supervisor` folder on the box, or the
  script stops (archiving the GitHub repository removes nothing locally);
- after every run, retarget the shortcut at
  `C:\GitHub\tk-studio\apps\supervisor\start.ps1` as §4.3 shows (or run the
  script with `-NoShortcut` and make the §4.3 shortcut by hand).

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
wt.exe -w studio nt --title supervisor pwsh -NoExit -File C:\GitHub\tk-studio\apps\supervisor\start.ps1
```

Its "Start in" folder is `C:\GitHub\tk-studio\apps\supervisor`.
`set-supervisor-env.ps1` (§4.2) writes this shortcut at the old clone's
`start.ps1`. After running it, set the target back to the line above, or run
it with `-NoShortcut`. `tk-studio doctor` reads the shortcut while it points
elsewhere (§7): at the old clone it fails `supervisor-root`; at a folder that
is no source checkout (a loose folder, or one with no `.tk-studio` of its
own) the `supervisor` check finds no checkout and fails (`no supervisor slot
… and no source checkout`) unless a slot is installed; and at a `start.ps1`
outside its "Start in" folder, or a missing one, it fails `startup-shortcut`.

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

The agent registry and the office projection (Epic 29) answer the same way,
on the bearer token:

```powershell
curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/agents
curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/office
```

`/agents` answers `{ok:true, rebuilt_at, agents:[…]}`: each served project's
seven roles (`orchestrator`, `session`, `implementer`, `reviewer`,
`consult`, `advisor`, `planner`) with their routed models. `/office` answers
the snapshot `{ok:true, at, agents, runs, …}`: every agent with one of the
eight office states, and the live runs with their progress. `curl` always
uses the bearer token; the account is for the browser.

**The web and the status page from a phone (Story 22.5, Story 29.1, Story 30.6).** `GET /` without
the bearer header answers a page for the owner's one account (so does
`/status` opened in a browser, returning there after the sign-in). The first visit
creates it: a username (3 to 64 characters: letters, digits, `-`, `_`, `.`)
and a password (12 characters or more), stored hashed in
`<TK_STUDIO_HOME or ~/.tk-studio>\supervisor\account.json`. Later visits
sign in with that username and password; the token form stays for the
operator's own browser. Five refused sign-ins within fifteen minutes lock the
account for fifteen minutes. There is no Google or GitHub sign-in: a
leftover `TK_SUPERVISOR_OAUTH_*` variable is ignored, with one warning at
start naming it. Delete any leftover `TK_SUPERVISOR_OAUTH_*` User variables
(they include the old Google and GitHub client secrets), and delete the Google
and GitHub OAuth apps registered for the supervisor's callback URLs. Sign-in
sets a seven-day `HttpOnly`, `Secure` session cookie, so it works only over
https. The operator's steps, once:

1. Enable HTTPS certificates in the Tailscale admin console (DNS → HTTPS
   Certificates). Then set the TLS variables (`set-supervisor-env.ps1 -WithTls`,
   or by hand `tailscale cert --cert-file <TLS_CERT> --key-file <TLS_KEY>
   <TLS_NAME>` followed by the three variables) and restart `start.ps1`. Open
   `https://<TLS_NAME>:8787/` on the phone and create the account.
2. The smoke sign-in: open `https://<TLS_NAME>:8787/` in a fresh browser (or
   after the session expires) and sign in with the account's username and
   password. The web answers at `/` (Story 30.6: the Office screen, or the
   screen this browser last showed). Its Status screen shows the queue's
   counts, the live runs, the agents, the office section, the ledger's last
   lines and the supervisor's version, and links the read-only status page
   at `https://<TLS_NAME>:8787/status`, which answers without JavaScript,
   with its Agents and Office sections. With no built web, `/` is that page.
3. The reset, when locked out or the password is lost: delete
   `<TK_STUDIO_HOME or ~/.tk-studio>\supervisor\account.json` from the
   console. The next visit creates the account again (no restart needed),
   and the bearer token keeps working throughout.

There is no sign-out: a session ends at its expiry, or rotate
`TK_SUPERVISOR_SESSION_SECRET` and restart to end every session at once. The
certificate renews itself (§4.7): nothing needs restarting by hand.

**After the cut-over (Epic 28).** Once the Startup shortcut points at
`C:\GitHub\tk-studio\apps\supervisor\start.ps1` (§4.3) and
`bun install --frozen-lockfile` has run in `apps\supervisor` (§4.1):

1. Run `tk-studio doctor` on the box. `supervisor-root`,
   `supervisor-registry`, `supervisor-trust` and `startup-shortcut` all
   `pass` (§7).
2. Start the supervisor tab from the console (the shortcut, or sign out and
   in) from its new root.
3. From another device on the tailnet,
   `curl -H "Authorization: Bearer <token>" http://<tailscale-ip>:8787/status`
   (or, with the TLS variables set, `https://<TLS_NAME>:8787/status`)
   answers JSON, and so do `/agents` and `/office` on the same token.
   On the phone, sign in at `https://<TLS_NAME>:8787/` with the account.
4. Queue one job and drive it to a guarded end (a refused or completed run,
   never one left running): from `apps\supervisor`,
   `bun src/cli.ts run studio-health --directory C:\GitHub\tk-studio`, or
   `POST /jobs` with the bearer header and body
   `{"project": "<id>", "job": "<job>"}`.
5. Record both results, the `/status` answer and the job's end, in the
   Epic 28 loop PR (branch `loop/epic-28`) that carries Story 28.4.

`TK_STUDIO_ROOT`, the `TK_SUPERVISOR_*` variables and
`set-supervisor-env.ps1` stay as they are: the cut-over changes none of them.

### 4.6 What runs where

| Tier | Where the worker runs | Permission mode |
|---|---|---|
| host (default) | `claude -p` in the supervisor's console session, under the Max login | `auto`, or `acceptEdits` when the job asks. A bypass request is refused before anything starts. The project's tracked `.claude/settings.json` allows `Bash(uv run:*)`, so the studio's own scripts run without the auto-mode classifier (supervisor DW-22); the deny list of §3.2 still applies. The rule counts only in a trusted repository (§4.1) |
| sbx | `claude -p` inside the project's Docker Sandboxes microVM (§3.8) | bypass is allowed there |

The tier comes from the submission or from `TK_SUPERVISOR_CONFIG`, never from
the plugin. The supervisor never chooses a model: model and effort are
forwarded as the job or the submission gives them (AD-14).

### 4.7 The run's lifetime: events and the certificate (Epic 27)

The supervisor owns every engine's life (supervisor Epic 27). A queue run's
`events` (`GET /runs/{id}`, the status page) carry these kinds, beyond the
Epic 21 and 22 set:

| Event | When |
|---|---|
| `materialised` | (27.1) The run's worktree was cut and its untracked runtime materialised: the drift check first, `tk install` at the pin only when it reports drift (hole 42: a fresh worktree of a project whose committed base is at the pin is already clean, and an install would re-render committed config into a dirty tree the launch refuses; the event's `install` says `ran` or `skipped: drift-clean`), the policy, routing and local overlay copied from the checkout, `tk activate` clean. |
| `launched` | (27.1) `tk-studio-launch` returned with an engine started: the run stays `running`, its driver lets go, the checkout lock goes to the engine; carries the status block and the engine run id. |
| `paused` | (27.1) The engine paused: the run is `paused` (not terminal), keeps its worktree, lock and pin; the draft PR's URL rides the event. |
| `ended` | (27.1) Written once, at the engine's end after the close-out: the PR URL (or "no changes"). The pacer counts the run as live until then. |
| `hold` | (27.2/27.3) The supervisor's own `sbx exec … tail --pid` (or the resume's child) holding the engine's sandbox open. |
| `closing-out`, `closed_out`, `lock-released` | (27.1/27.5) A late close-out took its lease; a close-out recorded on a run already ended (`orphaned: true` for the orphan pass); a kept lock freed. |
| `close-out`, `close-out-failed`, `awaiting-ruling`, `engine-resume` | (27.3) The paused-run pass relaunched a landed run; a step failed (retried next tick); a landed story with no verdict or `escalate` (one notification); `POST /runs/{id}/resume` moved the run back to `running`. |
| `host-verify` | (27.4) The project's `verify.host` ran on the host in the worktree: exit, duration, the last lines; or skipped and why. (34.1) A ran leg carries `engine {verdict: green\|red\|skipped, reason?, command?, exit?, stdout_tail?, stderr_tail?, godot_dir, …}`: the project's `verify.engine` after a green `verify.host`; an engine red makes the leg red. (33.8) A re-run (`POST /runs/{id}/verify`, `bun src/cli.ts verify <id>`) adds `rerun {by, head, worktree, pr, pr_ready?}`. |
| `host-verify-leg` | (33.8) The lease of an ended run's host-leg re-run: `{owner, by}` taken, `{owner: null, released}` let go of after a failed cut; the re-run's `host-verify` closes it. |
| `plan-status`, `plan-lease` | (27.5) The plan pull-back through `plansync.py status`: `review` when the PR opens, `done` when it merges, a skip naming why; never changes the run's state. The project that owns the plan comes from the host registry (tk-studio is registered on this box). |
| `accounted`, `worker` | (21.6/27.5) The iteration's counts now carry `cost_usd` (`run.json`'s `total_cost_usd` is the sum across iterations); the worker record lands pid first, the start time after it (win32: `GetProcessTimes` natively). |
| `studio-run-ended`, `studio-run-end-failed`, `finish-refused` | (27.5) A cancel's late studio-run end (or the next `recover`'s); a refused `finish` keeps the worker's own reason. |
| `cert-renew-requested`, `cert-renewed`, `cert-renew-failed` | (27.5) Supervisor-scope, in the queue's `service_events` table: the certificate rule below. |

**The TLS certificate renews itself.** `serve` checks the Tailscale
certificate's `notAfter` at start and hourly. Within 14 days of expiry, while
no run is `running` or `external` and no renewal was requested in the last 24
hours, it records `cert-renew-requested` and exits 75; the keeper in
`start.ps1` runs the same bounded `tailscale cert` (120 s) and restarts
`serve` at once. The next `serve` records `cert-renewed` or
`cert-renew-failed`. A live run postpones the renewal; within 3 days of
expiry it renews even during a live run, naming the runs it overrode.

**Checks only the console can run** (the supervisor is never started from a
Claude session), after each supervisor release: the real `sbx run -d`, `exec`
and `stop` and the kill through `sbx exec`; the console-hosted host-verify leg
on a real run; the `tailscale cert` renew and `serve` restart on exit 75 as a
dry run; `plansync.py status` into tk-studio's plan.

### 4.8 The engine MCP

Story 34.5. A run flagged `editor_in_the_loop` (its submission, or its job
definition's `editor_in_the_loop: true`) gets one engine MCP server for its
life, started on this host by the supervisor with the run's sandbox pin and
stopped at its release.

- **The server** is the project's tracked `.tk-studio/config.yaml` key
  `engine.mcp: {name, start, port}` (optional `path`, the server's
  endpoint path, default `/mcp`), read at the run's base: `start` runs in
  the run's worktree with `GODOT` in its env and listens on
  `127.0.0.1:<port>` only (a port something already answers on is refused
  before the server starts). The pick is `hi-godot/godot-ai`; its line,
  its measurements and its allowlist are in `kb/engine-mcp-godot.md`.
  The supervisor starts it in the pick's measured launch shape: the
  server with a per-run capability in its env (`GODOT_AI_HTTP_CAPABILITY`
  and `GODOT_AI_WS_TOKEN`, with `GODOT_AI_DISABLE_TELEMETRY=1`), then,
  once its port answers, the Godot editor on the project (`$GODOT
  --editor --path <the folder of project.godot>`, a window on this
  session) whose add-on adopts the server; the project carries the
  godot-ai add-on enabled in `project.godot`. A worktree with no
  `project.godot` is refused `engine-mcp:start-failed`. The project's
  `.mcp.json` carries the entry,
  written only by `recommend.py record --mcp <name>` on confirmation; it
  names the URL and the bearer as `${TK_ENGINE_MCP_URL:-}` and
  `${TK_ENGINE_MCP_BEARER:-}`, never a value (the empty default keeps the
  file parseable in every other session, where neither is set).
- **The port.** The supervisor fronts the server with a forwarder on
  `TK_SUPERVISOR_BIND` (the tailnet address, checked inside
  `100.64.0.0/10`: `0.0.0.0` or a LAN address fails
  `engine-mcp:start-failed` before anything starts) port
  `TK_SUPERVISOR_ENGINE_MCP_PORT`, default **8788**. One flagged run at a
  time holds it; a second concurrent flagged run's start fails
  `engine-mcp:start-failed`.
- **The server's own ports.** Only the server's HTTP port
  (`engine.mcp.port`, 8000 in TUA's line) is checked before the server
  starts; its WebSocket port (`--ws-port`, 9500 in TUA's line) is not
  pre-checked. An editor the operator opened on this box with the
  godot-ai add-on enabled holds 8000 and 9500 itself, so a flagged run
  fails `engine-mcp:start-failed` while that editor is open: close it
  before a flagged run starts.
- **Three processes per run.** The forwarder is its own detached child
  process (`bun src/enginemcp.ts forward`), beside the server and editor
  children, so all three outlive the one-shot `drain` that launched a
  `run-epic` run (the pacer runs `tick` and `drain` as separate
  processes). The start event records each: `pid`/`start` for the
  server, `forwarder_pid`/`forwarder_start` for the forwarder and
  `editor_pid`/`editor_start` for the editor. Any later tick stops them
  by pid and start time at the run's release, the editor before the
  server; `recover` leaves them while the launched run's engine lives and
  every pid is alive, and otherwise kills them all. A server, editor or
  forwarder that dies on its own takes the others with it
  (`engine-mcp-stop {why: "exited"}`) when the starting process is still
  up, else at the next `recover`. A drain-launched run's MCP serves only
  the sessions the starting process gives its env to (the in-process
  session limit, accepted for this version).
- **The bearer** is minted per run (32 random bytes, base64url), held in
  the starting process's memory (for its own sessions) and in the
  forwarder's spawn env only, never in an event, a log, a file or an argv
  value. The forwarder answers `401` to any request without exactly
  `Authorization: Bearer <it>`, and passes every other one to the server
  with the server's capability as its bearer instead (the capability and
  the WebSocket token, like the bearer, live only in the children's spawn
  env). The worker's sandbox gets
  `sbx exec -e TK_ENGINE_MCP_URL -e TK_ENGINE_MCP_BEARER` (by name; the
  values ride the spawn env). A restarted supervisor never re-arms a
  recorded MCP: `recover` kills all three recorded pids (server,
  forwarder and editor; `engine-mcp-stop {why: "supervisor restarted"}`),
  and records the stop only once all three are gone, so a failed kill is
  retried.
- **Editor readiness.** The start returns once the forwarder is bound,
  before the editor's add-on has adopted the server (measured about
  25 s). For up to about 25 s after the run starts, editor tools may
  answer `EDITOR_NOT_READY`; the session retries (checking
  `editor_state`) before treating the MCP as down. An editor that exits
  before the forwarder is ready fails the start `engine-mcp:start-failed`
  (every child stopped, no `engine-mcp-start`).
- **The sandbox must reach `TK_SUPERVISOR_BIND:8788`.** If the sandbox's
  network policy blocks the tailnet address, allow it by hand (§3.8); the
  loop never changes sbx network policy.
- **The rule: verify-only, in this version.** The dev session may run the
  project's tests, verify the project and take a frame through the MCP; it
  never uses the server's scene-editing tools (the `gds-engine-godot-4`
  skill says so, and the server's allowlist enforces it: godot-ai's
  `--exclude-domains` in `engine.mcp.start`, the 22 editing domains and
  `batch` excluded, which leaves 14 read-and-run tools; keep `editor` in).
  Scenes change through the editor or through code.
- **Refusals** (nothing started, the run ends `blocked`):
  `engine-mcp:no-config` (no or a malformed `engine.mcp`),
  `engine-mcp:no-mcp-json` (no `.mcp.json` at the base, or no
  `mcpServers.<name>`), `engine-mcp:no-engine` (`GODOT` unset or naming no
  file), `engine-mcp:start-failed` (a non-tailnet bind, a loopback port
  already in use or no `project.godot` in the worktree, refused before
  anything starts; the server exits or its port does not answer within
  60 s; the editor does not spawn or exits before the MCP is ready; the
  forwarder cannot bind). The events
  are `engine-mcp-start {name, pid, start, url, forwarder_pid,
  forwarder_start, editor_pid, editor_start}` and `engine-mcp-stop {name,
  pid, forwarder_pid, editor_pid, why}`.

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

Run `tk-studio doctor` (headless: `tk-studio doctor --json`, one JSON object
ending with the status block). It prints one line per check with pass,
fail, warn or skipped and the fix: Claude Code against the roster floor, the
skills-dir plugin against the roster, the per-user store, `sbx daemon status`
(never another sbx command), folder trust for every registered root, long
paths, the PATH launcher, the Tailscale certificate's age, the supervisor's
slot or checkout and whether `/status` answers, studio-web, the `engine` row
(Story 34.1: `GODOT` set and naming a file, with the version
`& $env:GODOT --version` prints; `skipped` `no engine` otherwise — the
binary the host leg's `verify.engine` calls through `$GODOT`, its folder
first on PATH), leftovers from an
interrupted install or update, and Hermes' `auth.adopt_external_logins`. On
Windows it also checks the cut-over (Epic 28): `supervisor-root` (the
shortcut's working directory is the nested root `apps\supervisor`, not a
repository of its own), `supervisor-registry` (the registry's `supervisor`
root agrees with it), `supervisor-trust` (the nested root is trusted, itself
or through a trusted ancestor such as the checkout, §4.1) and
`startup-shortcut` (the `.lnk`'s
Arguments run `start.ps1` in its working directory, §4.3). The first three
appear only when the shortcut runs a source checkout, and the registry and
trust checks are `skipped` until `supervisor-root` passes; a slot box shows
`startup-shortcut` alone, `skipped` when the roster ships no supervisor.
Doctor is read-only. The table keeps only what the CLI cannot check.

| Check | Command | Pass looks like |
|---|---|---|
| Studio smoke checks | `tk-studio doctor` | every check `pass`, or `skipped`/`warn` with its fix read; the JSON `reason` is null |
| RDP scope (§5 firewall) | from iPad over the tailnet: RDP to the MagicDNS name; from a device off the tailnet: RDP to the box's LAN or public address | desktop visible over the tailnet; off it, no connection (RDP scoped to `100.64.0.0/10`) |
| Startup shortcut's visible tab (§4.3) | sign out and back in as the studio account | the `studio` Windows Terminal window opens visibly with the `supervisor` tab running `start.ps1` |
| `GET /agents` (§4.5, Story 29.2) | `curl -H "Authorization: Bearer <token>" https://<TLS_NAME>:8787/agents` | `{ok:true, rebuilt_at, agents:[…]}`: each served project's seven roles (`orchestrator`, `session`, `implementer`, `reviewer`, `consult`, `advisor`, `planner`) with their routed models |
| `GET /office` (§4.5, Story 29.3) | `curl -H "Authorization: Bearer <token>" https://<TLS_NAME>:8787/office` | `{ok:true, at, agents, runs, …}`: every agent once with one of the eight states, the live runs with story and epic progress |
| `GET /office/events` (Story 29.3) | `curl -N -H "Accept: text/event-stream" -H "Authorization: Bearer <token>" https://<TLS_NAME>:8787/office/events` | an `event:snapshot` frame first, then a `: heartbeat` line within 10 s (and `office.*` frames while a run moves); Ctrl+C ends it |

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
| The engine's own gate for a tk-studio story is the dev session's `bun test`; a story that adds a skill without its `released-roster.json` row passes the engine and fails the host leg's lib suite (hole 62, twice: 31.5, 32.2) | agent PC, 2026-10-24/25 | the command is tracked in `plugins/tk-studio/pipeline/verify-commands.toml` (Story 33.5; a project's `.tk-studio/config.yaml` `engine.verify_commands` overrides it), and `tk-studio-launch check` (run by every launch and by `start`) reconciles the checkout's `.bmad-loop/policy.toml` (gitignored operator overlay, materialised into every run worktree) `[verify] commands` from it — adds the missing command, keeps the operator's extras, reports it in its `verify commands` row — so bmad-loop runs the roster gate inside the engine after a clean review and sends a failure back to a dev fix session; this takes effect on a box once the plugin release carrying it is installed (until then the hand line `[verify] commands = ["uv run --directory plugins/tk-studio/lib python -m unittest tests.test_release_roster"]` in the overlay stays the gate) |
| A stale sandbox view of a fresh render snapshot halts the dev session: inside the sandbox `_bmad/render/<skill>/<slug>/<generation>/` looks half-written across the sbx mount (`render_skill.py`: `failed to verify …`, `generation contains unexpected or missing files: …`) while the host sees it complete; the session writes a `blocked` spec and bmad-loop pauses the run on a CRITICAL escalation (hole 65) | agent PC, 2026-10-25 (32.6) | since Story 33.6 the paused-run pass removes the snapshot and the untracked draft and resumes once (`auto-resume` on the run, `attempt: 1`, and one notifier line); a second halt on the same story waits for the operator (`auto-resume` `attempt: 2` naming the first attempt's time), who removes the snapshot folder and the untracked `blocked` draft spec, then resumes (`POST /runs/{id}/resume`) |
| The supervisor process exits with no trace: the Windows Terminal tab's console is its only log and a restart wipes it (hole 66) | agent PC, 2026-10-25 | fixed by Story 33.1: the supervisor logs every console line to `C:\agent-work\supervisor\logs\supervisor-<date>.log` (one file per UTC day, the newest 14 kept; each line `<ISO time> [serve\|tick\|drain\|keeper\|pacer] <text>`, redacted, with explicit `started`, `stopped (<why>)` and `uncaught: <error>` lines). After a dead tab, read that file's tail (`Get-Content C:\agent-work\supervisor\logs\supervisor-<today>.log -Tail 20`), or run `tk-studio doctor`: its `supervisor-log` check names the newest file's last `stopped` or `uncaught` line and its age when the API does not answer (`GET /status`'s `log` shows the last 20 lines while it does). The engine in the sandbox keeps running and the run is re-adopted on restart |
| The supervisor tab is gone and nobody is at the box (16 hours lost on 2026-10-25) | agent PC, 2026-10-26 | the per-user Scheduled Task **`tk-studio supervisor`** (no trigger, no elevation, interactive, `MultipleInstances IgnoreNew`) opens the same Windows Terminal tab the Startup shortcut does, in the studio account's logon session; a session restarts the supervisor with `pwsh -NoProfile -Command "Start-ScheduledTask -TaskName 'tk-studio supervisor'"` and never with a direct `start.ps1` or `bun src/cli.ts serve` (those die with the session and run inside the desktop app's container); re-register with `Register-ScheduledTask` if it is ever removed (the action is `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe -w studio nt --title supervisor pwsh -NoExit -File C:\GitHub\tk-studio\apps\supervisor\start.ps1`) |
| The engine sandbox's Max login expires silently: the global `anthropic` sbx secret is an OAuth grant whose refresh token lasted ~10 days from provisioning (expired 2026-10-25T23:38Z); every sandbox start then gets `SBX_CRED_ANTHROPIC_MODE=none`, `claude auth status` says logged out, and the supervisor's preflight blocks every claim with `harness auth: Max login missing or expired` on the console only (hole 69) | agent PC, 2026-10-26 | renew from **inside** the sandbox (the host-side `sbx secret set anthropic --oauth` is refused): `sbx run --name claude-tk-studio`, then `/login` (claude.ai, Max), then `/exit`; the renewed refresh token expires on the date `sbx exec claude-tk-studio python3 -c "import json;print(json.load(open('/home/agent/.claude/.credentials.json'))['claudeAiOauth']['refreshTokenExpiresAt'])"` prints (ms since the epoch; 2026-11-24 after the 2026-10-26 renewal): calendar it until doctor warns |
| A sandbox started by a session's `sbx exec` while stopped comes up without the Max login, and the supervisor's pin (`sbx run -d --name`) does not restart a running sandbox (hole 68) | agent PC, 2026-10-26 | from a session, `sbx ls` first and never `sbx exec` a stopped engine sandbox; the supervisor's pin owns starts; `sbx stop <sandbox>` lets the next pin start it cleanly. Since Story 33.3 the pin restarts a running, logged-out sandbox itself, once (`sbx stop`, `sbx run -d --name`, a `pin-restart` event on the run), and `tk-studio-launch check`'s advisory `engine sandbox` row warns `<sandbox> started outside the supervisor; the next pin restarts it` when the sandbox runs with no supervisor pin record (`~/.tk-studio/sandboxes/<sandbox>.pin`); the session rule above still stands |
| The supervisor's suites leak `tk-sup-*` temp folders: about 90,000 in `%LOCALAPPDATA%\Temp` slowed the box and made a worktree test flaky (hole 64), and 1.3 M inodes in the engine sandbox's `/tmp` (hole 70) | agent PC, 2026-10-25; engine sandbox, 2026-10-26 | fixed by Story 33.4: one test helper, `apps/supervisor/test/tmp.ts`, makes every suite's temp folder (`tempDir`) and tracks its queues (`track`); `test/preload.ts` closes the queues and removes the folders at the end of the `bun test` process (a preload's `afterAll` runs once, after its last file; under the host gate every file is its own process, so there it is per file), and at process exit and on SIGINT/SIGTERM, on every platform; the host gate also points `TMPDIR`/`TEMP`/`TMP` at a per-run folder it removes. `tk-studio doctor`'s `supervisor-temp` check warns above 500 `tk-sup-*` folders in the temp folder and names the cleanup (doctor never deletes): close every `bun test`, then `Get-ChildItem $env:TEMP -Directory -Filter 'tk-sup-*' \| Remove-Item -Recurse -Force` (Linux: `find "${TMPDIR:-/tmp}" -maxdepth 1 -name 'tk-sup-*' -exec rm -rf {} +`) |
| The owner seat refuses with `401 Unauthorized` on Basic auth although the email is right: the token is an *organization admin API key* (admin.atlassian.com; works as a bearer on `/admin/v1/orgs`, anonymous on Jira) instead of an *account API token* | agent PC, 2026-10-26 | create the owner token at id.atlassian.com → Security → API tokens → *Create API token with scopes* → app Jira → `read:jira-work`, `write:jira-work`, `read:jira-user`; `setx TK_STUDIO_ATLASSIAN_OWNER_EMAIL` with the account's sign-in email and `setx TK_STUDIO_ATLASSIAN_OWNER_TOKEN`; probe with Basic `email:token` against `https://api.atlassian.com/ex/jira/<cloud id>/rest/api/3/myself` (200, `accountType: atlassian`) |
| Confluence publish and sync-back refuse with `scope does not match` although the agent token lists Confluence scopes | agent PC, 2026-10-26 | the studio's Confluence client is the v2 API, which needs the *granular* scopes; classic `read:confluence-content.all` and friends only reach v1. The agent seat needs `TK_ATLASSIAN_AGENT_CONFLUENCE_TOKEN`: a scoped token for the service account with `read/write:space:confluence`, `read/write:folder:confluence`, `read/write:page:confluence`, `read/write:attachment:confluence` (and `read/write:comment:confluence` for later stories); one token may carry both apps' scopes, so the kb's one-app-per-token note was wrong |
| Windows Smart App Control turns itself on after its evaluation period (it did at 03:03 local on 2026-10-25) and then blocks every unsigned, reputation-less executable: bun's `node_modules\.bin\*.exe` shims (the host leg's web build dies with `bun: unknown error`), uv's `tk-studio.exe` launcher, any new unsigned tool (hole 67) | agent PC, 2026-10-25 | on a fresh box turn it off before the evaluation ends: Windows Security → App & browser control → Smart App Control settings → Off (one-way; a reset is the only way back); the studio-web scripts run vite and vitest through `bun x` anyway, so the gate never depends on a shim |
| The engine sandbox's root filesystem runs out of inodes (`df -i /` at 100 %): the dev sessions' own `bun test` leaks `tk-sup-*` folders into the VM's `/tmp` (1.3 million on 2026-10-26), the skill render cannot write, every dev session halts and idles to its timeout (hole 70) | agent PC, 2026-10-26 | `sbx exec claude-tk-studio python3 /c/agent-work/worktrees/clean_tmp.py 60` removes the leaked folders older than an hour (the script lives on the host, visible in the sandbox); `bash /c/agent-work/worktrees/inodes.sh` measures; 33.4's shared teardown helper closes the leak at the source |
| The close-out's `git worktree prune` empties the served checkout's `.git/worktrees/`, so any other worktree of that repository (the operator's side checkout) answers `not a git repository` (hole 71, twice) | agent PC, 2026-10-26 | the operator's scratch checkout is its own clone: `git clone --no-hardlinks C:/GitHub/tk-studio C:/agent-work/scratch/tk-studio-side` then `git remote set-url origin https://github.com/thkennedy/tk-studio.git`; never a worktree of the served checkout |
| A supervisor test passes by hand and fails under the host leg (or the other way round) because it reads the live environment (the `TK_ATLASSIAN_*` pass-through pairs in the sbx worker's argv) (hole 72) | agent PC, 2026-10-27 | the host leg's supervisor gate strips `TK_SUPERVISOR_*`, `TK_ATLASSIAN_*` and `TK_STUDIO_ATLASSIAN_*`; a test that builds a worker's argv injects its environment |
| Restarting a running supervisor from a session: `Stop-ScheduledTask` leaves the tab's tree alive and a second `Start-ScheduledTask` instance cannot bind the port | agent PC, 2026-10-26 | find the `pwsh -NoExit -File ...start.ps1` process (`Get-CimInstance Win32_Process`), end its tree with `MSYS_NO_PATHCONV=1 taskkill /T /F /PID <pid>`, then `Start-ScheduledTask -TaskName 'tk-studio supervisor'`; the API answers within a minute (a keeper started early retries its bind with a back-off) |
| A dev session sits idle at its prompt inside the sandbox (a halt it printed, waiting for an operator) and will burn its attempt to the 90-minute timeout | agent PC, 2026-10-26 | steer it from its pane: `sbx exec claude-tk-studio tmux send-keys -t bmad-loop-<engine run id>:1.0 "<message>"`, then send `Escape` and `Enter` as separate `send-keys` (a bare Enter after the text does not submit); never write or commit in a live run's worktree meanwhile (a mid-attempt commit moves the baseline and the loop defers the finished story) |
| A supervisor PR stays open with no live run behind it: a cancelled run's close-out opened it (PR #161, run cancelled 2026-10-24 15:55Z, PR opened 16:41Z) and nothing closes it while the relaunch lands the same work (hole 73) | agent PC, 2026-10-27 | `gh pr list --state open` at the start of a session; a run PR whose run is `cancelled` or whose job has a later merged run is superseded: close it with a comment naming the cancellation and the landing PR; the fix to make: the close-out of a cancelled run opens no PR and the ended-run sweep closes a superseded one |
| A game project's engine gate never ran in the loop: the engine sandbox (Linux) has no `godot`, and the host leg ran `scripts/verify.sh` without `TUA_ENGINE_GATE=1`, so the headless import and the GoDotTest suite were skipped on both sides (found planning Epic 34) | agent PC, 2026-10-27 | landed in Story 34.1: the project declares `verify.engine` beside `verify.host` in its tracked `.tk-studio/config.yaml` (TUA: `bash scripts/engine-gate.sh`), and the host leg runs it after a green `verify.host` with `$env:GODOT`'s folder first on PATH, recording `engine` on `host-verify` (an engine red is a red leg); `tk-studio doctor`'s `engine` row shows whether `GODOT` answers `--version`; start the supervisor after setting `GODOT` (§3.8 step 5) |
| A cli test is green in the engine's sandbox and red on the host leg because the cli reads the box's HKCU user variables (`apps._var` consults the Windows user-variable store before the process env; the plugin-leg tests built their context without an `env_store`, so the real store supplied `GODOT` and the read-only doctor test saw a `<GODOT> --version` call) (hole 74, the twin of hole 72) | agent PC, 2026-10-27 | every cli test passes an explicit `env_store` (an empty dict); fixed on 34.1's branch; a `Ctx` built with the real store under tests is the thing to refuse |
| `POST /runs/{id}/verify` (Story 33.8) answers 500 `VerifyFailed: worktree activate drift: result 'drift'` on every run: the fresh worktree's materialise gates on the activation drift check being clean, and the `sandbox-login` plane (33.2) reports `missing` whenever the project's sandbox is stopped, which it always is after a run (the verify verb never pins) (hole 75) | agent PC, 2026-10-27 | materialise judges only the planes it owns (`worktreeClean`: `sandbox-login` is reported, never judged; PR #202); the drift check itself should call a stopped sandbox not-checked, as `doctor` does |
| A conformance drive is green in the sandbox and red on the host: it runs a whole supervisor suite under a fixed bound with no Windows headroom (34.1's `e2e_engine_gate.py`: `bun test test/hostverify.test.ts`, 43 s on the box with real git worktrees, under a 50 s bound forced by the runner's 60 s per-drive timeout; reported as `hung past 50s`) (hole 76) | agent PC, 2026-10-27 | a drive runs only the cases it owns (`bun test <suite> -t "Story N.M"`); a bound comes from the host-measured time with headroom; the runner's per-drive timeout is a knob to document |
| A bash `verify.host` is never green under the supervisor's host leg: its `verify:` lines are missing from the captured output and it exits 1 right after its last real step, while the same script passes by hand (The Universe Awaits, every run since 2026-10-18). The leg's capture wrapper opened the output files in append mode and MSYS bash cannot write to an append-only handle (`echo: write error: Bad file descriptor`): every `echo` fails and the script's exit follows its closing `echo "verify: OK"` (hole 77) | agent PC, 2026-10-27 | the wrapper opens fresh files in write mode (PR #203); a Windows test runs a bash step with echoes through the leg; to diagnose a red bash leg, push a tracing commit (`exec > >(tee -a <file>) 2>&1; set -x` after `set -u`) onto the run branch and re-run the verb, then revert it; a `tee` left behind by such a trace keeps the leg's `exit` from firing, so kill the verb's tree afterwards |
| The engine gate hangs under the host leg: a project's bare `godot` resolves past the `GODOT` folder (which holds only `Godot_v4.7.2-stable_mono_win64_console.exe`) to WinGet's `C:\Program Files\WinGet\Links\godot.exe`, the GUI build, whose `--headless --import --quit` never returns under a hidden window (45 minutes on 2026-10-27) (hole 78) | agent PC, 2026-10-27 | the project's engine gate calls `${GODOT:-godot}` (TUA PR of 2026-10-27, `cygpath` for the Windows path); the leg should also expose the console exe as `godot` first on PATH and bound the engine step on its own; kill the stuck `Godot_v4.7.2-stable_mono_win64.exe` to let the leg record the red |
| A supervisor test that builds several real git repositories in one case passes or fails by load: bun's default 5 s test timeout (`this test timed out after 5000ms`, the in-flight `git show` killed and read back as `config unreadable: git show exited null`); 34.1's `verifyCommand` case was one run in two by hand, and 34.2's host leg went red on it through the engine-gate conformance drive (hole 79) | agent PC, 2026-10-27 | every test that spawns real git or bun carries an explicit timeout (60 s), as the file's guard-trip cases do; a reviewer lens for a real process under the default timeout |
| A fresh worktree has no `apps/supervisor/node_modules`, so the engine-gate conformance drive's `bun test` fails (`Cannot find package 'js-yaml'`), the lib suite fails through `test_conformance`'s real-plugin case, and the host leg's supervisor gate fails the same way plus tsc (`Cannot find type definition file for 'bun'`): every `verify` worktree (33.8) and every run whose story never ran `bun install` (34.2) (hole 80) | agent PC, 2026-10-27 | the host gate and the drive run `bun install --frozen-lockfile` when `node_modules` is absent (PR #207; the drive has `timeout: 120` in the manifest); by hand: `bun install` in `apps/supervisor` of the clone before any gate |
| A dev session halts on an intent gap: the story introduces a contract schema and carries open SPEC questions, but no `plans/<story>.md` exists (the launch bootstrap writes only the first story's plan; the gates write the next story's plan only while the loop moves one story at a time, and a relaunch skipped that) — 34.6 asked six design questions and paused the run (hole 81) | agent PC, 2026-10-27 | the operator writes `plans/<story>.md` settling every open point (the planner's rulings), removes the halted untracked story spec, commits in the paused worktree (never an amend), `POST /runs/{id}/resume`, re-issues the graceful stop; the fix to make: the bootstrap writes every story's plan and the launch refuses a story whose SPEC open questions have no design note |
| After `POST /runs/{id}/resume` the engine takes the worktree's HEAD as its baseline; a commit amended or rewritten afterwards makes the loop's dev-decision see work above the baseline, pause for manual recovery and discard the graceful stop (34.5, 13:56Z) | agent PC, 2026-10-27 | never touch a run's worktree after a resume; if it happens: `reconcile_verdict: not-required` in the story spec's frontmatter, commit, let the paused-run pass close out and relaunch, then re-issue the graceful stop at once (the relaunch starts the next story within seconds) |
| The host leg's supervisor suites ran with the box's `TK_STUDIO_ROOT` (the served checkout on `main`): a story that changes the plugin lib or a contract and tests the supervisor against the change went red on the host leg only (34.5's `editor_in_the_loop` definition flag: `resolve: unknown field(s)` from `main`'s `job.py`); beside it, two Windows-only test defects the sandbox never sees (a Windows temp path in a bare double-quoted YAML scalar: `expected hexadecimal character`; `shutil.which` answering `blender.EXE`) (hole 82) | agent PC, 2026-10-27 | `tools/verify_host.py`'s `supervisor_env` sets `TK_STUDIO_ROOT` to the repo under verification (on the run branch, PR #213); test strings that carry a path are JSON-quoted in YAML, and a fake executable on PATH carries the platform's name; a red host leg after the run ended: fix forward on the branch in the hotfix clone, push, `POST /runs/{id}/verify` |
| CRLF checkout makes every BMad-installer rewrite show as modified | first agent PC, 2026-09-26 | `core.autocrlf false` before cloning; one-time re-checkout otherwise (§3.1) |
| Plugin skills work in the desktop app but headless `claude -p /tk-studio:…` is "Unknown command" (no CLI install record) | first agent PC, 2026-09-27; "tk activate" plugin plane | `tk-studio install`: the CLI loads the skills-dir folder with no install record (§3.4) |
| A detached bmad-loop engine and its tmux server die within a minute | sbx v0.45.1: the sandbox stops when no `exec` or session is attached (first agent PC, 2026-09-28) | hold an `sbx exec` for the engine's lifetime (`tools/sbx-engine/launch-epic.sh`, §3.8) |
| The loop's close-out commit fails with "Author identity unknown" after the story landed | the engine's shell has no git identity, even though the agent session has one (The Universe Awaits hit the same in WSL) | `provision-engine.sh` sets `user.name` and `user.email` (§3.8) |
| `bmad-loop list` fails on `pyte` / `rich`, so launch's live-engine check fails | bmad-loop installed without its `[tui]` extra | install `bmad-loop[tui]` at the pin (§3.8) |
| `bmad-build` / `bmad-build-auto` HALT: "ambiguous config value `planning_artifacts`" | BMAD-METHOD#2718: bmm + gds both declare the key | studio-managed base patch, re-applied by `tk install` (`kb/bmad-base-patches.md`) |
| Every host session's hooks fail after `bmad-loop init` | init wrote `python3 …` hooks (the Store stub on Windows), or 0.12.0's absolute sandbox path | hooks through `uv run --no-project python` (§3.8); bmad-loop pinned |
| A test fake written as a `.cmd` shim fails to start: `spawn … EINVAL` | Node and Bun refuse to spawn a `.cmd` or `.bat` without a shell, and the supervisor spawns without one (first agent PC, 2026-09-29) | real tools must be `.exe` (`claude`, `uv`, `sbx`, `bun` and `robocopy` all are); the supervisor's test fakes are compiled executables (`test/fakes.ts`) |
| The supervisor's tests pass in the Linux engine and fail on the Windows host | the loop's verify gate runs on Linux only: a lowercased path (21-4), 29 end-to-end failures and a `~\` separator (22-2, 22-3) | the host leg's `supervisor` gate runs every suite file but the e2e on Windows when `apps/supervisor` changed (Story 33.4; `tools/verify_host.py`: each `test/*.test.ts` in its own `bun test` under 420 s, every `TK_SUPERVISOR_*` unset, `TMPDIR`/`TEMP`/`TMP` at a per-run `tk-verify-supervisor-*` folder under the host's own Temp, outside any git checkout because the queue refuses a path inside one, removed afterwards, then `bunx tsc`), so the by-hand recipe (holes 51, 56) is retired; the e2e suite (`test/command-line.test.ts`, which spawns `bun src/cli.ts`) is still run by hand on the host (`$env:TK_STUDIO_ROOT` set, `bun test test/command-line.test.ts`) after a change to the CLI's paths |
| A supervisor signalled while it starts a worker dies and leaves the worker running (POSIX) | its signal handlers were installed after `spawn()` returned, and `spawn()` returns after the child is already running | fixed in the supervisor: the handlers are installed before the spawn. win32 is not affected: a worker there is not detached and ends with its supervisor |
| A supervisor killed within half a second of starting a worker leaves no record of that worker | on win32 the worker record waits on a PowerShell read of the start time, about 0.5 s (supervisor DW-19, open) | the worker still ends with its supervisor on win32, and the run ends `partial` naming no session |
| The status page will not open in a phone browser | it sat behind the same bearer header as the API, and an address bar cannot send one | Story 22.5: the page signs the operator in (token form, Google, GitHub) over https with a session cookie (§4.5); over plain http, the bearer header or a client that sends it |
| `serve` refuses to start with `SessionSecretMissing` or `SessionSecretWeak` | Story 22.5 made the session cookie's signing secret required, at least 32 bytes | set `TK_SUPERVISOR_SESSION_SECRET` (the setup script does, §4.2) |
| `serve` refuses to start with `TlsConfigIncomplete` or `TlsCertUnreadable` | the TLS trio is all-or-none, and the certificate files must exist | set all three or none; run `tailscale cert` before the TLS variables (`-WithTls`) (§4.5) |
| The token form on the sign-in page refuses over http | the session cookie is `Secure`, so a browser never keeps it over http | set the TLS variables; the bearer header still works over http |
| https fails with an expired certificate on a box up longer than 90 days | `tailscale cert` runs only when `start.ps1` starts (supervisor DW-21) | restart the supervisor tab before the certificate expires |
| A bmad-loop story is finished and committed, but the engine calls its session stalled | the dev session named its spec `<id>.md`; the engine resolves `<id>-*.md` and reads the story as pending (2026-09-28) | each `stories.yaml` entry names the file pattern; rename the file and commit if it happens (§3.8) |
| An engine nudge is swallowed and the sandbox's default permission mode changes to `auto` | Claude Code showed "Make auto mode your default?" in a bypass session, and the nudge's keystrokes answered it (2026-09-28) | `provision-engine.sh` marks the dialog seen (`hasSeenAutoDefaultNudge` and its two siblings in the sandbox's `~/.claude.json`, confirmed in the 2.1.284 binary); engine sessions pass the mode explicitly; if it ever shows again, put `permissions.defaultMode` back in the sandbox's `~/.claude/settings.json` |
| An sbx command issued from a Claude session while the daemon is down auto-starts a daemon that cannot reach the inner engine (`backend unavailable`, `sbx ls` empty) | first agent PC, 2026-10-06, after `winget upgrade Docker.sbx` to v0.47.0 | `sbx daemon status` before any other sbx command from a session; start the daemon only through the sign-in task or `start.ps1` (§3.5, §4.3) |
| A host-tier job ends `blocked` with "This command requires approval" on the studio's own `uv run` script | the host tier runs `claude -p --permission-mode auto`, and the auto-mode classifier does not approve the studio's scripts reliably (two of two `studio-health` runs denied on 2026-10-09, ten calls approved the day before) | `permissions.allow: ["Bash(uv run:*)"]` in the project's tracked `.claude/settings.json` (§4.6), **and** the repository trusted once on the box (§4.1): an untrusted folder's project rules are ignored, which is what kept three runs blocked on 2026-10-09 after the rule was in place. The run itself is honest and ends `blocked` naming the gap |

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
