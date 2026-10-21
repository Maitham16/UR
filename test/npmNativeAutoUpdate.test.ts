import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dir, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string

test.skipIf(process.platform === 'win32')('compiled npm-native permission checks and upgrades invoke npm while preserving independent launchers and aliases', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ur npm updater ')))
  try {
    const home = join(work, 'home'), bin = join(work, 'bin'), prefix = join(work, 'prefix')
    const packageRoot = join(work, 'node_modules/ur-agent'), platform = `${process.platform}-${process.arch}`
    const cache = join(work, 'cache'), payload = join(cache, 'ur/npm', `${version}-${platform}`, 'ur')
    for (const directory of [home, bin, prefix, join(packageRoot, 'bin'), join(cache, 'ur/npm', `${version}-${platform}`), join(home, '.local/bin')]) mkdirSync(directory, { recursive: true })
    const launcher = join(packageRoot, 'bin/ur.js'), node = join(work, 'node')
    writeFileSync(launcher, 'fixture npm launcher')
    writeFileSync(node, 'fixture Node executable')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'ur-agent', version, urDistribution: 'native', bin: { ur: 'bin/ur.js' } }))
    writeFileSync(join(packageRoot, 'bin/native-release.json'), JSON.stringify({ schemaVersion: 1, version, sourceCommit: 'a'.repeat(40), platforms: { [platform]: {} } }))
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$UR_TEST_NPM_LOG"\nif [ "$1" = -g ]; then printf "%s\\n" "$UR_TEST_NPM_PREFIX"; fi\n', { mode: 0o755 })
    const other = join(work, 'independent-native-ur')
    writeFileSync(other, 'independent native installation')
    symlinkSync(other, join(home, '.local/bin/ur'))
    const alias = `alias ur='${other}'\n`
    writeFileSync(join(home, '.zshrc'), alias)
    const source = join(work, 'probe.ts')
    writeFileSync(source, `
import { getGlobalPackageManager, checkGlobalInstallPermissions, installGlobalPackage } from ${JSON.stringify(join(root, 'src/utils/autoUpdater.ts'))};
import { enableConfigs, getGlobalConfig, _setGlobalConfigCacheForTesting } from ${JSON.stringify(join(root, 'src/utils/config.ts'))};
import { setOriginalCwd, setCwdState, setAllowedSettingSources } from ${JSON.stringify(join(root, 'src/bootstrap/state.ts'))};
setOriginalCwd(process.cwd()); setCwdState(process.cwd()); setAllowedSettingSources([]); enableConfigs(); _setGlobalConfigCacheForTesting({...getGlobalConfig()});
console.log(JSON.stringify({ embeddedBun: typeof Bun !== 'undefined', manager: getGlobalPackageManager(), permissions: await checkGlobalInstallPermissions(), status: await installGlobalPackage('1.86.2') }));
`)
    const built = spawnSync(process.execPath, ['build', source, '--compile', '--define', 'UR_NATIVE_BUILD=true',
      '--define', `MACRO.VERSION=${JSON.stringify(version)}`, '--define', 'MACRO.PACKAGE_URL="ur-agent"',
      '--define', 'MACRO.BUILD_TIME=""', '--define', 'MACRO.NATIVE_PACKAGE_URL=undefined',
      '--define', 'MACRO.FEEDBACK_CHANNEL="https://example.invalid/issues"', '--define', 'MACRO.ISSUES_EXPLAINER="fixture"',
      '--define', 'MACRO.VERSION_CHANGELOG=""', '--external', 'sharp', '--external', 'audio-capture-napi',
      '--external', 'playwright-core', '--outfile', payload], { cwd: root, encoding: 'utf8', timeout: 90_000 })
    expect(built.status, built.stderr).toBe(0)
    const log = join(work, 'npm.log')
    const result = spawnSync(payload, [], { cwd: work, encoding: 'utf8', timeout: 30_000,
      env: { HOME: home, USER: 'ur-npm-updater', SHELL: '/bin/zsh', PATH: bin, UR_CONFIG_DIR: join(home, 'config'),
        XDG_CACHE_HOME: cache, UR_NPM_PACKAGE_ROOT: packageRoot, UR_NPM_LAUNCHER_PATH: launcher,
        UR_NPM_NODE_EXECUTABLE: node, UR_NPM_NATIVE_EXECUTABLE: payload, UR_TEST_NPM_LOG: log, UR_TEST_NPM_PREFIX: prefix,
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ embeddedBun: true, manager: 'npm', permissions: { hasPermissions: true, npmPrefix: prefix }, status: 'success' })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['-g config get prefix', '-g config get prefix', 'install -g ur-agent@1.86.2'])
    expect(realpathSync(join(home, '.local/bin/ur'))).toBe(other)
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(alias)
  } finally { rmSync(work, { recursive: true, force: true }) }
}, 120_000)

test('actual npm background update never removes an independent native launcher', () => {
  const work = mkdtempSync(join(tmpdir(), 'ur npm background update '))
  try {
    const fixture = join(work, 'probe.ts')
    const source = (file: string) => join(root, 'src', file)
    // Resolve ESM package exports from this repository. Bare mock names from
    // a temporary entrypoint can resolve to a different module identity.
    const dependency = (name: string) => fileURLToPath(import.meta.resolve(name))
    writeFileSync(fixture, `
import { mock } from 'bun:test';
globalThis.MACRO = {VERSION:${JSON.stringify(version)}};
const effects=[]; let installs=0, removals=0;
mock.module(${JSON.stringify(dependency('react'))},()=>({ useState:value=>[value,()=>{}], useEffect:fn=>effects.push(fn), useRef:value=>({current:value}), useCallback:fn=>fn }));
mock.module(${JSON.stringify(dependency('react/jsx-runtime'))},()=>({jsx:()=>null,jsxs:()=>null,Fragment:()=>null}));
mock.module(${JSON.stringify(dependency('react/jsx-dev-runtime'))},()=>({jsxDEV:()=>null,Fragment:()=>null}));
mock.module(${JSON.stringify(dependency('usehooks-ts'))},()=>({useInterval(){}}));
mock.module(${JSON.stringify(source('services/analytics/index.ts'))},()=>({logEvent(){}}));
mock.module(${JSON.stringify(source('hooks/useUpdateNotification.ts'))},()=>({useUpdateNotification:()=>null}));
mock.module(${JSON.stringify(source('ink.ts'))},()=>({Box:()=>null,Text:()=>null}));
mock.module(${JSON.stringify(source('utils/autoUpdater.ts'))},()=>({getLatestVersion:async()=> '999.0.0',getMaxVersion:async()=>null,shouldSkipVersion:()=>false,installGlobalPackage:async()=>{installs++;return 'success';}}));
mock.module(${JSON.stringify(source('utils/config.ts'))},()=>({getGlobalConfig:()=>({installMethod:'global'}),isAutoUpdaterDisabled:()=>false}));
mock.module(${JSON.stringify(source('utils/debug.ts'))},()=>({logForDebugging(){}}));
mock.module(${JSON.stringify(source('utils/doctorDiagnostic.ts'))},()=>({getCurrentInstallationType:async()=> 'npm-global'}));
mock.module(${JSON.stringify(source('utils/localInstaller.ts'))},()=>({localInstallationExists:async()=>false,installOrUpdateURPackage:async()=>{throw new Error('unexpected local install');}}));
mock.module(${JSON.stringify(source('utils/nativeInstaller/index.ts'))},()=>({removeInstalledSymlink:async()=>{removals++;}}));
mock.module(${JSON.stringify(source('utils/settings/settings.ts'))},()=>({getInitialSettings:()=>({autoUpdatesChannel:'latest'})}));
const {AutoUpdater}=await import(${JSON.stringify(source('components/AutoUpdater.tsx'))});
AutoUpdater({isUpdating:false,onChangeIsUpdating(){},onAutoUpdaterResult(){},autoUpdaterResult:null,showSuccessMessage:false,verbose:false});
for(const effect of effects) effect();
await new Promise(resolve=>setTimeout(resolve,30));
console.log(JSON.stringify({installs,removals}));
`)
    const home = join(work, 'home')
    mkdirSync(home)
    const result = spawnSync(process.execPath, [fixture], { cwd: work, encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, BUN_BIN: process.execPath, HOME: home, NODE_ENV: 'production',
        USER: 'ur-npm-background-test', UR_CONFIG_DIR: join(home, 'config'),
        UR_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' } })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ installs: 1, removals: 0 })
  } finally { rmSync(work, { recursive: true, force: true }) }
})
