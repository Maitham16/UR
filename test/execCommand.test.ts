import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  call,
  changedFilesSinceBefore,
  readPrompts,
  runExecPool,
} from '../src/commands/exec/exec.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import type { TaskExecutionEvent } from '../src/services/promptPlanning/index.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ur exec command', () => {
  test('changed file evidence excludes old dirty files when task changes nothing', () => {
    expect(changedFilesSinceBefore(['old-dirty.ts'], ['old-dirty.ts'])).toEqual([])
    expect(
      changedFilesSinceBefore(['old-dirty.ts'], ['old-dirty.ts', 'new.ts']),
    ).toEqual(['new.ts'])
  })

  test('readPrompts returns positional prompts', async () => {
    const prompts = await readPrompts(['hello', 'world'])
    expect(prompts).toEqual(['hello', 'world'])
  })

  test('readPrompts reads prompts from JSONL file', async () => {
    const dir = tempDir('ur-exec-')
    try {
      const file = join(dir, 'prompts.jsonl')
      writeFileSync(file, '{"prompt": "one"}\n{"prompt": "two"}\nplain line\n')
      const prompts = await readPrompts(['--file', file])
      expect(prompts).toEqual(['one', 'two', 'plain line'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runExecPool dry-run returns commands without spawning', async () => {
    const dir = tempDir('ur-exec-')
    try {
      const results = await runExecPool(['add tests', 'fix bug'], {
        cwd: dir,
        concurrency: 2,
        dryRun: true,
      })
      expect(results).toHaveLength(2)
      expect(results[0]!.dryRun).toBe(true)
      expect(results[0]!.command.join(' ')).toContain('-p')
      expect(results[0]!.command.join(' ')).toContain('add tests')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('call returns usage when no prompts provided', async () => {
    const originalIsTTY = process.stdin.isTTY
    process.stdin.isTTY = true
    try {
      const result = await call('', {} as never)
      expect(result.type).toBe('text')
      if (result.type === 'text') {
        expect(result.value).toContain('Usage:')
      }
    } finally {
      process.stdin.isTTY = originalIsTTY
    }
  })

  test('call dry-runs multiple prompts with concurrency', async () => {
    const dir = tempDir('ur-exec-')
    try {
      const result = await runWithCwdOverride(dir, () =>
        call('"add tests" "fix bug" --concurrency 2 --dry-run --json', {} as never),
      )
      expect(result.type).toBe('text')
      if (result.type !== 'text') throw new Error('expected text')
      const parsed = JSON.parse(result.value) as Array<{
        index: number
        prompt: string
        status: string
        taskBoard?: string
        plan?: { tasks: Array<{ title: string }> }
      }>
      expect(parsed).toHaveLength(2)
      expect(parsed[0]!.prompt).toBe('add tests')
      expect(parsed[1]!.prompt).toBe('fix bug')
      expect(parsed[0]!.taskBoard).toContain('[UR-Nexus Task Board]')
      expect(parsed[0]!.plan?.tasks[0]?.title).toBe('add tests')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('normal run uses task planning when enabled', async () => {
    const dir = tempDir('ur-exec-plan-')
    try {
      const executed: string[] = []
      const results = await runExecPool(
        ['1. Add parser\n2. Add tests'],
        {
          cwd: dir,
          concurrency: 1,
          planning: { taskPlanning: true },
          executePlannedTask: async task => {
            executed.push(task.id)
            return {
              ok: true,
              output: `done ${task.id}`,
              commandsRun: [`run ${task.id}`],
            }
          },
        },
      )
      expect(results).toHaveLength(1)
      expect(results[0]!.dryRun).toBe(false)
      expect(results[0]!.plannedRun?.finished).toBe(2)
      expect(results[0]!.plan?.tasks).toHaveLength(2)
      expect(executed).toEqual(['task-1', 'task-2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('normal run does not use task planning when disabled', async () => {
    const dir = tempDir('ur-exec-no-plan-')
    try {
      let planned = false
      let legacy = false
      const results = await runExecPool(['add tests'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: false },
        executePlannedTask: async () => {
          planned = true
          return { ok: true, output: 'should not run' }
        },
        legacyRunner: async prompts => {
          legacy = true
          return prompts.map((prompt, index) => ({
            task: {
              id: `legacy-${index}`,
              task: prompt,
              status: 'queued' as const,
              cwd: dir,
              runCwd: dir,
              logFile: '',
              outputFile: '',
              inboxFile: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            command: ['ur', '-p', prompt],
            dryRun: false,
          }))
        },
      })
      expect(legacy).toBe(true)
      expect(planned).toBe(false)
      expect(results[0]!.plan).toBeUndefined()
      expect(results[0]!.task.id).toBe('legacy-0')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('task board updates during normal planned execution', async () => {
    const dir = tempDir('ur-exec-board-')
    try {
      const boards: string[] = []
      const events: TaskExecutionEvent[] = []
      const results = await runExecPool(['Add parser'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, showTaskBoard: true },
        onPlanningEvent: event => {
          events.push(event)
          if (event.type === 'board') boards.push(event.board)
        },
        executePlannedTask: async () => ({
          ok: true,
          output: 'done',
          commandsRun: ['true'],
        }),
      })
      expect(events.some(event => event.type === 'status')).toBe(true)
      expect(boards.some(board => board.includes('running'))).toBe(true)
      expect(boards.at(-1)).toContain('finished')
      expect(results[0]!.boardHistory?.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('live task-board streaming emits only on status changes', async () => {
    const dir = tempDir('ur-exec-stream-')
    try {
      const streamed: string[] = []
      const statuses: string[] = []
      await runExecPool(['Add parser'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, showTaskBoard: true },
        streamTaskBoard: true,
        writeTaskBoard: text => streamed.push(text),
        onPlanningEvent: event => {
          if (event.type === 'status') statuses.push(event.task.status)
        },
        executePlannedTask: async () => ({
          ok: true,
          output: 'done',
          commandsRun: ['true'],
        }),
      })
      expect(streamed.length).toBe(statuses.length + 1)
      expect(streamed[0]).toContain('queued')
      expect(new Set(statuses).size).toBe(statuses.length)
      expect(streamed.at(-1)).toContain('finished')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('quiet mode suppresses streaming but keeps final board', async () => {
    const dir = tempDir('ur-exec-quiet-')
    try {
      const streamed: string[] = []
      const results = await runExecPool(['Add parser'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, showTaskBoard: true },
        streamTaskBoard: false,
        writeTaskBoard: text => streamed.push(text),
        executePlannedTask: async () => ({
          ok: true,
          output: 'done',
          commandsRun: ['true'],
        }),
      })
      expect(streamed).toHaveLength(0)
      expect(results[0]!.taskBoard).toContain('[UR-Nexus Task Board]')
      expect(results[0]!.boardHistory?.length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('independent real planned tasks run in parallel', async () => {
    const dir = tempDir('ur-exec-parallel-')
    try {
      let active = 0
      let maxActive = 0
      const results = await runExecPool(['- Add parser\n- Add docs\n- Add tests'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, maxAgents: 3 },
        executePlannedTask: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 10))
          active -= 1
          return { ok: true, output: 'done', commandsRun: ['true'] }
        },
      })
      expect(maxActive).toBeGreaterThan(1)
      expect(results[0]!.plannedRun?.finished).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('dependent planned tasks wait for prerequisites', async () => {
    const dir = tempDir('ur-exec-deps-')
    try {
      const order: string[] = []
      await runExecPool(['1. Prepare parser\n2. Then verify parser'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, maxAgents: 2 },
        executePlannedTask: async task => {
          order.push(task.id)
          return { ok: true, output: task.id, commandsRun: ['true'] }
        },
      })
      expect(order).toEqual(['task-1', 'task-2'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('planned tasks with file conflicts are serialized', async () => {
    const dir = tempDir('ur-exec-locks-')
    try {
      writeFileSync(join(dir, 'README.md'), '# Test\n')
      let active = 0
      let maxActive = 0
      await runExecPool(
        ['1. Update README.md title\n2. Update README.md links'],
        {
          cwd: dir,
          concurrency: 1,
          planning: { taskPlanning: true, maxAgents: 2 },
        executePlannedTask: async task => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 10))
          writeFileSync(
            join(dir, 'README.md'),
            task.id === 'task-1' ? '# Test\nalpha\n' : '# Test\nbeta beta\n',
          )
          active -= 1
          return {
            ok: true,
            output: 'changed README.md',
            changedFiles: ['README.md'],
            }
          },
        },
      )
      expect(maxActive).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('failed verification fails the planned task', async () => {
    const dir = tempDir('ur-exec-verify-')
    try {
      const results = await runExecPool(['Update docs'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, strictVerification: true },
        executePlannedTask: async () => ({
          ok: true,
          output: 'I updated src/fake.ts and ran `npm test`.',
          changedFiles: ['src/real.ts'],
          commandsRun: ['npm run lint'],
        }),
      })
      expect(results[0]!.plannedRun?.failed).toBe(1)
      expect(results[0]!.verificationFailures?.map(f => f.code)).toContain(
        'unsupported_file_change_claim',
      )
      expect(results[0]!.verificationFailures?.map(f => f.code)).toContain(
        'unsupported_command_claim',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('claimed changed file without real change fails in strict mode', async () => {
    const dir = tempDir('ur-exec-claim-strict-')
    try {
      const results = await runExecPool(['Update docs'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, strictVerification: true },
        executePlannedTask: async () => ({
          ok: true,
          output: 'I updated src/fake.ts.',
          changedFiles: ['src/fake.ts'],
          commandsRun: ['true'],
        }),
      })
      expect(results[0]!.plannedRun?.failed).toBe(1)
      expect(results[0]!.verificationFailures?.map(f => f.code)).toContain(
        'unsupported_file_change_claim',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('claimed changed file without real change warns in non-strict mode', async () => {
    const dir = tempDir('ur-exec-claim-warn-')
    try {
      const results = await runExecPool(['Update docs'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, strictVerification: false },
        executePlannedTask: async () => ({
          ok: true,
          output: 'I updated src/fake.ts.',
          changedFiles: ['src/fake.ts'],
          commandsRun: ['true'],
        }),
      })
      expect(results[0]!.plannedRun?.finished).toBe(1)
      expect(results[0]!.warnings?.map(f => f.code)).toContain(
        'unsupported_file_change_claim',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('unreported changed files appear in final report', async () => {
    const dir = tempDir('ur-exec-unreported-')
    try {
      const results = await runExecPool(['Update docs'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => {
          writeFileSync(join(dir, 'actual.txt'), 'changed\n')
          return {
            ok: true,
            output: 'done',
            commandsRun: ['true'],
          }
        },
      })
      expect(results[0]!.finalReport?.actualChangedFiles).toEqual(['actual.txt'])
      expect(results[0]!.finalReport?.unreportedChangedFiles).toEqual([
        'actual.txt',
      ])
      expect(results[0]!.warnings?.map(f => f.code)).toContain(
        'unreported_file_change',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('waiting approval and outside-workspace evidence appear in final report', async () => {
    const dir = tempDir('ur-exec-approval-report-')
    try {
      const results = await runExecPool(['Delete /tmp/ur-nexus-outside-cache'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => {
          throw new Error('approval-required task should not execute')
        },
      })
      const report = results[0]!.finalReport
      expect(results[0]!.plannedRun?.waitingApproval).toBe(1)
      expect(report?.summary.waitingApproval).toBe(1)
      expect(report?.waitingApprovalTasks[0]?.title).toContain('/tmp/ur-nexus-outside-cache')
      expect(report?.approvalDecisions[0]?.paths).toEqual([
        '/tmp/ur-nexus-outside-cache',
      ])
      expect(results[0]!.finalReportText).toContain('Approval decisions:')
      expect(results[0]!.finalReportText).not.toMatch(/\b(blocked|denied|refused)\b/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('final report includes outside-workspace files accessed and modified from evidence', async () => {
    const dir = tempDir('ur-exec-outside-report-')
    try {
      const results = await runExecPool(['Inspect outside context'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => ({
          ok: true,
          output: 'outside evidence recorded',
          outsideWorkspaceReads: ['/tmp/input.txt'],
          outsideWorkspaceWrites: ['/tmp/output.txt'],
          commandsRun: ['cat /tmp/input.txt'],
        }),
      })
      expect(results[0]!.finalReport?.outsideWorkspaceFilesAccessed).toEqual([
        '/tmp/input.txt',
      ])
      expect(results[0]!.finalReport?.outsideWorkspaceFilesModified).toEqual([
        '/tmp/output.txt',
      ])
      expect(results[0]!.finalReportText).toContain('Outside-workspace files accessed:')
      expect(results[0]!.finalReportText).toContain('/tmp/input.txt')
      expect(results[0]!.finalReportText).toContain('/tmp/output.txt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('verified commands appear as confirmed', async () => {
    const dir = tempDir('ur-exec-commands-')
    try {
      const results = await runExecPool(['Run checks'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => ({
          ok: true,
          output: 'done',
          commandsRun: ['npm run lint'],
        }),
      })
      expect(results[0]!.finalReport?.verifiedCommands).toEqual(['npm run lint'])
      expect(results[0]!.finalReport?.unverifiedCommandClaims).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('unverified command claims are not shown as confirmed', async () => {
    const dir = tempDir('ur-exec-unverified-command-')
    try {
      const results = await runExecPool(['Run checks'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => ({
          ok: true,
          output: 'I ran `npm test`.',
          commandsRun: ['npm run lint'],
        }),
      })
      expect(results[0]!.finalReport?.verifiedCommands).toEqual(['npm run lint'])
      expect(results[0]!.finalReport?.unverifiedCommandClaims).toEqual([
        'npm test',
      ])
      expect(results[0]!.finalReport?.verifiedCommands).not.toContain('npm test')
      expect(results[0]!.plannedRun?.failed).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('non-strict verification warns instead of failing unsupported claims', async () => {
    const dir = tempDir('ur-exec-nonstrict-')
    try {
      const results = await runExecPool(['Run checks'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true, strictVerification: false },
        executePlannedTask: async () => ({
          ok: true,
          output: 'I ran `npm test`.',
          commandsRun: ['npm run lint'],
        }),
      })
      expect(results[0]!.plannedRun?.finished).toBe(1)
      expect(results[0]!.finalReport?.warnings.map(f => f.code)).toContain(
        'unsupported_command_claim',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('final report is based only on real executed task evidence', async () => {
    const dir = tempDir('ur-exec-report-')
    try {
      const results = await runExecPool(['Update docs'], {
        cwd: dir,
        concurrency: 1,
        planning: { taskPlanning: true },
        executePlannedTask: async () => {
          mkdirSync(join(dir, 'src'), { recursive: true })
          writeFileSync(join(dir, 'src/actual.ts'), 'export {}\n')
          return {
            ok: true,
            output: 'I updated src/claimed.ts.',
            changedFiles: ['src/claimed.ts'],
            commandsRun: ['npm run lint'],
          }
        },
      })
      const report = results[0]!.finalReport
      expect(report?.actualChangedFiles).toEqual(['src/actual.ts'])
      expect(report?.verifiedCommands).toEqual(['npm run lint'])
      expect(report?.activeAgentsUsed).toBe(1)
      expect(report?.maxAgentsAllowed).toBe(3)
      expect(report?.actualChangedFiles).not.toContain('src/claimed.ts')
      expect(report?.unreportedChangedFiles).toEqual(['src/actual.ts'])
      expect(report?.verificationFailures.map(f => f.code)).toContain(
        'unsupported_file_change_claim',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
