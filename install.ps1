param(
  [string]$Version = 'latest',
  [string]$BinDirectory,
  [string]$DataDirectory,
  [switch]$NoPathUpdate
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repository = 'https://github.com/Maitham16/UR'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $env:PROCESSOR_ARCHITEW6432) { throw 'Native Windows releases currently support x64 Windows only. Run this installer from native 64-bit PowerShell.' }
if ($Version -in @('latest', 'stable')) {
  $Release = Invoke-RestMethod -Uri 'https://api.github.com/repos/Maitham16/UR/releases/latest' -Headers @{Accept='application/vnd.github+json'}
  if ($Release.draft -or $Release.prerelease) { throw 'Invalid stable release response' }
  $Version = $Release.tag_name -replace '^v', ''
} else { $Version = $Version -replace '^v', '' }
if ($Version -cnotmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$' -or $Version.Length -gt 100) { throw 'Invalid native release version' }
$Platform = 'win32-x64'
$File = "ur-$Version-$Platform.zip"
$Url = "$Repository/releases/download/v$Version"
$Manifest = Invoke-RestMethod -Uri "$Url/manifest.json"
if ($Manifest.schemaVersion -ne 1 -or $Manifest.version -cne $Version -or $Manifest.sourceCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'Invalid native release manifest' }
$Artifact = $Manifest.platforms.$Platform
if (!$Artifact -or $Artifact.file -cne $File -or $Artifact.executable -cne 'ur.exe' -or $Artifact.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $Artifact.size -lt 1 -or $Artifact.size -gt 1073741824) { throw 'Invalid Windows release artifact' }
$DataRoot = if ($DataDirectory) { [IO.Path]::GetFullPath($DataDirectory) } elseif ($env:XDG_DATA_HOME) { Join-Path $env:XDG_DATA_HOME 'ur' } else { Join-Path $HOME '.local/share/ur' }
$Versions = Join-Path $DataRoot 'versions'
$Bin = if ($BinDirectory) { [IO.Path]::GetFullPath($BinDirectory) } else { Join-Path $HOME '.local/bin' }
New-Item -ItemType Directory -Force -Path $Versions,$Bin | Out-Null
foreach ($Name in @('ur.exe','ur.ps1')) { if (Test-Path -LiteralPath (Join-Path $Bin $Name)) { throw "Existing $(Join-Path $Bin $Name) would hide the native launcher. Move that previous installation aside and retry." } }
$Lock = Join-Path $Versions '.install-lock'
try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null } catch { throw "Another native installation is active. If no installer is running, remove $Lock and retry." }
$Staging = Join-Path $Versions ('.bootstrap-' + [guid]::NewGuid())
$Temporary = Join-Path $Bin ('.ur-install-' + [guid]::NewGuid() + '.cmd')
function Test-VerifiedRelease([string]$Directory) {
  $Candidate = Join-Path $Directory 'ur.exe'
  if (!(Test-Path -LiteralPath $Candidate) -or !(Test-Path -LiteralPath (Join-Path $Directory 'resources/manifest.json'))) { return $false }
  try {
    if ((& $Candidate --version) -cne "$Version (UR-Nexus)" -or $LASTEXITCODE -ne 0) { return $false }
    $Report = (& $Candidate --ur-native-self-test) | ConvertFrom-Json
    return ($LASTEXITCODE -eq 0 -and $Report.passed -eq $true)
  } catch { return $false }
}
try {
  [IO.File]::WriteAllText((Join-Path $Lock 'owner.pid'), "$PID`n")
  $Destination = Join-Path $Versions "$Version-$Platform"
  $Launcher = Join-Path $Bin 'ur.cmd'
  $Cached = $false
  if (Test-Path -LiteralPath $Launcher) {
    $LauncherText = [IO.File]::ReadAllText($Launcher)
    if ($LauncherText -match '(?m)^"([^"\r\n]+)" %\*\r?$') {
      $Active = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Matches[1].Replace('%%','%')))
      $ActiveName = [IO.Path]::GetFileName($Active)
      if ([IO.Path]::GetDirectoryName($Active) -ieq $Versions -and ($ActiveName -ceq "$Version-$Platform" -or $ActiveName.StartsWith("$Version-$Platform-repair-"))) {
        if (Test-VerifiedRelease $Active) { $Destination = $Active; $Cached = $true }
      }
    }
  }
  if (!$Cached) { $Cached = Test-VerifiedRelease $Destination }
  if (!$Cached) {
    New-Item -ItemType Directory -Path $Staging | Out-Null
  $Archive = Join-Path $Staging $File
  Invoke-WebRequest -UseBasicParsing -Uri "$Url/$File" -OutFile $Archive
  if ((Get-Item $Archive).Length -ne $Artifact.size -or (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant() -cne $Artifact.sha256) { throw 'Native release checksum or size mismatch' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $Expanded = 0L
    foreach ($Entry in $Zip.Entries) {
      $Name = $Entry.FullName.Replace('\','/').TrimEnd('/')
      if (!$Name -or $Name -cmatch '(^/|^[A-Za-z]:|(^|/)\.\.?(/|$)|//|:)' -or ($Name -cne 'ur.exe' -and $Name -cne 'resources' -and !$Name.StartsWith('resources/')) -or (($Entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw "Unsafe native archive entry: $Name" }
      $Expanded += $Entry.Length
      if ($Expanded -gt 2147483648) { throw 'Native release exceeds extraction limit' }
    }
  } finally { $Zip.Dispose() }
  $Extracted = Join-Path $Staging 'release'
  Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted
  $StagedExecutable = Join-Path $Extracted 'ur.exe'
  if (!(Test-Path -LiteralPath (Join-Path $Extracted 'resources/manifest.json'))) { throw 'Release resources are missing' }
  if ((& $StagedExecutable --version) -cne "$Version (UR-Nexus)" -or $LASTEXITCODE -ne 0) { throw 'Downloaded executable failed version check' }
  $SelfTest = (& $StagedExecutable --ur-native-self-test) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $SelfTest.passed -ne $true) { throw 'Downloaded executable failed resource verification' }
    if (Test-Path -LiteralPath $Destination) { $Destination = Join-Path $Versions ("$Version-$Platform-repair-" + [guid]::NewGuid()) }
    Move-Item -LiteralPath $Extracted -Destination $Destination
  }
  $Executable = Join-Path $Destination 'ur.exe'
  if ($Executable -match '["\r\n]') { throw 'Unsupported installation path' }
  [IO.File]::WriteAllText($Temporary, "@echo off`r`n@setlocal DisableDelayedExpansion`r`n@`"%SystemRoot%\System32\chcp.com`" 65001 >nul`r`n`"$($Executable.Replace('%','%%'))`" %*`r`n", (New-Object Text.UTF8Encoding($false)))
  # Rename into place only after the complete immutable release passes validation.
  $Launcher = Join-Path $Bin 'ur.cmd'
  if (Test-Path -LiteralPath $Launcher) { [IO.File]::Replace($Temporary, $Launcher, $null) } else { [IO.File]::Move($Temporary, $Launcher) }
  if (!$NoPathUpdate) {
    $UserPath = [Environment]::GetEnvironmentVariable('Path','User')
    if (!($UserPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $Bin.TrimEnd('\') })) { [Environment]::SetEnvironmentVariable('Path', "$Bin;$UserPath", 'User') }
  }
  Write-Host "Installed UR-Nexus $Version. Open a new terminal and run ur."
} finally {
  Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue
}
