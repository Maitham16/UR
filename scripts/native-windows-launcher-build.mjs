#!/usr/bin/env node
// Build the Windows command-discovery shim with a static Microsoft C runtime.
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const source = fileURLToPath(new URL('./windows-native-launcher.c', import.meta.url))

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
    ...options,
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Windows launcher compiler failed (${result.error?.message ?? `exit ${result.status}`}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return result.stdout.trim()
}

function checkedPath(value, description) {
  if (!value || !isAbsolute(value) || /["\r\n\0]/.test(value)) throw new Error(`Invalid ${description}: an absolute literal Windows path is required`)
  if (!existsSync(value)) throw new Error(`Missing ${description}: ${value}`)
  return value
}

export function buildWindowsNativeLauncher(outFile) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build the Windows native launcher on a Windows x64 host with Visual Studio 2022 C++ tools')
  if (typeof outFile !== 'string' || !outFile || /["\r\n\0]/.test(outFile)) throw new Error('A valid Windows launcher output file is required')
  const destination = resolve(outFile)
  const systemRoot = checkedPath(process.env.SystemRoot ?? process.env.SYSTEMROOT, 'SystemRoot')
  const cmd = checkedPath(join(systemRoot, 'System32', 'cmd.exe'), 'Windows command processor')
  const programFiles = checkedPath(process.env['ProgramFiles(x86)'], 'ProgramFiles(x86)')
  const vswhere = checkedPath(join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'), 'Visual Studio discovery tool')
  const installation = checkedPath(run(vswhere, [
    '-latest', '-products', '*', '-version', '[17.0,18.0)',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath',
  ]), 'Visual Studio 2022 C++ installation')
  const developerCommand = checkedPath(join(installation, 'Common7', 'Tools', 'VsDevCmd.bat'), 'Visual Studio developer command')
  checkedPath(source, 'Windows launcher C source')
  const work = mkdtempSync(join(tmpdir(), 'ur-msvc-launcher-'))
  chmodSync(work, 0o700)
  try {
    copyFileSync(source, join(work, 'launcher.c'))
    // CMD expands this one fixed variable exactly once. No CALL or recursively
    // expanded repository/output paths pass through the command interpreter.
    const command = '""%UR_MSVC_VSDEVCMD%" -no_logo -arch=x64 -host_arch=x64 && cl.exe /nologo /O2 /MT /W4 /WX /utf-8 /Brepro /Folauncher.obj /Felauncher.exe launcher.c /link /Brepro /SUBSYSTEM:CONSOLE /INCREMENTAL:NO"'
    const output = run(cmd, ['/d', '/v:off', '/s', '/c', command], {
      cwd: work, windowsVerbatimArguments: true,
      env: { ...process.env, UR_MSVC_VSDEVCMD: developerCommand },
    })
    const executable = join(work, 'launcher.exe')
    if (!existsSync(executable)) throw new Error(`MSVC did not create the Windows launcher executable:\n${output}`)
    const bytes = readFileSync(executable)
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Windows launcher compiler output has no PE header')
    const pe = bytes.readUInt32LE(0x3c)
    if (pe < 64 || pe + 94 > bytes.length || bytes.readUInt32LE(pe) !== 0x00004550 || bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(pe + 92) !== 3) {
      throw new Error('Windows launcher compiler output must be a Windows x64 console executable')
    }
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(executable, destination)
    return destination
  } finally {
    try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    catch (error) { console.warn(`Windows launcher compiler temporary files remain at ${work}: ${error instanceof Error ? error.message : String(error)}`) }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--out-file') throw new Error('Usage: node scripts/native-windows-launcher-build.mjs --out-file <launcher.exe>')
    console.log(`Windows native launcher built: ${buildWindowsNativeLauncher(process.argv[3])}`)
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  }
}
