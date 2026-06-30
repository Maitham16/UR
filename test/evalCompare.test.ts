import { describe, expect, test } from 'bun:test'
import {
  type CompareLabel,
  makeDryEvalRunner,
  makeDryJudgeRunner,
  runSuiteCompare,
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
    expect((report.rows[0] as { dry1: { passed: boolean } }).dry1.passed).toBe(true)
  })
})
