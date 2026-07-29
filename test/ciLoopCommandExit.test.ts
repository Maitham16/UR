import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { call as ciLoopCommand } from '../src/commands/ci-loop/ci-loop.ts'
import { runWithCwdOverride } from '../src/utils/cwd.ts'

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'ur-ci-command-exit-'))
}

const passingCommand = `${JSON.stringify(process.execPath)} --eval ${JSON.stringify('process.exit(0)')}`

describe('ci-loop command exit semantics', () => {
  test('direct invocation distinguishes success, non-completion, and usage errors', async () => {
    const cwd = temporaryDirectory()
    const previousExitCode = process.exitCode
    try {
      const passed = await runWithCwdOverride(cwd, () =>
        ciLoopCommand(
          `--command ${JSON.stringify(passingCommand)} --max-attempts 1 --json`,
          {} as never,
        ),
      )
      expect(passed.exitCode).toBeUndefined()
      expect(JSON.parse((passed as { value: string }).value).status).toBe(
        'passed',
      )

      const dryRun = await runWithCwdOverride(cwd, () =>
        ciLoopCommand('--command "bun test" --dry-run --json', {} as never),
      )
      expect(dryRun.exitCode).toBe(1)
      expect(JSON.parse((dryRun as { value: string }).value).status).toBe(
        'failed',
      )

      const invalidNumber = await runWithCwdOverride(cwd, () =>
        ciLoopCommand('--max-attempts nope', {} as never),
      )
      expect(invalidNumber.exitCode).toBe(2)

      const missingLog = await runWithCwdOverride(cwd, () =>
        ciLoopCommand('--from-log absent.log', {} as never),
      )
      expect(missingLog.exitCode).toBe(2)

      expect(process.exitCode).toBe(previousExitCode)
    } finally {
      process.exitCode = previousExitCode
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('the shipped bin adapter propagates 0, 1, and 2', () => {
    const cwd = temporaryDirectory()
    const run = (args: string[]) =>
      spawnSync('node', ['./bin/ur.js', 'ci-loop', '--cwd', cwd, ...args], {
        cwd: join(import.meta.dir, '..'),
        encoding: 'utf8',
        timeout: 90_000,
      })

    try {
      const passed = run([
        '--command',
        passingCommand,
        '--max-attempts',
        '1',
        '--json',
      ])
      expect(passed.stderr).toBe('')
      expect(passed.status).toBe(0)
      expect(JSON.parse(passed.stdout).status).toBe('passed')

      const nonCompleted = run([
        '--command',
        'bun test',
        '--dry-run',
        '--json',
      ])
      expect(nonCompleted.status).toBe(1)
      expect(JSON.parse(nonCompleted.stdout).status).toBe('failed')

      const invalid = run(['--max-attempts', 'nope'])
      expect(invalid.status).toBe(2)
      expect(invalid.stdout).toContain(
        '--max-attempts must be a positive integer',
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, 120_000)
})
