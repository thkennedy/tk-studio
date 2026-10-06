#Requires -Version 7
<#
.SYNOPSIS
  One-shot operator setup for the tk-studio supervisor (runbook section 4.2 and 4.3).

.DESCRIPTION
  Run this ONCE from your own PowerShell 7 terminal, never from a Claude desktop-app session.
  It:
    1. creates the folders the supervisor needs under C:\agent-work
    2. sets the TK_STUDIO_ROOT and TK_SUPERVISOR_* variables in the User environment
       - the API token is generated here and never printed (use -ShowToken to print it once)
       - Telegram uses the same bot as Hermes: token and home chat are read from Hermes' own .env
       - an ntfy topic is generated too, so switching is one variable change (TK_SUPERVISOR_NOTIFY=ntfy)
    3. puts the shell:startup shortcut in place (skip with -NoShortcut)
  Re-running is safe: the token and the ntfy topic are kept if already set; everything else is re-asserted.

.PARAMETER ShowToken
  Print the API token once at the end (you need it on the phone / another device for the smoke test).

.PARAMETER NoShortcut
  Do not create the shell:startup shortcut.
#>
[CmdletBinding()]
param(
  [switch]$ShowToken,
  [switch]$NoShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupervisorRepo = 'C:\GitHub\tk-studio-supervisor'
$StudioRoot     = 'C:\GitHub\tk-studio'
$Work           = 'C:\agent-work'
$Tailscale      = 'C:\Program Files\Tailscale\tailscale.exe'
$HermesEnv      = Join-Path $env:LOCALAPPDATA 'hermes\.env'

foreach ($p in $SupervisorRepo, $StudioRoot, $Tailscale, $HermesEnv) {
  if (-not (Test-Path -LiteralPath $p)) { throw "missing: $p" }
}

function Set-UserVar {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Value, [switch]$KeepExisting)
  $current = [Environment]::GetEnvironmentVariable($Name, 'User')
  if ($KeepExisting -and -not [string]::IsNullOrWhiteSpace($current)) {
    Write-Host ("  {0,-36} kept (already set)" -f $Name); return
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
  Write-Host ("  {0,-36} set" -f $Name)
}

# 1. folders
New-Item -ItemType Directory -Force (Join-Path $Work 'supervisor')              | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Work 'backups\claude-projects') | Out-Null

# Hermes' bot: the same bot you already talk to, so a reply to a run's message reaches Hermes.
$kv = @{}
Get-Content -LiteralPath $HermesEnv | ForEach-Object {
  if ($_ -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $kv[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
  }
}
foreach ($k in 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_HOME_CHANNEL') {
  if (-not $kv.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($kv[$k])) { throw "Hermes .env has no $k" }
}

# this machine's tailnet address
$bind = (& $Tailscale ip -4 | Select-Object -First 1).Trim()
if ($bind -notmatch '^100\.') { throw "tailscale ip -4 answered '$bind', not a 100.x address" }

# 2. User environment
Write-Host 'User environment:'
Set-UserVar TK_STUDIO_ROOT                  $StudioRoot
Set-UserVar TK_SUPERVISOR_DB                (Join-Path $Work 'supervisor\queue.db')
Set-UserVar TK_SUPERVISOR_BIND              $bind
Set-UserVar TK_SUPERVISOR_TOKEN             ([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))) -KeepExisting
Set-UserVar TK_SUPERVISOR_TRANSCRIPT_BACKUP (Join-Path $Work 'backups\claude-projects')
Set-UserVar TK_SUPERVISOR_WORK              $Work
Set-UserVar TK_SUPERVISOR_NOTIFY            'telegram'
Set-UserVar TK_SUPERVISOR_TELEGRAM_TOKEN    $kv['TELEGRAM_BOT_TOKEN']
Set-UserVar TK_SUPERVISOR_TELEGRAM_CHAT     $kv['TELEGRAM_HOME_CHANNEL']
$topic = 'tk-supervisor-' + ([Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(12))).ToLowerInvariant()
Set-UserVar TK_SUPERVISOR_NTFY_URL          "https://ntfy.sh/$topic" -KeepExisting
# TK_SUPERVISOR_PORT (default 8787) and TK_SUPERVISOR_CONFIG (per-job tiers; unset = host tier) are left unset on purpose.

# 3. shell:startup shortcut
if (-not $NoShortcut) {
  $wt = (Get-Command wt.exe -ErrorAction Stop).Source
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup 'tk-studio supervisor.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath       = $wt
  $s.Arguments        = "-w studio nt --title supervisor pwsh -NoExit -File $SupervisorRepo\start.ps1"
  $s.WorkingDirectory = $SupervisorRepo
  $s.Description      = 'tk-studio supervisor, console-hosted at logon (runbook section 4.3)'
  $s.Save()
  Write-Host "Startup shortcut: $lnk"
}

Write-Host ''
Write-Host 'Notifications: Telegram, from your Hermes bot, in its home chat (TK_SUPERVISOR_NOTIFY=telegram).'
Write-Host "  To switch to ntfy later: setx TK_SUPERVISOR_NOTIFY ntfy   and subscribe your phone to  $([Environment]::GetEnvironmentVariable('TK_SUPERVISOR_NTFY_URL','User'))"
Write-Host ''
Write-Host 'Start it now, in THIS console (a new tab also sees the new variables):'
Write-Host "  pwsh -NoExit -File $SupervisorRepo\start.ps1"
Write-Host ''
Write-Host 'Smoke test from another tailnet device:'
Write-Host "  curl -H ""Authorization: Bearer <token>"" http://${bind}:8787/status"
if ($ShowToken) {
  Write-Host ("  token: " + [Environment]::GetEnvironmentVariable('TK_SUPERVISOR_TOKEN', 'User'))
} else {
  Write-Host "  (show the token once with:  [Environment]::GetEnvironmentVariable('TK_SUPERVISOR_TOKEN','User')  or re-run with -ShowToken)"
}
