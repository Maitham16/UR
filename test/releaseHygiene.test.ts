import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  missingRequiredSourceZipEntries,
  missingRequiredPackageFiles,
  normalizeArchiveRootPaths,
  releasePathViolations,
  requiredPackageFiles,
  requiredSourceZipEntries,
  sourceArchiveCandidatePaths,
} from '../scripts/release-hygiene.mjs'

const repoRoot = join(import.meta.dir, '..')

describe('release hygiene file-list checks', () => {
  test('rejects dependency, env, cache, log, and test-output artifacts', () => {
    const violations = releasePathViolations([
      'package/node_modules/pkg/index.js',
      'package/extensions/vscode-ur-inline-diffs/node_modules/pkg/index.js',
      'package/.DS_Store',
      'package/__MACOSX/._README.md',
      'package/.env.local',
      'package/debug.log',
      'package/debug-output.json',
      'package/.Trash/old-file',
      'package/dist/.cache/chunk.js',
      'package/test-results/result.json',
      'package/coverage/lcov.info',
      'package/.ur-analysis/run.json',
      'package/ur-nexus-1.0.0.tgz',
      'package/tmp/scratch.txt',
      'package/bin/node',
      'package/bin/bun',
      'package/extensions/jetbrains-ur/.gradle/cache.bin',
      'package/extensions/jetbrains-ur/.intellijPlatform/sandbox/state.xml',
      'package/extensions/jetbrains-ur/build/classes/Plugin.class',
      'package/extensions/jetbrains-ur/.kotlin/cache.bin',
      'package/.idea/workspace.xml',
      'package/.vscode/settings.json',
      'package/.claude/settings.local.json',
      'package/UR.local.md',
      'package/.ur/settings.local.json',
      'package/.ur/context/task-memory.jsonl',
      'package/.ur/actions.jsonl',
      'package/.ur/ide/chat/session.json',
    ])

    expect(violations).toHaveLength(28)
    expect(violations.join('\n')).toContain('node_modules')
    expect(violations.join('\n')).toContain('__MACOSX')
    expect(violations.join('\n')).toContain('.env.local')
    expect(violations.join('\n')).toContain('dist/.cache')
    expect(violations.join('\n')).toContain('debug-output.json')
    expect(violations.join('\n')).toContain('runtime binary')
    expect(violations.join('\n')).toContain('.intellijPlatform')
    expect(violations.join('\n')).toContain('.claude/settings.local.json')
    expect(violations.join('\n')).toContain('.ur/settings.local.json')
  })

  test('strict-core files all exist on disk', () => {
    const config = JSON.parse(
      readFileSync(join(repoRoot, 'tsconfig.strict-core.json'), 'utf8'),
    ) as { files: string[] }
    expect(config.files).not.toContain('src/utils/shell.ts')
    for (const file of config.files) {
      expect(existsSync(join(repoRoot, file)), file).toBe(true)
    }
  })

  test('allows required package runtime files', () => {
    expect(releasePathViolations(requiredPackageFiles)).toEqual([])
    expect(missingRequiredPackageFiles(requiredPackageFiles)).toEqual([])
  })

  test('reports missing package runtime files', () => {
    expect(missingRequiredPackageFiles(['package/package.json'])).toContain('bin/ur.js')
    expect(missingRequiredPackageFiles(['package/package.json'])).toContain('dist/cli.js')
  })

  test('normalizes a common source zip root directory', () => {
    expect(
      normalizeArchiveRootPaths([
        'UR-1.37.2/package.json',
        'UR-1.37.2/src/index.ts',
        'UR-1.37.2/scripts/release-check.mjs',
      ]),
    ).toEqual(['package.json', 'src/index.ts', 'scripts/release-check.mjs'])
  })

  test('source zip checks require source files and allow the clean template list', () => {
    const cleanEntries = [
      'UR-1.37.2/package.json',
      'UR-1.37.2/bun.lock',
      'UR-1.37.2/src/index.ts',
      'UR-1.37.2/bin/ur.js',
      'UR-1.37.2/scripts/release-check.mjs',
      'UR-1.37.2/README.md',
      'UR-1.37.2/CHANGELOG.md',
      'UR-1.37.2/SECURITY.md',
    ]
    expect(missingRequiredSourceZipEntries(cleanEntries)).toEqual([])
    expect(releasePathViolations(normalizeArchiveRootPaths(cleanEntries))).toEqual([])
    expect(requiredSourceZipEntries).toContain('bun.lock')
  })

  test('source zip checks report missing source entries', () => {
    expect(missingRequiredSourceZipEntries(['package.json'])).toContain('src/')
    expect(missingRequiredSourceZipEntries(['package.json'])).toContain('bun.lock')
  })

  test('source archive candidates include untracked inputs but honor Git ignores', () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-release-hygiene-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: root })
      writeFileSync(join(root, '.gitignore'), 'build/\n.env\n')
      writeFileSync(join(root, 'tracked.ts'), 'export const tracked = true\n')
      writeFileSync(join(root, 'removed.ts'), 'export const removed = true\n')
      execFileSync('git', ['add', '.gitignore', 'tracked.ts', 'removed.ts'], { cwd: root })
      rmSync(join(root, 'removed.ts'))
      writeFileSync(join(root, 'new-source.ts'), 'export const added = true\n')
      writeFileSync(join(root, '.env'), 'SECRET=not-for-release\n')
      mkdirSync(join(root, 'build'))
      writeFileSync(join(root, 'build', 'generated.js'), 'generated\n')

      const candidates = sourceArchiveCandidatePaths(root)
      expect(candidates).toContain('tracked.ts')
      expect(candidates).toContain('new-source.ts')
      expect(candidates).not.toContain('removed.ts')
      expect(candidates).not.toContain('.env')
      expect(candidates).not.toContain('build/generated.js')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
