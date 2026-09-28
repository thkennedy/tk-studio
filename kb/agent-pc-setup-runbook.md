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

`balanced` is deny-by-default plus an allow list of AI services and package
registries (`allow-all` and `deny-all` are the alternatives; `sbx policy
reset` starts over). `sbx diagnose` should end with no failures. The CLI has
no `--version` flag.

The daemon does **not** come back on its own after a reboot (verified
2026-09-27). Until the supervisor's `start.ps1` (§4) starts it, register a
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
- `TK_STUDIO_ROOT`
- the tk-studio plugin at user scope
- the sandbox's own studio store, with the project registered as developer

From Git Bash, set `MSYS_NO_PATHCONV=1`, or Git Bash rewrites `/c/...`
arguments to `C:/...`:

```bash
MSYS_NO_PATHCONV=1 sbx exec claude-<project> bash -lc 'GIT_NAME="Tim Kennedy" GIT_EMAIL="<noreply email>" bash /c/GitHub/tk-studio/tools/sbx-engine/provision-engine.sh /c/GitHub/<project> /c/GitHub/tk-studio'
```

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

Run it **console-hosted in the studio account's interactive session**, never
as a "run whether user is logged on or not" task. Simplest: a shortcut in
`shell:startup` for the studio account that runs

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
| Supervisor | `curl …/status` from another device | JSON status |

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
