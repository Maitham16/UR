import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildLeaderboard,
  type EvalReport,
} from '../src/services/agents/evals.js'
import {
  getBuiltinSuite,
  installBuiltinSuite,
  listBuiltinSuiteIds,
} from '../src/services/agents/benchmarkSuites.js'

describe('eval benchmark suites', () => {
  test('lists six built-in suites', () => {
    const ids = listBuiltinSuiteIds()
    expect(ids).toContain('bug-fix')
    expect(ids).toContain('refactor')
    expect(ids).toContain('test-gen')
    expect(ids).toContain('docker-repair')
    expect(ids).toContain('ts-migrate')
    expect(ids).toContain('py-package-repair')
    expect(ids.length).toBe(6)
  })

  test('loads a built-in suite', () => {
    const suite = getBuiltinSuite('bug-fix')
    expect(suite).toBeDefined()
    expect(suite!.name).toBe('builtin-bug-fix')
    expect(suite!.cases.length).toBeGreaterThan(0)
  })

  test('installs a built-in suite into cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-eval-builtin-'))
    try {
      const result = installBuiltinSuite(dir, 'bug-fix')
      expect(result.created).toBe(true)
      expect(result.suite?.name).toBe('builtin-bug-fix')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('writes a markdown leaderboard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-eval-leaderboard-'))
    try {
      const report: EvalReport = {
        name: 'demo',
        generatedAt: new Date().toISOString(),
        total: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        byCategory: { demo: { passed: 1, total: 2 } },
        totalDurationMs: 100,
        totalCostUSD: 0.001,
        totalInputTokens: 10,
        totalOutputTokens: 20,
        totalFilesChanged: 1,
        totalCommandFailures: 0,
        totalHumanEditsNeeded: 0,
        totalRollbacks: 1,
        testPassRate: 0.5,
        cases: [],
      }
      const path = buildLeaderboard(dir, [report], { format: 'md' })
      expect(path.endsWith('leaderboard.md')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
