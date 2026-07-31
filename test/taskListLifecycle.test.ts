import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPrompt as getTaskCreatePrompt } from '../src/tools/TaskCreateTool/prompt.js'
import { getPrompt as getTaskListPrompt } from '../src/tools/TaskListTool/prompt.js'
import { PROMPT as taskUpdatePrompt } from '../src/tools/TaskUpdateTool/prompt.js'
import {
  getTaskListRunForCommand,
  requestsAppendToCurrentTaskList,
} from '../src/utils/taskListRunContext.js'
import {
  createTask,
  createTaskForRun,
  isTaskListFullyCompleted,
  listTaskHistory,
  listTasks,
  prepareTaskListForRun,
  retireCompletedTaskList,
  type Task,
  updateTask,
} from '../src/utils/tasks.js'

let configRoot = ''
let previousConfigDir: string | undefined
const taskListId = 'task-list-generation-test'

function task(id: string, status: Task['status']): Task {
  return {
    id,
    subject: `task ${id}`,
    description: '',
    status,
    blocks: [],
    blockedBy: [],
  }
}

async function createBareTask(
  subject: string,
  status: Task['status'] = 'pending',
): Promise<string> {
  return createTask(taskListId, {
    subject,
    description: subject,
    status,
    blocks: [],
    blockedBy: [],
  })
}

function newTask(subject: string): Omit<Task, 'id'> {
  return {
    subject,
    description: subject,
    status: 'pending',
    blocks: [],
    blockedBy: [],
  }
}

beforeEach(() => {
  configRoot = mkdtempSync(join(tmpdir(), 'ur-task-list-generation-'))
  previousConfigDir = process.env.UR_CONFIG_DIR
  process.env.UR_CONFIG_DIR = configRoot
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.UR_CONFIG_DIR
  else process.env.UR_CONFIG_DIR = previousConfigDir
  rmSync(configRoot, { recursive: true, force: true })
})

describe('completed-list detection', () => {
  test('only a non-empty, fully completed list is finished', () => {
    expect(isTaskListFullyCompleted([])).toBe(false)
    expect(
      isTaskListFullyCompleted([
        task('1', 'completed'),
        task('2', 'completed'),
      ]),
    ).toBe(true)
    for (const status of [
      'pending',
      'in_progress',
      'failed',
      'skipped',
    ] as const) {
      expect(
        isTaskListFullyCompleted([
          task('1', 'completed'),
          task('2', status),
        ]),
      ).toBe(false)
    }
  })
})

describe('persistent task-list generations', () => {
  test('a new run archives completed tasks as readable history', async () => {
    await createBareTask('finished', 'completed')

    const archived = await prepareTaskListForRun(taskListId, 'run-2')

    expect(archived?.tasks.map(item => item.subject)).toEqual(['finished'])
    expect(await listTasks(taskListId)).toEqual([])
    const history = await listTaskHistory(taskListId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      generationId: undefined,
      tasks: [{ subject: 'finished', status: 'completed' }],
    })
  })

  test('a new run archives stale incomplete tasks instead of appending', async () => {
    await createBareTask('still pending')
    await createBareTask('failed work', 'failed')

    await prepareTaskListForRun(taskListId, 'fresh-run')

    expect(await listTasks(taskListId)).toEqual([])
    expect(
      (await listTaskHistory(taskListId))[0]?.tasks.map(item => item.status),
    ).toEqual(['pending', 'failed'])
  })

  test('explicit append keeps the active list and binds the whole run', async () => {
    await createBareTask('existing')

    await prepareTaskListForRun(taskListId, 'append-run', {
      appendToCurrent: true,
    })
    await createTaskForRun(
      taskListId,
      'append-run',
      newTask('appended'),
    )

    expect((await listTasks(taskListId)).map(item => item.subject)).toEqual([
      'existing',
      'appended',
    ])
    expect(await listTaskHistory(taskListId)).toEqual([])
  })

  test('same-generation preparation is idempotent', async () => {
    await prepareTaskListForRun(taskListId, 'same-run')
    await createTaskForRun(taskListId, 'same-run', newTask('kept'))

    expect(
      await prepareTaskListForRun(taskListId, 'same-run'),
    ).toBeUndefined()
    expect((await listTasks(taskListId)).map(item => item.subject)).toEqual([
      'kept',
    ])
    expect(await listTaskHistory(taskListId)).toEqual([])
  })

  test('parallel first creates archive once and never lose a new task', async () => {
    await createBareTask('old task', 'completed')

    const ids = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createTaskForRun(
          taskListId,
          'parallel-run',
          newTask(`parallel ${index}`),
        ),
      ),
    )

    expect(new Set(ids).size).toBe(8)
    expect((await listTasks(taskListId)).map(item => item.subject).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `parallel ${index}`).sort(),
    )
    const history = await listTaskHistory(taskListId)
    expect(history).toHaveLength(1)
    expect(history[0]?.tasks.map(item => item.subject)).toEqual(['old task'])
  })

  test('archival preserves the high-water mark and never reuses IDs', async () => {
    expect(await createBareTask('one')).toBe('1')
    expect(await createBareTask('two')).toBe('2')
    await prepareTaskListForRun(taskListId, 'next-run')

    expect(
      await createTaskForRun(taskListId, 'next-run', newTask('three')),
    ).toBe('3')
  })

  test('explicit completed-list retirement archives rather than deletes', async () => {
    const id = await createBareTask('pending')
    expect(await retireCompletedTaskList(taskListId)).toBe(false)
    await updateTask(taskListId, id, { status: 'completed' })

    expect(await retireCompletedTaskList(taskListId)).toBe(true)
    expect(await listTasks(taskListId)).toEqual([])
    expect((await listTaskHistory(taskListId))[0]?.tasks[0]?.subject).toBe(
      'pending',
    )
  })
})

describe('append-current intent', () => {
  test('recognizes explicit current-list language', () => {
    for (const input of [
      'Add this to the current task list',
      'Append a verification step to the existing list',
      'Queue it on your current tasks',
      'Keep the existing task list and add one more check',
    ]) {
      expect(requestsAppendToCurrentTaskList(input)).toBe(true)
    }
  })

  test('does not infer append from an ordinary new prompt', () => {
    expect(requestsAppendToCurrentTaskList('Fix the next issue')).toBe(false)
    expect(requestsAppendToCurrentTaskList('Create a task list')).toBe(false)
  })

  test('only real prompt commands create a run generation', () => {
    expect(
      getTaskListRunForCommand({
        value: 'Add this to the current list',
        mode: 'prompt',
        uuid: 'prompt-run' as never,
      }),
    ).toEqual({ generationId: 'prompt-run', appendToCurrent: true })
    expect(
      getTaskListRunForCommand({ value: '/model', mode: 'prompt' }),
    ).toBeUndefined()
    expect(
      getTaskListRunForCommand(
        { value: '/review changes', mode: 'prompt', uuid: 'review-run' as never },
        { allowSlashCommand: true },
      ),
    ).toEqual({ generationId: 'review-run', appendToCurrent: false })
    expect(
      getTaskListRunForCommand({
        value: 'background tick',
        mode: 'prompt',
        isMeta: true,
      }),
    ).toBeUndefined()
  })
})

describe('task tool status guidance', () => {
  test('documents every persisted state and derived blocked state', () => {
    const listPrompt = getTaskListPrompt()
    for (const status of [
      'pending',
      'in_progress',
      'completed',
      'failed',
      'skipped',
    ]) {
      expect(listPrompt).toContain(`'${status}'`)
    }
    expect(listPrompt).toContain('blocked is derived')
    expect(taskUpdatePrompt).toContain('`failed`')
    expect(taskUpdatePrompt).toContain('`skipped`')
    expect(taskUpdatePrompt).toContain('derived display state')
  })

  test('requires explicit user intent for add-to-current', () => {
    const createPrompt = getTaskCreatePrompt()
    expect(createPrompt).toContain('**addToCurrentList**')
    expect(createPrompt).toContain('only when the user explicitly asks')
  })
})
