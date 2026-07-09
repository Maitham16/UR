import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  type CompareLabel,
  makeDryEvalRunner,
  makeDryJudgeRunner,
  runSuiteCompare,
  saveSuite,
} from '../src/services/agents/evals.js'

function starterSuite() {
  return {
    version: 1 as const,
    name: 'starter-compare',
    cases: [
      {
        id: 'a',
        category: 'coding',
        prompt: 'Write a function.',
        expect: { contains: ['would run'] },
      },
      {
        id: 'b',
        category: 'coding',
        prompt: 'Refactor.',
        expect: { contains: ['would run'] },
      },
      {
        id: 'c',
        category: 'research',
        prompt: 'Summarize.',
        expect: { contains: ['missing'] },
      },
    ],
  }
}

describe('eval compare', () => {
  test('runSuiteCompare builds a matrix across labels', async () => {
    const labels: CompareLabel[] = [
      {
        name: 'dry1',
        runnerFactory: makeDryEvalRunner,
      },
      {
        name: 'dry2',
        runnerFactory: makeDryEvalRunner,
      },
    ]
    const report = await runSuiteCompare(starterSuite(), labels, {
      judge: makeDryJudgeRunner(),
    })
    expect(report.labels).toEqual(['dry1', 'dry2'])
    expect(report.totalCases).toBe(3)
    expect(report.byLabel.dry1.passed).toBe(2)
    expect(report.byLabel.dry2.passed).toBe(2)
    expect(report.rows[0].caseId).toBe('a')
    expect((report.rows[0] as unknown as { dry1: { passed: boolean } }).dry1.passed).toBe(true)
  })

  test('eval command supports compare pool codex claude syntax', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-eval-compare-command-'))
    try {
      saveSuite(dir, starterSuite())
      const { call } = await import('../src/commands/eval/eval.js')
      const result = await runWithCwdOverride(dir, () =>
        call('compare starter-compare pool codex claude --dry-run', {} as never),
      )
      expect(result.type).toBe('text')
      if (result.type !== 'text') throw new Error('expected text')
      expect(result.value).toContain('Eval comparison: starter-compare')
      expect(result.value).toContain('pool')
      expect(result.value).toContain('codex')
      expect(result.value).toContain('claude')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
