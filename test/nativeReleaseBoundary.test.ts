import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const root = join(import.meta.dir, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string
const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']

function addArtifact(directory: string, platform: string, sourceCommit: string) {
  const windows = platform.startsWith('win32')
  const file = `ur-${version}-${platform}.${windows ? 'zip' : 'tar.gz'}`
  const bytes = Buffer.from(`opaque archive fixture for ${platform}`)
  writeFileSync(join(directory, file), bytes)
  writeFileSync(join(directory, `manifest-${platform}.json`), JSON.stringify({
    schemaVersion: 1, version, sourceCommit,
    platforms: { [platform]: {
      file, executable: windows ? 'ur.exe' : 'ur', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    } },
  }))
}

test('public native manifest requires exactly the four tested Mac/Linux targets', () => {
  const work = mkdtempSync(join(tmpdir(), 'ur-release-boundary-'))
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const merge = (directory: string) => spawnSync('node', [join(root, 'scripts/native-manifest.mjs'), directory], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  })
  try {
    const complete = join(work, 'complete')
    mkdirSync(complete)
    for (const platform of platforms) addArtifact(complete, platform, sourceCommit)
    const accepted = merge(complete)
    expect(accepted.error).toBeUndefined()
    expect(accepted.status, accepted.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(join(complete, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.platforms).sort()).toEqual([...platforms].sort())
    expect(manifest.sourceCommit).toBe(sourceCommit)
    const sums = readFileSync(join(complete, 'SHA256SUMS'), 'utf8').trim().split('\n')
    expect(sums).toHaveLength(4)
    for (const sum of sums) expect(sum).toMatch(/^[a-f0-9]{64}  ur-[\w.-]+\.tar\.gz$/)

    const missing = join(work, 'missing')
    mkdirSync(missing)
    for (const platform of platforms.slice(0, -1)) addArtifact(missing, platform, sourceCommit)
    const incomplete = merge(missing)
    expect(incomplete.error).toBeUndefined()
    expect(incomplete.status).not.toBe(0)
    expect(incomplete.stderr).toContain('Missing tested native target linux-x64')
    expect(existsSync(join(missing, 'manifest.json'))).toBe(false)
    expect(existsSync(join(missing, 'SHA256SUMS'))).toBe(false)

    const untested = join(work, 'untested')
    mkdirSync(untested)
    for (const platform of [...platforms, 'win32-x64']) addArtifact(untested, platform, sourceCommit)
    const rejected = merge(untested)
    expect(rejected.error).toBeUndefined()
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain('Unexpected or duplicate platform win32-x64')
    expect(existsSync(join(untested, 'manifest.json'))).toBe(false)
    expect(existsSync(join(untested, 'SHA256SUMS'))).toBe(false)
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test.skipIf(process.platform === 'win32')('actual production publish commands exclude Windows ZIP and PowerShell files even when present', () => {
  const native = parse(readFileSync(join(root, '.github/workflows/native.yml'), 'utf8'))
  expect(native.jobs.native.strategy.matrix.include.map((entry: { target: string }) => entry.target).sort()).toEqual([...platforms].sort())
  const workflow = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'))
  const step = workflow.jobs['github-release'].steps.find((entry: { name?: string }) => entry.name === 'Publish the GitHub Release')
  expect(typeof step?.run).toBe('string')
  const work = mkdtempSync(join(tmpdir(), 'ur-publish-boundary-'))
  try {
    const bin = join(work, 'bin')
    mkdirSync(bin)
    mkdirSync(join(work, 'dist-release/native'), { recursive: true })
    writeFileSync(join(bin, 'gh'), [
      '#!/bin/sh',
      'printf "%s\\0" "$@" >> "$UR_RELEASE_CAPTURE"',
      'printf "\\0" >> "$UR_RELEASE_CAPTURE"',
      'if [ "$1" = release ] && [ "$2" = view ]; then [ "$UR_RELEASE_EXISTS" = true ]; else exit 0; fi',
      '',
    ].join('\n'), { mode: 0o755 })
    writeFileSync(join(work, 'CHANGELOG.md'), `## ${version}\n\nVerified release fixture.\n`)
    const nativeAssets = platforms.map(platform => `dist-release/native/ur-${version}-${platform}.tar.gz`)
    const assets = [...nativeAssets, `dist-release/ur-agent-${version}.tgz`, 'dist-release/native/manifest.json',
      'dist-release/native/SHA256SUMS', 'install.sh', 'uninstall.sh']
    for (const file of [...assets, `dist-release/native/ur-${version}-win32-x64.zip`, 'install.ps1', 'uninstall.ps1']) {
      writeFileSync(join(work, file), 'fixture')
    }
    for (const exists of ['true', 'false']) {
      const capture = join(work, `publish-${exists}.args`)
      const result = spawnSync('/bin/bash', ['-c', step.run], {
        cwd: work, encoding: 'utf8', timeout: 30_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TAG: `v${version}`, VERSION: version,
          PRERELEASE: 'false', UR_RELEASE_CAPTURE: capture, UR_RELEASE_EXISTS: exists },
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const calls = readFileSync(capture, 'utf8').split('\0\0').filter(Boolean).map(call => call.split('\0'))
      const publication = calls.find(call => call[0] === 'release' && call[1] === (exists === 'true' ? 'upload' : 'create'))
      expect(publication).toBeDefined()
      for (const asset of assets) expect(publication).toContain(asset)
      expect(publication!.filter(argument => argument.endsWith('.zip') || argument.endsWith('.ps1'))).toEqual([])
      expect(publication!.filter(argument => argument.endsWith('.tar.gz')).sort()).toEqual([...nativeAssets].sort())
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})
