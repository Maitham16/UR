$ErrorActionPreference = 'Stop'
$Launcher = Join-Path $HOME '.local/bin/ur.cmd'
$DataRoot = if ($env:XDG_DATA_HOME) { Join-Path $env:XDG_DATA_HOME 'ur' } else { Join-Path $HOME '.local/share/ur' }
if (Test-Path -LiteralPath $Launcher) {
  $Content = [IO.File]::ReadAllText($Launcher)
  if (!$Content.Contains((Join-Path $DataRoot 'versions'))) { throw 'Launcher is owned by another installation; leaving it unchanged.' }
  Remove-Item -LiteralPath $Launcher
}
Write-Host 'Native launcher removed. Configuration, sessions and version directories are preserved.'
Write-Host "After closing every UR process, remove application versions at $DataRoot\versions."
