#!/usr/bin/env node
// Exercise the actual PowerShell bootstrap using local verified release assets.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
if (process.platform !== 'win32') throw new Error('Windows bootstrap qualification must run on Windows')
const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const artifactIndex = process.argv.indexOf('--artifact-dir')
const artifacts = resolve(artifactIndex < 0 ? 'dist-release/native' : process.argv[artifactIndex + 1])
const temporaryBase = realpathSync.native(process.env.RUNNER_TEMP || tmpdir())
const work = mkdtempSync(join(temporaryBase, 'ur bootstrap [café!] '))
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
const fixture = join(work, 'qualify.ps1')
writeFileSync(fixture, `
$ErrorActionPreference = 'Stop'
foreach ($Path in @($env:UR_BOOTSTRAP_INSTALL_SCRIPT, (Join-Path (Split-Path $env:UR_BOOTSTRAP_INSTALL_SCRIPT) 'uninstall.ps1'))) {
  $ParseErrors = $null
  [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$null, [ref]$ParseErrors) | Out-Null
  if ($ParseErrors.Count) { throw "PowerShell installer syntax error: $ParseErrors" }
}
function Invoke-RestMethod {
  param([string]$Uri, $Headers)
  if (!$Uri.EndsWith('/manifest.json')) { throw 'Unexpected bootstrap metadata request' }
  return ([IO.File]::ReadAllText($env:UR_BOOTSTRAP_MANIFEST) | ConvertFrom-Json)
}
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
  if (!$Uri.EndsWith('/' + [IO.Path]::GetFileName($env:UR_BOOTSTRAP_ARCHIVE))) { throw 'Unexpected bootstrap asset request' }
  [IO.File]::Copy($env:UR_BOOTSTRAP_ARCHIVE, $OutFile)
  $script:NativeDownloadCount++
}
$script:NativeDownloadCount = 0
for ($Attempt = 0; $Attempt -lt 2; $Attempt++) {
  & $env:UR_BOOTSTRAP_INSTALL_SCRIPT -Version $env:UR_BOOTSTRAP_VERSION -BinDirectory $env:UR_BOOTSTRAP_BIN -DataDirectory $env:UR_BOOTSTRAP_DATA -NoPathUpdate
}
if ($script:NativeDownloadCount -ne 1) { throw 'Repeated bootstrap downloaded the native archive again' }
$Output = & (Join-Path $env:UR_BOOTSTRAP_BIN 'ur.cmd') --version
if ($LASTEXITCODE -ne 0 -or $Output -cne ($env:UR_BOOTSTRAP_VERSION + ' (UR-Nexus)')) { throw 'Installed Windows launcher returned the wrong version' }
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
  console.log('PASS actual Windows bootstrap, repeat install, private data, and Unicode-path launcher')
} finally {
  if (passed) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  else console.error(`Windows bootstrap evidence retained at ${work}`)
}
