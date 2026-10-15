<#
.SYNOPSIS
  tk-studio bootstrap (AD-21, Story 25.4): installs the pinned uv and the tk-studio meta-CLI.

.DESCRIPTION
  Re-running it is the update. It:
    1. installs the pinned uv (version and SHA-256 embedded below) unmanaged into
       %LOCALAPPDATA%\tk-studio\tools\uv-<version>\ (no install receipt, so `uv self update` is off)
    2. reads the roster (-Roster / TK_STUDIO_ROSTER, else the channel's file on main) and takes
       components.cli; no cli entry refuses with CliNotShipped
    3. downloads the meta-CLI wheel, verifies its SHA-256 against the roster, then runs
       `uv tool install --force <wheel>` with UV_TOOL_BIN_DIR=<root>\bin
    4. puts only <root>\bin on the User PATH (idempotent; %VAR% entries are kept unexpanded)
    5. turns on long paths for git (git config --global core.longpaths true)
  It never clones a repository and never resolves a "latest" release: every download is pinned.
  Then run: tk-studio install

  Two ways to run it:
    irm <url>/install.ps1 | iex       channel / roster from TK_STUDIO_CHANNEL / TK_STUDIO_ROSTER;
                                      a refusal throws "<Name>: <detail>" and leaves the window open
    pwsh -File install.ps1 [-Channel stable|latest] [-Roster <path|url>]
                                      a refusal prints "<Name>: <detail>" and exits 1
  Everything runs inside one script block, so no variable, StrictMode or preference leaks into
  the calling session; only $env:Path gains <root>\bin.

.PARAMETER Channel
  stable (default) or latest. Also read from TK_STUDIO_CHANNEL.

.PARAMETER Roster
  A roster path or https URL overriding the channel's. Also read from TK_STUDIO_ROSTER.
#>

& {
  param([object[]]$Argv, [string]$CommandPath, $Invocation)

  # Run as a file (-File, or .\install.ps1): a refusal exits 1. Through iex: it throws, so the
  # user's window stays open. Decided before StrictMode (MyCommand may have no Path property).
  $AsFile = $false
  try {
    $AsFile = [bool]$CommandPath -and [string]$Invocation.MyCommand.Path -eq $CommandPath `
      -and [string]$Invocation.Line -notmatch '\biex\b|Invoke-Expression'
  } catch { $AsFile = $false }

  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  $UvVersion = '0.13.1'
  $UvTarget  = 'x86_64-pc-windows-msvc'
  $UvSha256  = '3b2661a463a5baea7f5076ea2b25ab71d77f36a6c0d809e5350651792f80a672'

  function Stop-Bootstrap([string]$Name, [string]$Detail) {
    throw "${Name}: $Detail"
  }

  function Get-Verified([string]$Url, [string]$Sha256, [string]$OutFile) {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
    $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutFile).Hash.ToLowerInvariant()
    if ($got -ne $Sha256) {
      Remove-Item -LiteralPath $OutFile -Force
      Stop-Bootstrap 'DigestMismatch' "$Url sha256 $got != pinned $Sha256"
    }
  }

  function Send-SettingChange {
    # WM_SETTINGCHANGE "Environment", as [Environment]::SetEnvironmentVariable(..., 'User') does
    if (-not ('TkStudio.Native' -as [type])) {
      Add-Type -Namespace TkStudio -Name Native -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
  uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    }
    $result = [UIntPtr]::Zero
    [void][TkStudio.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
  }

  function Invoke-Bootstrap([object[]]$Argv) {
    $Channel = if ($env:TK_STUDIO_CHANNEL) { $env:TK_STUDIO_CHANNEL } else { 'stable' }
    $Roster = $env:TK_STUDIO_ROSTER
    $rest = @($Argv | Where-Object { $null -ne $_ })
    for ($i = 0; $i -lt $rest.Count; $i++) {
      $name = [string]$rest[$i]
      if ($name -in @('-Channel', '-Roster')) {
        if ($i + 1 -ge $rest.Count) { Stop-Bootstrap 'UsageError' "$name needs a value" }
        $i++
        if ($name -eq '-Channel') { $Channel = [string]$rest[$i] } else { $Roster = [string]$rest[$i] }
      } else {
        Stop-Bootstrap 'UsageError' "unknown argument $name (use -Channel stable|latest, -Roster PATH|URL)"
      }
    }

    if ($Channel -notin @('stable', 'latest')) { Stop-Bootstrap 'UsageError' "channel '$Channel' is not stable or latest" }
    if (-not $env:LOCALAPPDATA) { Stop-Bootstrap 'NoDataRoot' 'LOCALAPPDATA is not set' }

    $Root  = Join-Path $env:LOCALAPPDATA 'tk-studio'
    $Bin   = Join-Path $Root 'bin'
    $Tools = Join-Path $Root 'tools'
    $UvDir = Join-Path $Tools "uv-$UvVersion"
    $Uv    = Join-Path $UvDir 'uv.exe'
    New-Item -ItemType Directory -Force $Bin, $Tools | Out-Null
    $Work = Join-Path $Tools ('.bootstrap-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $Work | Out-Null
    $savedToolBin = $env:UV_TOOL_BIN_DIR
    $savedToolDir = $env:UV_TOOL_DIR

    try {
      # 1. uv, pinned and unmanaged
      if (-not (Test-Path -LiteralPath $Uv)) {
        $zip = Join-Path $Work "uv-$UvTarget.zip"
        Get-Verified "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-$UvTarget.zip" $UvSha256 $zip
        $stage = Join-Path $Work 'uv'
        Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
        if (Test-Path -LiteralPath $UvDir) { Remove-Item -LiteralPath $UvDir -Recurse -Force }
        Move-Item -LiteralPath $stage -Destination $UvDir
      }
      Write-Host "uv $UvVersion at $Uv"

      # 2. the roster's cli entry
      if (-not $Roster) {
        $Roster = "https://raw.githubusercontent.com/thkennedy/tk-studio/main/tools/installer/rosters/$Channel.json"
      }
      if ($Roster -match '^https://') {
        $rosterText = (Invoke-WebRequest -UseBasicParsing -Uri $Roster).Content
      } else {
        $rosterText = Get-Content -LiteralPath $Roster -Raw -Encoding utf8
      }
      $rosterData = $rosterText | ConvertFrom-Json
      $cli = $rosterData.components.PSObject.Properties['cli']
      if (-not $cli) { Stop-Bootstrap 'CliNotShipped' "$Roster has no components.cli: no meta-CLI release in this channel yet" }
      $WheelUrl = [string]$cli.Value.url
      $WheelSha = [string]$cli.Value.sha256
      if ($WheelUrl -notmatch '^https://github\.com/[^/]+/[^/]+/releases/download/cli--v[0-9.]+/[^/]+\.whl$') {
        Stop-Bootstrap 'RosterInvalid' "components.cli.url '$WheelUrl' is not a cli--v release wheel"
      }

      # 3. the wheel: verified, then installed
      $wheelDir = Join-Path $Tools 'wheels'
      New-Item -ItemType Directory -Force $wheelDir | Out-Null
      $wheel = Join-Path $wheelDir ($WheelUrl.Split('/')[-1])
      $download = Join-Path $Work ($WheelUrl.Split('/')[-1])
      Get-Verified $WheelUrl $WheelSha $download
      Move-Item -LiteralPath $download -Destination $wheel -Force
      $env:UV_TOOL_BIN_DIR = $Bin
      $env:UV_TOOL_DIR = Join-Path $Tools 'uv-tools'
      & $Uv tool install --force $wheel
      if ($LASTEXITCODE -ne 0) { Stop-Bootstrap 'CliInstallFailed' "uv tool install exited $LASTEXITCODE" }

      # 4. only <root>\bin on the User PATH. Read raw (DoNotExpandEnvironmentNames) and written back
      #    with the value's own kind, so %VAR% entries stay unexpanded.
      $envKey = Get-Item -LiteralPath 'HKCU:\Environment'
      $userPath = [string]$envKey.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
      $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
      if ($envKey.GetValueNames() -contains 'Path' -and
          $envKey.GetValueKind('Path') -eq [Microsoft.Win32.RegistryValueKind]::String) {
        $kind = [Microsoft.Win32.RegistryValueKind]::String
      }
      $entries = @($userPath.Split(';') | Where-Object { $_ })
      $present = @($entries | Where-Object {
          $_.TrimEnd('\') -eq $Bin -or [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -eq $Bin })
      if ($present.Count -eq 0) {
        [Microsoft.Win32.Registry]::SetValue('HKEY_CURRENT_USER\Environment', 'Path', ((@($entries) + $Bin) -join ';'), $kind)
        try {
          Send-SettingChange
          Write-Host "added $Bin to the User PATH (new terminals see it)"
        } catch {
          Write-Host "added $Bin to the User PATH (the change broadcast failed: terminals opened after the next sign-in see it)"
        }
      }
      if (($env:Path.Split(';')) -notcontains $Bin) { $env:Path = "$env:Path;$Bin" }

      # 5. long paths for git
      if (Get-Command git -ErrorAction SilentlyContinue) {
        git config --global core.longpaths true
        Write-Host 'git: core.longpaths true'
      } else {
        Write-Host 'git not found: core.longpaths not set (run: git config --global core.longpaths true once git is installed)'
      }
    } finally {
      $env:UV_TOOL_BIN_DIR = $savedToolBin
      $env:UV_TOOL_DIR = $savedToolDir
      Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host ''
    Write-Host 'tk-studio meta-CLI installed. Next: tk-studio install   (then: tk-studio status)'
  }

  if ($AsFile) {
    try {
      Invoke-Bootstrap $Argv
    } catch {
      [Console]::Error.WriteLine([string]$_.Exception.Message)
      exit 1
    }
  } else {
    Invoke-Bootstrap $Argv
  }
} $args $PSCommandPath $MyInvocation
