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
if (Test-Path -LiteralPath (Join-Path $Bin 'ur.ps1')) { throw "Existing $(Join-Path $Bin 'ur.ps1') would hide the native launcher. Move that previous installation aside and retry." }
$NativeShim = Join-Path $Bin 'ur.exe'
$NativeShimOwner = Join-Path $Bin '.ur-native-launcher-v1.sha256'
function Test-ManagedNativeShim {
  $ShimExists = Test-Path -LiteralPath $NativeShim
  $OwnerExists = Test-Path -LiteralPath $NativeShimOwner
  if (!$ShimExists -and !$OwnerExists) { return $false }
  if (!$ShimExists -or !$OwnerExists) { throw 'Existing native launcher has no matching ownership record; leaving it unchanged.' }
  foreach ($Path in @($NativeShim,$NativeShimOwner)) {
    $Item = Get-Item -LiteralPath $Path -Force
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Existing native launcher is not a regular managed file; leaving it unchanged.' }
  }
  $Owner = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($NativeShimOwner))
  $Ownership = [regex]::Match($Owner, '\AUR-Nexus native launcher v1\n([a-f0-9]{64})\n\z')
  if (!$Ownership.Success -or (Get-FileHash -LiteralPath $NativeShim -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Ownership.Groups[1].Value) { throw 'Existing native launcher does not match its ownership record; leaving it unchanged.' }
  return $true
}
$ExistingNativeShim = Test-ManagedNativeShim
$Lock = Join-Path $Versions '.install-lock'
try { New-Item -ItemType Directory -Path $Lock -ErrorAction Stop | Out-Null } catch { throw "Another native installation is active. If no installer is running, remove $Lock and retry." }
$Staging = Join-Path $Versions ('.bootstrap-' + [guid]::NewGuid())
$Temporary = Join-Path $Bin ('.ur-install-' + [guid]::NewGuid() + '.cmd')
$ShimTemporary = Join-Path $Bin ('.ur-shim-' + [guid]::NewGuid() + '.exe')
$OwnerTemporary = Join-Path $Bin ('.ur-shim-' + [guid]::NewGuid() + '.sha256')
$CreatedNativeShim = $false
$CreatedNativeShimOwner = $false
$Activated = $false
function Invoke-NativeInstallFileOperation {
  param([scriptblock]$Operation, [ValidateRange(0,15000)][int]$TimeoutMilliseconds = 15000)
  $Timer = [Diagnostics.Stopwatch]::StartNew()
  $FirstFailure = $null
  while ($true) {
    try { & $Operation; return } catch {
      $Exception = $_.Exception
      while ($Exception.InnerException) { $Exception = $Exception.InnerException }
      # Defender and indexers can briefly retain the verified executable or
      # launcher. Retry sharing/access locks only; preserve all other failures.
      $Code = $Exception.HResult -band 65535
      if (($Exception -isnot [IO.IOException] -and $Exception -isnot [UnauthorizedAccessException]) -or $Code -notin @(5,32,33)) { throw }
      if (!$FirstFailure) { $FirstFailure = $_ }
      $Remaining = $TimeoutMilliseconds - $Timer.ElapsedMilliseconds
      if ($Remaining -le 0) { throw $FirstFailure }
      Start-Sleep -Milliseconds ([Math]::Min(100, $Remaining))
    }
  }
}
function Stop-NativeVerificationProcess {
  param([Diagnostics.Process]$Process)
  try {
    if (!$Process.HasExited) {
      $KillInfo = New-Object Diagnostics.ProcessStartInfo
      $KillInfo.FileName = Join-Path $env:SystemRoot 'System32/taskkill.exe'
      $KillInfo.Arguments = '/PID ' + $Process.Id + ' /T /F'
      $KillInfo.UseShellExecute = $false
      $KillInfo.CreateNoWindow = $true
      $KillInfo.RedirectStandardOutput = $true
      $KillInfo.RedirectStandardError = $true
      $Killer = New-Object Diagnostics.Process
      $Killer.StartInfo = $KillInfo
      try {
        if ($Killer.Start()) {
          $KillOutput = $Killer.StandardOutput.ReadToEndAsync()
          $KillError = $Killer.StandardError.ReadToEndAsync()
          if (!$Killer.WaitForExit(5000)) { try { $Killer.Kill() } catch {} }
        }
      } finally { $Killer.Dispose() }
    }
  } catch {} finally {
    try { if (!$Process.HasExited) { $Process.Kill() }; [void]$Process.WaitForExit(5000) } catch {}
  }
}
function Invoke-NativeReleaseVerification {
  param([string]$Executable, [ValidateSet('--version','--ur-native-self-test')][string]$Argument)
  $StartInfo = New-Object Diagnostics.ProcessStartInfo
  $StartInfo.FileName = $Executable
  $StartInfo.Arguments = $Argument
  $StartInfo.UseShellExecute = $false
  $StartInfo.CreateNoWindow = $true
  $StartInfo.RedirectStandardOutput = $true
  $StartInfo.RedirectStandardError = $true
  $StartInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false, $true)
  $StartInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false, $true)
  $Process = New-Object Diagnostics.Process
  $Process.StartInfo = $StartInfo
  $Started = $false
  $Timer = [Diagnostics.Stopwatch]::StartNew()
  try {
    $Started = $Process.Start()
    if (!$Started) { throw 'Native verification process did not start' }
    # Read both pipes concurrently. PowerShell 5.1 native command discovery and
    # its automatic LASTEXITCODE are bypassed for literal installed paths.
    $OutputTask = $Process.StandardOutput.ReadToEndAsync()
    $ErrorTask = $Process.StandardError.ReadToEndAsync()
    $Remaining = [Math]::Max(0, 120000 - $Timer.ElapsedMilliseconds)
    if (!$Process.WaitForExit([int]$Remaining)) { throw 'Native verification exceeded its 120 second deadline' }
    $Remaining = [Math]::Max(0, 120000 - $Timer.ElapsedMilliseconds)
    if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($OutputTask,$ErrorTask), [int]$Remaining)) { throw 'Native verification output exceeded its 120 second deadline' }
    return [pscustomobject]@{ exitCode = $Process.ExitCode; stdout = $OutputTask.Result; stderr = $ErrorTask.Result }
  } catch { throw "Unable to verify native executable '$Executable' ($Argument): $($_.Exception.Message)" }
  finally {
    if ($Started) { Stop-NativeVerificationProcess $Process }
    $Process.Dispose()
  }
}
function Test-VerifiedRelease([string]$Directory) {
  $Candidate = Join-Path $Directory 'ur.exe'
  if (!(Test-Path -LiteralPath $Candidate) -or !(Test-Path -LiteralPath (Join-Path $Directory 'resources/manifest.json'))) { return $false }
  try {
    $VersionResult = Invoke-NativeReleaseVerification $Candidate '--version'
    $ActualVersion = $VersionResult.stdout -creplace '\r?\n\z',''
    if ($VersionResult.exitCode -ne 0 -or $ActualVersion -cne "$Version (UR-Nexus)") { return $false }
    $ResourceResult = Invoke-NativeReleaseVerification $Candidate '--ur-native-self-test'
    $Report = $ResourceResult.stdout | ConvertFrom-Json
    return ($ResourceResult.exitCode -eq 0 -and $Report.passed -is [bool] -and $Report.passed -eq $true)
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
  $Download = Invoke-WebRequest -UseBasicParsing -Uri "$Url/$File"
  $DownloadStream = $Download.RawContentStream
  $ArchiveStream = $null
  try {
    if ($DownloadStream -isnot [IO.Stream]) { throw 'Native download did not provide a binary response stream' }
    if ($DownloadStream.CanSeek) { $DownloadStream.Position = 0 }
    # Windows PowerShell 5.1's -OutFile expands wildcard path characters.
    # .NET file streams preserve the literal installation directory instead.
    $ArchiveStream = [IO.File]::Open($Archive, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $DownloadStream.CopyTo($ArchiveStream)
  } finally {
    if ($ArchiveStream) { $ArchiveStream.Dispose() }
    if ($DownloadStream -is [IO.Stream]) { $DownloadStream.Dispose() }
  }
  if ((Get-Item -LiteralPath $Archive).Length -ne $Artifact.size -or (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant() -cne $Artifact.sha256) { throw 'Native release checksum or size mismatch' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $Expanded = 0L
    foreach ($Entry in $Zip.Entries) {
      $Name = $Entry.FullName.Replace('\','/')
      if ($Name.EndsWith('/')) { $Name = $Name.Substring(0, $Name.Length - 1) }
      if (!$Name -or $Name -cmatch '(^/|^[A-Za-z]:|(^|/)\.\.?(/|$)|//|[\p{Cc}<>:"|?*])' -or ($Name -cne 'ur.exe' -and $Name -cne 'resources' -and !$Name.StartsWith('resources/')) -or (($Entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw "Unsafe native archive entry: $Name" }
      foreach ($Component in $Name.Split('/')) {
        $DeviceName = $Component.Split('.')[0].TrimEnd(' ')
        if (!$Component -or $Component -match '[. ]$' -or $DeviceName -match '^(?i:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])$') { throw "Unsafe native archive entry: $Name" }
      }
      $Expanded += $Entry.Length
      if ($Expanded -gt 2147483648) { throw 'Native release exceeds extraction limit' }
    }
  } finally { $Zip.Dispose() }
  $Extracted = Join-Path $Staging 'release'
  Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted
  $StagedExecutable = Join-Path $Extracted 'ur.exe'
  if (!(Test-Path -LiteralPath (Join-Path $Extracted 'resources/manifest.json'))) { throw 'Release resources are missing' }
  $VersionResult = Invoke-NativeReleaseVerification $StagedExecutable '--version'
  $ActualVersion = $VersionResult.stdout -creplace '\r?\n\z',''
  if ($VersionResult.exitCode -ne 0 -or $ActualVersion -cne "$Version (UR-Nexus)") {
    $VersionDiagnostics = @{ expected = "$Version (UR-Nexus)"; actual = $VersionResult.stdout; stderr = $VersionResult.stderr; exitCode = $VersionResult.exitCode; executable = $StagedExecutable } | ConvertTo-Json -Compress
    throw "Downloaded executable failed version check: $VersionDiagnostics"
  }
  $ResourceResult = Invoke-NativeReleaseVerification $StagedExecutable '--ur-native-self-test'
  try { $SelfTest = $ResourceResult.stdout | ConvertFrom-Json } catch { throw "Downloaded executable returned invalid resource verification JSON: $($ResourceResult | ConvertTo-Json -Compress)" }
  if ($ResourceResult.exitCode -ne 0 -or $SelfTest.passed -isnot [bool] -or $SelfTest.passed -ne $true) { throw "Downloaded executable failed resource verification: $($ResourceResult | ConvertTo-Json -Compress)" }
    if (Test-Path -LiteralPath $Destination) { $Destination = Join-Path $Versions ("$Version-$Platform-repair-" + [guid]::NewGuid()) }
    Invoke-NativeInstallFileOperation { Move-Item -LiteralPath $Extracted -Destination $Destination }
  }
  $Executable = Join-Path $Destination 'ur.exe'
  if ($Executable -match '["\r\n]') { throw 'Unsupported installation path' }
  # The immutable console shim avoids PowerShell's batch-file path expansion.
  # Only ur.cmd changes on updates, including when the shim is still running.
  $ShimSource = Join-Path $Destination 'resources/windows/ur-launcher.exe'
  if (!(Test-Path -LiteralPath $ShimSource -PathType Leaf)) { throw 'Release is missing its native Windows launcher' }
  if (!$ExistingNativeShim) {
    [IO.File]::Copy($ShimSource, $ShimTemporary, $false)
    $Owner = "UR-Nexus native launcher v1`n$((Get-FileHash -LiteralPath $ShimTemporary -Algorithm SHA256).Hash.ToLowerInvariant())`n"
    [IO.File]::WriteAllText($OwnerTemporary, $Owner, [Text.UTF8Encoding]::new($false))
    Invoke-NativeInstallFileOperation { [IO.File]::Move($OwnerTemporary, $NativeShimOwner) }
    $CreatedNativeShimOwner = $true
    Invoke-NativeInstallFileOperation { [IO.File]::Move($ShimTemporary, $NativeShim) }
    $CreatedNativeShim = $true
  }
  [IO.File]::WriteAllText($Temporary, "@echo off`r`n@setlocal DisableDelayedExpansion`r`n@`"%SystemRoot%\System32\chcp.com`" 65001 >nul`r`n@set `"UR_NATIVE_BIN_DIR=$($Bin.Replace('%','%%'))`"`r`n@set `"UR_NATIVE_DATA_DIR=$($DataRoot.Replace('%','%%'))`"`r`n`"$($Executable.Replace('%','%%'))`" %*`r`n", (New-Object Text.UTF8Encoding($false)))
  # Rename into place only after the complete immutable release passes validation.
  $Launcher = Join-Path $Bin 'ur.cmd'
  Invoke-NativeInstallFileOperation {
    # A plain PowerShell $null converts to an empty string for .NET string
    # arguments. File.Replace needs an actual CLR null for its backup filename.
    if (Test-Path -LiteralPath $Launcher) { [IO.File]::Replace($Temporary, $Launcher, [System.Management.Automation.Language.NullString]::Value) } else { [IO.File]::Move($Temporary, $Launcher) }
  }
  $Activated = $true
  if (!$NoPathUpdate) {
    $UserPath = [Environment]::GetEnvironmentVariable('Path','User')
    if (!($UserPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $Bin.TrimEnd('\') })) { [Environment]::SetEnvironmentVariable('Path', "$Bin;$UserPath", 'User') }
  }
  Write-Host "Installed UR-Nexus $Version. Open a new terminal and run ur."
} finally {
  try {
    $CleanupPaths = @($Staging,$Temporary,$ShimTemporary,$OwnerTemporary)
    if (!$Activated) {
      if ($CreatedNativeShim) { $CleanupPaths += $NativeShim }
      if ($CreatedNativeShimOwner) { $CleanupPaths += $NativeShimOwner }
    }
    foreach ($CleanupPath in $CleanupPaths) {
      try {
        Invoke-NativeInstallFileOperation {
          if (Test-Path -LiteralPath $CleanupPath) { Remove-Item -LiteralPath $CleanupPath -Recurse -Force -ErrorAction Stop }
        }
      } catch { Write-Warning -WarningAction Continue "Temporary installer files remain at $CleanupPath : $($_.Exception.Message)" }
    }
  } finally { Remove-Item -LiteralPath $Lock -Recurse -Force -ErrorAction SilentlyContinue }
}
