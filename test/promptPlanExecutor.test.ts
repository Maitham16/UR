import { describe, it, expect } from 'bun:test'
import { runPromptPlan } from '../src/services/promptPlanning/executor.js'
import type { NexusTask, PromptPlan, TaskExecutionResult } from '../src/services/promptPlanning/types.js'

function makeTask(id: string, order: number, title: string, status: NexusTask['status'], deps: string[] = []): NexusTask {
  return {
    id,
    order,
    title,
    description: `desc ${id}`,
    status,
    dependencies: deps,
    assignedAgent: 'executor',
    input: { prompt: `prompt ${id}`, assumptions: ['assume ok'], requiredFiles: [], targetFiles: [], resources: [] },
    expectedOutput: '',
    verificationCriteria: [],
    fileTargets: [],
    riskLevel: 'low',
    approvalRequired: false,
    approvalPaths: [],
    outsideWorkspacePaths: [],
  }
}

function makePlan(tasks: NexusTask[]): PromptPlan {
  return {
    id: 'plan-1',
    originalPrompt: 'test',
    tasks,
    assumptions: [],
    createdAt: new Date().toISOString(),
    config: { taskPlanning: true, parallelAgents: false, maxAgents: 1, showTaskBoard: true, strictVerification: false },
  }
}

describe('promptPlanExecutor integration', () => {
  it('running tasks update correctly and completed tasks are checked', async () => {
    const tasks = [
      makeTask('1', 1, 'A', 'pending'),
      makeTask('2', 2, 'B', 'pending', ['1']),
    ]
    const plan = makePlan(tasks)
    const events: { type: string; board?: string; taskId?: string; status?: string }[] = []

    const result = await runPromptPlan(plan, {
      cwd: process.cwd(),
      executeTask: async () => ({ ok: true, output: 'completed' }),
      onEvent: event => {
        if (event.type === 'board') {
          events.push({ type: event.type, board: event.board })
        } else if (event.type === 'status') {
          events.push({ type: event.type, taskId: event.task.id, status: event.task.status })
        }
      },
    })

    // Both tasks should be finished
    expect(result.finished).toBe(2)
    expect(result.failed).toBe(0)

    const finalBoardEvent = events.filter(e => e.type === 'board').pop()
    const finalBoard = finalBoardEvent?.board ?? ''

    // Running status should have appeared in intermediate boards
    const runningBoard = events.find(e => e.type === 'board' && e.board?.includes('running'))
    expect(runningBoard).toBeDefined()

    // Final board should show both tasks completed and checked
    const lines = finalBoard.split('\n')
    const lineA = lines.find(line => line.match(/^\[.\] \d+\. .*\|.*\| A$/))
    const lineB = lines.find(line => line.match(/^\[.\] \d+\. .*\|.*\| B$/))
    expect(lineA).toContain('completed')
    expect(lineA).toContain('[✓]')
    expect(lineB).toContain('completed')
    expect(lineB).toContain('[✓]')
  })

  it('failed tasks render clearly as failed, not unchecked', async () => {
    const tasks = [makeTask('1', 1, 'Fail task', 'pending')]
    const plan = makePlan(tasks)
    const events: { type: string; board?: string }[] = []

    const result = await runPromptPlan(plan, {
      cwd: process.cwd(),
      executeTask: async () => ({ ok: false, error: 'boom' }),
      onEvent: event => {
        if (event.type === 'board') {
          events.push({ type: event.type, board: event.board })
        }
      },
    })

    expect(result.failed).toBe(1)
    expect(result.finished).toBe(0)

    const finalBoard = events[events.length - 1]?.board ?? ''
    const line = finalBoard.split('\n').find(l => l.includes('Fail task'))
    expect(line).toContain('failed')
    expect(line).toContain('[✓]')
  })

  it('does not emit duplicate consecutive boards', async () => {
    const tasks = [makeTask('1', 1, 'Only task', 'pending')]
    const plan = makePlan(tasks)
    const boards: string[] = []

    await runPromptPlan(plan, {
      cwd: process.cwd(),
      executeTask: async () => ({ ok: true }),
      onEvent: event => {
        if (event.type === 'board' && event.board) {
          boards.push(event.board)
        }
      },
    })

    // No two consecutive boards should be identical
    for (let i = 1; i < boards.length; i++) {
      expect(boards[i]).not.toBe(boards[i - 1])
    }
  })

  it('final board is clean with no duplicate separators', async () => {
    const tasks = [makeTask('1', 1, 'Task one', 'pending')]
    const plan = makePlan(tasks)
    let finalBoard = ''

    await runPromptPlan(plan, {
      cwd: process.cwd(),
      executeTask: async () => ({ ok: true }),
      onEvent: event => {
        if (event.type === 'board' && event.board) {
          finalBoard = event.board
        }
      },
    })

    const headerCount = (finalBoard.match(/\[UR-Nexus Task Board\]/g) || []).length
    const progressCount = (finalBoard.match(/Progress:/g) || []).length
    expect(headerCount).toBe(1)
    expect(progressCount).toBe(1)
  })
})
