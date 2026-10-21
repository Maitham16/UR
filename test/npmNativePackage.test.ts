import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']

function fixture() {
  const work = mkdtempSync(join(tmpdir(), 'ur-npm-native-package-'))
  const directory = join(work, 'package')
  mkdirSync(join(directory, 'bin'), { recursive: true })
  mkdirSync(join(directory, 'dist'))
  mkdirSync(join(directory, 'sdk/python'), { recursive: true })
  const metadata = {
    name: 'ur-agent', version, type: 'module', bin: { ur: 'bin/ur.js' },
    files: ['bin', 'dist', 'sdk', 'README.md'], engines: { node: '>=22.12', bun: '>=1.3.0' },
    exports: { './sdk': { types: './sdk/index.d.ts', import: './sdk/index.js' } },
    dependencies: { protobufjs: '0.0.0-unavailable-fixture' }, devDependencies: { fixture: '*' },
    optionalDependencies: { optional: '*' }, peerDependencies: { peer: '*' },
    scripts: { prepack: 'exit 99', postinstall: 'exit 99' }, overrides: { fixture: '*' },
    patchedDependencies: { fixture: 'unused.patch' }, packageManager: 'bun@1.3.14',
  }
  const original = JSON.stringify(metadata)
  writeFileSync(join(directory, 'package.json'), original)
  writeFileSync(join(directory, 'bin/ur.js'), '#!/usr/bin/env node\nif (metadata.urDistribution === "native") await import("./npm-native.mjs");\n', { mode: 0o755 })
  writeFileSync(join(directory, 'bin/npm-native.mjs'), 'export function launchNpmNative() {}\n')
  writeFileSync(join(directory, 'dist/cli.js'), 'verified source bundle fixture\n')
  writeFileSync(join(directory, 'sdk/index.js'), 'export const sdkFixture = true;\n')
  writeFileSync(join(directory, 'sdk/index.d.ts'), 'export declare const sdkFixture: true;\n')
  writeFileSync(join(directory, 'sdk/python/pyproject.toml'), '[project]\nname="ur-agent-sdk"\nversion="0.0.0"\n')
  writeFileSync(join(directory, 'README.md'), 'verified release documentation\n')
  const source = join(work, 'source.tgz')
  execFileSync('tar', ['-czf', source, '-C', work, 'package'])
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const manifest = { schemaVersion: 1, version, sourceCommit, platforms: {} as Record<string, object> }
  for (const target of targets) {
    const file = `ur-${version}-${target}.tar.gz`
    const bytes = Buffer.from(`native archive fixture ${target}`)
    writeFileSync(join(work, file), bytes)
    manifest.platforms[target] = { file, executable: 'ur', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const manifestPath = join(work, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const out = join(work, 'output')
  return { work, directory, original, source, manifest, manifestPath, out }
}

function assemble(item: ReturnType<typeof fixture>, extra: string[] = []) {
  return spawnSync('node', [join(root, 'scripts/npm-native-package.mjs'), '--manifest', item.manifestPath,
    '--source-tarball', item.source, '--out-dir', item.out, ...extra], { cwd: root, encoding: 'utf8', timeout: 30_000 })
}

test('public npm assembler packs a dependency-free native bootstrap without mutating the verified source', () => {
  const item = fixture()
  const originalArchive = readFileSync(item.source)
  try {
    const result = assemble(item)
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const output = JSON.parse(result.stdout)
    expect(output.targets).toEqual(targets)
    expect(output.qualificationOnly).toBe(false)
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', output.tarball, 'package/package.json'], { encoding: 'utf8' }))
    expect(metadata.urDistribution).toBe('native')
    expect(metadata.engines).toEqual({ node: '>=22.12' })
    expect(metadata.os).toEqual(['darwin', 'linux'])
    expect(metadata.cpu).toEqual(['arm64', 'x64'])
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'scripts', 'overrides', 'patchedDependencies', 'packageManager']) expect(metadata[key], key).toBeUndefined()
    expect(metadata.bin).toEqual({ ur: 'bin/ur.js' })
    expect(metadata.exports['./sdk']).toEqual({ types: './sdk/index.d.ts', import: './sdk/index.js' })
    expect(execFileSync('tar', ['-xOf', output.tarball, 'package/sdk/index.js'], { encoding: 'utf8' })).toContain('sdkFixture')
    expect(JSON.parse(execFileSync('tar', ['-xOf', output.tarball, 'package/bin/native-release.json'], { encoding: 'utf8' }))).toEqual(item.manifest)
    expect(execFileSync('tar', ['-xOf', output.tarball, 'package/dist/cli.js'], { encoding: 'utf8' })).toBe('verified source bundle fixture\n')
    expect(execFileSync('tar', ['-xOf', output.tarball, 'package/README.md'], { encoding: 'utf8' })).toBe('verified release documentation\n')
    expect(readFileSync(join(item.directory, 'package.json'), 'utf8')).toBe(item.original)
    expect(readFileSync(item.source)).toEqual(originalArchive)
  } finally { rmSync(item.work, { recursive: true, force: true }) }
})

test('public assembler rejects missing/Windows/stale manifests and altered archive bytes before publishing', () => {
  const item = fixture()
  try {
    for (const change of [
      () => ({ ...item.manifest, platforms: { 'darwin-arm64': item.manifest.platforms['darwin-arm64'] } }),
      () => ({ ...item.manifest, platforms: { ...item.manifest.platforms, 'win32-x64': {} } }),
      () => ({ ...item.manifest, version: '0.0.1' }),
      () => ({ ...item.manifest, sourceCommit: '0'.repeat(40) }),
    ]) {
      writeFileSync(item.manifestPath, JSON.stringify(change()))
      const result = assemble(item)
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(existsSync(item.out)).toBe(false)
    }
    writeFileSync(item.manifestPath, JSON.stringify(item.manifest))
    writeFileSync(join(item.work, `ur-${version}-linux-x64.tar.gz`), 'tampered')
    const tampered = assemble(item)
    expect(tampered.status).not.toBe(0)
    expect(tampered.stderr).toContain('Native archive integrity failed: linux-x64')
    expect(existsSync(item.out)).toBe(false)
  } finally { rmSync(item.work, { recursive: true, force: true }) }
})

test('single-target npm qualification is explicit and cannot satisfy the public package gate', () => {
  const item = fixture()
  try {
    const target = 'darwin-arm64'
    writeFileSync(item.manifestPath, JSON.stringify({ ...item.manifest, platforms: { [target]: item.manifest.platforms[target] } }))
    expect(assemble(item).status).not.toBe(0)
    const qualified = assemble(item, ['--target', target])
    expect(qualified.status, qualified.stderr).toBe(0)
    expect(JSON.parse(qualified.stdout).qualificationOnly).toBe(true)
    expect(JSON.parse(qualified.stdout).targets).toEqual([target])
  } finally { rmSync(item.work, { recursive: true, force: true }) }
})
