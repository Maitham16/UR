import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
        totalEditCount: 4,
        totalCommandFailures: 0,
        totalHumanEditsNeeded: 0,
        totalHumanInterventions: 0,
        totalRollbacks: 1,
        testsPassed: 1,
        testsFailed: 1,
        testPassRate: 0.5,
        cases: [],
      }
      const path = buildLeaderboard(dir, [report], { format: 'md' })
      expect(path.endsWith('leaderboard.md')).toBe(true)
      const markdown = readFileSync(path, 'utf8')
      expect(markdown).toContain('Tests passed')
      expect(markdown).toContain('Edit count')
      expect(markdown).toContain('Human intervention')
      expect(markdown).toContain('| demo | 50% | 1/2 | 4 |')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('writes json and html leaderboards from a fresh directory', () => {
    const report: EvalReport = {
      name: 'fresh-demo',
      generatedAt: new Date().toISOString(),
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      byCategory: { demo: { passed: 1, total: 1 } },
      totalDurationMs: 10,
      cases: [],
    }
    const jsonDir = mkdtempSync(join(tmpdir(), 'ur-eval-leaderboard-json-'))
    const htmlDir = mkdtempSync(join(tmpdir(), 'ur-eval-leaderboard-html-'))
    try {
      const jsonPath = buildLeaderboard(jsonDir, [report], { format: 'json' })
      const htmlPath = buildLeaderboard(htmlDir, [report], { format: 'html' })

      expect(jsonPath.endsWith('leaderboard.json')).toBe(true)
      expect(htmlPath.endsWith('leaderboard.html')).toBe(true)
      expect(existsSync(jsonPath)).toBe(true)
      expect(existsSync(htmlPath)).toBe(true)
      expect(readFileSync(htmlPath, 'utf8')).toContain('UR Public Leaderboard')
    } finally {
      rmSync(jsonDir, { recursive: true, force: true })
      rmSync(htmlDir, { recursive: true, force: true })
    }
  })
})
