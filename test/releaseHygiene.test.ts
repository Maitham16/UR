import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  missingRequiredSourceZipEntries,
  missingRequiredPackageFiles,
  normalizeArchiveRootPaths,
  releasePathViolations,
  requiredPackageFiles,
  requiredSourceZipEntries,
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
    ])

    expect(violations).toHaveLength(16)
    expect(violations.join('\n')).toContain('node_modules')
    expect(violations.join('\n')).toContain('__MACOSX')
    expect(violations.join('\n')).toContain('.env.local')
    expect(violations.join('\n')).toContain('dist/.cache')
    expect(violations.join('\n')).toContain('debug-output.json')
    expect(violations.join('\n')).toContain('runtime binary')
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
})
