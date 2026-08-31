import { describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertVersionConsistency,
  collectVersionConsistencyErrors,
} from '../scripts/version-consistency.mjs'

const REPO = join(import.meta.dir, '..')
const SURFACES = [
  'package.json',
  'bunfig.toml',
  'CHANGELOG.md',
  'documentation/index.html',
  'docs/VALIDATION.md',
  'extensions/vscode-ur-inline-diffs/package.json',
  'extensions/vscode-ur-inline-diffs/package-lock.json',
  'extensions/jetbrains-ur/build.gradle.kts',
  'src/commands/agent-ci/agent-ci.ts',
  'src/services/agents/agenticCi.ts',
  'src/services/agents/featureScaffolds.ts',
  'src/services/agents/trends.ts',
]

describe('version consistency preflight', () => {
  test('accepts the synchronized repository', () => {
    const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
    expect(collectVersionConsistencyErrors(REPO, version)).toEqual([])
    expect(() => assertVersionConsistency(REPO, version)).not.toThrow()
  })

  test('rejects a package-only edit before invoking the bundler', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ur-version-consistency-'))
    try {
      for (const path of SURFACES) {
        cpSync(join(REPO, path), join(fixture, path), { recursive: true })
      }
      const pkgPath = join(fixture, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      pkg.version = '9.9.9'
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

      expect(() => assertVersionConsistency(fixture, '9.9.9')).toThrow(
        'bunfig.toml MACRO.VERSION must be 9.9.9',
      )
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
