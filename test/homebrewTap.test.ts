import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateHomebrewFormula, HOMEBREW_TARGETS, validateHomebrewManifest, writeHomebrewTap } from '../scripts/homebrew-tap.mjs'
import { stableReleaseVersion, updateHomebrewTap } from '../scripts/update-homebrew-tap.mjs'

const temporary = mkdtempSync(join(tmpdir(), 'ur-homebrew-generator-'))
afterAll(() => rmSync(temporary, { recursive: true, force: true }))
const manifest = () => ({
  schemaVersion: 1, version: '1.86.1', sourceCommit: 'a'.repeat(40),
  platforms: Object.fromEntries(HOMEBREW_TARGETS.map((target: string, index: number) => [target, {
    file: `ur-1.86.1-${target}.tar.gz`, sha256: createHash('sha256').update(target).digest('hex'),
    size: 100 + index, executable: 'ur',
  }])),
})

describe('personal Homebrew tap generation', () => {
  test('pins all four native URLs and their exact published checksums without runtime dependencies', () => {
    const value = manifest()
    const formula = generateHomebrewFormula(value, { expectedVersion: '1.86.1', expectedCommit: 'a'.repeat(40) })
    for (const target of HOMEBREW_TARGETS) {
      expect(formula).toContain(`https://github.com/Maitham16/UR/releases/download/v1.86.1/ur-1.86.1-${target}.tar.gz`)
      expect(formula).toContain(`sha256 "${value.platforms[target].sha256}"`)
    }
    expect(formula.match(/^\s+url /gm)).toHaveLength(4)
    expect(formula).not.toMatch(/depends_on ["'](?:bun|node|npm)["']/)
    expect(formula).toContain('depends_on macos: :sequoia')
    expect(formula).toContain('preserve_rpath')
    expect(formula).toContain('libexec.install "ur", "resources"')
    expect(formula).toContain('bin.install_symlink libexec/"ur"')
    expect(formula).toContain('--ur-native-self-test')
    expect(formula).not.toContain('win32')
  })

  test('rejects incomplete, extra-platform, malformed and mismatched native releases', () => {
    const cases: Array<(value: ReturnType<typeof manifest>) => void> = [
      value => { delete value.platforms['linux-arm64'] },
      value => { value.platforms['win32-x64'] = { ...value.platforms['linux-x64'] } },
      value => { value.version = '1.86.1-rc.1' },
      value => { value.version = '1.86.0' },
      value => { value.version = '1.86.1#{system("evil")}' },
      value => { value.sourceCommit = 'main' },
      value => { value.platforms['darwin-arm64'].file = '../ur.tar.gz' },
      value => { value.platforms['darwin-x64'].sha256 = '0'.repeat(63) },
      value => { value.platforms['linux-x64'].executable = 'cli.js' },
      value => { value.platforms['linux-arm64'].size = 0 },
    ]
    for (const mutate of cases) {
      const value = manifest(); mutate(value)
      expect(() => validateHomebrewManifest(value)).toThrow()
    }
    expect(() => validateHomebrewManifest(manifest(), { expectedVersion: '1.86.0' })).toThrow('version')
    expect(() => validateHomebrewManifest(manifest(), { expectedCommit: 'b'.repeat(40) })).toThrow('commit')
  })

  test('writes an auditable tap with immutable setup actions and the original release manifest', () => {
    const value = manifest()
    const path = writeHomebrewTap(value, join(temporary, 'tap'))
    expect(path).toBe(join(temporary, 'tap', 'Formula', 'ur.rb'))
    expect(JSON.parse(readFileSync(join(temporary, 'tap', 'release-manifest.json'), 'utf8'))).toEqual(value)
    const readme = readFileSync(join(temporary, 'tap', 'README.md'), 'utf8')
    expect(readme).toContain('brew install Maitham16/ur/ur')
    expect(readme).toContain('non-commercial license')
    const workflow = readFileSync(join(temporary, 'tap', '.github', 'workflows', 'test.yml'), 'utf8')
    expect(workflow).toContain('brew test Maitham16/ur/ur')
    expect(workflow.match(/os: /g)).toHaveLength(4)
    expect(workflow).not.toMatch(/uses: .+@(?:master|main|v\d+)\s/)
    const syntax = spawnSync('ruby', ['-c', path], { encoding: 'utf8' })
    if (!syntax.error || (syntax.error as NodeJS.ErrnoException).code !== 'ENOENT') expect(syntax.status, syntax.stderr).toBe(0)
  })

  test('CLI rejects unpinned URLs and checksum mismatch before producing a formula', () => {
    const script = resolve(import.meta.dir, '../scripts/homebrew-tap.mjs')
    const output = join(temporary, 'must-not-exist')
    const moving = spawnSync(process.execPath, [script, '--manifest-url', 'https://github.com/Maitham16/UR/releases/latest/download/manifest.json', '--output-dir', output], { encoding: 'utf8' })
    expect(moving.status).toBe(1)
    expect(moving.stderr).toContain('immutable')
    const input = join(temporary, 'input.json')
    writeFileSync(input, JSON.stringify(manifest()))
    const mismatch = spawnSync(process.execPath, [script, '--manifest', input, '--manifest-sha256', '0'.repeat(64), '--output-dir', output], { encoding: 'utf8' })
    expect(mismatch.status).toBe(1)
    expect(mismatch.stderr).toContain('SHA-256 mismatch')
    expect(existsSync(join(output, 'Formula', 'ur.rb'))).toBe(false)
  })

  test('scheduled updater verifies the exact manifest before writing and preserves committed tap scripts', async () => {
    const directory = join(temporary, 'update-success')
    writeHomebrewTap(manifest(), directory)
    const script = join(directory, 'scripts', 'homebrew-tap.mjs')
    const committedScript = readFileSync(script, 'utf8')
    const calls: string[] = []
    let verified = false
    const request = async (url: string) => {
      calls.push(url)
      return url.startsWith('https://api.github.com/')
        ? Response.json({ tag_name: 'v1.86.1', draft: false, prerelease: false })
        : Response.json(manifest())
    }
    const result = await updateHomebrewTap({ directory, request, verify: async (path: string, version: string, commit: string) => {
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(manifest())
      expect(version).toBe('1.86.1'); expect(commit).toBe('a'.repeat(40)); verified = true
    } })
    expect(result).toEqual({ version: '1.86.1', sourceCommit: 'a'.repeat(40) })
    expect(verified).toBe(true)
    expect(calls).toEqual(['https://api.github.com/repos/Maitham16/UR/releases/latest', 'https://github.com/Maitham16/UR/releases/download/v1.86.1/manifest.json'])
    expect(readFileSync(script, 'utf8')).toBe(committedScript)
    const workflow = readFileSync(join(directory, '.github', 'workflows', 'update.yml'), 'utf8')
    expect(workflow).toContain('contents: write')
    expect(workflow).toContain('ref: ${{ needs.update.outputs.base }}')
    expect(workflow).toContain('needs: update')
    expect(workflow).toContain('brew test Maitham16/ur/ur')
    expect(workflow).toContain('brew reinstall --build-from-source')
    expect(workflow).toContain('needs: [update, formula]')
    expect(workflow).toContain("needs.formula.result == 'success'")
    expect(workflow).toContain('git rev-parse FETCH_HEAD')
    const beforePublish = workflow.split('  publish:')[0]!
    expect(beforePublish).not.toContain('git push')
    expect(beforePublish).not.toContain('contents: write')
    expect(workflow.indexOf('uses: Homebrew/actions/setup-homebrew@')).toBeLessThan(workflow.indexOf('uses: actions/download-artifact@'))
  })

  test('invalid provenance and nonstable releases never produce a formula', async () => {
    const directory = join(temporary, 'update-refused')
    const request = async (url: string) => url.startsWith('https://api.github.com/')
      ? Response.json({ tag_name: 'v1.86.1', draft: false, prerelease: false }) : Response.json(manifest())
    await expect(updateHomebrewTap({ directory, request, verify: () => { throw new Error('certificate identity mismatch') } })).rejects.toThrow('certificate identity mismatch')
    expect(existsSync(join(directory, 'Formula', 'ur.rb'))).toBe(false)
    await expect(updateHomebrewTap({ directory, request: async () => Response.json({ tag_name: 'v1.86.1', draft: false, prerelease: true }) })).rejects.toThrow('published stable')
    expect(() => stableReleaseVersion('1.86.1; echo unsafe')).toThrow()
  })
})
