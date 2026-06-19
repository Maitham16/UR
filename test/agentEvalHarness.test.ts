import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  type EvalRunner,
  type EvalSuite,
  defaultEvalSuite,
  gradeOutput,
  listSuites,
  loadReport,
  loadSuite,
  runSuite,
  saveReport,
  saveSuite,
  scaffoldEvals,
  validateEvalSuite,
} from '../src/services/agents/evals.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('eval grading', () => {
  test('contains is case-insensitive and notContains forbids text', () => {
    expect(gradeOutput('Hello World', { contains: ['hello'] })[0].passed).toBe(true)
    expect(gradeOutput('foo', { notContains: ['bar'] })[0].passed).toBe(true)
    expect(gradeOutput('a bar b', { notContains: ['bar'] })[0].passed).toBe(false)
  })

  test('regex, verdict, and length checks', () => {
    expect(gradeOutput('see https://x.com', { regex: ['https?://'] })[0].passed).toBe(true)
    const wrongVerdict = gradeOutput('VERDICT: FAIL', { verdict: 'PASS' })[0]
    expect(wrongVerdict.passed).toBe(false)
    expect(wrongVerdict.detail).toBe('got FAIL')
    expect(gradeOutput('VERDICT: PASS', { verdict: 'PASS' })[0].passed).toBe(true)
    expect(gradeOutput('abcdef', { maxOutputChars: 3 })[0].passed).toBe(false)
  })
})

describe('eval suite validation', () => {
  test('the bundled starter suite is valid', () => {
    expect(validateEvalSuite(defaultEvalSuite()).valid).toBe(true)
  })

  test('flags duplicate ids, empty prompts, and bad regex', () => {
    const broken: EvalSuite = {
      version: 1,
      name: 'broken',
      cases: [
        { id: 'x', category: 'coding', prompt: 'p', expect: { contains: ['a'] } },
        { id: 'x', category: 'coding', prompt: '', expect: { regex: ['('] } },
      ],
    }
    const validation = validateEvalSuite(broken)
    expect(validation.valid).toBe(false)
    const joined = validation.errors.join(' ')
    expect(joined).toContain('duplicate case id "x"')
    expect(joined).toContain('empty prompt')
    expect(joined).toContain('invalid regex')
  })

  test('warns when a case has no expectations', () => {
    const suite: EvalSuite = {
      version: 1,
      name: 's',
      cases: [{ id: 'a', category: 'coding', prompt: 'p', expect: {} }],
    }
    expect(validateEvalSuite(suite).warnings.join(' ')).toContain('no expectations')
  })
})

describe('eval runner and report', () => {
  const suite: EvalSuite = {
    version: 1,
    name: 'demo',
    cases: [
      { id: 'good', category: 'coding', prompt: 'p', expect: { contains: ['answer'], verdict: 'PASS' } },
      { id: 'bad', category: 'coding', prompt: 'p', expect: { contains: ['answer'] } },
      { id: 'res', category: 'research', prompt: 'p', expect: { regex: ['https?://'] } },
    ],
  }
  const runner: EvalRunner = async evalCase => {
    if (evalCase.id === 'good') return { output: 'the answer is 42 VERDICT: PASS' }
    if (evalCase.id === 'res') return { output: 'see https://example.com' }
    return { output: 'nothing useful here' }
  }

  test('grades each case and aggregates by category', async () => {
    const report = await runSuite(suite, runner)
    expect(report.total).toBe(3)
    expect(report.passed).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.passRate).toBe(0.67)
    expect(report.byCategory.coding).toEqual({ passed: 1, total: 2 })
    expect(report.byCategory.research).toEqual({ passed: 1, total: 1 })
  })

  test('a category filter runs only matching cases', async () => {
    const report = await runSuite(suite, runner, { category: 'research' })
    expect(report.total).toBe(1)
    expect(report.passed).toBe(1)
  })

  test('a runner error fails the case without throwing', async () => {
    const boom: EvalRunner = async () => {
      throw new Error('spawn failed')
    }
    const report = await runSuite(suite, boom)
    expect(report.passed).toBe(0)
    expect(report.cases[0].isError).toBe(true)
  })
})

describe('eval persistence and command', () => {
  test('scaffold, load, and report round-trip on disk', () => {
    const dir = tempDir('ur-eval-')
    const result = scaffoldEvals(dir)
    expect(result.created).toContain('evals/starter.json')
    expect(existsSync(join(dir, '.ur', 'evals', 'starter.json'))).toBe(true)
    expect(listSuites(dir)).toContain('starter')

    const loaded = loadSuite(dir, 'starter')
    expect(loaded?.cases.length).toBeGreaterThan(0)

    saveReport(dir, {
      name: 'starter',
      generatedAt: new Date().toISOString(),
      total: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      byCategory: { coding: { passed: 1, total: 1 } },
      cases: [],
    })
    expect(loadReport(dir, 'starter')?.passed).toBe(1)
  })

  test('saving without --force keeps an existing suite', () => {
    const dir = tempDir('ur-eval-force-')
    const first = saveSuite(dir, defaultEvalSuite())
    expect(first.created).toBe(true)
    const second = saveSuite(dir, defaultEvalSuite())
    expect(second.created).toBe(false)
  })

  test('command inits, lists, and dry-runs a suite', async () => {
    const dir = tempDir('ur-eval-cmd-')
    const { call } = await import('../src/commands/eval/eval.js')

    const init = await runWithCwdOverride(dir, () => call('init'))
    if (init.type !== 'text') throw new Error('expected text')
    expect(init.value).toContain('starter.json')

    const list = await runWithCwdOverride(dir, () => call('list'))
    if (list.type !== 'text') throw new Error('expected text')
    expect(list.value).toContain('starter')

    const run = await runWithCwdOverride(dir, () => call('run starter --dry-run --json'))
    if (run.type !== 'text') throw new Error('expected text')
    const report = JSON.parse(run.value)
    expect(report.total).toBeGreaterThan(0)
    // Dry-run echoes the prompt, so verdict/contains cases won't all pass — that's fine.
    expect(typeof report.passRate).toBe('number')
  })
})
