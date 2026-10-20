# Standalone local fixture capture only. No network, provider calls, or release qualification.
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
import { writeFileSync, readFileSync } from 'node:fs';
if (process.env.UR_DIAG_ARGV_FILE) writeFileSync(process.env.UR_DIAG_ARGV_FILE, JSON.stringify({argv:process.argv,execPath:process.execPath,cwd:process.cwd(),nativeBin:process.env.UR_NATIVE_BIN_DIR,nativeData:process.env.UR_NATIVE_DATA_DIR}));
if (process.argv.includes('--shim-argv')) { console.log(JSON.stringify(process.argv.slice(2))); process.exit(0); }
if (process.argv.includes('--shim-exit')) process.exit(7);
if (process.argv.includes('--shim-stdio')) { const input=readFileSync(0,'utf8'); process.stdout.write('OUT:'+input+'x'.repeat(300000)); process.stderr.write('ERR:'+input+'y'.repeat(300000)); process.exit(7); }
console.log(process.argv.includes('--ur-native-self-test') ? JSON.stringify({passed:true,diagnosticFixture:true}) : process.argv.includes('--version') ? __UR_DIAGNOSTIC_VERSION__ + ' (UR-Nexus)' : JSON.stringify(process.argv));
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
function Capture([string]$Route,[string]$Target,[bool]$NoWindow,[string]$Expansion='default',[string]$EnvironmentMode='control') {
  $Info=New-Object Diagnostics.ProcessStartInfo
  $Info.FileName=$Cmd
  $Mode=if ($Expansion -eq 'default') { '' } else { ' /v:' + $Expansion }
  $Info.Arguments='/d' + $Mode + ' /s /c ""%UR_DIAG_TARGET%" --version"'
  if ($Route -eq 'cmd-path') { $Info.Arguments='/d' + $Mode + ' /s /c "ur --version"' }
  if ($Route -eq 'ps-path') { $Info.FileName=$PowerShell; $Info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "ur --version; exit $LASTEXITCODE"' }
  if ($Route -eq 'direct-exe') { $Info.FileName=$Target; $Info.Arguments='--version' }
  if ($Route -eq 'shim-args') { $Info.FileName=$Target; $Info.Arguments='--shim-argv "two words" "" "literal%UR_NATIVE_FIXTURE%!&caf' + [char]0xE9 + '" "C:\trailing\\" "{\"message\":\"hello\"}"' }
  if ($Route -eq 'shim-exit') { $Info.FileName=$Target; $Info.Arguments='--shim-exit' }
  if ($Route -eq 'shim-stdio') { $Info.FileName=$Target; $Info.Arguments='--shim-stdio'; $Info.RedirectStandardInput=$true }
  if ($Route -eq 'chcp') { $Info.Arguments='/d /s /c ""%UR_DIAG_TARGET%""' }
  if ($Route -in @('bootstrap-install','ps-discovery')) { $Info.FileName=$PowerShell; $Script=if ($Route -eq 'bootstrap-install') { $BootstrapFixture } else { $Discovery }; $Info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Script + '"' }
  if ($Route -eq 'console') { $Info.FileName=$PowerShell; $Info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Target + '"' }
  $Info.UseShellExecute=$false; $Info.CreateNoWindow=$NoWindow; $Info.RedirectStandardOutput=$true; $Info.RedirectStandardError=$true
  $Info.WorkingDirectory=$Control
  $Info.EnvironmentVariables.Clear()
  $ArgumentFile=Join-Path $Control ('argv-' + $Report.probes.Count + '.json')
  $Environment=@{SystemRoot=$env:SystemRoot; COMSPEC=$Cmd; PATH=[IO.Path]::GetDirectoryName($Target); PATHEXT='.COM;.EXE;.BAT;.CMD'; TEMP=$Control; TMP=$Control; HOME=$Control; USERPROFILE=$Control; PROCESSOR_ARCHITECTURE='AMD64'; UR_DIAG_TARGET=$Target; UR_DIAG_ARGV_FILE=$ArgumentFile; UR_NATIVE_FIXTURE='WRONG_PERCENT_EXPANSION'; PSModulePath=(Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules')}
  if ($EnvironmentMode -eq 'installed') {
    $HomeDirectory=Join-Path $Special 'private home'
    $Environment.TEMP=$Special; $Environment.TMP=$Special; $Environment.HOME=$HomeDirectory; $Environment.USERPROFILE=$HomeDirectory
    $Environment.PATH=''; $Environment.APPDATA=Join-Path $HomeDirectory 'AppData/Roaming'; $Environment.LOCALAPPDATA=Join-Path $HomeDirectory 'AppData/Local'
    $Environment.USERNAME='ur-native-smoke'; $Environment.USER='ur-native-smoke'; $Environment.LOGNAME='ur-native-smoke'
    $Environment.CI='1'; $Environment.DO_NOT_TRACK='1'; $Environment.DISABLE_TELEMETRY='1'; $Environment.UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
    $Environment.UR_CONFIG_DIR=Join-Path $HomeDirectory '.ur'
    if ($Route -in @('ps-path','cmd-path','ps-discovery')) { $Environment.PATH=[IO.Path]::GetDirectoryName($Target) }
  }
  if ($Route -eq 'bootstrap-install') {
    $Environment.UR_BOOTSTRAP_INSTALL_SCRIPT=Join-Path $Repository 'install.ps1'
    $Environment.UR_BOOTSTRAP_ARCHIVE=$FixtureArchive; $Environment.UR_BOOTSTRAP_MANIFEST=$FixtureManifest
    $Environment.UR_BOOTSTRAP_BIN=$InstalledBin; $Environment.UR_BOOTSTRAP_DATA=$InstalledData
    $Environment.UR_BOOTSTRAP_VERSION=$Version; $Environment.UR_BOOTSTRAP_REPORT=$BootstrapReport
  }
  foreach ($Key in $Environment.Keys) { $Info.EnvironmentVariables[$Key]=$Environment[$Key] }
  $Result=[ordered]@{environmentMode=$EnvironmentMode; route=$Route; target=$Target; createNoWindow=$NoWindow; delayedExpansion=$Expansion; fileName=$Info.FileName; arguments=$Info.Arguments; environment=$Environment; exitCode=$null; stdout=''; stderr=''; stdoutBytesBase64=''; stderrBytesBase64=''; argv=$null; error=$null}
  $Process=New-Object Diagnostics.Process; $Process.StartInfo=$Info
  $Output=New-Object IO.MemoryStream; $Errors=New-Object IO.MemoryStream
  try {
    if ($Route -eq 'shim-stdio') { [Console]::InputEncoding=[Text.UTF8Encoding]::new($false) }
    if (!$Process.Start()) { throw 'Process did not start' }
    $OutputTask=$Process.StandardOutput.BaseStream.CopyToAsync($Output); $ErrorTask=$Process.StandardError.BaseStream.CopyToAsync($Errors)
    if ($Route -eq 'shim-stdio') { $InputBytes=[Text.Encoding]::UTF8.GetBytes(('input caf'+[char]0xE9+' %UR_NATIVE_FIXTURE%!')); $Process.StandardInput.BaseStream.Write($InputBytes,0,$InputBytes.Length); $Process.StandardInput.Close() }
    $Deadline=if ($Route -eq 'bootstrap-install') { 120000 } else { 8000 }
    if (!$Process.WaitForExit($Deadline)) { throw 'Process deadline exceeded' }
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
  # Native launch evidence above already isolates console behavior.
}

# Exercise the complete real bootstrap with a local ZIP, exact manifest and the
# same empty PATH / Unicode TEMP and home environment as production smoke.
$ReleaseDirectory=Join-Path $Control 'tiny-release'
$ResourceDirectory=Join-Path $ReleaseDirectory 'resources'
[IO.Directory]::CreateDirectory($ResourceDirectory) | Out-Null
[IO.File]::Copy($AsciiExecutable,(Join-Path $ReleaseDirectory 'ur.exe'))
[IO.Directory]::CreateDirectory((Join-Path $ResourceDirectory 'windows')) | Out-Null
[IO.File]::Copy($env:UR_DIAG_NATIVE_SHIM,(Join-Path $ResourceDirectory 'windows/ur-launcher.exe'))
[IO.File]::WriteAllText((Join-Path $ResourceDirectory 'manifest.json'),'{"diagnosticFixture":true}',[Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$FixtureArchive=Join-Path $Control ("ur-$Version-win32-x64.zip")
[IO.Compression.ZipFile]::CreateFromDirectory($ReleaseDirectory,$FixtureArchive)
$FixtureManifest=Join-Path $Control 'fixture-manifest.json'
$Manifest=[ordered]@{schemaVersion=1;version=$Version;sourceCommit=('0'*40);platforms=@{'win32-x64'=@{file=[IO.Path]::GetFileName($FixtureArchive);executable='ur.exe';size=([IO.FileInfo]$FixtureArchive).Length;sha256=(Get-FileHash -LiteralPath $FixtureArchive -Algorithm SHA256).Hash.ToLowerInvariant()}}}
[IO.File]::WriteAllText($FixtureManifest,($Manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
$InstalledBin=Join-Path $Special 'actual install/application bin'
$InstalledData=Join-Path $Special 'actual install/application data'
[IO.Directory]::CreateDirectory((Join-Path $Special 'private home')) | Out-Null
$BootstrapReport=Join-Path $Artifacts 'bootstrap-install.json'
$BootstrapFixture=Join-Path $Control 'bootstrap-fixture.ps1'
[IO.File]::WriteAllText($BootstrapFixture,@'
$ErrorActionPreference='Stop'
$Result=[ordered]@{diagnosticOnly=$true;attempts=@();downloadCount=0;launcher=$null;target=$null;nestedProbes=@();environment=@{path=$env:PATH;temp=$env:TEMP;home=$env:HOME;userprofile=$env:USERPROFILE}}
function Invoke-RestMethod {
  param([string]$Uri,$Headers)
  if (!$Uri.EndsWith('/manifest.json')) { throw 'Unexpected bootstrap metadata request' }
  return ([IO.File]::ReadAllText($global:UrNativeBootstrapFixtureManifestPath) | ConvertFrom-Json)
}
function Invoke-WebRequest {
  param([switch]$UseBasicParsing,[string]$Uri)
  if (!$Uri.EndsWith('/'+[IO.Path]::GetFileName($env:UR_BOOTSTRAP_ARCHIVE))) { throw 'Unexpected bootstrap asset request' }
  $global:UrNativeBootstrapFixtureDownloadCount++
  return [pscustomobject]@{RawContentStream=[IO.File]::OpenRead($global:UrNativeBootstrapFixtureArchivePath)}
}
$global:UrNativeBootstrapFixtureManifestPath=$env:UR_BOOTSTRAP_MANIFEST
$global:UrNativeBootstrapFixtureArchivePath=$env:UR_BOOTSTRAP_ARCHIVE
$global:UrNativeBootstrapFixtureDownloadCount=0
try {
  for ($Attempt=0;$Attempt -lt 2;$Attempt++) {
    $Entry=[ordered]@{attempt=$Attempt;passed=$false;error=$null}
    try { & $env:UR_BOOTSTRAP_INSTALL_SCRIPT -Version $env:UR_BOOTSTRAP_VERSION -BinDirectory $env:UR_BOOTSTRAP_BIN -DataDirectory $env:UR_BOOTSTRAP_DATA -NoPathUpdate; $Entry.passed=$true } catch { $Entry.error=$_.Exception.ToString() }
    $Result.attempts += [pscustomobject]$Entry
  }
  $NestedLauncher=Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd'
  if ([IO.File]::Exists($NestedLauncher)) {
    $NestedAscii=Join-Path ([IO.Path]::GetDirectoryName($env:UR_BOOTSTRAP_ARCHIVE)) 'nested-actual-ur.cmd'
    [IO.File]::Copy($NestedLauncher,$NestedAscii)
    foreach ($NestedTarget in @($NestedLauncher,$NestedAscii)) {
      foreach ($NoWindow in @($true,$false)) {
        foreach ($Route in @('cmd-fullpath','ps-path')) {
          $Start=New-Object Diagnostics.ProcessStartInfo
          $Start.FileName=Join-Path $env:SystemRoot 'System32/cmd.exe'
          $Start.Arguments='/d /s /c ""%UR_NATIVE_BOOTSTRAP_LAUNCHER%" --version"'
          $Start.EnvironmentVariables['UR_NATIVE_BOOTSTRAP_LAUNCHER']=$NestedTarget
          if ($Route -eq 'ps-path') {
            $Start.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            $Start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "ur --version; exit $LASTEXITCODE"'
            $Start.EnvironmentVariables['PATH']=[IO.Path]::GetDirectoryName($NestedTarget)
          }
          $Start.UseShellExecute=$false; $Start.CreateNoWindow=$NoWindow; $Start.RedirectStandardOutput=$true; $Start.RedirectStandardError=$true
          $Probe=[ordered]@{route=$Route;target=$NestedTarget;createNoWindow=$NoWindow;fileName=$Start.FileName;arguments=$Start.Arguments;parentPath=$env:PATH;parentTemp=$env:TEMP;exitCode=$null;stdout='';stderr='';error=$null}
          $Process=New-Object Diagnostics.Process; $Process.StartInfo=$Start
          try {
            if (!$Process.Start()) { throw 'Nested launcher did not start' }
            $Out=$Process.StandardOutput.ReadToEndAsync(); $Err=$Process.StandardError.ReadToEndAsync()
            if (!$Process.WaitForExit(10000)) { throw 'Nested launcher deadline exceeded' }
            $Probe.exitCode=$Process.ExitCode
            if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($Out,$Err),10000)) { throw 'Nested output deadline exceeded' }
            $Probe.stdout=$Out.Result; $Probe.stderr=$Err.Result
          } catch { $Probe.error=$_.Exception.Message }
          finally { try { if (!$Process.HasExited) { $Process.Kill() } } catch {}; $Process.Dispose() }
          $Result.nestedProbes += [pscustomobject]$Probe
        }
      }
    }
  }
} finally {
  $Result.downloadCount=$global:UrNativeBootstrapFixtureDownloadCount
  $Launcher=Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd'
  $Target=Join-Path $env:UR_BOOTSTRAP_DATA ('versions/'+$env:UR_BOOTSTRAP_VERSION+'-win32-x64/ur.exe')
  $Result.launcher=[ordered]@{path=$Launcher;exists=[IO.File]::Exists($Launcher);content=$null;bytesBase64=$null;sha256=$null}
  if ([IO.File]::Exists($Launcher)) { $Bytes=[IO.File]::ReadAllBytes($Launcher); $Result.launcher.content=[Text.Encoding]::UTF8.GetString($Bytes); $Result.launcher.bytesBase64=[Convert]::ToBase64String($Bytes); $Result.launcher.sha256=(Get-FileHash -LiteralPath $Launcher).Hash }
  $Result.target=[ordered]@{path=$Target;exists=[IO.File]::Exists($Target);sha256=$null}
  if ([IO.File]::Exists($Target)) { $Result.target.sha256=(Get-FileHash -LiteralPath $Target).Hash }
  [IO.File]::WriteAllText($env:UR_BOOTSTRAP_REPORT,($Result | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  $Result | ConvertTo-Json -Depth 12 -Compress
}
'@,[Text.ASCIIEncoding]::new())
$Discovery=Join-Path $Control 'ps-discovery.ps1'
[IO.File]::WriteAllText($Discovery,@'
$ErrorActionPreference='Continue'
$Commands=@(Get-Command ur -All -ErrorAction Continue | Select-Object CommandType,Name,Source,Definition,Path)
[ordered]@{commands=$Commands;path=$env:PATH;comspec=$env:COMSPEC;pathext=$env:PATHEXT;temp=$env:TEMP;userprofile=$env:USERPROFILE} | ConvertTo-Json -Depth 6 -Compress
Trace-Command -Name CommandDiscovery,NativeCommandParameterBinder -Option All -Expression { ur --version } -PSHost
Write-Output ('TRACE_LASTEXITCODE='+$LASTEXITCODE)
exit $LASTEXITCODE
'@,[Text.ASCIIEncoding]::new())
Capture 'bootstrap-install' $InstalledBin $true 'default' 'installed'
if ([IO.File]::Exists($BootstrapReport)) { $Report['actualBootstrap']=[IO.File]::ReadAllText($BootstrapReport) | ConvertFrom-Json; Save-Report }
$ActualManaged=Join-Path $InstalledBin 'ur.cmd'
if ([IO.File]::Exists($ActualManaged)) {
  $ActualAsciiDirectory=Join-Path $Control 'actual-installed-ascii'
  [IO.Directory]::CreateDirectory($ActualAsciiDirectory) | Out-Null
  $ActualAscii=Join-Path $ActualAsciiDirectory 'ur.cmd'
  [IO.File]::Copy($ActualManaged,$ActualAscii)
  foreach ($ActualFile in @($ActualManaged,$ActualAscii)) {
    $Bytes=[IO.File]::ReadAllBytes($ActualFile)
    $Report.files += [pscustomobject]@{path=$ActualFile;content=[Text.Encoding]::UTF8.GetString($Bytes);bytesBase64=[Convert]::ToBase64String($Bytes);sha256=(Get-FileHash -LiteralPath $ActualFile).Hash}
    foreach ($NoWindow in @($true,$false)) {
      Capture 'cmd-fullpath' $ActualFile $NoWindow 'default' 'installed'
      Capture 'cmd-fullpath' $ActualFile $NoWindow 'off' 'installed'
      Capture 'ps-path' $ActualFile $NoWindow 'default' 'installed'
      # Ordinary PS execution above is the required discovery result.
    }
  }
  Capture 'direct-exe' (Join-Path $InstalledData ('versions/'+$Version+'-win32-x64/ur.exe')) $true 'default' 'installed'
}

# Qualify the immutable native shim itself, including arbitrary Unicode argv,
# both pipes exceeding pipe capacity, stdin, exact child status and fail-closed
# parsing. The earlier batch-only PS failures remain in this diagnostic report.
$ActualShim=Join-Path $InstalledBin 'ur.exe'
if ([IO.File]::Exists($ActualShim)) {
  foreach ($NoWindow in @($true,$false)) {
    Capture 'shim-args' $ActualShim $NoWindow 'default' 'installed'
    Capture 'shim-exit' $ActualShim $NoWindow 'default' 'installed'
    Capture 'shim-stdio' $ActualShim $NoWindow 'default' 'installed'
    Capture 'direct-exe' $ActualShim $NoWindow 'default' 'installed'
    Capture 'cmd-path' $ActualShim $NoWindow 'off' 'installed'
    Capture 'ps-path' $ActualShim $NoWindow 'default' 'installed'
  }
  $Original=[IO.File]::ReadAllBytes($ActualManaged)
  try {
    $Bad=[Text.Encoding]::UTF8.GetString($Original)+'echo invalid added command'
    [IO.File]::WriteAllText($ActualManaged,$Bad,[Text.UTF8Encoding]::new($false))
    Capture 'direct-exe' $ActualShim $true 'default' 'installed'
    $Report['malformedActivation']=$Report.probes[-1]
  } finally { [IO.File]::WriteAllBytes($ActualManaged,$Original) }
  $Qualified=@($Report.probes | Where-Object { $_.target -ceq $ActualShim -and $_ -ne $Report.malformedActivation })
  foreach ($Probe in $Qualified) {
    if ($Probe.error) { throw ('Native shim qualification error: '+($Probe | ConvertTo-Json -Depth 5 -Compress)) }
    $Expected=if ($Probe.route -in @('shim-exit','shim-stdio')) {7} else {0}
    if ($Probe.exitCode -ne $Expected) { throw ('Native shim exit status mismatch: '+($Probe | ConvertTo-Json -Depth 5 -Compress)) }
    if ($Probe.route -eq 'shim-args') {
      $ExpectedArgs=@('--shim-argv','two words','',('literal%UR_NATIVE_FIXTURE%!&caf'+[char]0xE9),'C:\trailing\','{"message":"hello"}')
      $ActualArgs=ConvertFrom-Json -InputObject $Probe.stdout
      if ($ActualArgs.Count -ne $ExpectedArgs.Count) { throw ('Native shim argv count mismatch: '+$ActualArgs.Count+' / '+$ExpectedArgs.Count) }
      for ($Index=0;$Index -lt $ExpectedArgs.Count;$Index++) {
        if ([string]$ActualArgs[$Index] -cne [string]$ExpectedArgs[$Index]) { throw ('Native shim argv mismatch at '+$Index+': actual='+([string]$ActualArgs[$Index])+' expected='+([string]$ExpectedArgs[$Index])) }
      }
    }
    if ($Probe.route -eq 'shim-stdio') {
      $InputText='input caf'+[char]0xE9+' %UR_NATIVE_FIXTURE%!'
      if ($Probe.stdout -cne ('OUT:'+$InputText+('x'*300000)) -or $Probe.stderr -cne ('ERR:'+$InputText+('y'*300000))) { throw 'Native shim changed redirected stdin/stdout/stderr' }
    }
  }
  if ($Report.malformedActivation.exitCode -ne 125) { throw 'Native shim accepted an unmanaged activation file' }
  $Report['nativeShimQualified']=$true
} else { throw 'Actual bootstrap did not install the native console shim' }
$Report.captureComplete=$true; Save-Report
$LogReport=$Report | ConvertTo-Json -Depth 20 | ConvertFrom-Json
foreach ($Probe in $LogReport.probes) { if ($Probe.route -eq 'shim-stdio') { $Probe.stdout='[full pipe contents retained in artifact]'; $Probe.stderr='[full pipe contents retained in artifact]'; $Probe.stdoutBytesBase64='[artifact]'; $Probe.stderrBytesBase64='[artifact]' } }
$Printed=[regex]::Replace(($LogReport | ConvertTo-Json -Depth 20 -Compress),'[^\x00-\x7F]',{param($Match) '\u' + ([int][char]$Match.Value).ToString('x4')})
Write-Output $Printed
Write-Output 'Diagnostic capture completed; this does not qualify a release.'
