import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { renameNativeBuildStage, stagePinnedCompiler } from '../scripts/native-compiler.mjs'

const directories: string[] = []
function fixtureDirectory() {
  const path = mkdtempSync(join(tmpdir(), 'ur-native-compiler-'))
  directories.push(path)
  return path
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function compilerArchive(extra: Record<string, Uint8Array> = {}) {
  const executable = Buffer.alloc(96)
  executable.write('MZ')
  executable.writeUInt32LE(64, 0x3c)
  executable.writeUInt32LE(0x00004550, 64)
  executable.writeUInt16LE(0x8664, 68)
  const entry = 'bun-windows-x64-baseline/bun.exe'
  const archive = zipSync({ [entry]: executable, ...extra })
  return { executable, archive, artifact: { url: 'https://example.invalid/pinned.zip', sha256: digest(archive), entry, identity: 'pinned-fixture', revision: 'fixture' } }
}

describe('pinned Windows baseline compiler', () => {
  test('verifies downloaded bytes, reuses the archive, and repairs a modified executable', async () => {
    const directory = fixtureDirectory()
    const { executable, archive, artifact } = compilerArchive({ '../../outside.exe': new Uint8Array([1]) })
    let downloads = 0
    let verified = 0
    const options = {
      request: async () => { downloads++; return new Response(archive) },
      verifyExecutable: (path: string) => { verified++; expect(readFileSync(path)).toEqual(executable) },
    }
    const path = await stagePinnedCompiler(artifact, directory, options)
    expect(downloads).toBe(1)
    expect(existsSync(join(directory, '..', 'outside.exe'))).toBe(false)
    writeFileSync(path, 'tampered compiler')
    expect(await stagePinnedCompiler(artifact, directory, options)).toBe(path)
    expect(downloads).toBe(1)
    expect(verified).toBe(2)
  })

  test('rejects checksum mismatches after a bounded three attempts', async () => {
    const { archive, artifact } = compilerArchive()
    let attempts = 0
    await expect(stagePinnedCompiler({ ...artifact, sha256: '0'.repeat(64) }, fixtureDirectory(), {
      request: async () => { attempts++; return new Response(archive) },
    })).rejects.toThrow('after 3 attempts')
    expect(attempts).toBe(3)
  })

  test('retries a transport failure and rejects an archive without its pinned entry', async () => {
    const { artifact } = compilerArchive()
    const wrong = zipSync({ 'unexpected/bun.exe': new Uint8Array([1, 2]) })
    let attempts = 0
    await expect(stagePinnedCompiler({ ...artifact, sha256: digest(wrong) }, fixtureDirectory(), {
      request: async () => { attempts++; if (attempts === 1) throw new Error('temporary network failure'); return new Response(wrong) },
    })).rejects.toThrow('missing its Windows executable')
    expect(attempts).toBe(2)
  })

  test('compiled execution never loads untrusted project or home Bun preloads', () => {
    const directory = fixtureDirectory()
    const project = join(directory, 'project')
    const home = join(directory, 'home')
    mkdirSync(project)
    mkdirSync(home)
    const marker = join(directory, 'preload-executed')
    const preload = join(project, 'untrusted.cjs')
    writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`)
    const bunfig = `preload = [${JSON.stringify(preload.replaceAll('\\', '/'))}]\n`
    writeFileSync(join(project, 'bunfig.toml'), bunfig)
    writeFileSync(join(home, '.bunfig.toml'), bunfig)
    const entry = join(directory, 'entry.ts')
    writeFileSync(entry, "console.log('compiled fixture')")
    const executable = join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture')
    execFileSync(process.execPath, ['build', entry, '--compile', '--no-compile-autoload-bunfig', '--outfile', executable], { stdio: 'pipe' })
    const result = spawnSync(executable, [], { cwd: project, env: { PATH: '', HOME: home, USERPROFILE: home }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('compiled fixture')
    expect(existsSync(marker)).toBe(false)
  }, 120_000)
})

describe('Windows native build stage promotion', () => {
  test('retries transient Windows locks and succeeds once the handle releases', async () => {
    let clock = 0
    let calls = 0
    await renameNativeBuildStage('stage', 'release', {
      platform: 'win32', now: () => clock,
      pause: async (milliseconds: number) => { clock += milliseconds },
      rename: async () => { if (++calls <= 3) throw Object.assign(new Error('locked'), { code: ['EPERM', 'EACCES', 'EBUSY'][calls - 1] }) },
    })
    expect(calls).toBe(4)
    expect(clock).toBe(300)
  })

  test('preserves a permanent error without retrying', async () => {
    const original = Object.assign(new Error('wrong destination'), { code: 'ENOENT' })
    let calls = 0
    await expect(renameNativeBuildStage('stage', 'release', {
      platform: 'win32', rename: async () => { calls++; throw original },
    })).rejects.toBe(original)
    expect(calls).toBe(1)
  })

  test('fails with the original lock error when the deadline expires', async () => {
    const original = Object.assign(new Error('permanently locked'), { code: 'EPERM' })
    let clock = 0
    let calls = 0
    await expect(renameNativeBuildStage('stage', 'release', {
      platform: 'win32', now: () => clock, timeoutMs: 250,
      pause: async (milliseconds: number) => { clock += milliseconds },
      rename: async () => { calls++; throw original },
    })).rejects.toBe(original)
    expect(calls).toBe(4)
    expect(clock).toBe(250)
  })

  test('leaves non-Windows filesystem errors unchanged', async () => {
    const original = Object.assign(new Error('permission denied'), { code: 'EPERM' })
    let calls = 0
    await expect(renameNativeBuildStage('stage', 'release', {
      platform: 'linux', rename: async () => { calls++; throw original },
    })).rejects.toBe(original)
    expect(calls).toBe(1)
  })
})
