import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskCreateTool } from '../src/tools/TaskCreateTool/TaskCreateTool.ts'
import { TaskGetTool } from '../src/tools/TaskGetTool/TaskGetTool.ts'
import { TaskListTool } from '../src/tools/TaskListTool/TaskListTool.ts'
import { TaskUpdateTool } from '../src/tools/TaskUpdateTool/TaskUpdateTool.ts'
import {
  blockTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
  validateTaskDependency,
} from '../src/utils/tasks.ts'

let configRoot = ''
let previousConfigDir: string | undefined
let previousTaskListId: string | undefined

const taskListId = 'task-lifecycle-regression'

function toolContext() {
  let appState = { expandedView: undefined as string | undefined }
  return {
    abortController: new AbortController(),
    options: { tools: [] },
    getAppState() {
      return appState
    },
    setAppState(update: (previous: typeof appState) => typeof appState) {
      appState = update(appState)
    },
  } as never
}

async function createBareTask(subject: string): Promise<string> {
  return await createTask(taskListId, {
    subject,
    description: subject,
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-task-lifecycle-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  previousTaskListId = process.env.UR_CODE_TASK_LIST_ID
  process.env.UR_CONFIG_DIR = configRoot
  process.env.UR_CODE_TASK_LIST_ID = taskListId
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  if (previousTaskListId === undefined) delete process.env.UR_CODE_TASK_LIST_ID
  else process.env.UR_CODE_TASK_LIST_ID = previousTaskListId
  rmSync(configRoot, { recursive: true, force: true })
})

describe('task dependency and completion lifecycle', () => {
  test('TaskUpdate normalizes an accepted numeric ID before lookup', async () => {
    const taskId = await createBareTask('numeric id')
    expect(taskId).toBe('1')

    const result = await TaskUpdateTool.call(
      { taskId: 1, status: 'in_progress' },
      toolContext(),
    )

    expect(result.data).toMatchObject({
      success: true,
      taskId: '1',
      statusChange: { from: 'pending', to: 'in_progress' },
    })
    expect((await getTask(taskListId, taskId))?.status).toBe('in_progress')
  })

  test('TaskUpdate normalizes numeric dependency IDs before graph updates', async () => {
    const prerequisite = await createBareTask('numeric prerequisite')
    const dependent = await createBareTask('numeric dependent')

    const result = await TaskUpdateTool.call(
      { taskId: 2, addBlockedBy: [1] },
      toolContext(),
    )

    expect(result.data).toMatchObject({
      success: true,
      taskId: dependent,
    })
    expect((await getTask(taskListId, dependent))?.blockedBy).toEqual([
      prerequisite,
    ])
    expect((await getTask(taskListId, prerequisite))?.blocks).toEqual([
      dependent,
    ])
  })

  test('TaskCreate normalizes numeric dependency IDs before graph updates', async () => {
    const prerequisite = await createBareTask('numeric create prerequisite')
    const result = await TaskCreateTool.call(
      {
        subject: 'numeric create dependent',
        description: 'numeric create dependent',
        blockedBy: [1],
      },
      toolContext(),
    )
    const dependent = result.data.task.id

    expect((await getTask(taskListId, dependent))?.blockedBy).toEqual([
      prerequisite,
    ])
    expect((await getTask(taskListId, prerequisite))?.blocks).toEqual([
      dependent,
    ])
  })

  test('TaskUpdate cannot bypass a pending numeric blocker on completion', async () => {
    const prerequisite = await createBareTask('pending numeric prerequisite')
    const dependent = await createBareTask('blocked numeric dependent')

    const result = await TaskUpdateTool.call(
      { taskId: 2, status: 'completed', addBlockedBy: [1] },
      toolContext(),
    )

    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain(`#${prerequisite}`)
    expect((await getTask(taskListId, dependent))?.status).toBe('pending')
    expect((await getTask(taskListId, dependent))?.blockedBy).toEqual([])
  })

  test('TaskGet normalizes an accepted numeric ID before lookup', async () => {
    const taskId = await createBareTask('numeric task get')

    const result = await TaskGetTool.call({ taskId: 1 })

    expect(result.data.task).toMatchObject({
      id: taskId,
      subject: 'numeric task get',
    })
  })

  test('blockTask writes reciprocal edges and rejects missing, self, and cyclic edges', async () => {
    const first = await createBareTask('first')
    const second = await createBareTask('second')

    expect(await blockTask(taskListId, first, second)).toBe(true)
    expect((await getTask(taskListId, first))?.blocks).toEqual([second])
    expect((await getTask(taskListId, second))?.blockedBy).toEqual([first])

    expect(
      await validateTaskDependency(taskListId, first, first),
    ).toEqual({ valid: false, reason: 'self_dependency' })
    expect(
      await validateTaskDependency(taskListId, second, first),
    ).toEqual({ valid: false, reason: 'cycle' })
    expect(
      await validateTaskDependency(taskListId, first, 'missing'),
    ).toEqual({ valid: false, reason: 'task_not_found' })
    expect(await blockTask(taskListId, second, first)).toBe(false)
  })

  test('TaskCreate dependency fields update both referenced tasks', async () => {
    const prerequisite = await createBareTask('prerequisite')
    const result = await TaskCreateTool.call(
      {
        subject: 'dependent',
        description: 'dependent',
        blockedBy: [prerequisite],
      },
      toolContext(),
    )
    const dependent = result.data.task.id

    expect((await getTask(taskListId, prerequisite))?.blocks).toContain(
      dependent,
    )
    expect((await getTask(taskListId, dependent))?.blockedBy).toEqual([
      prerequisite,
    ])
  })

  test('TaskCreate preflights every dependency before writing any edge', async () => {
    const prerequisite = await createBareTask('prerequisite')

    await expect(
      TaskCreateTool.call(
        {
          subject: 'invalid dependent',
          description: 'invalid dependent',
          blockedBy: [prerequisite, 'missing-task'],
        },
        toolContext(),
      ),
    ).rejects.toThrow('task_not_found')

    // The newly allocated task was rolled back and the valid first
    // prerequisite did not retain a dangling reciprocal edge.
    expect((await getTask(taskListId, prerequisite))?.blocks).toEqual([])
  })

  test('TaskCreate validates combined dependency edges as one graph', async () => {
    const first = await createBareTask('first')
    const second = await createBareTask('second')
    expect(await blockTask(taskListId, first, second)).toBe(true)

    await expect(
      TaskCreateTool.call(
        {
          subject: 'combined cycle',
          description: 'combined cycle',
          blocks: [first],
          blockedBy: [second],
        },
        toolContext(),
      ),
    ).rejects.toThrow('cycle')

    expect((await listTasks(taskListId)).map(task => task.id)).toEqual([
      first,
      second,
    ])
    expect((await getTask(taskListId, first))?.blocks).toEqual([second])
    expect((await getTask(taskListId, second))?.blockedBy).toEqual([first])
  })

  test('TaskUpdate rejects a combined cycle without partially updating fields', async () => {
    const first = await createBareTask('first')
    const second = await createBareTask('second')
    const updatedTask = await createBareTask('unchanged')
    expect(await blockTask(taskListId, first, second)).toBe(true)

    const result = await TaskUpdateTool.call(
      {
        taskId: updatedTask,
        subject: 'must not persist',
        addBlocks: [first],
        addBlockedBy: [second],
      },
      toolContext(),
    )

    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain('cycle')
    expect(await getTask(taskListId, updatedTask)).toMatchObject({
      subject: 'unchanged',
      blocks: [],
      blockedBy: [],
    })
    expect((await getTask(taskListId, first))?.blocks).toEqual([second])
    expect((await getTask(taskListId, second))?.blockedBy).toEqual([first])
  })

  test('TaskUpdate refuses blocked completion and reports an error block', async () => {
    const prerequisite = await createBareTask('prerequisite')
    const dependent = await createBareTask('dependent')
    expect(await blockTask(taskListId, prerequisite, dependent)).toBe(true)

    const result = await TaskUpdateTool.call(
      { taskId: dependent, status: 'completed' },
      toolContext(),
    )
    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain(`#${prerequisite}`)
    expect(
      TaskUpdateTool.mapToolResultToToolResultBlockParam(
        result.data,
        'tool-update',
      ).is_error,
    ).toBe(true)
    expect((await getTask(taskListId, dependent))?.status).toBe('pending')
  })

  test('TaskUpdate considers blockers added in the completion request', async () => {
    const prerequisite = await createBareTask('prerequisite')
    const dependent = await createBareTask('dependent')

    const result = await TaskUpdateTool.call(
      {
        taskId: dependent,
        status: 'completed',
        addBlockedBy: [prerequisite],
      },
      toolContext(),
    )

    expect(result.data.success).toBe(false)
    expect(result.data.error).toContain(`#${prerequisite}`)
    expect(await getTask(taskListId, dependent)).toMatchObject({
      status: 'pending',
      blockedBy: [],
    })
    expect((await getTask(taskListId, prerequisite))?.blocks).toEqual([])
  })

  test('TaskUpdate ignores stale missing blockers when completing', async () => {
    const dependent = await createBareTask('dependent')
    await updateTask(taskListId, dependent, {
      blockedBy: ['already-deleted'],
    })

    const result = await TaskUpdateTool.call(
      { taskId: dependent, status: 'completed' },
      toolContext(),
    )

    expect(result.data.success).toBe(true)
    expect((await getTask(taskListId, dependent))?.status).toBe('completed')
  })

  test('deleteTask removes reciprocal references before unlinking', async () => {
    const blocker = await createBareTask('blocker')
    const dependent = await createBareTask('dependent')
    expect(await blockTask(taskListId, blocker, dependent)).toBe(true)

    expect(await deleteTask(taskListId, blocker)).toBe(true)
    expect(await getTask(taskListId, blocker)).toBeNull()
    expect((await getTask(taskListId, dependent))?.blockedBy).toEqual([])
  })

  test('TaskList hides resolved and nonexistent blockers consistently', async () => {
    const completed = await createBareTask('completed')
    const dependent = await createBareTask('dependent')
    await updateTask(taskListId, completed, { status: 'completed' })
    await updateTask(taskListId, dependent, {
      blockedBy: [completed, 'deleted-task'],
    })

    const result = await TaskListTool.call()
    const listed = result.data.tasks.find(task => task.id === dependent)
    expect(listed?.blockedBy).toEqual([])
  })
})
