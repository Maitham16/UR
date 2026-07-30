import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolUseContext } from '../src/Tool.js'
import {
  createTaskStateAttachmentIfNeeded,
  selectPostCompactTasks,
  selectPostCompactTodos,
} from '../src/services/compact/compact.js'
import { normalizeAttachmentForAPI } from '../src/utils/messages.js'
import { createTask, type Task } from '../src/utils/tasks.js'

let configRoot: string
let previousConfigDir: string | undefined
let previousTaskListId: string | undefined
let previousEnableTasks: string | undefined

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-compact-task-state-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  previousTaskListId = process.env.UR_CODE_TASK_LIST_ID
  previousEnableTasks = process.env.UR_CODE_ENABLE_TASKS
  process.env.UR_CONFIG_DIR = configRoot
  process.env.UR_CODE_TASK_LIST_ID = 'compact-state-test'
  process.env.UR_CODE_ENABLE_TASKS = '1'
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  if (previousTaskListId === undefined) delete process.env.UR_CODE_TASK_LIST_ID
  else process.env.UR_CODE_TASK_LIST_ID = previousTaskListId
  if (previousEnableTasks === undefined) delete process.env.UR_CODE_ENABLE_TASKS
  else process.env.UR_CODE_ENABLE_TASKS = previousEnableTasks
  rmSync(configRoot, { recursive: true, force: true })
})

describe('post-compaction task continuity', () => {
  test('prioritizes actionable tasks when a bounded snapshot is required', () => {
    const tasks = [
      task('1', 'completed'),
      task('2', 'pending'),
      task('3', 'failed'),
      task('4', 'in_progress'),
    ]

    expect(selectPostCompactTasks(tasks, 2).map(item => item.id)).toEqual([
      '2',
      '4',
    ])
  })

  test('restores exact live IDs and dependencies as authoritative state', async () => {
    await createTask('compact-state-test', {
      subject: 'Inspect implementation',
      description: 'Review the current behavior and record the evidence.',
      status: 'in_progress',
      blocks: ['2'],
      blockedBy: [],
      owner: 'reviewer',
    })
    await createTask('compact-state-test', {
      subject: 'Verify release',
      description: 'Run the full release checks before completion.',
      status: 'pending',
      blocks: [],
      blockedBy: ['1'],
    })

    const attachmentMessage = await createTaskStateAttachmentIfNeeded({
      getAppState: () => ({ todos: {} }),
    } as ToolUseContext)

    expect(attachmentMessage?.attachment).toMatchObject({
      type: 'task_reminder',
      itemCount: 2,
      authoritativeAfterCompact: true,
    })

    const normalized = normalizeAttachmentForAPI(
      attachmentMessage?.attachment,
    )
    const rendered = JSON.stringify(normalized)
    expect(rendered).toContain('Authoritative live task-store state')
    expect(rendered).toContain('#1 [in_progress] Inspect implementation')
    expect(rendered).toContain('Blocks: #2')
    expect(rendered).toContain('Owner: reviewer')
    expect(rendered).toContain('#2 [pending] Verify release')
    expect(rendered).toContain('Blocked by: #1')
  })

  test('enforces a token budget in addition to the item-count bound', () => {
    const huge = {
      ...task('1', 'pending'),
      subject: 'oversized '.repeat(10_000),
    }
    const small = task('2', 'pending')

    expect(
      selectPostCompactTasks([huge, small], 64, 200).map(item => item.id),
    ).toEqual(['2'])

    const todos = [
      {
        content: 'oversized '.repeat(10_000),
        activeForm: 'Working',
        status: 'pending' as const,
      },
      {
        content: 'Verify release',
        activeForm: 'Verifying release',
        status: 'in_progress' as const,
      },
    ]
    expect(selectPostCompactTodos(todos, 64, 200)).toEqual([todos[1]])
  })

  test('renders a legacy TodoWrite snapshot as authoritative ordered state', () => {
    const normalized = normalizeAttachmentForAPI({
      type: 'todo_reminder',
      content: [
        {
          content: 'Run release checks',
          activeForm: 'Running release checks',
          status: 'in_progress',
        },
      ],
      itemCount: 1,
      authoritativeAfterCompact: true,
    })
    const rendered = JSON.stringify(normalized)

    expect(rendered).toContain('Authoritative live TodoWrite state')
    expect(rendered).toContain('1. [in_progress] Run release checks')
    expect(rendered).toContain('Active form: Running release checks')
  })

  test('wires task restoration into every compaction result path', () => {
    const compactSource = readFileSync(
      'src/services/compact/compact.ts',
      'utf8',
    )
    const sessionMemorySource = readFileSync(
      'src/services/compact/sessionMemoryCompact.ts',
      'utf8',
    )
    const replSource = readFileSync('src/screens/REPL.tsx', 'utf8')

    expect(
      compactSource.match(
        /await createTaskStateAttachmentIfNeeded\(context\)/g,
      ),
    ).toHaveLength(2)
    expect(
      sessionMemorySource.match(
        /await createTaskStateAttachmentIfNeeded\(toolUseContext\)/g,
      ),
    ).toHaveLength(1)
    expect(replSource).toContain('suppressCompactWarning();')
  })
})

function task(id: string, status: Task['status']): Task {
  return {
    id,
    subject: `Task ${id}`,
    description: `Description ${id}`,
    status,
    blocks: [],
    blockedBy: [],
  }
}
