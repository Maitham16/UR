import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type EvalRunner,
  type EvalSuite,
  createEvalWorktree,
  evaluateEvalGate,
  runEvalTestCommand,
  runSuite,
} from '../src/services/agents/evals.js'

test('eval gates use full-precision pass rates', async () => {
  const cases: EvalSuite['cases'] = Array.from(
    { length: 300 },
    (_, index) => ({
      id: `case-${index}`,
      category: 'coding',
      prompt: 'p',
      expect: { contains: ['ok'] },
    }),
  )
  const report = await runSuite(
    { version: 1, name: 'precision', cases },
    async evalCase => ({
      output: evalCase.id === 'case-299' ? 'failed' : 'ok',
    }),
  )
  expect(report.passRate).toBe(299 / 300)
  expect(evaluateEvalGate(report, {}).passed).toBe(false)
})

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

describe('eval child metrics', () => {
  test('verification commands cannot inherit ambient secrets', async () => {
    const cwd = tempDir('ur-eval-env-')
    const key = 'UR_EVAL_TEST_TOKEN'
    const previous = process.env[key]
    process.env[key] = 'must-not-reach-eval'
    try {
      const result = await runEvalTestCommand(
        cwd,
        `test -z "\${${key}:-}"`,
      )
      expect(result.testPassed).toBe(true)
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('eval worktree hooks cannot inherit ambient credentials', async () => {
    if (process.platform === 'win32') return
    const root = tempDir('ur-eval-hook-')
    const repo = join(root, 'repo')
    const ran = join(root, 'hook-ran')
    const leaked = join(root, 'hook-leaked')
    const key = 'UR_EVAL_HOOK_TOKEN'
    const previous = process.env[key]
    let isolated: Awaited<ReturnType<typeof createEvalWorktree>> | undefined
    try {
      mkdirSync(repo)
      git(repo, 'init')
      git(repo, 'config', 'user.email', 'test@example.com')
      git(repo, 'config', 'user.name', 'Test')
      writeFileSync(join(repo, 'file.txt'), 'base\n')
      git(repo, 'add', 'file.txt')
      git(repo, 'commit', '-m', 'base')
      const hook = join(repo, '.git', 'hooks', 'post-checkout')
      writeFileSync(
        hook,
        `#!/bin/sh\nprintf ran > ${JSON.stringify(ran)}\nif [ -n "\${${key}:-}" ]; then printf leaked > ${JSON.stringify(leaked)}; fi\n`,
      )
      chmodSync(hook, 0o700)
      process.env[key] = 'must-not-reach-hook'

      isolated = await createEvalWorktree(repo, 'hook-case')
      expect(existsSync(ran)).toBe(false)
      expect(existsSync(leaked)).toBe(false)
    } finally {
      await isolated?.cleanup()
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('runner metrics are attached to each case result', async () => {
    const suite: EvalSuite = {
      version: 1,
      name: 'metrics',
      cases: [{ id: 'a', category: 'coding', prompt: 'p', expect: { contains: ['ok'] } }],
    }
    const runner: EvalRunner = async () => ({
      output: 'ok',
      metrics: {
        durationMs: 1200,
        costUSD: 0.0042,
        inputTokens: 100,
        outputTokens: 50,
        model: 'claude-sonnet-4-20250514',
        filesChanged: 2,
        editCount: 13,
        insertions: 10,
        deletions: 3,
        commandFailures: 1,
        humanEditsNeeded: 0,
        humanInterventions: 0,
      },
    })
    const report = await runSuite(suite, runner)
    expect(report.cases[0].metrics?.costUSD).toBe(0.0042)
    expect(report.cases[0].metrics?.inputTokens).toBe(100)
    expect(report.cases[0].metrics?.outputTokens).toBe(50)
    expect(report.cases[0].metrics?.model).toBe('claude-sonnet-4-20250514')
    expect(report.cases[0].metrics?.filesChanged).toBe(2)
    expect(report.totalEditCount).toBe(13)
    expect(report.totalCostUSD).toBe(0.0042)
    expect(report.totalInputTokens).toBe(100)
    expect(report.totalOutputTokens).toBe(50)
    expect(report.totalFilesChanged).toBe(2)
    expect(report.totalCommandFailures).toBe(1)
  })

  test('report aggregates and test pass rate', async () => {
    const suite: EvalSuite = {
      version: 1,
      name: 'mixed',
      cases: [
        {
          id: 'pass',
          category: 'coding',
          prompt: 'p',
          expect: { contains: ['ok'] },
        },
        {
          id: 'fail',
          category: 'coding',
          prompt: 'p',
          expect: { contains: ['ok'] },
        },
      ],
    }
    const runner: EvalRunner = async evalCase => ({
      output: evalCase.id === 'pass' ? 'ok' : 'nope',
      metrics: {
        durationMs: 1000,
        costUSD: 0.001,
        inputTokens: 10,
        outputTokens: 10,
        testPassed: evalCase.id === 'pass',
        testsPassed: evalCase.id === 'pass' ? 1 : 0,
        testsFailed: evalCase.id === 'pass' ? 0 : 1,
      },
    })
    const report = await runSuite(suite, runner)
    expect(report.passed).toBe(1)
    expect(report.testsPassed).toBe(1)
    expect(report.testsFailed).toBe(1)
    expect(report.testPassRate).toBe(0.5)
    expect(report.totalCostUSD).toBe(0.002)
    expect(report.totalInputTokens).toBe(20)
    expect(report.totalOutputTokens).toBe(20)
  })

  test('failing testCommand fails the eval case and increments command failures', async () => {
    const suite: EvalSuite = {
      version: 1,
      name: 'test-command',
      cases: [
        {
          id: 'a',
          category: 'coding',
          prompt: 'p',
          expect: { contains: ['ok'], testCommand: 'bun test focused.test.ts' },
        },
      ],
    }
    const runner: EvalRunner = async () => ({
      output: 'ok',
      metrics: {
        durationMs: 0,
        commandFailures: 1,
        testCommand: 'bun test focused.test.ts',
        testPassed: false,
      },
    })
    const report = await runSuite(suite, runner)
    expect(report.passed).toBe(0)
    expect(report.failed).toBe(1)
    expect(report.testPassRate).toBe(0)
    expect(report.totalCommandFailures).toBe(1)
    expect(report.cases[0].checks.some(check => check.name.startsWith('test command:') && !check.passed)).toBe(true)
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(0)
  })

  test('child metrics file serialization round-trip', async () => {
    const dir = tempDir('ur-eval-child-')
    const file = join(dir, 'metrics.json')
    const payload = {
      costUSD: 0.005,
      inputTokens: 200,
      outputTokens: 100,
      model: 'gpt-4o',
      linesAdded: 5,
      linesRemoved: 2,
      apiDurationMs: 3000,
    }
    writeFileSync(file, JSON.stringify(payload, null, 2))
    const read = JSON.parse(readFileSync(file, 'utf8'))
    expect(read.costUSD).toBe(0.005)
    expect(read.model).toBe('gpt-4o')
    expect(read.apiDurationMs).toBe(3000)
  })

  test('runSuite aggregates report totals from case metrics', async () => {
    const suite: EvalSuite = {
      version: 1,
      name: 'aggregate',
      cases: [
        {
          id: 'a',
          category: 'coding',
          prompt: 'p',
          expect: { contains: ['ok'] },
        },
      ],
    }
    const runner: EvalRunner = async () => ({
      output: 'ok',
      metrics: {
        durationMs: 500,
        costUSD: 0.003,
        inputTokens: 30,
        outputTokens: 20,
        filesChanged: 1,
        insertions: 7,
        deletions: 2,
        commandFailures: 0,
        humanEditsNeeded: 1,
        humanInterventions: 1,
        testPassed: true,
      },
    })
    const report = await runSuite(suite, runner)
    expect(report.totalCostUSD).toBe(0.003)
    expect(report.totalFilesChanged).toBe(1)
    expect(report.totalEditCount).toBe(9)
    expect(report.totalHumanEditsNeeded).toBe(1)
    expect(report.totalHumanInterventions).toBe(1)
    expect(report.testPassRate).toBe(1)
    expect(report.totalDurationMs).toBeGreaterThanOrEqual(500)
  })
})
