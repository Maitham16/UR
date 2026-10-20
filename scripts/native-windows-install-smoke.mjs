#!/usr/bin/env node
// Exercise the actual PowerShell bootstrap using local verified release assets.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
if (process.platform !== 'win32') throw new Error('Windows bootstrap qualification must run on Windows')
const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const artifactIndex = process.argv.indexOf('--artifact-dir')
const artifacts = resolve(artifactIndex < 0 ? 'dist-release/native' : process.argv[artifactIndex + 1])
const temporaryBase = realpathSync.native(process.env.RUNNER_TEMP || tmpdir())
const work = mkdtempSync(join(temporaryBase, 'ur bootstrap 100% User [café!] '))
const bin = join(work, 'application bin'), data = join(work, 'application data'), home = join(work, 'private home')
mkdirSync(home)
const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows'
const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const cmd = join(systemRoot, 'System32', 'cmd.exe')
const env = {
  HOME: home, USERPROFILE: home, USERNAME: 'ur-native-smoke', USER: 'ur-native-smoke', LOGNAME: 'ur-native-smoke',
  APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
  SYSTEMROOT: systemRoot, SystemRoot: systemRoot, COMSPEC: cmd,
  PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  PATH: '', TEMP: work, TMP: work, UR_CONFIG_DIR: join(home, '.ur'),
  CI: '1', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  UR_BOOTSTRAP_INSTALL_SCRIPT: join(root, 'install.ps1'), UR_BOOTSTRAP_BIN: bin, UR_BOOTSTRAP_DATA: data,
  UR_BOOTSTRAP_ARCHIVE: join(artifacts, `ur-${version}-win32-x64.zip`),
  UR_BOOTSTRAP_MANIFEST: join(artifacts, 'manifest-win32-x64.json'), UR_BOOTSTRAP_VERSION: version,
  PROCESSOR_ARCHITECTURE: 'AMD64',
}
const hostileEntries = [
  'resources/CON', 'resources/con.txt', 'resources/CON .txt', 'resources/COM1.dll', 'resources/LPT9',
  'resources/NUL/nested', 'resources/CONIN$.txt', 'resources/COM¹.txt',
  'resources/trailing.', 'resources/trailing /nested', 'resources/control\u0001name',
  'resources/question?mark', 'resources/file:stream', 'resources//', 'resources/../outside',
]
const baseManifest = JSON.parse(readFileSync(env.UR_BOOTSTRAP_MANIFEST, 'utf8'))
const hostileCases = hostileEntries.map((entry, index) => {
  const archive = join(work, `hostile-${index}.zip`)
  const manifestPath = join(work, `hostile-${index}.json`)
  const bytes = zipSync({ [entry]: new Uint8Array(0) })
  writeFileSync(archive, bytes)
  const manifest = structuredClone(baseManifest)
  Object.assign(manifest.platforms['win32-x64'], { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  writeFileSync(manifestPath, JSON.stringify(manifest))
  return { entry, archive, manifest: manifestPath, directory: join(work, `hostile-install-${index}`) }
})
env.UR_BOOTSTRAP_HOSTILE_CASES = join(work, 'hostile-cases.json')
writeFileSync(env.UR_BOOTSTRAP_HOSTILE_CASES, JSON.stringify(hostileCases))
const fixture = join(work, 'qualify.ps1')
writeFileSync(fixture, `
$ErrorActionPreference = 'Stop'
$UninstallScript = Join-Path (Split-Path $env:UR_BOOTSTRAP_INSTALL_SCRIPT) 'uninstall.ps1'
foreach ($Path in @($env:UR_BOOTSTRAP_INSTALL_SCRIPT, (Join-Path (Split-Path $env:UR_BOOTSTRAP_INSTALL_SCRIPT) 'uninstall.ps1'))) {
  $ParseErrors = $null
  $Ast = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$ParseErrors)
  if ($ParseErrors.Count) { throw "PowerShell installer syntax error: $ParseErrors" }
  if ($Path -eq $env:UR_BOOTSTRAP_INSTALL_SCRIPT) { $InstallAst = $Ast }
}
# Exercise the exact installer retry helper without executing an installation.
$RetryDefinition = $InstallAst.Find({ param($Node) $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Invoke-NativeInstallFileOperation' }, $true)
if (!$RetryDefinition) { throw 'Installer file-operation retry helper is missing' }
. ([ScriptBlock]::Create($RetryDefinition.Extent.Text))
foreach ($TransientCode in @(5,32,33)) {
  $script:RetryAttempts = 0
  Invoke-NativeInstallFileOperation {
    $script:RetryAttempts++
    if ($script:RetryAttempts -lt 3) {
      if ($TransientCode -eq 5) { throw [UnauthorizedAccessException]::new('Fixture access lock') }
      throw [IO.IOException]::new('Fixture sharing violation', (-2147024896 + $TransientCode))
    }
  }
  if ($script:RetryAttempts -ne 3) { throw 'Transient Windows sharing/access violation was not retried' }
}
$script:RetryAttempts = 0
$Failure = $null
try {
  Invoke-NativeInstallFileOperation { $script:RetryAttempts++; throw [IO.IOException]::new('Fixture permanent failure', -2147024894) }
} catch { $Failure = $_ }
if (!$Failure -or $script:RetryAttempts -ne 1 -or $Failure.Exception.Message -ne 'Fixture permanent failure') { throw 'Permanent Windows file-operation failure was not preserved immediately' }
$script:RetryAttempts = 0
$Failure = $null
try {
  Invoke-NativeInstallFileOperation -TimeoutMilliseconds 0 -Operation { $script:RetryAttempts++; throw [IO.IOException]::new('Fixture bounded sharing violation', -2147024864) }
} catch { $Failure = $_ }
if (!$Failure -or $script:RetryAttempts -ne 1 -or $Failure.Exception.Message -ne 'Fixture bounded sharing violation') { throw 'Windows file-operation retry deadline did not preserve the original error' }
function Invoke-RestMethod {
  param([string]$Uri, $Headers)
  if (!$Uri.EndsWith('/manifest.json')) { throw 'Unexpected bootstrap metadata request' }
  return ([IO.File]::ReadAllText($script:BootstrapManifestPath) | ConvertFrom-Json)
}
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
  if (!$Uri.EndsWith('/' + [IO.Path]::GetFileName($env:UR_BOOTSTRAP_ARCHIVE))) { throw 'Unexpected bootstrap asset request' }
  [IO.File]::Copy($script:BootstrapArchivePath, $OutFile)
  $script:NativeDownloadCount++
}
$Cases = [IO.File]::ReadAllText($env:UR_BOOTSTRAP_HOSTILE_CASES) | ConvertFrom-Json
foreach ($Case in $Cases) {
  $script:BootstrapManifestPath = $Case.manifest
  $script:BootstrapArchivePath = $Case.archive
  $Failure = $null
  try {
    & $env:UR_BOOTSTRAP_INSTALL_SCRIPT -Version $env:UR_BOOTSTRAP_VERSION -BinDirectory (Join-Path $Case.directory 'bin') -DataDirectory (Join-Path $Case.directory 'data') -NoPathUpdate
  } catch { $Failure = $_ }
  if (!$Failure -or !$Failure.Exception.Message.StartsWith('Unsafe native archive entry:')) { throw "Hostile archive entry was not rejected before extraction: $($Case.entry); $Failure" }
  if (Test-Path -LiteralPath (Join-Path $Case.directory 'bin/ur.cmd')) { throw 'Hostile archive activated a launcher' }
}
$script:BootstrapManifestPath = $env:UR_BOOTSTRAP_MANIFEST
$script:BootstrapArchivePath = $env:UR_BOOTSTRAP_ARCHIVE
$script:NativeDownloadCount = 0
for ($Attempt = 0; $Attempt -lt 2; $Attempt++) {
  & $env:UR_BOOTSTRAP_INSTALL_SCRIPT -Version $env:UR_BOOTSTRAP_VERSION -BinDirectory $env:UR_BOOTSTRAP_BIN -DataDirectory $env:UR_BOOTSTRAP_DATA -NoPathUpdate
}
if ($script:NativeDownloadCount -ne 1) { throw 'Repeated bootstrap downloaded the native archive again' }
$Output = & (Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd') --version
if ($LASTEXITCODE -ne 0 -or $Output -cne ($env:UR_BOOTSTRAP_VERSION + ' (UR-Nexus)')) { throw 'Installed Windows launcher returned the wrong version' }
# The managed launcher supplies its custom directories to the native updater.
# A pinned version already installed locally must reuse that cache offline.
$InstallOutput = & (Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd') install $env:UR_BOOTSTRAP_VERSION
if ($LASTEXITCODE -ne 0) { throw "Native cached install did not reuse the custom installation: $InstallOutput" }
$OutputAfterInstall = & (Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd') --version
if ($LASTEXITCODE -ne 0 -or $OutputAfterInstall -cne ($env:UR_BOOTSTRAP_VERSION + ' (UR-Nexus)')) { throw 'Native cached install changed the custom launcher incorrectly' }
if (Test-Path -LiteralPath (Join-Path $HOME '.local/bin/ur.cmd')) { throw 'Native cached install escaped to the default home launcher' }
$Launcher = Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd'
$ManagedContent = [IO.File]::ReadAllText($Launcher)
if (!$ManagedContent.Contains('100%% User')) { throw 'Percent-containing installation path was not escaped in the launcher' }
$ConfigSentinel = Join-Path $env:UR_CONFIG_DIR 'bootstrap-preserve.json'
$SessionSentinel = Join-Path $env:UR_CONFIG_DIR 'sessions/bootstrap-preserve.jsonl'
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($SessionSentinel)) | Out-Null
[IO.File]::WriteAllText($ConfigSentinel, 'configuration stays')
[IO.File]::WriteAllText($SessionSentinel, 'session stays')
$RetainedExecutable = Join-Path $env:UR_BOOTSTRAP_DATA ('versions/' + $env:UR_BOOTSTRAP_VERSION + '-win32-x64/ur.exe')
foreach ($ForeignContent in @(('@echo off' + [Environment]::NewLine + 'echo unrelated'), ($ManagedContent.Replace('versions', 'versions-other')), ($ManagedContent + 'echo added command'), ($ManagedContent.Replace('100%% User','100% User')))) {
  [IO.File]::WriteAllText($Launcher, $ForeignContent)
  $Failure = $null
  try { & $UninstallScript -BinDirectory $env:UR_BOOTSTRAP_BIN -DataDirectory $env:UR_BOOTSTRAP_DATA } catch { $Failure = $_ }
  if (!$Failure -or !(Test-Path -LiteralPath $Launcher) -or [IO.File]::ReadAllText($Launcher) -cne $ForeignContent) { throw 'Uninstall did not preserve an unrelated launcher' }
}
[IO.File]::WriteAllText($Launcher, $ManagedContent)
& $UninstallScript -BinDirectory $env:UR_BOOTSTRAP_BIN -DataDirectory $env:UR_BOOTSTRAP_DATA
if (Test-Path -LiteralPath $Launcher) { throw 'Uninstall did not remove the managed percent-path launcher' }
if (!(Test-Path -LiteralPath $RetainedExecutable) -or [IO.File]::ReadAllText($ConfigSentinel) -cne 'configuration stays' -or [IO.File]::ReadAllText($SessionSentinel) -cne 'session stays') { throw 'Uninstall did not preserve application versions, configuration, and sessions' }
Write-Output $Output
`)
function check(command, args) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 180_000, windowsHide: true })
  writeFileSync(join(work, 'bootstrap-command.json'), `${JSON.stringify({ command, args, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2)}\n`, { mode: 0o600 })
  if (result.error || result.status !== 0) throw new Error(`Windows native bootstrap failed: ${result.error?.message ?? result.stderr}\n${result.stdout}`)
  return result.stdout
}
let passed = false
try {
  // Observe the very same embedded executable through Node's native process
  // launcher before PowerShell runs it. This isolates executable/path startup
  // failures from PowerShell's pipeline output and exit-code handling.
  const executableBytes = unzipSync(new Uint8Array(readFileSync(env.UR_BOOTSTRAP_ARCHIVE)), { filter: entry => entry.name === 'ur.exe' })['ur.exe']
  if (!executableBytes) throw new Error('Windows release archive has no native executable')
  const controlDirectory = mkdtempSync(join(temporaryBase, 'ur-native-ascii-probe-'))
  try {
    const probes = []
    for (const [label, directory] of [['ascii-control', controlDirectory], ['unicode-brackets', join(work, 'version probe')]]) {
      mkdirSync(directory, { recursive: true })
      const executable = join(directory, 'ur.exe')
      writeFileSync(executable, executableBytes)
      const result = spawnSync(executable, ['--version'], { env, encoding: 'utf8', timeout: 30_000, windowsHide: true })
      probes.push({ label, executable, expected: `${version} (UR-Nexus)`, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr })
    }
    writeFileSync(join(work, 'native-version-probes.json'), `${JSON.stringify(probes, null, 2)}\n`, { mode: 0o600 })
    console.log(`Native direct version probes: ${JSON.stringify(probes)}`)
    for (const probe of probes) {
      if (probe.error || probe.status !== 0 || probe.stdout.replace(/\r?\n$/, '') !== probe.expected) {
        throw new Error(`Native ${probe.label} executable failed exact version qualification: ${JSON.stringify(probe)}`)
      }
    }
  } finally {
    try { rmSync(controlDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
    catch (error) { console.warn(`Windows probe cleanup retained ${controlDirectory}: ${error}`) }
  }
  const output = check(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture])
  if (!output.includes(`${version} (UR-Nexus)`)) throw new Error('Installed Windows launcher returned the wrong version')
  passed = true
  console.log('PASS actual Windows bootstrap, bounded file-operation retries, hostile ZIP rejection, repeat install, Unicode/percent-path launcher, and managed-only uninstall preserving user data')
} finally {
  if (passed) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  else console.error(`Windows bootstrap evidence retained at ${work}`)
}
