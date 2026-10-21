import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getNpmNativeInstallation } from '../src/utils/npmNativeInstallation.ts'

const root = resolve(import.meta.dir, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const platform = `${process.platform}-${process.arch}`

function fixture() {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur npm channel [café!] ')))
  const packageRoot = join(work, 'node_modules/ur-agent')
  const cache = join(work, 'cache')
  const nativeExecutable = join(cache, 'ur/npm', `${version}-${platform}`, 'ur')
  const launcherPath = join(packageRoot, 'bin/ur.js')
  const nodeExecutable = join(work, 'node')
  mkdirSync(join(packageRoot, 'bin'), { recursive: true })
  mkdirSync(join(cache, 'ur/npm', `${version}-${platform}`), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'ur-agent', version, urDistribution: 'native', bin: { ur: 'bin/ur.js' } }))
  writeFileSync(join(packageRoot, 'bin/native-release.json'), JSON.stringify({ schemaVersion: 1, version, sourceCommit: 'a'.repeat(40), platforms: { [platform]: {} } }))
  writeFileSync(launcherPath, 'fixture launcher')
  writeFileSync(nativeExecutable, 'fixture payload')
  writeFileSync(nodeExecutable, 'fixture Node executable')
  const env = { XDG_CACHE_HOME: cache, UR_NPM_PACKAGE_ROOT: packageRoot,
    UR_NPM_LAUNCHER_PATH: launcherPath, UR_NPM_NODE_EXECUTABLE: nodeExecutable,
    UR_NPM_NATIVE_EXECUTABLE: nativeExecutable }
  return { work, packageRoot, launcherPath, nodeExecutable, nativeExecutable, env }
}

function compileProbe(source: string, executable: string) {
  return spawnSync(process.execPath, ['build', source, '--compile', '--define', 'UR_NATIVE_BUILD=true',
    '--define', `MACRO.VERSION=${JSON.stringify(version)}`, '--define', 'MACRO.PACKAGE_URL="ur-agent"',
    '--define', 'MACRO.BUILD_TIME=""', '--define', 'MACRO.NATIVE_PACKAGE_URL=undefined',
    '--define', 'MACRO.FEEDBACK_CHANNEL="https://example.invalid/issues"', '--define', 'MACRO.ISSUES_EXPLAINER="fixture"',
    '--define', 'MACRO.VERSION_CHANGELOG=""', '--external', 'sharp', '--external', 'audio-capture-napi',
    '--external', 'playwright-core', '--outfile', executable], { cwd: root, encoding: 'utf8', timeout: 90_000 })
}

test('npm channel identity belongs to the exact package, release, launcher and cache executable', () => {
  const item = fixture()
  try {
    const options = { env: item.env, execPath: item.nativeExecutable, version, platform }
    expect(getNpmNativeInstallation(options)).toEqual({ packageRoot: item.packageRoot,
      launcherPath: item.launcherPath, nodeExecutable: item.nodeExecutable, nativeExecutable: item.nativeExecutable })
    expect(getNpmNativeInstallation({ ...options, version: '0.0.1' })).toBeNull()
    expect(getNpmNativeInstallation({ ...options, execPath: item.nodeExecutable })).toBeNull()
    expect(getNpmNativeInstallation({ ...options, env: { ...item.env, UR_NPM_LAUNCHER_PATH: item.nodeExecutable } })).toBeNull()
    expect(getNpmNativeInstallation({ ...options, env: { ...item.env, XDG_CACHE_HOME: join(item.work, 'foreign cache') } })).toBeNull()
    expect(getNpmNativeInstallation({ ...options, env: { ...item.env, UR_NPM_NATIVE_EXECUTABLE: 'relative/ur' } })).toBeNull()
    writeFileSync(join(item.packageRoot, 'package.json'), JSON.stringify({ name: 'other-agent', version, urDistribution: 'native', bin: { ur: 'bin/ur.js' } }))
    expect(getNpmNativeInstallation(options)).toBeNull()
  } finally { rmSync(item.work, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('native npm launches retain npm ownership and reject native reinstallation without network', () => {
  const item = fixture()
  try {
    const source = join(item.work, 'probe.ts')
    writeFileSync(source, `
import { getCurrentInstallationType } from ${JSON.stringify(join(root, 'src/utils/doctorDiagnostic.ts'))};
import { resolveUrExecutable } from ${JSON.stringify(join(root, 'src/utils/urExecutable.ts'))};
import { installLatest, checkInstall } from ${JSON.stringify(join(root, 'src/utils/nativeInstaller/installer.ts'))};
import { saveGlobalConfig } from ${JSON.stringify(join(root, 'src/utils/config.ts'))};
saveGlobalConfig(current => ({ ...current, installMethod: 'native' }));
let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('network is forbidden'); };
let message = ''; try { await installLatest('latest'); } catch (error) { message = error.message; }
console.log(JSON.stringify({ type: await getCurrentInstallationType(), stable: resolveUrExecutable({ preferStable: true }), warnings: await checkInstall(), message, requests }));
`)
    const compiled = compileProbe(source, item.nativeExecutable)
    expect(compiled.status, compiled.stderr).toBe(0)
    const home = join(item.work, 'home')
    mkdirSync(home)
    const result = spawnSync(item.nativeExecutable, [], { cwd: item.work, encoding: 'utf8', timeout: 20_000,
      env: { ...item.env, HOME: home, PATH: '', USER: 'ur-npm-test', UR_CONFIG_DIR: join(home, 'config'),
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ type: 'npm-global',
      stable: { file: item.nodeExecutable, baseArgs: [item.launcherPath] },
      warnings: [], message: 'This UR installation is managed by npm. Run: npm install -g ur-agent@latest', requests: 0 })
    expect(existsSync(join(home, '.local/bin/ur'))).toBe(false)
    expect(existsSync(join(home, '.local/share/ur'))).toBe(false)
  } finally { rmSync(item.work, { recursive: true, force: true }) }
}, 120_000)

test.skipIf(process.platform === 'win32')('running npm agents retain their validated channel after package upgrade and removal', () => {
  const item = fixture()
  try {
    const source = join(item.work, 'lifetime.ts')
    writeFileSync(source, `
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getNpmNativeInstallation } from ${JSON.stringify(join(root, 'src/utils/npmNativeInstallation.ts'))};
import { getCurrentInstallationType } from ${JSON.stringify(join(root, 'src/utils/doctorDiagnostic.ts'))};
import { getGlobalPackageManager } from ${JSON.stringify(join(root, 'src/utils/autoUpdater.ts'))};
import { resolveUrExecutable } from ${JSON.stringify(join(root, 'src/utils/urExecutable.ts'))};
import { installLatest } from ${JSON.stringify(join(root, 'src/utils/nativeInstaller/installer.ts'))};
let requests=0; globalThis.fetch=async()=>{requests++;throw new Error('network is forbidden');};
async function snapshot() {
 let message='';try{await installLatest('latest');}catch(error){message=error.message;}
 return {type:await getCurrentInstallationType(),manager:getGlobalPackageManager(),stable:resolveUrExecutable({preferStable:true}),explicitStable:resolveUrExecutable({preferStable:true,execPath:process.execPath}),fresh:getNpmNativeInstallation({execPath:process.execPath})!==null,message};
}
const initial=getNpmNativeInstallation();if(!initial)throw new Error('Initial npm identity is missing');
const pristine=await snapshot();
initial.launcherPath='/must-not-poison-the-cached-identity';
const packageFile=join(process.env.UR_NPM_PACKAGE_ROOT,'package.json');
const manifestFile=join(process.env.UR_NPM_PACKAGE_ROOT,'bin/native-release.json');
writeFileSync(packageFile,JSON.stringify({name:'ur-agent',version:'999.0.0',urDistribution:'native',bin:{ur:'bin/ur.js'}}));
writeFileSync(manifestFile,JSON.stringify({schemaVersion:1,version:'999.0.0',sourceCommit:'b'.repeat(40),platforms:{[${JSON.stringify(platform)}]:{}}}));
const upgraded=await snapshot();
rmSync(packageFile);rmSync(manifestFile);rmSync(process.env.UR_NPM_LAUNCHER_PATH);
const removed=await snapshot();
console.log(JSON.stringify({pristine,upgraded,removed,requests}));
`)
    const compiled = compileProbe(source, item.nativeExecutable)
    expect(compiled.status, compiled.stderr).toBe(0)
    const home = join(item.work, 'home')
    mkdirSync(home)
    const result = spawnSync(item.nativeExecutable, [], { cwd: item.work, encoding: 'utf8', timeout: 20_000,
      env: { ...item.env, HOME: home, PATH: '', USER: 'ur-npm-lifetime', UR_CONFIG_DIR: join(home, 'config'),
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const expected = { type: 'npm-global', manager: 'npm', stable: { file: item.nodeExecutable, baseArgs: [item.launcherPath] },
      message: 'This UR installation is managed by npm. Run: npm install -g ur-agent@latest' }
    const initialStable = { file: item.nodeExecutable, baseArgs: [item.launcherPath] }
    const currentExecutable = { file: item.nativeExecutable, baseArgs: [] }
    expect(JSON.parse(result.stdout)).toEqual({ pristine: { ...expected, fresh: true, explicitStable: initialStable },
      upgraded: { ...expected, fresh: false, explicitStable: currentExecutable },
      removed: { ...expected, fresh: false, explicitStable: currentExecutable }, requests: 0 })
    expect(existsSync(join(home, '.local/bin/ur'))).toBe(false)
    expect(existsSync(join(home, '.local/share/ur'))).toBe(false)
  } finally { rmSync(item.work, { recursive: true, force: true }) }
}, 120_000)
