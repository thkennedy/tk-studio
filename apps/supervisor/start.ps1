<#
.SYNOPSIS
  Start the supervisor, console-hosted, at logon (Story 22.3).

.DESCRIPTION
  Launched by a shortcut in shell:startup, in the studio account's own session (runbook section 4):

    wt.exe -w studio nt --title supervisor pwsh -NoExit -File <repo>\start.ps1

  In order, it:
    1. reads every TK_SUPERVISOR_* / TK_STUDIO_* / worker variable from the User environment
       (falling back to the process value; a shortcut-launched tab may predate a later setx) and
       exports it to its children. TK_SUPERVISOR_BIND, TK_SUPERVISOR_TOKEN and TK_SUPERVISOR_SESSION_SECRET
       are required: a missing one fails loudly, naming the variable, never printing a value.
       TK_SUPERVISOR_TRANSCRIPT_BACKUP (the nightly backup's claude-projects folder) is warned about when
       unset. When TK_SUPERVISOR_TLS_CERT/KEY/NAME are all set, `tailscale cert` renews the 90-day
       certificate into them (bounded; a failure is a warning) before the keeper starts (Story 22.5).
       Story 27.5: the keeper runs the same renewal whenever `serve` exits 75 (the certificate is within
       14 days of expiry and no run is live), then restarts `serve` at once, without the back-off.
    2. starts the API keeper: this script again with -ServeOnly, in this console (never hidden),
       inheriting the variables step 1 exported. The keeper loops `bun src/cli.ts serve` in its own
       foreground and restarts it with a back-off whenever it exits, independent of recover, tick and
       drain (which drive runs to completion here, for hours), so /status answers throughout. This
       script restarts a keeper that has exited (checked once per pacer pass, with a back-off) and
       stops the keeper's own process tree when it ends.
    3. starts the Docker Sandboxes daemon from $HOME when a read-only `sbx ls` says it is not running:
       it exits non-zero, or gives no answer within 30 s (that probe alone is then killed).
    4. attempts one `bun src/cli.ts recover` pass (the restart rule with resumes) before the pacer's
       first tick. If that pass fails the pacer still starts: recover is retried with a back-off on
       later passes, and every tick also recovers at its own start.
    5. loops the pacer in the foreground: `bun src/tick.ts`, then `bun src/cli.ts drain`, then sleeps
       -IntervalSeconds.

  Only step 1's checks end the script: a missing TK_SUPERVISOR_BIND, TK_SUPERVISOR_TOKEN or
  TK_SUPERVISOR_SESSION_SECRET, or no `bun` on PATH. Nothing after them does. Right after logon Tailscale may not have bound its 100.x
  address yet, so `serve` can fail to bind: the keeper warns and retries it with a back-off while
  the pacer runs on here (as it does when serve exits later). A failed `recover` is a warning too,
  retried with a back-off on later passes; every tick also recovers at its own start. Warnings name
  exit codes, never a variable's value.

  It never registers a scheduled task and never hides a worker's window: the supervisor runs only
  in this console tab. Never start it from a Claude desktop-app session.

.PARAMETER IntervalSeconds
  Seconds between pacer passes (tick + drain). Default 60.

.PARAMETER ServeOnly
  Run as the API keeper only (step 2 starts it): steps 1 and the serve loop; no sbx probe, no
  recover, no pacer. Not meant to be passed by hand.
#>
[CmdletBinding()]
param(
  [ValidateRange(5, 86400)]
  [int]$IntervalSeconds = 60,
  [switch]$ServeOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# A native command's non-zero exit is read from $LASTEXITCODE, never raised (PowerShell 7.4+).
$PSNativeCommandUseErrorActionPreference = $false

$Repo = $PSScriptRoot
$Self = $PSCommandPath
$StartupCommand = "wt.exe -w studio nt --title supervisor pwsh -NoExit -File $Repo\start.ps1"

if (-not $ServeOnly) {
  Write-Host '[supervisor] the shell:startup shortcut command (runbook section 4):'
  Write-Host "  $StartupCommand"
}

# 1. The environment: User scope first, else the process value; exported to every child.
#    Only names are ever printed, never a value (NFR5). The keeper runs this step too.
$Names = @(
  'TK_STUDIO_ROOT', 'TK_STUDIO_HOME', 'CLAUDE_BIN', 'SBX_BIN', 'CLAUDE_CONFIG_DIR',
  'TK_SUPERVISOR_DB', 'TK_SUPERVISOR_CONFIG', 'TK_SUPERVISOR_TRANSCRIPT_BACKUP',
  'TK_SUPERVISOR_BIND', 'TK_SUPERVISOR_PORT', 'TK_SUPERVISOR_TOKEN',
  'TK_SUPERVISOR_NOTIFY', 'TK_SUPERVISOR_NTFY_URL', 'TK_SUPERVISOR_TELEGRAM_TOKEN', 'TK_SUPERVISOR_TELEGRAM_CHAT',
  'TK_SUPERVISOR_WORK',
  'TK_SUPERVISOR_SESSION_SECRET', 'TK_SUPERVISOR_TLS_CERT', 'TK_SUPERVISOR_TLS_KEY', 'TK_SUPERVISOR_TLS_NAME',
  'TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_ID', 'TK_SUPERVISOR_OAUTH_GOOGLE_CLIENT_SECRET', 'TK_SUPERVISOR_OAUTH_GOOGLE_ALLOW',
  'TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_ID', 'TK_SUPERVISOR_OAUTH_GITHUB_CLIENT_SECRET', 'TK_SUPERVISOR_OAUTH_GITHUB_ALLOW'
)

function Import-SupervisorVariable {
  param([Parameter(Mandatory)][string]$Name)
  $value = [Environment]::GetEnvironmentVariable($Name, 'User')
  if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($Name, 'Process') }
  if ([string]::IsNullOrWhiteSpace($value)) { return $false }
  [Environment]::SetEnvironmentVariable($Name, $value, 'Process')
  return $true
}

$Present = @{}
foreach ($name in $Names) { $Present[$name] = Import-SupervisorVariable -Name $name }

$Missing = @('TK_SUPERVISOR_BIND', 'TK_SUPERVISOR_TOKEN', 'TK_SUPERVISOR_SESSION_SECRET') | Where-Object { -not $Present[$_] }
if ($Missing) {
  throw "[supervisor] cannot start: $($Missing -join ', ') not set in the User environment (setx <name> <value>, then open a new tab)"
}
if (-not $ServeOnly -and -not $Present['TK_SUPERVISOR_TRANSCRIPT_BACKUP']) {
  Write-Warning '[supervisor] TK_SUPERVISOR_TRANSCRIPT_BACKUP is not set: per-run transcript copies are skipped, and a host resume cannot restore a missing transcript'
}

$Bun = (Get-Command bun -ErrorAction Stop).Source
Set-Location -LiteralPath $Repo

# Story 22.5: with all three TLS variables set, renew the Tailscale certificate for the MagicDNS name
# (90 days) into the files `serve` reads, before the keeper starts. Bounded; a failure (or no
# `tailscale` on PATH) is a warning and `serve` uses the files as they are. Names only are printed.
# Story 27.5 (DW-21): one function, shared by the main script and the keeper (which runs it when `serve`
# exits 75: the certificate is within 14 days of expiry and no run is live).
$CertSeconds = 120
$TlsNames = @('TK_SUPERVISOR_TLS_CERT', 'TK_SUPERVISOR_TLS_KEY', 'TK_SUPERVISOR_TLS_NAME')
function Invoke-TailscaleCert {
  $Tailscale = Get-Command tailscale -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $Tailscale) {
    Write-Warning '[supervisor] tailscale not found: the certificate in TK_SUPERVISOR_TLS_CERT/TK_SUPERVISOR_TLS_KEY is not renewed'
    return
  }
  Write-Host '[supervisor] tailscale cert (renews the certificate named by TK_SUPERVISOR_TLS_CERT/TK_SUPERVISOR_TLS_KEY/TK_SUPERVISOR_TLS_NAME)'
  try {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($Tailscale.Source)
    foreach ($arg in @('cert', '--cert-file', $env:TK_SUPERVISOR_TLS_CERT, '--key-file', $env:TK_SUPERVISOR_TLS_KEY, $env:TK_SUPERVISOR_TLS_NAME)) { $psi.ArgumentList.Add($arg) }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $cert = [System.Diagnostics.Process]::Start($psi)
    try {
      $cert.BeginOutputReadLine()
      $cert.BeginErrorReadLine()
      if (-not $cert.WaitForExit($CertSeconds * 1000)) {
        try { $cert.Kill() } catch { } # only this process (its known pid)
        Write-Warning "[supervisor] tailscale cert gave no answer within $CertSeconds s: the certificate is not renewed"
      } elseif ($cert.ExitCode -ne 0) {
        Write-Warning "[supervisor] tailscale cert exited $($cert.ExitCode): the certificate is not renewed (is HTTPS enabled in the Tailscale admin console?)"
      }
    } finally { $cert.Dispose() }
  } catch {
    Write-Warning "[supervisor] tailscale cert did not run: the certificate is not renewed"
  }
}
$TlsPresent = -not ($TlsNames | Where-Object { -not $Present[$_] })
if (-not $ServeOnly -and $TlsPresent) {
  Invoke-TailscaleCert
}

# Retries with a back-off: 5 s after the first failure, doubling to at most 600 s. The keeper sleeps
# it out; this script checks it once per pacer pass (so a retry waits for the next pass at the earliest).
function New-Backoff { return @{ Failures = 0; NextAt = [datetime]::MinValue } }
function Register-Failure {
  param([Parameter(Mandatory)][hashtable]$Backoff)
  $Backoff.Failures++
  $delay = [math]::Min(600, 5 * [math]::Pow(2, $Backoff.Failures - 1))
  $Backoff.NextAt = (Get-Date).AddSeconds($delay)
  return [int]$delay
}
function Test-Due {
  param([Parameter(Mandatory)][hashtable]$Backoff)
  return (Get-Date) -ge $Backoff.NextAt
}

# 2 (the keeper, -ServeOnly). `serve` (the API) in the foreground of this console, restarted with
#    the back-off whenever it exits; a serve that stayed up $ServeUpSeconds resets the back-off (its
#    next failure waits 5 s again). Right after logon Tailscale may not have bound its 100.x address
#    yet, so a first bind can fail: a warning, never the end of the keeper.
if ($ServeOnly) {
  $ServeUpSeconds = 60
  $ServeBackoff = New-Backoff
  while ($true) {
    Write-Host '[supervisor] serve (the API)'
    $started = Get-Date
    try {
      & $Bun src/cli.ts serve
      $code = $LASTEXITCODE
    } catch {
      $code = "no exit code ($($_.Exception.Message))"
    }
    if (((Get-Date) - $started).TotalSeconds -ge $ServeUpSeconds) { $ServeBackoff.Failures = 0 }
    # Story 27.5 (DW-21): exit 75 is serve asking for a certificate renewal (within 14 days of expiry, no live
    # run): the same bounded `tailscale cert`, then serve restarted at once, without the back-off.
    if ($code -eq 75) {
      Write-Host '[supervisor] serve asked for a certificate renewal (exit 75): tailscale cert, then serve restarts at once'
      if ($TlsPresent) { Invoke-TailscaleCert }
      continue
    }
    $delay = Register-Failure -Backoff $ServeBackoff
    Write-Warning "[supervisor] serve exited ${code} (right after logon Tailscale may not have bound its 100.x address yet): the API is down, restarting it in ${delay} s (the pacer keeps running)"
    Start-Sleep -Seconds $delay
  }
}

# 2. The API keeper, in this console: started before the sbx probe and recover so /status answers
#    while recover, tick and drain drive runs. A failure warns and is retried later; it never ends
#    the script. Never hidden: it shares this console tab.
$KeeperBackoff = New-Backoff
function Start-SupervisorKeeper {
  Write-Host '[supervisor] the API keeper (serve, restarted with a back-off)'
  try {
    # The script path is quoted: Start-Process joins -ArgumentList with spaces, unquoted.
    $proc = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-File', "`"$Self`"", '-ServeOnly') -WorkingDirectory $Repo -NoNewWindow -PassThru
    $null = $proc.Handle # cached now, so ExitCode is readable once it exits
    return $proc
  } catch {
    $delay = Register-Failure -Backoff $KeeperBackoff
    Write-Warning "[supervisor] the API keeper did not start: $($_.Exception.Message); the API is down, retrying in ${delay} s or more (the pacer keeps running)"
    return $null
  }
}

# Stops only the keeper this script started (its known pid) and the tree under it (its serve),
# never by name.
function Stop-SupervisorKeeper {
  param($Keeper)
  if (-not $Keeper -or $Keeper.HasExited) { return }
  try { $Keeper.Kill($true) } catch { Write-Warning "[supervisor] the API keeper did not stop: $($_.Exception.Message)" }
}

# 3. The Docker Sandboxes daemon: a read-only listing answers whether it runs. It is bounded: a
#    half-started daemon can leave `sbx ls` blocked instead of exiting non-zero. Its output is
#    discarded (read and dropped, so a full pipe never blocks it).
$SbxProbeSeconds = 30
function Test-SbxDaemon {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($Path, 'ls')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $probe = [System.Diagnostics.Process]::Start($psi)
  } catch {
    Write-Warning "[supervisor] sbx ls did not run: $($_.Exception.Message)"
    return $false
  }
  try {
    $probe.BeginOutputReadLine()
    $probe.BeginErrorReadLine()
    if (-not $probe.WaitForExit($SbxProbeSeconds * 1000)) {
      try { $probe.Kill() } catch { } # only this probe (its known pid); it may have just exited
      Write-Warning "[supervisor] sbx ls gave no answer within $SbxProbeSeconds s: taking the daemon as not running"
      return $false
    }
    # No parameterless WaitForExit: it would wait for the output's end, which a daemon the probe
    # started could hold open.
    return $probe.ExitCode -eq 0
  } finally { $probe.Dispose() }
}

# 4. The restart rule with resumes: one pass is attempted before the pacer's first tick. A failure
#    warns and the pacer still starts; recover is retried with a back-off on later passes (every tick
#    also recovers at its own start). Its output goes to the console, so the function answers only
#    the boolean.
$RecoverBackoff = New-Backoff
function Invoke-SupervisorRecover {
  Write-Host '[supervisor] recover (the restart rule with resumes)'
  try {
    & $Bun src/cli.ts recover | Out-Host
    $code = $LASTEXITCODE
  } catch {
    $code = "no exit code ($($_.Exception.Message))"
  }
  if ($code -eq 0) { return $true }
  $delay = Register-Failure -Backoff $RecoverBackoff
  Write-Warning "[supervisor] recover exited ${code}: retrying in ${delay} s or more (every tick also recovers at its start)"
  return $false
}

# One pacer step (tick or drain): a failure warns; it never stops the pacer. Its output goes to the
# console, never into the function's output.
function Invoke-PacerStep {
  param([Parameter(Mandatory)][string[]]$Arguments)
  try {
    & $Bun @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Warning "[supervisor] $($Arguments -join ' ') exited $LASTEXITCODE" }
  } catch {
    Write-Warning "[supervisor] $($Arguments -join ' ') did not run: $($_.Exception.Message)"
  }
}

$Keeper = Start-SupervisorKeeper
try {
  $Sbx = if ($Present['SBX_BIN']) { $env:SBX_BIN } else { 'sbx' }
  $SbxCommand = Get-Command $Sbx -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($SbxCommand) {
    if (-not (Test-SbxDaemon -Path $SbxCommand.Source)) {
      Write-Host '[supervisor] the sbx daemon is not running: starting it from $HOME'
      Push-Location -LiteralPath $HOME
      try {
        & $Sbx daemon start -d
        if ($LASTEXITCODE -ne 0) { Write-Warning "[supervisor] sbx daemon start exited ${LASTEXITCODE}: sbx-tier runs will fail until it runs" }
      } finally { Pop-Location }
    } else {
      Write-Host '[supervisor] the sbx daemon is running'
    }
  } else {
    Write-Warning "[supervisor] $Sbx not found: sbx-tier runs will fail (host-tier runs are unaffected)"
  }

  $Recovered = Invoke-SupervisorRecover

  # 5. The pacer, in the foreground: tick, then drain (API-submitted runs), then sleep.
  Write-Host "[supervisor] pacer every $IntervalSeconds s (Ctrl+C stops the supervisor)"
  while ($true) {
    if ($Keeper -and $Keeper.HasExited) {
      $delay = Register-Failure -Backoff $KeeperBackoff
      Write-Warning "[supervisor] the API keeper exited $($Keeper.ExitCode): restarting it in ${delay} s or more"
      $Keeper = $null
    }
    if (-not $Keeper -and (Test-Due -Backoff $KeeperBackoff)) { $Keeper = Start-SupervisorKeeper }
    if (-not $Recovered -and (Test-Due -Backoff $RecoverBackoff)) { $Recovered = Invoke-SupervisorRecover }
    Invoke-PacerStep -Arguments @('src/tick.ts')
    Invoke-PacerStep -Arguments @('src/cli.ts', 'drain')
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  Stop-SupervisorKeeper -Keeper $Keeper
}
