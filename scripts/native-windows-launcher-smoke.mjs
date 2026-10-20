#!/usr/bin/env node
// Qualify the shipped native command-discovery shim without a JS runtime on PATH.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

if (process.platform !== 'win32') throw new Error('Native Windows launcher qualification requires Windows')
const args = process.argv.slice(2)
if (args.length !== 2 || !['--artifact-dir', '--launcher-executable'].includes(args[0])) {
  throw new Error('Usage: node scripts/native-windows-launcher-smoke.mjs --artifact-dir <directory> | --launcher-executable <absolute file>')
}
const work = mkdtempSync(join(realpathSync.native(process.env.RUNNER_TEMP || tmpdir()), 'ur bootstrap launcher 100% %UR_NATIVE_FIXTURE% [café!] '))
const bin = join(work, 'application bin'), data = join(work, 'application data'), home = join(work, 'private home')
const shim = join(bin, 'ur.exe'), activation = join(bin, 'ur.cmd'), executable = join(data, 'versions', 'probe-win32-x64', 'ur.exe')
for (const directory of [bin, home, join(data, 'versions', 'probe-win32-x64')]) mkdirSync(directory, { recursive: true })
const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const env = {
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
  USERNAME: 'ur-native-smoke', USER: 'ur-native-smoke', LOGNAME: 'ur-native-smoke', TEMP: work, TMP: work,
  SystemRoot: systemRoot, SYSTEMROOT: systemRoot, COMSPEC: join(systemRoot, 'System32', 'cmd.exe'),
  PSModulePath: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  PATH: bin, PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD', PROCESSOR_ARCHITECTURE: 'AMD64',
  UR_CONFIG_DIR: join(home, '.ur'), UR_NATIVE_FIXTURE: 'this value must never replace a literal path',
  CI: '1', DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
}
const evidence = { work, shim, bin, data, probes: [] }
writeFileSync(join(work, 'launcher-contract.json'), JSON.stringify(evidence, null, 2))
const digest = value => createHash('sha256').update(value).digest('hex')
function run(probe, file, arguments_, options = {}) {
  const result = spawnSync(file, arguments_, { cwd: home, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options })
  evidence.probes.push({ probe, file, args: arguments_, status: result.status, signal: result.signal, error: result.error?.message,
    stdoutBytes: Buffer.byteLength(result.stdout || ''), stderrBytes: Buffer.byteLength(result.stderr || ''),
    stdoutSha256: digest(result.stdout || ''), stderrSha256: digest(result.stderr || ''),
    stdoutSample: (result.stdout || '').slice(0, 1200), stderrSample: (result.stderr || '').slice(0, 1200) })
  writeFileSync(join(work, 'launcher-contract.json'), JSON.stringify(evidence, null, 2))
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${probe}: unexpected signal`)
  return result
}
const escaped = value => value.replaceAll('%', '%%')
const configuration = (binPath = bin, target = executable) => `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@"%SystemRoot%\\System32\\chcp.com" 65001 >nul\r\n@set "UR_NATIVE_BIN_DIR=${escaped(binPath)}"\r\n@set "UR_NATIVE_DATA_DIR=${escaped(data)}"\r\n"${escaped(target)}" %*\r\n`
let passed = false
try {
  if (args[0] === '--launcher-executable') {
    assert.ok(isAbsolute(args[1]), 'Launcher executable must be an absolute path')
    copyFileSync(args[1], shim)
  } else {
    const directory = resolve(args[1]), manifest = JSON.parse(readFileSync(join(directory, 'manifest-win32-x64.json'), 'utf8'))
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
    const asset = manifest.platforms['win32-x64'], bytes = readFileSync(join(directory, `ur-${manifest.version}-win32-x64.zip`))
    assert.equal(bytes.length, asset.size)
    assert.equal(digest(bytes), asset.sha256)
    const { unzipSync } = await import('fflate')
    let count = 0
    const name = 'resources/windows/ur-launcher.exe'
    const files = unzipSync(new Uint8Array(bytes), { filter: entry => {
      if (entry.name !== name) return false
      assert.ok(entry.originalSize > 0 && entry.originalSize <= 2 * 1024 * 1024, 'Unexpected launcher resource size')
      assert.equal(++count, 1, 'Duplicate launcher resource')
      return true
    } })
    assert.equal(count, 1, 'Archive has no native launcher resource')
    writeFileSync(shim, files[name])
  }
  evidence.launcherSha256 = digest(readFileSync(shim))
  const source = join(work, 'probe.ts')
  writeFileSync(source, `import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const [mode,...args]=process.argv.slice(2);
if(mode==='--version') process.stdout.write('launcher-probe-v1\\n');
else if(mode==='argv') console.log(JSON.stringify({args,bin:process.env.UR_NATIVE_BIN_DIR,data:process.env.UR_NATIVE_DATA_DIR}));
else if(mode==='exit') process.exit(Number(args[0]));
else if(mode==='io'){process.stdout.write(readFileSync(0));process.stdout.write('O'.repeat(320000));process.stderr.write('E'.repeat(320000));}
else if(mode==='activate'){const path=process.env.UR_NATIVE_BIN_DIR+'\\\\ur.cmd';writeFileSync(path+'.next',readFileSync(path));renameSync(path+'.next',path);console.log('activated');}
else process.exit(90);
`)
  const built = run('compile-private-probe', process.env.BUN_BIN || 'bun', ['build', '--compile', '--no-compile-autoload-bunfig', '--outfile', executable, source], { env: process.env, cwd: work, timeout: 120_000 })
  assert.equal(built.status, 0, 'Private native fixture compilation failed')
  const valid = configuration()
  writeFileSync(activation, valid)
  const forwarded = ['', 'spaced café 日本語', '100% %UR_NATIVE_FIXTURE% & ! []', 'embedded"quote', 'trailing\\', 'quote"with\\\\']
  const argv = run('arguments-and-managed-environment', shim, ['argv', ...forwarded])
  assert.equal(argv.status, 0)
  assert.equal(argv.stderr, '')
  assert.deepEqual(JSON.parse(argv.stdout), { args: forwarded, bin, data })
  for (const code of [7, 124]) assert.equal(run(`child-exit-${code}`, shim, ['exit', String(code)]).status, code)
  const input = '日本語 café % & "quoted"\\tail\n'.repeat(16000)
  const io = run('utf8-stdin-and-large-pipes', shim, ['io'], { input })
  assert.equal(io.status, 0)
  assert.ok(io.stdout === input + 'O'.repeat(320000), 'UTF-8 stdin/stdout bytes changed; see evidence sizes and hashes')
  assert.ok(io.stderr === 'E'.repeat(320000), 'Large stderr bytes changed; see evidence sizes and hashes')
  const normal = run('restricted-powershell-bare-ur', powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Restricted', '-Command', 'ur --version; exit $LASTEXITCODE'])
  assert.equal(normal.status, 0)
  assert.equal(normal.stdout.replace(/\r?\n$/, ''), 'launcher-probe-v1')
  assert.equal(normal.stderr, '')
  const activated = run('child-atomic-activation-replacement', shim, ['activate'])
  assert.equal(activated.status, 0)
  assert.equal(activated.stdout, 'activated\n')
  assert.equal(readFileSync(activation, 'utf8'), valid)
  const malformed = {
    bom: Buffer.from('\ufeff' + valid), utf16: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(valid, 'utf16le')]),
    'extra-command': Buffer.from(valid + '@echo unexpected\r\n'), 'unescaped-percent': Buffer.from(valid.replace('100%%', '100%')),
    'foreign-bin': Buffer.from(configuration(join(work, 'foreign bin'))), 'self-target': Buffer.from(configuration(bin, shim)),
    'embedded-nul': Buffer.concat([Buffer.from(valid), Buffer.from([0])]), 'invalid-utf8': Buffer.concat([Buffer.from(valid), Buffer.from([0xff])]),
  }
  for (const [name, bytes] of Object.entries(malformed)) {
    writeFileSync(activation, bytes)
    const rejected = run(`reject-${name}`, shim, ['--version'])
    assert.equal(rejected.status, 125, `${name}: corrupt configuration was accepted`)
    assert.equal(rejected.stdout, '')
  }
  passed = true
  console.log(`Windows native launcher contract: ${evidence.probes.length} probes passed`)
} catch (error) {
  console.error(`Windows launcher evidence retained at ${work}`)
  throw error
} finally {
  if (passed) rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
