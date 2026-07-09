import { describe, expect, test } from 'bun:test'
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
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  detectTestFirstStack,
  installTestFirstGates,
  runTestFirstLoop,
} from '../src/services/agents/testFirstLoop.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeNodeProject(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      scripts: {
        typecheck: 'tsc --noEmit',
        test: 'bun test',
        lint: 'eslint .',
      },
    }),
  )
  writeFileSync(join(dir, 'bun.lock'), '')
  writeFileSync(join(dir, 'tsconfig.json'), '{}')
}

describe('test-first execution loop', () => {
  test('detects Node/Bun compile, test, and lint commands in order', () => {
    const dir = tempDir('ur-test-first-detect-')
    try {
      writeNodeProject(dir)
      const stack = detectTestFirstStack(dir)
      expect(stack.languages).toContain('JavaScript/TypeScript')
      expect(stack.packageManagers).toContain('bun')
      expect(stack.commands.map(command => `${command.phase}:${command.command}`)).toEqual([
        'compile:bun run typecheck',
        'test:bun run test',
        'lint:bun run lint',
      ])
      expect(stack.missingPhases).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('installs detected commands into project verify gates without dropping existing config', () => {
    const dir = tempDir('ur-test-first-gates-')
    try {
      writeNodeProject(dir)
      mkdirSync(join(dir, '.ur'), { recursive: true })
      writeFileSync(
        join(dir, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['custom check'], afterBash: ['shellcheck'], timeoutMs: 42 }),
      )

      const installed = installTestFirstGates(dir)
      const parsed = JSON.parse(readFileSync(join(dir, installed.path), 'utf8')) as {
        afterEdit: string[]
        afterBash: string[]
        timeoutMs: number
      }
      expect(parsed.afterEdit).toContain('custom check')
      expect(parsed.afterEdit).toContain('bun run typecheck')
      expect(parsed.afterEdit).toContain('bun run test')
      expect(parsed.afterEdit).toContain('bun run lint')
      expect(parsed.afterBash).toEqual(['shellcheck'])
      expect(parsed.timeoutMs).toBe(42)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('stores a failure trace and refuses success when a command is red', async () => {
    const dir = tempDir('ur-test-first-trace-')
    try {
      writeNodeProject(dir)
      const result = await runTestFirstLoop({
        cwd: dir,
        maxAttempts: 1,
        now: () => new Date('2026-06-30T10:00:00.000Z'),
        exec: async () => ({ code: 2, stdout: 'compile failed', stderr: 'TS1005 error' }),
      })

      expect(result.status).toBe('exhausted')
      const failed = result.attempts[0]?.runs[0]
      expect(failed?.passed).toBe(false)
      expect(failed?.tracePath).toBe(
        '.ur/test-first/traces/2026-06-30T10-00-00-000Z-attempt-1-compile-bun-run-typecheck.log',
      )
      expect(existsSync(join(dir, failed?.tracePath ?? 'missing'))).toBe(true)
      expect(readFileSync(join(dir, failed?.tracePath ?? 'missing'), 'utf8')).toContain(
        'TS1005 error',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('invokes a fix runner and retries until all detected commands pass', async () => {
    const dir = tempDir('ur-test-first-retry-')
    try {
      writeNodeProject(dir)
      let runCount = 0
      let runnerCalls = 0
      const result = await runTestFirstLoop({
        cwd: dir,
        maxAttempts: 2,
        exec: async command => {
          runCount += 1
          if (runCount === 1) {
            return { code: 1, stdout: '', stderr: `${command} failed` }
          }
          return { code: 0, stdout: `${command} passed`, stderr: '' }
        },
        runner: async options => {
          runnerCalls += 1
          expect(options.prompt).toContain('Failure trace:')
          return { output: 'fixed\nVERDICT: PASS', verdict: 'PASS', isError: false }
        },
      })

      expect(result.status).toBe('passed')
      expect(runnerCalls).toBe(1)
      expect(result.attempts[1]?.runs.map(run => run.phase)).toEqual([
        'compile',
        'test',
        'lint',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('test-first command reports detected stack', async () => {
    const dir = tempDir('ur-test-first-command-')
    try {
      writeNodeProject(dir)
      const { call } = await import('../src/commands/test-first/test-first.js')
      const result = await runWithCwdOverride(dir, () => call('detect', {} as never))
      expect(result.type).toBe('text')
      if (result.type !== 'text') throw new Error('expected text')
      expect(result.value).toContain('compile: bun run typecheck')
      expect(result.value).toContain('lint: bun run lint')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('test-first command keeps option values out of the default action', async () => {
    const dir = tempDir('ur-test-first-default-action-')
    try {
      writeNodeProject(dir)
      const { call } = await import('../src/commands/test-first/test-first.js')
      const result = await runWithCwdOverride(dir, () =>
        call('--max-attempts 1 --dry-run', {} as never),
      )
      expect(result.type).toBe('text')
      if (result.type !== 'text') throw new Error('expected text')
      expect(result.value).toContain('Test-first loop: planned')
      expect(result.value).toContain('Dry run only')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
