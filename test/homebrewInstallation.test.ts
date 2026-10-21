import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getHomebrewInstallation,
  getHomebrewStableExecutable,
  getHomebrewUpgradeCommand,
  parseHomebrewExecutablePath,
} from '../src/utils/nativeInstaller/homebrew.ts'
import { resolveUrExecutable } from '../src/utils/urExecutable.ts'

test('Homebrew detection identifies UR formulae/casks across standard and custom prefixes', () => {
  for (const prefix of ['/opt/homebrew', '/usr/local', '/home/linuxbrew/.linuxbrew', '/custom brew [café!]']) {
    for (const name of ['ur', 'ur-agent', 'ur-nexus']) {
      for (const executable of ['libexec/ur', 'bin/ur']) {
        const expected = { kind: 'formula' as const, prefix, name, stableExecutable: `${prefix}/opt/${name}/${executable}` }
        expect(parseHomebrewExecutablePath(`${prefix}/Cellar/${name}/1.86.1_1/${executable}`)).toEqual(expected)
        expect(parseHomebrewExecutablePath(`${prefix}/opt/${name}/${executable}`)).toEqual(expected)
      }
      expect(parseHomebrewExecutablePath(`${prefix}/Caskroom/${name}/1.86.1/ur`)).toEqual({
        kind: 'cask', prefix, name, stableExecutable: `${prefix}/bin/ur`,
      })
    }
  }
})

test('Homebrew Node, Bun and npm installations are never classified as a Brew-owned UR', () => {
  for (const executable of [
    '/opt/homebrew/Cellar/node/24.0.0/bin/node', '/opt/homebrew/opt/node/bin/node',
    '/opt/homebrew/Cellar/bun/1.3.14/bin/bun', '/usr/local/opt/bun/bin/bun',
    '/opt/homebrew/lib/node_modules/ur-agent/bin/ur.js',
    '/opt/homebrew/Cellar/node/24.0.0/lib/node_modules/ur-agent/bin/ur.js',
    '/opt/homebrew/Cellar/ur/1.86.1/libexec/node_modules/ur-agent/bin/ur.js',
    '/opt/homebrew/Caskroom/another-tool/1.0/ur', '/opt/homebrew/bin/ur',
    '/opt/homebrew/Cellar/ur/1.86.1/resources/bin/rg',
    'Cellar/ur/1.86.1/bin/ur', '/opt/homebrew/Cellar/ur/../1.86.1/bin/ur',
    '/opt/homebrew/Cellar/ur/1.86.1/bin/ur\n',
  ]) expect(parseHomebrewExecutablePath(executable), executable).toBeNull()
})

test.skipIf(process.platform === 'win32')('Brew opt resolution survives keg cleanup and refuses misleading executable symlinks', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur-brew ownership-')))
  const keg = join(work, 'Cellar/ur/1.86.1')
  const nextKeg = join(work, 'Cellar/ur/1.86.2')
  const binary = join(keg, 'libexec/ur')
  const opt = join(work, 'opt/ur')
  try {
    mkdirSync(join(keg, 'libexec'), { recursive: true })
    mkdirSync(join(nextKeg, 'libexec'), { recursive: true })
    mkdirSync(join(work, 'opt'))
    mkdirSync(join(work, 'bin'))
    writeFileSync(binary, 'current release')
    writeFileSync(join(nextKeg, 'libexec/ur'), 'next release')
    symlinkSync(keg, opt)
    const command = join(work, 'bin/ur')
    symlinkSync(join(opt, 'libexec/ur'), command)
    expect(getHomebrewInstallation(command)?.kind).toBe('formula')
    expect(getHomebrewUpgradeCommand(command)).toBe('brew upgrade ur')
    const stable = getHomebrewStableExecutable(binary)
    expect(stable).toBe(join(opt, 'libexec/ur'))
    expect(resolveUrExecutable({ native: true, execPath: binary, preferStable: true })).toEqual({ file: stable, baseArgs: [] })
    unlinkSync(opt)
    symlinkSync(nextKeg, opt)
    expect(getHomebrewStableExecutable(binary)).toBeNull()
    rmSync(keg, { recursive: true })
    expect(readFileSync(stable!, 'utf8')).toBe('next release')
    expect(getHomebrewInstallation(binary)?.kind).toBe('formula')
    unlinkSync(command)
    const node = join(work, 'Cellar/node/24/bin/node')
    mkdirSync(join(work, 'Cellar/node/24/bin'), { recursive: true })
    writeFileSync(node, 'a runtime is not UR')
    symlinkSync(node, command)
    expect(getHomebrewInstallation(command)).toBeNull()
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('Homebrew upgrade instructions preserve formula/cask ownership', () => {
  expect(getHomebrewUpgradeCommand('/opt/homebrew/Cellar/ur/1.86.1/libexec/ur')).toBe('brew upgrade ur')
  expect(getHomebrewUpgradeCommand('/usr/local/Cellar/ur-agent/1.86.1/bin/ur')).toBe('brew upgrade ur-agent')
  expect(getHomebrewUpgradeCommand('/opt/homebrew/Caskroom/ur/1.86.1/ur')).toBe('brew upgrade --cask ur')
})

test('actual Brew update flow only prints Brew guidance and never installs another distribution', () => {
  const work = mkdtempSync(join(tmpdir(), 'ur-brew-update-'))
  try {
    const fixture = join(work, 'update.ts')
    const source = join(import.meta.dir, '../src/cli/update.ts')
    const utility = (path: string) => join(import.meta.dir, '../src', path)
    writeFileSync(fixture, `
import { mock } from 'bun:test';
let output = ''; let exitCode; let nativeCalls = 0; let npmCalls = 0;
mock.module(${JSON.stringify(utility('services/analytics/index.ts'))}, () => ({ logEvent() {} }));
mock.module(${JSON.stringify(utility('utils/doctorDiagnostic.ts'))}, () => ({ getDoctorDiagnostic: async () => ({ installationType: 'package-manager', packageManager: 'homebrew' }) }));
mock.module(${JSON.stringify(utility('utils/execFileNoThrow.ts'))}, () => ({ execFileNoThrowWithCwd: async () => { npmCalls++; throw new Error('npm must not run'); } }));
mock.module(${JSON.stringify(utility('utils/gracefulShutdown.ts'))}, () => ({ gracefulShutdown: async code => { exitCode = code; } }));
mock.module(${JSON.stringify(utility('utils/offlineMode.ts'))}, () => ({ isNetworkRestricted: () => false, offlineBlockReason: () => 'offline' }));
mock.module(${JSON.stringify(utility('utils/process.ts'))}, () => ({ writeToStdout: value => { output += value; } }));
mock.module(${JSON.stringify(utility('utils/nativeRelease.ts'))}, () => ({ fetchNativeVersion: async () => { nativeCalls++; throw new Error('native check must not run'); }, installNativeRelease: async () => { nativeCalls++; throw new Error('native installer must not run'); } }));
const { update } = await import(${JSON.stringify(source)});
await update();
console.log(JSON.stringify({ output, exitCode, nativeCalls, npmCalls }));
`)
    const result = spawnSync(process.execPath, [fixture], { cwd: join(import.meta.dir, '..'), encoding: 'utf8', timeout: 30_000 })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      output: 'Update UR-Nexus with Homebrew:\n  brew upgrade ur\n', exitCode: 0, nativeCalls: 0, npmCalls: 0,
    })
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('a real native Brew executable refuses ur install before network or filesystem changes', () => {
  const work = mkdtempSync(join(tmpdir(), 'ur-brew-install-guard-'))
  try {
    const home = join(work, 'private home')
    const binary = join(work, 'Cellar/ur/1.86.1/libexec/ur')
    mkdirSync(join(work, 'Cellar/ur/1.86.1/libexec'), { recursive: true })
    mkdirSync(home)
    const fixture = join(work, 'fixture.ts')
    writeFileSync(fixture, `
import { installLatest } from ${JSON.stringify(join(import.meta.dir, '../src/utils/nativeInstaller/installer.ts'))};
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('network is forbidden'); };
let message = '';
try { await installLatest('latest'); } catch (error) { message = error.message; }
console.log(JSON.stringify({ message, networkRequests }));
`)
    const built = spawnSync(process.execPath, ['build', fixture, '--compile', '--define', 'UR_NATIVE_BUILD=true',
      '--define', 'MACRO.VERSION="1.86.1"', '--define', 'MACRO.PACKAGE_URL="ur-agent"', '--define', 'MACRO.BUILD_TIME=""',
      '--define', 'MACRO.NATIVE_PACKAGE_URL=undefined', '--define', 'MACRO.FEEDBACK_CHANNEL="https://example.invalid/issues"',
      '--define', 'MACRO.ISSUES_EXPLAINER="fixture"', '--define', 'MACRO.VERSION_CHANGELOG=""',
      '--external', 'sharp', '--external', 'audio-capture-napi', '--external', 'playwright-core', '--outfile', binary], {
      cwd: join(import.meta.dir, '..'), encoding: 'utf8', timeout: 90_000, env: { ...process.env, NODE_ENV: 'production' },
    })
    expect(built.status, built.stderr).toBe(0)
    const result = spawnSync(binary, [], {
      cwd: work, encoding: 'utf8', timeout: 15_000,
      env: { HOME: home, USER: 'ur-brew-guard', PATH: '', UR_CONFIG_DIR: join(home, '.ur'),
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      message: 'This UR installation is managed by Homebrew. Run: brew upgrade ur', networkRequests: 0,
    })
    expect(readFileSync(binary).length).toBeGreaterThan(0)
    expect(existsSync(join(home, '.local/bin/ur'))).toBe(false)
    expect(existsSync(join(home, '.local/share/ur'))).toBe(false)
  } finally { rmSync(work, { recursive: true, force: true }) }
}, 120_000)
