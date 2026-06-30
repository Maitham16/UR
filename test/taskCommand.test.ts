import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import { buildPrSummary, formatPrSummary } from '../src/services/agents/prSummary.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ur task command', () => {
  test('start creates one queued worktree task and run starts that task', async () => {
    const dir = tempDir('ur-task-command-')
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      const { call } = await import('../src/commands/task/task.js')

      const started = await runWithCwdOverride(dir, () =>
        call('start fix-auth --worktree --json'),
      )
      if (started.type !== 'text') throw new Error('expected text')
      const task = JSON.parse(started.value)
      expect(task.task).toBe('fix-auth')
      expect(task.status).toBe('queued')
      expect(task.worktree.enabled).toBe(true)

      const run = await runWithCwdOverride(dir, () =>
        call(`run ${task.id} --dry-run --json`),
      )
      if (run.type !== 'text') throw new Error('expected text')
      const startedTask = JSON.parse(run.value)
      expect(startedTask.task.id).toBe(task.id)
      expect(startedTask.command.join(' ')).toContain(`bg worker ${task.id}`)

      const listed = await runWithCwdOverride(dir, () => call('list --json'))
      if (listed.type !== 'text') throw new Error('expected text')
      const tasks = JSON.parse(listed.value).tasks
      expect(tasks).toHaveLength(1)
      expect(tasks[0].task).toBe('fix-auth')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('PR-quality task output', () => {
  test('formats summary, changed files, tests, risks, rollback, and TODOs', async () => {
    const dir = tempDir('ur-pr-summary-')
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        scripts: {
          test: 'bun test',
          lint: 'ur lint',
        },
      }))
      execFileSync('git', ['add', 'package.json'], { cwd: dir, stdio: 'ignore' })
      execFileSync(
        'git',
        ['-c', 'user.name=UR Test', '-c', 'user.email=ur@example.test', 'commit', '-m', 'init'],
        { cwd: dir, stdio: 'ignore' },
      )
      writeFileSync(join(dir, 'package.json'), readFileSync(join(dir, 'package.json'), 'utf8') + '\n')

      const summary = await buildPrSummary({
        cwd: dir,
        title: 'Fix auth',
        description: 'Implements the requested auth fix.',
      })
      const text = formatPrSummary(summary)
      expect(text).toContain('## Summary')
      expect(text).toContain('## Changed files')
      expect(text).toContain('- package.json')
      expect(text).toContain('## Tests run')
      expect(text).toContain('- none recorded by UR for this PR handoff')
      expect(text).toContain('## Detected verification commands')
      expect(text).toContain('- bun run test')
      expect(text).toContain('- bun run lint')
      expect(text).toContain('## Risks')
      expect(text).toContain('## Rollback command')
      expect(text).toContain('## Remaining TODOs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
