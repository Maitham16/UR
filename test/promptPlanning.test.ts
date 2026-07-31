import { describe, expect, test } from 'bun:test'
import {
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decomposePrompt,
  captureWorkspaceFileState,
  diffWorkspaceFileState,
  renderTaskBoard,
  runPromptPlan,
  validateAfterExecution,
  type NexusTask,
  type PromptPlan,
} from '../src/services/promptPlanning/index.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function planWithTasks(tasks: NexusTask[]): PromptPlan {
  return {
    id: 'plan-test',
    originalPrompt: 'test',
    tasks,
    assumptions: ['Use test workspace.'],
    createdAt: '2026-01-01T00:00:00.000Z',
    config: {
      taskPlanning: true,
      parallelAgents: true,
      maxAgents: 3,
      showTaskBoard: true,
      strictVerification: true,
    },
  }
}

function task(id: string, title: string, dependencies: string[] = []): NexusTask {
  const order = Number(id.replace(/\D+/g, '')) || 1
  return {
    id,
    order,
    title,
    description: title,
    status: dependencies.length > 0 ? 'pending' : 'ready',
    dependencies,
    assignedAgent: 'executor',
    input: {
      prompt: title,
      assumptions: ['Use the current workspace as the source of truth.'],
      requiredFiles: [],
      targetFiles: [],
      resources: [],
    },
    expectedOutput: title,
    verificationCriteria: ['Output must match the requested task.'],
    fileTargets: [],
    riskLevel: 'low',
    approvalRequired: false,
    approvalPaths: [],
    outsideWorkspacePaths: [],
  }
}

describe('prompt planning', () => {
  test('simple prompt becomes one task without over-splitting', () => {
    const plan = decomposePrompt('Update README wording')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.title).toBe('Update README wording')
    expect(plan.tasks[0]?.order).toBe(1)
    expect(plan.tasks[0]?.status).toBe('ready')
    expect(plan.tasks[0]?.fileTargets).toEqual(['README'])
    expect(plan.tasks[0]?.riskLevel).toBe('low')
    expect(plan.tasks[0]?.approvalRequired).toBe(false)
  })

  test('long prompt becomes multiple dependent tasks when ordering is explicit', () => {
    const plan = decomposePrompt(
      [
        '1. Update README.md with the new product name',
        '2. Then verify CHANGELOG.md mentions the release',
        '3. Finally report the changed files',
      ].join('\n'),
    )
    expect(plan.tasks).toHaveLength(3)
    expect(plan.tasks.map(task => task.order)).toEqual([1, 2, 3])
    expect(plan.tasks[1]?.dependencies).toEqual(['task-1'])
    expect(plan.tasks[2]?.dependencies).toEqual(['task-1', 'task-2'])
    expect(plan.tasks[2]?.assignedAgent).toBe('reporter')
  })

  test('verification fans in after every earlier parallel branch', () => {
    const plan = decomposePrompt(
      [
        '- Implement the parser',
        '- Update the documentation',
        '- Run the full test suite',
      ].join('\n'),
    )
    expect(plan.tasks[0]?.dependencies).toEqual([])
    expect(plan.tasks[1]?.dependencies).toEqual([])
    expect(plan.tasks[2]?.assignedAgent).toBe('verifier')
    expect(plan.tasks[2]?.dependencies).toEqual(['task-1', 'task-2'])
  })

  test('nested list details stay with their parent and trailing work is preserved', () => {
    const prompt = [
      'Keep the existing public API stable.',
      '- Implement the parser',
      '  - Handle JSON input',
      '  - Return useful parse errors',
      '- Update the documentation',
      'Once everything is complete, run tests.',
    ].join('\n')
    const plan = decomposePrompt(prompt)

    expect(plan.tasks).toHaveLength(3)
    expect(plan.tasks[0]?.description).toContain('Handle JSON input')
    expect(plan.tasks[0]?.description).toContain('Return useful parse errors')
    expect(plan.tasks[2]?.title).toContain('Once everything is complete')
    expect(plan.tasks[2]?.dependencies).toEqual(['task-1', 'task-2'])
    expect(plan.tasks.every(task => task.input.originalPrompt === prompt)).toBe(
      true,
    )
  })

  test('task decomposition stays bounded for very long lists', () => {
    const prompt = Array.from(
      { length: 30 },
      (_, index) => `- Implement independent unit ${index + 1}`,
    ).join('\n')
    const plan = decomposePrompt(prompt)
    expect(plan.tasks).toHaveLength(12)
    expect(plan.tasks.at(-1)?.description).toContain('unit 30')
  })

  test('new file targets do not have to exist before creation', () => {
    const plan = decomposePrompt('Create src/new-module.ts')
    expect(plan.tasks[0]?.input.targetFiles).toEqual(['src/new-module.ts'])
    expect(plan.tasks[0]?.input.requiredFiles).toEqual([])
  })

  test('parallel plan creation produces unique run ids', () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => decomposePrompt('Inspect README').id),
    )
    expect(ids.size).toBe(100)
  })

  test('ambiguous prompt needs context with explicit assumptions', () => {
    const plan = decomposePrompt('fix it')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.status).toBe('needs-context')
    expect(plan.tasks[0]?.input.assumptions.join(' ')).toContain(
      'Critical target/context is missing',
    )
  })

  test('risky command becomes waiting approval', () => {
    const plan = decomposePrompt('Run `rm -rf build` to clean generated files')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.status).toBe('waiting-approval')
    expect(plan.tasks[0]?.riskLevel).toBe('high')
    expect(plan.tasks[0]?.approvalRequired).toBe(true)
    expect(plan.tasks[0]?.approvalCommand).toBe('rm -rf build')
    expect(plan.tasks[0]?.approvalReason).toContain('Destructive commands')
  })

  test('destructive outside-workspace action requires approval', () => {
    const plan = decomposePrompt('Delete /tmp/ur-nexus-outside-cache')
    expect(plan.tasks[0]?.status).toBe('waiting-approval')
    expect(plan.tasks[0]?.approvalRequired).toBe(true)
    expect(plan.tasks[0]?.outsideWorkspacePaths).toEqual([
      '/tmp/ur-nexus-outside-cache',
    ])
    expect(plan.tasks[0]?.approvalReason).toContain('outside-workspace')
  })

  test('outside-workspace read is tracked without approval requirement', () => {
    const plan = decomposePrompt('Read /tmp/ur-nexus-notes.txt for context')
    expect(plan.tasks[0]?.status).toBe('ready')
    expect(plan.tasks[0]?.approvalRequired).toBe(false)
    expect(plan.tasks[0]?.outsideWorkspacePaths).toEqual([
      '/tmp/ur-nexus-notes.txt',
    ])
  })

  test('absolute paths inside a known workspace are not treated as outside', () => {
    const dir = tempDir('ur-nexus-inside-path-')
    try {
      const file = join(dir, 'README.md')
      writeFileSync(file, '# Test\n')
      const plan = decomposePrompt(`Update ${file}`, undefined, dir)
      expect(plan.tasks[0]?.outsideWorkspacePaths).toEqual([])
      expect(plan.tasks[0]?.approvalRequired).toBe(false)
      expect(plan.tasks[0]?.status).toBe('ready')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('task statuses transition through running to finished', async () => {
    const dir = tempDir('ur-nexus-plan-')
    try {
      const events: string[] = []
      const result = await runPromptPlan(planWithTasks([task('t1', 'Do work')]), {
        cwd: dir,
        executeTask: async current => ({
          ok: true,
          output: `finished ${current.id}`,
          commandsRun: ['true'],
        }),
        onEvent: event => {
          if (event.type === 'status') events.push(event.task.status)
        },
      })
      expect(events).toContain('running')
      expect(events).toContain('finished')
      expect(result.finished).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('malformed executor output fails the task instead of crashing the plan', async () => {
    const dir = tempDir('ur-nexus-malformed-result-')
    try {
      const result = await runPromptPlan(
        planWithTasks([task('t1', 'Inspect malformed result')]),
        {
          cwd: dir,
          executeTask: async () => undefined as never,
        },
      )
      expect(result.failed).toBe(1)
      expect(result.taskResults[0]?.execution?.ok).toBe(false)
      expect(result.taskResults[0]?.execution?.error).toContain(
        'structured execution result',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('independent tasks can run in parallel', async () => {
    const dir = tempDir('ur-nexus-parallel-')
    try {
      let active = 0
      let maxActive = 0
      await runPromptPlan(
        planWithTasks([
          task('t1', 'Inspect A'),
          task('t2', 'Review B'),
          task('t3', 'Analyze C'),
        ]),
        {
          cwd: dir,
          config: { maxAgents: 3 },
          executeTask: async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise(resolve => setTimeout(resolve, 10))
            active -= 1
            return { ok: true, output: 'done', commandsRun: ['true'] }
          },
        },
      )
      expect(maxActive).toBeGreaterThan(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('approval-required task records waiting evidence without executing', async () => {
    const dir = tempDir('ur-nexus-approval-')
    try {
      let executed = false
      const current = {
        ...task('t1', 'Delete /tmp/ur-nexus-cache'),
        approvalRequired: true,
        approvalReason: 'Modifying or deleting outside-workspace paths requires explicit approval.',
        approvalAction: 'Delete /tmp/ur-nexus-cache',
        approvalPaths: ['/tmp/ur-nexus-cache'],
        outsideWorkspacePaths: ['/tmp/ur-nexus-cache'],
        riskLevel: 'high' as const,
      }
      const result = await runPromptPlan(planWithTasks([current]), {
        cwd: dir,
        executeTask: async () => {
          executed = true
          return { ok: true, output: 'should not run' }
        },
      })
      expect(executed).toBe(false)
      expect(result.waitingApproval).toBe(1)
      expect(result.approvalDecisions[0]?.paths).toEqual([
        '/tmp/ur-nexus-cache',
      ])
      expect(result.tasks[0]?.status).toBe('waiting-approval')
      expect(result.taskResults[0]?.execution).toBeUndefined()
      expect(result.taskResults[0]?.preVerification.ok).toBe(false)
      expect(
        result.taskResults[0]?.preVerification.issues.map(issue => issue.code),
      ).toContain('approval_required')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('outside-workspace read evidence is preserved in run result', async () => {
    const dir = tempDir('ur-nexus-outside-read-')
    try {
      const outside = '/tmp/ur-nexus-read-evidence.txt'
      const result = await runPromptPlan(planWithTasks([task('t1', 'Read outside')]), {
        cwd: dir,
        executeTask: async () => ({
          ok: true,
          output: 'read outside file',
          outsideWorkspaceReads: [outside],
          commandsRun: ['cat /tmp/ur-nexus-read-evidence.txt'],
        }),
      })
      expect(result.outsideWorkspaceReads).toEqual([outside])
      expect(result.taskResults[0]?.outsideWorkspaceReads).toEqual([outside])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('adaptive scheduler uses rational agent counts', async () => {
    const simpleDir = tempDir('ur-nexus-simple-agents-')
    const largeDir = tempDir('ur-nexus-large-agents-')
    try {
      let simpleActive = 0
      let simpleMaxActive = 0
      const simple = await runPromptPlan(planWithTasks([task('t1', 'One task')]), {
        cwd: simpleDir,
        config: { maxAgents: 5 },
        executeTask: async () => {
          simpleActive += 1
          simpleMaxActive = Math.max(simpleMaxActive, simpleActive)
          await new Promise(resolve => setTimeout(resolve, 10))
          simpleActive -= 1
          return { ok: true, output: 'done', commandsRun: ['true'] }
        },
      })

      let largeActive = 0
      let largeMaxActive = 0
      const largeTasks = Array.from({ length: 6 }, (_, index) =>
        task(`t${index + 1}`, `Inspect area ${index + 1}`),
      )
      const large = await runPromptPlan(planWithTasks(largeTasks), {
        cwd: largeDir,
        config: { maxAgents: 4 },
        executeTask: async () => {
          largeActive += 1
          largeMaxActive = Math.max(largeMaxActive, largeActive)
          await new Promise(resolve => setTimeout(resolve, 10))
          largeActive -= 1
          return { ok: true, output: 'done', commandsRun: ['true'] }
        },
      })

      expect(simpleMaxActive).toBe(1)
      expect(simple.maxAgentsUsed).toBe(1)
      expect(largeMaxActive).toBe(4)
      expect(large.maxAgentsUsed).toBe(4)
      expect(large.maxAgentsAllowed).toBe(4)
    } finally {
      rmSync(simpleDir, { recursive: true, force: true })
      rmSync(largeDir, { recursive: true, force: true })
    }
  })

  test('dependent tasks wait for prerequisites', async () => {
    const dir = tempDir('ur-nexus-dependent-')
    try {
      const order: string[] = []
      const result = await runPromptPlan(
        planWithTasks([task('t1', 'First'), task('t2', 'Second', ['t1'])]),
        {
          cwd: dir,
          executeTask: async current => {
            order.push(current.id)
            return { ok: true, output: current.id, commandsRun: ['true'] }
          },
        },
      )
      expect(order).toEqual(['t1', 't2'])
      expect(result.finished).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('scheduler can fan out after a single prerequisite finishes', async () => {
    const dir = tempDir('ur-nexus-fanout-')
    try {
      const tasks = [
        task('t1', 'Prepare shared context'),
        task('t2', 'Inspect parser', ['t1']),
        task('t3', 'Inspect renderer', ['t1']),
      ]
      let activeAfterRoot = 0
      let maxActiveAfterRoot = 0
      const result = await runPromptPlan(planWithTasks(tasks), {
        cwd: dir,
        config: { maxAgents: 3 },
        executeTask: async current => {
          if (current.id !== 't1') {
            activeAfterRoot += 1
            maxActiveAfterRoot = Math.max(
              maxActiveAfterRoot,
              activeAfterRoot,
            )
            await Bun.sleep(10)
            activeAfterRoot -= 1
          }
          return { ok: true, output: current.id, commandsRun: ['true'] }
        },
      })

      expect(result.finished).toBe(3)
      expect(maxActiveAfterRoot).toBe(2)
      expect(result.maxAgentsUsed).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('potential shared-workspace mutations never overlap', async () => {
    const dir = tempDir('ur-nexus-shared-mutations-')
    try {
      let active = 0
      let maxActive = 0
      const result = await runPromptPlan(
        planWithTasks([
          task('t1', 'Implement parser'),
          task('t2', 'Update documentation'),
        ]),
        {
          cwd: dir,
          config: { maxAgents: 3 },
          executeTask: async current => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await Bun.sleep(10)
            writeFileSync(join(dir, `${current.id}.txt`), current.id)
            active -= 1
            return {
              ok: true,
              output: `changed ${current.id}.txt`,
              changedFiles: [`${current.id}.txt`],
            }
          },
        },
      )

      expect(result.finished).toBe(2)
      expect(maxActive).toBe(1)
      expect(result.maxAgentsUsed).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('review tasks that request corrections are serialized as mutations', async () => {
    const dir = tempDir('ur-nexus-review-corrections-')
    try {
      let active = 0
      let maxActive = 0
      const result = await runPromptPlan(
        planWithTasks([
          task('t1', 'Review parser and correct errors'),
          task('t2', 'Audit renderer and repair gaps'),
        ]),
        {
          cwd: dir,
          config: { maxAgents: 3 },
          executeTask: async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await Bun.sleep(10)
            active -= 1
            return { ok: true, output: 'review complete', commandsRun: ['true'] }
          },
        },
      )

      expect(result.finished).toBe(2)
      expect(maxActive).toBe(1)
      expect(result.maxAgentsUsed).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a task classified read-only fails if it mutates the workspace', async () => {
    const dir = tempDir('ur-nexus-readonly-write-')
    try {
      const result = await runPromptPlan(
        planWithTasks([task('t1', 'Inspect parser')]),
        {
          cwd: dir,
          executeTask: async () => {
            writeFileSync(join(dir, 'unexpected.txt'), 'unexpected')
            return {
              ok: true,
              output: 'changed unexpected.txt',
              changedFiles: ['unexpected.txt'],
            }
          },
        },
      )
      expect(result.failed).toBe(1)
      expect(
        result.taskResults[0]?.postVerification?.issues.map(
          issue => issue.code,
        ),
      ).toContain('read_only_task_modified_workspace')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('numeric task order controls serial scheduling even for unsorted input', async () => {
    const dir = tempDir('ur-nexus-plan-order-')
    try {
      const tasks = [
        { ...task('t3', 'Third'), order: 3 },
        { ...task('t1', 'First'), order: 1 },
        { ...task('t2', 'Second'), order: 2 },
      ]
      const executionOrder: string[] = []
      await runPromptPlan(planWithTasks(tasks), {
        cwd: dir,
        config: { parallelAgents: false },
        executeTask: async current => {
          executionOrder.push(current.id)
          return { ok: true, output: current.id, commandsRun: ['true'] }
        },
      })
      expect(executionOrder).toEqual(['t1', 't2', 't3'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('tasks that target the same file are serialized', async () => {
    const dir = tempDir('ur-nexus-lock-')
    try {
      const a = task('t1', 'Edit README')
      const b = task('t2', 'Edit README again')
      a.input.targetFiles = ['README.md']
      b.input.targetFiles = ['README.md']
      writeFileSync(join(dir, 'README.md'), '# Test\n')

      let active = 0
      let maxActive = 0
      await runPromptPlan(planWithTasks([a, b]), {
        cwd: dir,
        config: { maxAgents: 2 },
        executeTask: async current => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 10))
          writeFileSync(join(dir, 'README.md'), `# Test\n${current.id}\n`)
          active -= 1
          return { ok: true, output: 'changed README.md', changedFiles: ['README.md'] }
        },
      })

      expect(maxActive).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('path aliases and symlinked parents share the same task lock', async () => {
    const dir = tempDir('ur-nexus-lock-alias-')
    try {
      writeFileSync(join(dir, 'shared.txt'), 'initial\n')
      symlinkSync(dir, join(dir, 'alias'), 'dir')
      const tasks = [
        task('t1', 'Edit shared file'),
        task('t2', 'Edit shared file through a relative alias'),
        task('t3', 'Edit shared file through a symlink'),
      ]
      tasks[0]!.input.targetFiles = ['shared.txt']
      tasks[1]!.input.targetFiles = ['./shared.txt']
      tasks[2]!.input.targetFiles = ['alias/shared.txt']

      let active = 0
      let maxActive = 0
      await runPromptPlan(planWithTasks(tasks), {
        cwd: dir,
        config: { maxAgents: 3 },
        executeTask: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await new Promise(resolve => setTimeout(resolve, 10))
          active -= 1
          return { ok: true, output: 'done', commandsRun: ['true'] }
        },
      })

      expect(maxActive).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('task board renders statuses, agents, and progress', () => {
    const board = renderTaskBoard(
      planWithTasks([
        { ...task('t1', 'Analyze prompt'), assignedAgent: 'planner' },
        { ...task('t2', 'Update README'), status: 'running' },
      ]),
    )
    expect(board).toContain('[UR-Nexus Task Board]')
    expect(board).toContain('Agents: 1 active / 3 max')
    expect(board).toContain('1. queued')
    expect(board).toContain('2. running')
    expect(board).toContain('planner')
    expect(board).toContain('running')
    expect(board).toContain('Progress:')
    expect(board).not.toMatch(/\b(blocked|denied|refused)\b/i)
  })

  test('verifier catches unsupported file and command claims', () => {
    const current = task('t1', 'Verify claims')
    const result = validateAfterExecution(
      current,
      {
        ok: true,
        output: 'I updated src/missing.ts and ran `npm test`.',
        changedFiles: ['src/actual.ts'],
        commandsRun: ['npm run lint'],
      },
      { cwd: process.cwd() },
    )
    expect(result.ok).toBe(false)
    expect(result.issues.map(issue => issue.code)).toContain(
      'unsupported_file_change_claim',
    )
    expect(result.issues.map(issue => issue.code)).toContain(
      'unsupported_command_claim',
    )
  })

  test('command verification rejects commands merely mentioned by another command', () => {
    const current = task('t1', 'Verify claims')
    const result = validateAfterExecution(
      current,
      {
        ok: true,
        output: 'I ran `npm test`.',
        commandsRun: ['echo npm test'],
      },
      { cwd: process.cwd() },
    )
    expect(result.ok).toBe(false)
    expect(result.issues.map(issue => issue.code)).toContain(
      'unsupported_command_claim',
    )
  })

  test('file verification normalizes equivalent relative paths', () => {
    const current = task('t1', 'Verify claims')
    const result = validateAfterExecution(
      current,
      {
        ok: true,
        output: 'I updated ./src/actual.ts.',
        changedFiles: ['./src/actual.ts'],
      },
      {
        cwd: process.cwd(),
        actualChangedFiles: ['src/actual.ts'],
      },
    )
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  test('file state before and after detects actual changed files', () => {
    const dir = tempDir('ur-nexus-evidence-')
    try {
      const before = captureWorkspaceFileState(dir)
      writeFileSync(join(dir, 'actual.txt'), 'changed\n')
      const after = captureWorkspaceFileState(dir)
      expect(diffWorkspaceFileState(before, after)).toEqual(['actual.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('file evidence detects same-size rewrites with a restored mtime', () => {
    const dir = tempDir('ur-nexus-evidence-restored-mtime-')
    try {
      const file = join(dir, 'actual.txt')
      writeFileSync(file, 'before\n')
      const original = lstatSync(file)
      const before = captureWorkspaceFileState(dir)

      writeFileSync(file, 'after!\n')
      utimesSync(file, original.atime, original.mtime)

      const after = captureWorkspaceFileState(dir)
      expect(diffWorkspaceFileState(before, after)).toEqual(['actual.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('non-strict verification warns for unsupported claims', () => {
    const current = task('t1', 'Verify claims')
    const result = validateAfterExecution(
      current,
      {
        ok: true,
        output: 'I updated src/missing.ts and ran `npm test`.',
        changedFiles: ['src/actual.ts'],
        commandsRun: ['npm run lint'],
      },
      { cwd: process.cwd(), actualChangedFiles: ['src/actual.ts'], strict: false },
    )
    expect(result.ok).toBe(true)
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
    expect(result.issues.map(issue => issue.code)).toContain(
      'unsupported_file_change_claim',
    )
    expect(result.issues.map(issue => issue.code)).toContain(
      'unsupported_command_claim',
    )
  })

  test('partial run options preserve the plan verification policy', async () => {
    const dir = tempDir('ur-nexus-config-merge-')
    try {
      const plan = planWithTasks([task('t1', 'Verify claims')])
      plan.config.parallelAgents = false
      plan.config.strictVerification = false
      const result = await runPromptPlan(plan, {
        cwd: dir,
        config: { maxAgents: 8 },
        executeTask: async () => ({
          ok: true,
          output: 'I updated src/unobserved.ts.',
          changedFiles: ['src/unobserved.ts'],
        }),
      })

      expect(result.finished).toBe(1)
      expect(result.maxAgentsAllowed).toBe(1)
      expect(
        result.taskResults[0]?.postVerification?.issues.map(
          issue => issue.code,
        ),
      ).toContain('unsupported_file_change_claim')
      expect(
        result.taskResults[0]?.postVerification?.issues.every(
          issue => issue.severity === 'warning',
        ),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('resumed plans keep finished prerequisites without pretending to reverify them', async () => {
    const dir = tempDir('ur-nexus-plan-resume-')
    try {
      const completed = {
        ...task('t1', 'Already complete'),
        status: 'finished' as const,
      }
      const pending = task('t2', 'Inspect next step', ['t1'])
      const executed: string[] = []
      const result = await runPromptPlan(
        planWithTasks([completed, pending]),
        {
          cwd: dir,
          executeTask: async current => {
            executed.push(current.id)
            return { ok: true, output: current.id, commandsRun: ['true'] }
          },
        },
      )

      expect(executed).toEqual(['t2'])
      expect(result.finished).toBe(2)
      expect(result.taskResults[0]?.execution).toBeUndefined()
      expect(
        result.taskResults[0]?.preVerification.issues.map(issue => issue.code),
      ).toContain('preexisting_completion_not_reverified')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('invalid dependency graphs fail closed without executing tasks', async () => {
    const dir = tempDir('ur-nexus-invalid-graph-')
    try {
      const duplicateA = task('duplicate', 'Duplicate A')
      const duplicateB = {
        ...task('duplicate', 'Duplicate B'),
        order: 2,
      }
      const missing = task('missing', 'Missing dependency', ['absent'])
      const self = task('self', 'Self dependency', ['self'])
      const cycleA = task('cycle-a', 'Cycle A', ['cycle-b'])
      const cycleB = task('cycle-b', 'Cycle B', ['cycle-a'])
      let executions = 0
      const result = await runPromptPlan(
        planWithTasks([
          duplicateA,
          duplicateB,
          missing,
          self,
          cycleA,
          cycleB,
        ]),
        {
          cwd: dir,
          executeTask: async () => {
            executions += 1
            return { ok: true, output: 'must not execute' }
          },
        },
      )

      expect(executions).toBe(0)
      expect(result.taskResults).toHaveLength(6)
      expect(
        result.taskResults
          .flatMap(record => record.preVerification.issues)
          .map(issue => issue.code),
      ).toEqual(
        expect.arrayContaining([
          'duplicate_task_id',
          'missing_dependency',
          'self_dependency',
          'cyclic_dependency',
        ]),
      )
      expect(
        result.taskResults.every(record => record.preVerification.ok === false),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('failed prerequisites block dependents with explicit evidence', async () => {
    const dir = tempDir('ur-nexus-dependency-failure-')
    try {
      const result = await runPromptPlan(
        planWithTasks([
          task('t1', 'Fail first'),
          task('t2', 'Must wait', ['t1']),
        ]),
        {
          cwd: dir,
          executeTask: async current =>
            current.id === 't1'
              ? { ok: false, error: 'expected failure' }
              : { ok: true, output: 'must not run' },
        },
      )

      expect(result.tasks.map(current => current.status)).toEqual([
        'failed',
        'blocked',
      ])
      expect(result.blocked).toBe(1)
      expect(result.taskResults[1]?.execution).toBeUndefined()
      expect(
        result.taskResults[1]?.preVerification.issues.map(issue => issue.code),
      ).toContain('dependency_not_completed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
