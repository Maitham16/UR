# Standalone capture only. No installation, downloads, provider calls, or release qualification.
$ErrorActionPreference = 'Stop'
$Repository = Split-Path -Parent $PSScriptRoot
$Artifacts = Join-Path $Repository 'artifacts/windows-launcher-diagnostics'
[IO.Directory]::CreateDirectory($Artifacts) | Out-Null
$Control = Join-Path $env:RUNNER_TEMP ('ur-cmd-diagnostic-' + [guid]::NewGuid())
$Special = Join-Path $Control ('100% User %UR_NATIVE_FIXTURE% [caf' + [char]0xE9 + '!]')
$Bin = Join-Path $Special 'application bin'
$DataRoot = Join-Path $Special 'application data'
$Executable = Join-Path $DataRoot 'versions/fixture/ur.exe'
foreach ($Directory in @($Control,$Bin,[IO.Path]::GetDirectoryName($Executable))) { [IO.Directory]::CreateDirectory($Directory) | Out-Null }
$Version = ([IO.File]::ReadAllText((Join-Path $Repository 'package.json')) | ConvertFrom-Json).version
$Fixture = Join-Path $Control 'fixture.ts'
$FixtureSource = @'
import { writeFileSync } from 'node:fs';
if (process.env.UR_DIAG_ARGV_FILE) writeFileSync(process.env.UR_DIAG_ARGV_FILE, JSON.stringify({argv:process.argv,execPath:process.execPath,cwd:process.cwd(),nativeBin:process.env.UR_NATIVE_BIN_DIR,nativeData:process.env.UR_NATIVE_DATA_DIR}));
console.log(process.argv.includes('--version') ? __UR_DIAGNOSTIC_VERSION__ + ' (UR-Nexus)' : JSON.stringify(process.argv));
'@
[IO.File]::WriteAllText($Fixture, $FixtureSource.Replace('__UR_DIAGNOSTIC_VERSION__', ($Version | ConvertTo-Json -Compress)), [Text.UTF8Encoding]::new($false))
$AsciiExecutable = Join-Path $Control 'fixture.exe'
$BuildOutput = & $env:UR_DIAG_BUN build $Fixture --compile --outfile $AsciiExecutable 2>&1
if ($LASTEXITCODE -ne 0) { throw "Tiny fixture compilation failed: $BuildOutput" }
[IO.File]::Copy($AsciiExecutable,$Executable)

# Execute only the exact batch-writing AST from the installer, with fixture paths.
$ParseErrors = $null
$InstallAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $Repository 'install.ps1'), [ref]$null, [ref]$ParseErrors)
if ($ParseErrors.Count) { throw "Installer parsing failed: $ParseErrors" }
$Template = $InstallAst.Find({ param($Node)
  $Node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and
  $Node.Member.Extent.Text -eq 'WriteAllText' -and $Node.Arguments.Count -eq 3 -and
  $Node.Arguments[0].Extent.Text -eq '$Temporary'
}, $true)
if (!$Template) { throw 'Exact installer launcher template was not found' }
$Managed = Join-Path $Bin 'ur.cmd'
$Temporary = $Managed
. ([ScriptBlock]::Create($Template.Extent.Text))
$AsciiCopy = Join-Path $Control 'ur.cmd'
[IO.File]::Copy($Managed,$AsciiCopy)
$StubDirectory = Join-Path $Bin 'ascii-stub'
$EchoDirectory = Join-Path $Bin 'echo-on'
foreach ($Directory in @($StubDirectory,$EchoDirectory)) { [IO.Directory]::CreateDirectory($Directory) | Out-Null }
$Stub = Join-Path $StubDirectory 'ur.cmd'
[IO.File]::WriteAllText($Stub, "@echo off`r`necho ASCII_STUB_REACHED`r`nexit /b 0`r`n", [Text.ASCIIEncoding]::new())
$Echo = Join-Path $EchoDirectory 'ur.cmd'
$EchoText = ([IO.File]::ReadAllText($Managed) -replace '@echo off','echo on') -replace '(?m)^@',''
[IO.File]::WriteAllText($Echo,$EchoText,[Text.UTF8Encoding]::new($false))
$Cmd = Join-Path $env:SystemRoot 'System32/cmd.exe'
$PowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$Chcp = Join-Path $Control 'chcp-probe.cmd'
[IO.File]::WriteAllText($Chcp, "@echo off`r`n@`"%SystemRoot%\System32\chcp.com`"`r`n@echo QUERY_EXIT=%ERRORLEVEL%`r`n@`"%SystemRoot%\System32\chcp.com`" 65001`r`n@echo SET_EXIT=%ERRORLEVEL%`r`n@`"%SystemRoot%\System32\chcp.com`"`r`n@echo AFTER_EXIT=%ERRORLEVEL%`r`n", [Text.ASCIIEncoding]::new())
$Console = Join-Path $Control 'console-probe.ps1'
[IO.File]::WriteAllText($Console, @'
$Result = [ordered]@{ inputCP=$null; outputCP=$null; managedInput=$null; managedOutput=$null; errors=@() }
try { Add-Type 'using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern uint GetConsoleCP(); [DllImport("kernel32.dll")] public static extern uint GetConsoleOutputCP(); }'; $Result.inputCP=[ConsoleProbe]::GetConsoleCP(); $Result.outputCP=[ConsoleProbe]::GetConsoleOutputCP() } catch { $Result.errors += $_.Exception.Message }
try { $Result.managedInput=[Console]::InputEncoding.CodePage } catch { $Result.errors += $_.Exception.Message }
try { $Result.managedOutput=[Console]::OutputEncoding.CodePage } catch { $Result.errors += $_.Exception.Message }
$Result | ConvertTo-Json -Compress
'@, [Text.ASCIIEncoding]::new())
$Report = [ordered]@{
  diagnosticOnly=$true; captureComplete=$false; version=$Version; powershellVersion=$PSVersionTable.PSVersion.ToString()
  template=$Template.Extent.Text; buildOutput=($BuildOutput | Out-String); control=$Control; special=$Special
  registry=@(); files=@(); probes=@()
  references=@('https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd','https://source.dot.net/Aspire.Hosting.Tasks/src/Shared/ProcessStartInfoHelper.cs.html')
}
foreach ($Key in @('HKCU:\Software\Microsoft\Command Processor','HKLM:\Software\Microsoft\Command Processor')) {
  $Properties = Get-ItemProperty -LiteralPath $Key -ErrorAction SilentlyContinue
  $Report.registry += [pscustomobject]@{key=$Key; delayedExpansion=$Properties.DelayedExpansion; enableExtensions=$Properties.EnableExtensions; autoRun=$Properties.AutoRun}
}
foreach ($File in @($Managed,$AsciiCopy,$Stub,$Echo,$Chcp,$Console)) {
  $Bytes=[IO.File]::ReadAllBytes($File)
  $Report.files += [pscustomobject]@{path=$File; content=[Text.Encoding]::UTF8.GetString($Bytes); bytesBase64=[Convert]::ToBase64String($Bytes); sha256=(Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash}
}
$Report['executable']=[pscustomobject]@{path=$Executable; exists=[IO.File]::Exists($Executable); sha256=(Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash}
$Destination = Join-Path $Artifacts 'launcher-probes.json'
function Save-Report { [IO.File]::WriteAllText($Destination, ($Report | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false)) }
function Capture([string]$Route,[string]$Target,[bool]$NoWindow,[string]$Expansion='default') {
  $Info=New-Object Diagnostics.ProcessStartInfo
  $Info.FileName=$Cmd
  $Mode=if ($Expansion -eq 'default') { '' } else { ' /v:' + $Expansion }
  $Info.Arguments='/d' + $Mode + ' /s /c ""%UR_DIAG_TARGET%" --version"'
  if ($Route -eq 'cmd-path') { $Info.Arguments='/d' + $Mode + ' /s /c "ur --version"' }
  if ($Route -eq 'ps-path') { $Info.FileName=$PowerShell; $Info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "ur --version; exit $LASTEXITCODE"' }
  if ($Route -eq 'direct-exe') { $Info.FileName=$Target; $Info.Arguments='--version' }
  if ($Route -eq 'chcp') { $Info.Arguments='/d /s /c ""%UR_DIAG_TARGET%""' }
  if ($Route -eq 'console') { $Info.FileName=$PowerShell; $Info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Target + '"' }
  $Info.UseShellExecute=$false; $Info.CreateNoWindow=$NoWindow; $Info.RedirectStandardOutput=$true; $Info.RedirectStandardError=$true
  $Info.WorkingDirectory=$Control
  $Info.EnvironmentVariables.Clear()
  $ArgumentFile=Join-Path $Control ('argv-' + $Report.probes.Count + '.json')
  $Environment=@{SystemRoot=$env:SystemRoot; COMSPEC=$Cmd; PATH=[IO.Path]::GetDirectoryName($Target); PATHEXT='.COM;.EXE;.BAT;.CMD'; TEMP=$Control; TMP=$Control; HOME=$Control; USERPROFILE=$Control; PROCESSOR_ARCHITECTURE='AMD64'; UR_DIAG_TARGET=$Target; UR_DIAG_ARGV_FILE=$ArgumentFile; UR_NATIVE_FIXTURE='WRONG_PERCENT_EXPANSION'; PSModulePath=(Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules')}
  foreach ($Key in $Environment.Keys) { $Info.EnvironmentVariables[$Key]=$Environment[$Key] }
  $Result=[ordered]@{route=$Route; target=$Target; createNoWindow=$NoWindow; delayedExpansion=$Expansion; fileName=$Info.FileName; arguments=$Info.Arguments; environment=$Environment; exitCode=$null; stdout=''; stderr=''; stdoutBytesBase64=''; stderrBytesBase64=''; argv=$null; error=$null}
  $Process=New-Object Diagnostics.Process; $Process.StartInfo=$Info
  $Output=New-Object IO.MemoryStream; $Errors=New-Object IO.MemoryStream
  try {
    if (!$Process.Start()) { throw 'Process did not start' }
    $OutputTask=$Process.StandardOutput.BaseStream.CopyToAsync($Output); $ErrorTask=$Process.StandardError.BaseStream.CopyToAsync($Errors)
    if (!$Process.WaitForExit(8000)) { throw 'Process deadline exceeded' }
    $Result.exitCode=$Process.ExitCode
    if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($OutputTask,$ErrorTask),8000)) { throw 'Output deadline exceeded' }
  } catch { $Result.error=$_.Exception.Message }
  finally {
    try { if (!$Process.HasExited) { & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $Process.Id /T /F 2>$null | Out-Null } } catch {}
    $OutBytes=$Output.ToArray(); $ErrBytes=$Errors.ToArray()
    $Result.stdout=[Text.Encoding]::UTF8.GetString($OutBytes); $Result.stderr=[Text.Encoding]::UTF8.GetString($ErrBytes)
    $Result.stdoutBytesBase64=[Convert]::ToBase64String($OutBytes); $Result.stderrBytesBase64=[Convert]::ToBase64String($ErrBytes)
    if ([IO.File]::Exists($ArgumentFile)) { $Result.argv=[IO.File]::ReadAllText($ArgumentFile) | ConvertFrom-Json }
    $Process.Dispose(); $Output.Dispose(); $Errors.Dispose()
  }
  $Report.probes += [pscustomobject]$Result; Save-Report
  Write-Output ('Captured ' + $Route + ' / ' + $Expansion + ' / noWindow=' + $NoWindow + ' / exit=' + $Result.exitCode)
}
# Preserve original no-window route before any CHCP-setting probes.
foreach ($Target in @($Managed,$AsciiCopy,$Stub,$Echo)) {
  foreach ($NoWindow in @($true,$false)) {
    Capture 'cmd-fullpath' $Target $NoWindow 'default'
    Capture 'cmd-fullpath' $Target $NoWindow 'off'
  }
}
foreach ($NoWindow in @($true,$false)) {
  Capture 'cmd-path' $Managed $NoWindow 'default'
  Capture 'cmd-path' $Managed $NoWindow 'off'
  Capture 'ps-path' $Managed $NoWindow
  Capture 'direct-exe' $Executable $NoWindow
  Capture 'cmd-fullpath' $Managed $NoWindow 'on'
  Capture 'chcp' $Chcp $NoWindow
  Capture 'console' $Console $NoWindow
}
$Report.captureComplete=$true; Save-Report
$Printed=[regex]::Replace(($Report | ConvertTo-Json -Depth 20 -Compress),'[^\x00-\x7F]',{param($Match) '\u' + ([int][char]$Match.Value).ToString('x4')})
Write-Output $Printed
Write-Output 'Diagnostic capture completed; this does not qualify a release.'
