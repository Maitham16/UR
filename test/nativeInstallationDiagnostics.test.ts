import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'ur custom install diagnostics '))
const binDir = join(root, 'custom bin')
const dataDir = join(root, 'custom data')
const release = join(dataDir, 'versions', 'fixture-release')
const executable = join(release, process.platform === 'win32' ? 'ur.exe' : 'ur')
const launcher = join(binDir, process.platform === 'win32' ? 'ur.cmd' : 'ur')

beforeAll(() => {
  mkdirSync(binDir, { recursive: true })
  mkdirSync(join(release, 'resources', 'bin'), { recursive: true })
  // Doctor only reports ripgrep's configured path; this fixture never runs it.
  writeFileSync(join(release, 'resources', 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg'), 'diagnostic resource fixture')
  const entry = join(root, 'fixture.ts')
  writeFileSync(entry, `
import { getDoctorDiagnostic } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/doctorDiagnostic.ts'))};
import { checkInstall } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/nativeInstaller/installer.ts'))};
import { enableConfigs, getGlobalConfig, _setGlobalConfigCacheForTesting } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/config.ts'))};
import { setOriginalCwd, setCwdState, setAllowedSettingSources } from ${JSON.stringify(resolve(import.meta.dir, '../src/bootstrap/state.ts'))};
setOriginalCwd(process.cwd()); setCwdState(process.cwd()); setAllowedSettingSources([]);
enableConfigs(); _setGlobalConfigCacheForTesting({...getGlobalConfig(), installMethod:'native'});
console.log(JSON.stringify({diagnostic:await getDoctorDiagnostic(), setup:await checkInstall()}));
`)
  const built = spawnSync(process.execPath, [
    'build', entry, '--compile', '--define', 'UR_NATIVE_BUILD=true', '--define', 'MACRO.VERSION="fixture-version"',
    '--define', 'MACRO.PACKAGE_URL="ur-agent"', '--define', 'MACRO.BUILD_TIME=""',
    '--define', 'MACRO.NATIVE_PACKAGE_URL=undefined', '--define', 'MACRO.FEEDBACK_CHANNEL="https://example.invalid/issues"',
    '--define', 'MACRO.ISSUES_EXPLAINER="fixture"', '--define', 'MACRO.VERSION_CHANGELOG=""',
    '--external', 'sharp', '--external', 'audio-capture-napi', '--external', 'playwright-core', '--outfile', executable,
  ], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, NODE_ENV: 'production' } })
  if (built.status !== 0) throw new Error(`Diagnostic fixture compilation failed: ${built.stderr}`)
  if (process.platform === 'win32') writeFileSync(launcher, `@echo off\r\n"${executable}" %*\r\n`)
  else symlinkSync(executable, launcher)
}, 130_000)
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

function inspect(path: string) {
  const result = spawnSync(executable, [], {
    cwd: root,
    env: {
      ...process.env, PATH: path, HOME: root, USERPROFILE: root, UR_CONFIG_DIR: join(root, 'config'),
      UR_NATIVE_BIN_DIR: binDir, UR_NATIVE_DATA_DIR: dataDir,
      NODE_ENV: 'production', UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
    },
    encoding: 'utf8', timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as {
    diagnostic: { installationType: string; multipleInstallations: Array<{ type: string; path: string }>; warnings: Array<{ issue: string; fix: string }> }
    setup: Array<{ type: string; message: string }>
  }
}

test('compiled diagnostics find the configured native launcher and report its actual missing PATH directory', () => {
  const { diagnostic, setup } = inspect('')
  expect(diagnostic.installationType).toBe('native')
  expect(diagnostic.multipleInstallations).toContainEqual({ type: 'native', path: launcher })
  expect(setup.filter(message => message.type === 'error')).toEqual([])
  const warning = diagnostic.warnings.find(item => item.issue.includes('not in your PATH'))
  expect(warning?.issue).toContain(binDir)
  const message = setup.find(item => item.type === 'path')?.message
  expect(message).toContain(binDir)
  if (process.platform === 'win32') {
    expect(warning?.fix).toContain('User PATH')
    expect(message).toContain('User PATH')
    expect(warning?.fix).not.toContain('export PATH')
    expect(message).not.toContain('export PATH')
  } else {
    expect(warning?.fix).toContain(`export PATH='${binDir}'`)
    expect(message).toContain(`export PATH='${binDir}'`)
  }
})

test('configured native PATH membership handles trailing separators and Windows case differences', () => {
  const path = process.platform === 'win32' ? `${binDir.toUpperCase()}\\` : `${binDir}/`
  const { diagnostic, setup } = inspect(path)
  expect(diagnostic.warnings.filter(item => item.issue.includes('not in your PATH'))).toEqual([])
  expect(setup.filter(message => message.type === 'path')).toEqual([])
})
