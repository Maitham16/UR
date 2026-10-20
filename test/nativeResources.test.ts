import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('installed native resources', () => {
  let directory: string
  let executable: string
  let project: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ur native resource fixture '))
    executable = join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture')
    project = join(directory, 'unrelated project')
    const resources = join(directory, 'resources')
    mkdirSync(join(resources, 'node_modules', 'fixture-sidecar'), { recursive: true })
    mkdirSync(join(project, 'resources', 'node_modules', 'fixture-sidecar'), { recursive: true })
    mkdirSync(join(directory, 'node_modules', 'parent-only'), { recursive: true })
    writeFileSync(join(directory, 'node_modules', 'parent-only', 'package.json'), '{"name":"parent-only","main":"index.js"}')
    writeFileSync(join(directory, 'node_modules', 'parent-only', 'index.js'), 'module.exports = "must not load"')
    writeFileSync(join(resources, 'package.json'), '{"private":true,"urNativeModuleEntrypoints":{"generated-sidecar":"modules/generated.cjs","unsafe-sidecar":"../outside.cjs"}}')
    mkdirSync(join(resources, 'modules'), { recursive: true })
    writeFileSync(join(resources, 'modules', 'generated.cjs'), "module.exports = require('./helper.cjs')")
    writeFileSync(join(resources, 'modules', 'helper.cjs'), 'module.exports = "generated module"')
    writeFileSync(join(directory, 'outside.cjs'), 'module.exports = "must not load"')
    writeFileSync(join(resources, 'marker.txt'), 'installation resource')
    writeFileSync(join(resources, 'manifest.json'), '{"schemaVersion":1,"version":"fixture","files":{}}')
    for (const [base, value] of [[resources, 'installed module'], [join(project, 'resources'), 'project impostor']]) {
      writeFileSync(join(base!, 'node_modules', 'fixture-sidecar', 'package.json'), '{"name":"fixture-sidecar","main":"index.js"}')
      writeFileSync(join(base!, 'node_modules', 'fixture-sidecar', 'index.js'), `module.exports = ${JSON.stringify(value)}`)
    }
    const entry = join(directory, 'entry.ts')
    writeFileSync(entry, `
import { readFileSync } from 'node:fs';
import { getNativeResourcePath, requireNativeResource, loadNativeModule, readNativeResourceManifest } from ${JSON.stringify(resolve(import.meta.dir, '../src/utils/nativeResources.ts'))};
if (process.argv[2] === 'escape') { getNativeResourcePath('../outside'); }
else if (process.argv[2] === 'missing') { requireNativeResource('missing.txt'); }
else if (process.argv[2] === 'parent-module') { loadNativeModule('parent-only'); }
else if (process.argv[2] === 'generated-module') { console.log(loadNativeModule('generated-sidecar')); }
else if (process.argv[2] === 'unsafe-module') { loadNativeModule('unsafe-sidecar'); }
else console.log(JSON.stringify({text:readFileSync(requireNativeResource('marker.txt'),'utf8'),module:loadNativeModule('fixture-sidecar'),version:readNativeResourceManifest()?.version}));
`)
    execFileSync(process.execPath, ['build', entry, '--compile', '--define', 'UR_NATIVE_BUILD=true', '--outfile', executable], { stdio: 'pipe' })
  }, 120_000)

  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  test('resolves installed data and module sidecars from an unrelated project', () => {
    const result = spawnSync(executable, [], { cwd: project, env: { PATH: '' }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ text: 'installation resource', module: 'installed module', version: 'fixture' })
  })

  test('rejects resource traversal and reports incomplete installs', () => {
    const escape = spawnSync(executable, ['escape'], { encoding: 'utf8' })
    expect(escape.status).not.toBe(0)
    expect(escape.stderr).toContain('escapes the installation')
    const missing = spawnSync(executable, ['missing'], { encoding: 'utf8' })
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('Reinstall this version of UR')
    const parentModule = spawnSync(executable, ['parent-module'], { encoding: 'utf8' })
    expect(parentModule.status).not.toBe(0)
    expect(parentModule.stderr).toContain('Reinstall this version of UR')
    const unsafe = spawnSync(executable, ['unsafe-module'], { encoding: 'utf8' })
    expect(unsafe.status).not.toBe(0)
    expect(unsafe.stderr).toContain('Reinstall this version of UR')
  })

  test('loads generated native JS closures and relative dependencies', () => {
    const result = spawnSync(executable, ['generated-module'], { cwd: project, env: { PATH: '' }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('generated module')
  })

  test.skipIf(process.platform === 'win32')('stable executable symlinks retain their version resources', () => {
    const link = join(project, 'ur')
    symlinkSync(executable, link)
    const result = spawnSync(link, [], { cwd: project, env: { PATH: '' }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).module).toBe('installed module')
  })
})
