param([string]$BinDirectory, [string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$Bin = if ($BinDirectory) { [IO.Path]::GetFullPath($BinDirectory) } else { Join-Path $HOME '.local/bin' }
$Launcher = Join-Path $Bin 'ur.cmd'
$DataRoot = if ($DataDirectory) { [IO.Path]::GetFullPath($DataDirectory) } elseif ($env:XDG_DATA_HOME) { Join-Path $env:XDG_DATA_HOME 'ur' } else { Join-Path $HOME '.local/share/ur' }
$Versions = [IO.Path]::GetFullPath((Join-Path $DataRoot 'versions')).TrimEnd('\')
$NativeShim = Join-Path $Bin 'ur.exe'
$NativeShimOwner = Join-Path $Bin '.ur-native-launcher-v1.sha256'
$ShimExists = Test-Path -LiteralPath $NativeShim
$OwnerExists = Test-Path -LiteralPath $NativeShimOwner
if ($ShimExists -or $OwnerExists) {
  if (!$ShimExists -or !$OwnerExists) { throw 'Native launcher has no matching ownership record; leaving it unchanged.' }
  foreach ($Path in @($NativeShim,$NativeShimOwner)) {
    $Item = Get-Item -LiteralPath $Path -Force
    if ($Item.PSIsContainer -or ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Native launcher is not a regular managed file; leaving it unchanged.' }
  }
  $Ownership = [regex]::Match([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($NativeShimOwner)), '\AUR-Nexus native launcher v1\n([a-f0-9]{64})\n\z')
  if (!$Ownership.Success -or (Get-FileHash -LiteralPath $NativeShim -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Ownership.Groups[1].Value) { throw 'Native launcher does not match its ownership record; leaving it unchanged.' }
}
if (Test-Path -LiteralPath $Launcher) {
  $Content = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($Launcher))
  $Targets = [regex]::Matches($Content, '(?m)^"([^"\r\n]+)" %\*\r?$')
  $BinTargets = [regex]::Matches($Content, '(?m)^@set "UR_NATIVE_BIN_DIR=([^"\r\n]+)"\r?$')
  $DataTargets = [regex]::Matches($Content, '(?m)^@set "UR_NATIVE_DATA_DIR=([^"\r\n]+)"\r?$')
  $Managed = $false
  if ($Targets.Count -eq 1 -and $BinTargets.Count -eq 1 -and $DataTargets.Count -eq 1) {
    try {
      $EncodedTarget = $Targets[0].Groups[1].Value
      $DecodedTarget = $EncodedTarget.Replace('%%','%')
      $EncodedBin = $BinTargets[0].Groups[1].Value
      $DecodedBin = $EncodedBin.Replace('%%','%')
      $EncodedData = $DataTargets[0].Groups[1].Value
      $DecodedData = $EncodedData.Replace('%%','%')
      $Executable = [IO.Path]::GetFullPath($DecodedTarget)
      $ReleaseDirectory = [IO.Path]::GetDirectoryName($Executable)
      $ExpectedContent = "@echo off`r`n@setlocal DisableDelayedExpansion`r`n@`"%SystemRoot%\System32\chcp.com`" 65001 >nul`r`n@set `"UR_NATIVE_BIN_DIR=$EncodedBin`"`r`n@set `"UR_NATIVE_DATA_DIR=$EncodedData`"`r`n`"$EncodedTarget`" %*`r`n"
      $Managed = ($DecodedTarget.Replace('%','%%') -ceq $EncodedTarget -and
        $DecodedBin.Replace('%','%%') -ceq $EncodedBin -and
        $DecodedData.Replace('%','%%') -ceq $EncodedData -and
        [IO.Path]::GetFullPath($DecodedBin).TrimEnd('\') -ieq [IO.Path]::GetFullPath($Bin).TrimEnd('\') -and
        [IO.Path]::GetFullPath($DecodedData).TrimEnd('\') -ieq [IO.Path]::GetFullPath($DataRoot).TrimEnd('\') -and
        [IO.Path]::GetFileName($Executable) -ceq 'ur.exe' -and
        [IO.Path]::GetDirectoryName($ReleaseDirectory) -ieq $Versions -and
        $Content -ceq $ExpectedContent)
    } catch { $Managed = $false }
  }
  if (!$Managed) { throw 'Launcher is owned by another installation; leaving it unchanged.' }
}
function Remove-ManagedLauncherFile {
  param([string]$Path)
  $Timer = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    try { [IO.File]::Delete($Path); return } catch {
      $Exception = $_.Exception
      while ($Exception.InnerException) { $Exception = $Exception.InnerException }
      $Code = $Exception.HResult -band 65535
      if ($Code -notin @(5,32,33) -or $Timer.ElapsedMilliseconds -ge 15000) { throw }
      Start-Sleep -Milliseconds 100
    }
  }
}
# Verify every owned file before removing any launcher. A running console shim
# may retain its image, so fail while the activation and ownership files remain.
if ($ShimExists) { Remove-ManagedLauncherFile $NativeShim }
if (Test-Path -LiteralPath $Launcher) { Remove-ManagedLauncherFile $Launcher }
if ($OwnerExists) { Remove-ManagedLauncherFile $NativeShimOwner }
Write-Host 'Native launcher removed. Configuration, sessions and version directories are preserved.'
Write-Host "After closing every UR process, remove application versions at $DataRoot\versions."
