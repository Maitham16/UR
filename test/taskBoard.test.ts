import { describe, it, expect } from 'bun:test'
import { renderTaskBoard, progressSummary } from '../src/services/promptPlanning/taskBoard.js'
import type { NexusTask } from '../src/services/promptPlanning/types.js'

describe('taskBoard', () => {
  const makeTasks = (): NexusTask[] => [
    {
      id: '1',
      order: 1,
      title: 'Task 1',
      description: 'Description 1',
      status: 'pending',
      dependencies: [],
      assignedAgent: 'executor',
      input: {
        prompt: 'prompt 1',
        assumptions: [],
        requiredFiles: [],
        targetFiles: [],
        resources: [],
      },
      expectedOutput: '',
      verificationCriteria: [],
      fileTargets: [],
      riskLevel: 'low',
      approvalRequired: false,
      approvalPaths: [],
      outsideWorkspacePaths: [],
    },
    {
      id: '2',
      order: 2,
      title: 'Task 2',
      description: 'Description 2',
      status: 'running',
      dependencies: [],
      assignedAgent: 'executor',
      input: {
        prompt: 'prompt 2',
        assumptions: [],
        requiredFiles: [],
        targetFiles: [],
        resources: [],
      },
      expectedOutput: '',
      verificationCriteria: [],
      fileTargets: [],
      riskLevel: 'low',
      approvalRequired: false,
      approvalPaths: [],
      outsideWorkspacePaths: [],
    },
    {
      id: '3',
      order: 3,
      title: 'Task 3',
      description: 'Description 3',
      status: 'finished',
      dependencies: [],
      assignedAgent: 'verifier',
      input: {
        prompt: 'prompt 3',
        assumptions: [],
        requiredFiles: [],
        targetFiles: [],
        resources: [],
      },
      expectedOutput: '',
      verificationCriteria: [],
      fileTargets: [],
      riskLevel: 'low',
      approvalRequired: false,
      approvalPaths: [],
      outsideWorkspacePaths: [],
    },
    {
      id: '4',
      order: 4,
      title: 'Task 4',
      description: 'Description 4',
      status: 'failed',
      dependencies: [],
      assignedAgent: 'executor',
      input: {
        prompt: 'prompt 4',
        assumptions: [],
        requiredFiles: [],
        targetFiles: [],
        resources: [],
      },
      expectedOutput: '',
      verificationCriteria: [],
      fileTargets: [],
      riskLevel: 'low',
      approvalRequired: false,
      approvalPaths: [],
      outsideWorkspacePaths: [],
    },
    {
      id: '5',
      order: 5,
      title: 'Task 5',
      description: 'Description 5',
      status: 'skipped',
      dependencies: [],
      assignedAgent: 'executor',
      input: {
        prompt: 'prompt 5',
        assumptions: [],
        requiredFiles: [],
        targetFiles: [],
        resources: [],
      },
      expectedOutput: '',
      verificationCriteria: [],
      fileTargets: [],
      riskLevel: 'low',
      approvalRequired: false,
      approvalPaths: [],
      outsideWorkspacePaths: [],
    },
  ]

  it('should render a task board with all statuses', () => {
    const board = renderTaskBoard(makeTasks())
    expect(board).toContain('[UR-Nexus Task Board]')
    expect(board).toContain('Task 1')
    expect(board).toContain('Task 2')
    expect(board).toContain('Task 3')
    expect(board).toContain('Task 4')
    expect(board).toContain('Task 5')
  })

  it('should mark finished, failed, and skipped tasks as checked', () => {
    const board = renderTaskBoard(makeTasks())
    const lines = board.split('\n')

    const task3Line = lines.find(line => line.includes('Task 3'))
    const task4Line = lines.find(line => line.includes('Task 4'))
    const task5Line = lines.find(line => line.includes('Task 5'))

    expect(task3Line).toContain('[✓]')
    expect(task4Line).toContain('[✓]')
    expect(task5Line).toContain('[✓]')
  })

  it('should not mark pending or running tasks as checked', () => {
    const board = renderTaskBoard(makeTasks())
    const lines = board.split('\n')

    const task1Line = lines.find(line => line.includes('Task 1'))
    const task2Line = lines.find(line => line.includes('Task 2'))

    expect(task1Line).toContain('[ ]')
    expect(task2Line).toContain('[ ]')
  })

  it('should show failed status clearly, not unchecked', () => {
    const board = renderTaskBoard(makeTasks())
    const lines = board.split('\n')

    const task4Line = lines.find(line => line.includes('Task 4'))
    expect(task4Line).toContain('failed')
    expect(task4Line).toContain('[✓]')
  })

  it('should show skipped status clearly, not unchecked', () => {
    const board = renderTaskBoard(makeTasks())
    const lines = board.split('\n')

    const task5Line = lines.find(line => line.includes('Task 5'))
    expect(task5Line).toContain('skipped')
    expect(task5Line).toContain('[✓]')
  })

  it('should produce an accurate progress summary', () => {
    const summary = progressSummary(makeTasks())
    expect(summary).toBe('Progress: 1/5 finished, 1 running, 1 queued, 0 waiting, 1 failed, 1 skipped')
  })

  it('should not duplicate content when rendered twice', () => {
    const tasks = makeTasks()
    const board1 = renderTaskBoard(tasks)
    const board2 = renderTaskBoard(tasks)

    const headerCount1 = (board1.match(/UR-Nexus Task Board/g) || []).length
    const headerCount2 = (board2.match(/UR-Nexus Task Board/g) || []).length

    expect(headerCount1).toBe(1)
    expect(headerCount2).toBe(1)
  })

  it('should update status in real time from source tasks', () => {
    const tasks = makeTasks()
    const boardPending = renderTaskBoard(tasks)
    const lineBefore = boardPending.split('\n').find(line => line.includes('Task 1'))
    expect(lineBefore).toContain('[ ]')

    tasks[0].status = 'finished'
    const boardCompleted = renderTaskBoard(tasks)
    const lineAfter = boardCompleted.split('\n').find(line => line.includes('Task 1'))
    expect(lineAfter).toContain('[✓]')
  })
})