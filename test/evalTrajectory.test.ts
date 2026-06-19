import { expect, test } from 'bun:test'
import {
  buildDashboardHtml,
  gradeTrajectory,
  makeDryJudgeRunner,
  runSuite,
  runSuiteReliability,
  type EvalRunner,
  type EvalSuite,
} from '../src/services/agents/evals.ts'

test('gradeTrajectory checks tools used, order, and step budget', () => {
  const expect_ = { toolsUsed: ['Grep', 'FileEdit'], toolOrder: ['Grep', 'FileEdit'], maxSteps: 3 }
  const good = gradeTrajectory(['Grep', 'FileRead', 'FileEdit'], expect_)
  expect(good.every(c => c.passed)).toBe(true)

  const wrongOrder = gradeTrajectory(['FileEdit', 'Grep'], expect_)
  expect(wrongOrder.find(c => c.name.startsWith('tool order'))!.passed).toBe(false)

  const tooMany = gradeTrajectory(['Grep', 'A', 'B', 'C', 'FileEdit'], expect_)
  expect(tooMany.find(c => c.name.startsWith('≤'))!.passed).toBe(false)
})

test('gradeTrajectory flags a missing trajectory only when one is expected', () => {
  expect(gradeTrajectory(undefined, {})).toEqual([])
  const checks = gradeTrajectory(undefined, { toolsUsed: ['Bash'] })
  expect(checks).toHaveLength(1)
  expect(checks[0]!.passed).toBe(false)
})

const TRAJECTORY_SUITE: EvalSuite = {
  version: 1,
  name: 'traj',
  cases: [
    {
      id: 'uses-grep',
      category: 'coding',
      prompt: 'find the bug',
      expect: { toolsUsed: ['Grep'] },
    },
  ],
}

test('runSuite grades a captured trajectory from the runner', async () => {
  const runner: EvalRunner = async () => ({ output: 'done', trajectory: ['Grep', 'FileEdit'] })
  const report = await runSuite(TRAJECTORY_SUITE, runner)
  expect(report.passed).toBe(1)
})

test('runSuite invokes the judge for judge-bearing cases', async () => {
  const suite: EvalSuite = {
    version: 1,
    name: 'judged',
    cases: [{ id: 'j1', category: 'research', prompt: 'explain X', expect: { judge: 'is it correct?' } }],
  }
  const pass = await runSuite(suite, async () => ({ output: 'an answer' }), {
    judge: makeDryJudgeRunner(true),
  })
  expect(pass.passed).toBe(1)
  const fail = await runSuite(suite, async () => ({ output: 'an answer' }), {
    judge: makeDryJudgeRunner(false),
  })
  expect(fail.passed).toBe(0)
})

test('runSuiteReliability computes pass^k over multiple trials', async () => {
  let call = 0
  // Case passes on trials 1 and 3 but not 2 -> not solvedAll, pass^k = 0.
  const flaky: EvalRunner = async () => {
    call += 1
    return { output: 'x', trajectory: call === 2 ? [] : ['Grep'] }
  }
  const rel = await runSuiteReliability(TRAJECTORY_SUITE, flaky, { trials: 3 })
  expect(rel.trials).toBe(3)
  expect(rel.cases[0]!.passes).toBe(2)
  expect(rel.cases[0]!.solvedAll).toBe(false)
  expect(rel.passHatK).toBe(0)
})

test('runSuiteReliability reports pass^k = 100% when every trial passes', async () => {
  const solid: EvalRunner = async () => ({ output: 'x', trajectory: ['Grep'] })
  const rel = await runSuiteReliability(TRAJECTORY_SUITE, solid, { trials: 4 })
  expect(rel.passHatK).toBe(1)
  expect(rel.meanPassRate).toBe(1)
})

test('buildDashboardHtml is self-contained and escapes content', () => {
  const html = buildDashboardHtml([
    {
      name: 'suite<script>',
      generatedAt: '2026-06-29T00:00:00.000Z',
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      byCategory: { coding: { passed: 1, total: 1 } },
      cases: [
        {
          id: 'c1',
          category: 'coding',
          passed: true,
          isError: false,
          durationMs: 5,
          checks: [],
          outputPreview: 'ok',
        },
      ],
    },
  ])
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).not.toContain('<script>suite')
  expect(html).toContain('suite&lt;script&gt;')
  expect(html).not.toContain('http://')
})

test('buildDashboardHtml renders an empty state', () => {
  expect(buildDashboardHtml([], [])).toContain('No eval reports yet')
})
