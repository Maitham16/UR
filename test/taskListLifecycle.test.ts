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
  requestsContinueCurrentTaskList,
  requestsRevisionOfCurrentTaskList,
} from '../src/utils/taskListRunContext.js'
import {
  AUTOMATIC_PROMPT_TASK_ACTIVE_FORM,
  AUTOMATIC_PROMPT_TASK_DESCRIPTION,
  AUTOMATIC_PROMPT_TASK_SUBJECT,
  blockTask,
  createAutomaticPromptTaskForRun,
  createTask,
  createTaskForRun,
  finalizeAutomaticPromptTask,
  getTask,
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

  test('a new run preserves interrupted incomplete tasks in the active list', async () => {
    await createBareTask('still pending')
    await createBareTask('failed work', 'failed')

    await prepareTaskListForRun(taskListId, 'fresh-run')

    expect((await listTasks(taskListId)).map(item => item.status)).toEqual([
      'pending',
      'failed',
    ])
    expect(await listTaskHistory(taskListId)).toEqual([])
  })

  test('an interruption resumes the visible seed instead of echoing the reply as a task', async () => {
    await prepareTaskListForRun(taskListId, 'first-run')
    const first = await createAutomaticPromptTaskForRun(
      taskListId,
      'first-run',
      'Implement the parser fix',
    )
    expect(first).toBeDefined()
    expect(await getTask(taskListId, first!)).toMatchObject({
      subject: AUTOMATIC_PROMPT_TASK_SUBJECT,
      description: AUTOMATIC_PROMPT_TASK_DESCRIPTION,
      activeForm: AUTOMATIC_PROMPT_TASK_ACTIVE_FORM,
      status: 'in_progress',
    })
    expect(JSON.stringify(await getTask(taskListId, first!))).not.toContain(
      'Implement the parser fix',
    )

    await prepareTaskListForRun(taskListId, 'interruption-run')
    const interruption = await createAutomaticPromptTaskForRun(
      taskListId,
      'interruption-run',
      'Also update the task board after interruptions',
    )

    expect(interruption).toBe(first)
    expect((await listTasks(taskListId)).map(item => item.id)).toEqual([first])
    expect((await listTasks(taskListId))[0]).toMatchObject({
      subject: AUTOMATIC_PROMPT_TASK_SUBJECT,
      status: 'in_progress',
    })
    expect(JSON.stringify(await listTasks(taskListId))).not.toContain(
      'Also update the task board after interruptions',
    )
    expect(await listTaskHistory(taskListId)).toEqual([])
    expect(
      await finalizeAutomaticPromptTask(
        taskListId,
        first!,
        'first-run',
        'pending',
      ),
    ).toBe(false)
    expect(
      await finalizeAutomaticPromptTask(
        taskListId,
        first!,
        'interruption-run',
        'pending',
      ),
    ).toBe(true)
    expect((await getTask(taskListId, first!))?.status).toBe('pending')
  })

  test('a follow-up does not add an automatic task to an unfinished explicit board', async () => {
    const explicit = await createBareTask('Implement the parser fix')
    await prepareTaskListForRun(taskListId, 'follow-up-run')

    expect(
      await createAutomaticPromptTaskForRun(
        taskListId,
        'follow-up-run',
        'Why did you remove it? I said fix it.',
      ),
    ).toBeUndefined()
    expect((await listTasks(taskListId)).map(item => item.id)).toEqual([
      explicit,
    ])
  })

  test('a corrective reply reopens the prior automatic task without renaming it', async () => {
    await prepareTaskListForRun(taskListId, 'first-run')
    const original = await createAutomaticPromptTaskForRun(
      taskListId,
      'first-run',
      'Fix the game bug',
    )
    expect(original).toBeDefined()
    await finalizeAutomaticPromptTask(
      taskListId,
      original!,
      'first-run',
      'completed',
    )

    const followUp = getTaskListRunForCommand({
      value: 'why did u remove it i said fix it',
      mode: 'prompt',
      uuid: 'revision-run' as never,
    })!
    expect(followUp.appendToCurrent).toBe(true)
    await prepareTaskListForRun(taskListId, followUp.generationId, {
      appendToCurrent: followUp.appendToCurrent,
    })
    const resumed = await createAutomaticPromptTaskForRun(
      taskListId,
      followUp.generationId,
      'why did u remove it i said fix it',
      { reuseExistingBoard: true },
    )

    expect(resumed).toBe(original)
    expect(await getTask(taskListId, original!)).toMatchObject({
      subject: AUTOMATIC_PROMPT_TASK_SUBJECT,
      status: 'in_progress',
    })
  })

  test('the first explicit model task atomically replaces its automatic seed', async () => {
    await prepareTaskListForRun(taskListId, 'model-run')
    const seed = await createAutomaticPromptTaskForRun(
      taskListId,
      'model-run',
      'Fix and verify the release',
    )
    const explicit = await createTaskForRun(
      taskListId,
      'model-run',
      newTask('Fix release workflow'),
      { replaceAutomaticPromptTask: true },
    )

    expect(explicit).toBe(seed)
    expect(await listTasks(taskListId)).toHaveLength(1)
    expect(await getTask(taskListId, explicit)).toMatchObject({
      subject: 'Fix release workflow',
      status: 'pending',
    })
    expect(
      await finalizeAutomaticPromptTask(
        taskListId,
        seed,
        'model-run',
        'completed',
      ),
    ).toBe(false)
    expect((await getTask(taskListId, explicit))?.status).toBe('pending')
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

  test('an acknowledgement keeps the plan it authorizes active', async () => {
    await prepareTaskListForRun(taskListId, 'planning-run')
    const planned = await createTaskForRun(
      taskListId,
      'planning-run',
      newTask('plan implementation'),
    )
    expect(planned).toBe('1')

    const continuation = getTaskListRunForCommand({
      value: 'ok',
      mode: 'prompt',
      uuid: 'implementation-run' as never,
    })!
    expect(continuation.appendToCurrent).toBe(true)
    await prepareTaskListForRun(
      taskListId,
      continuation.generationId,
      { appendToCurrent: continuation.appendToCurrent },
    )

    expect((await listTasks(taskListId)).map(item => item.id)).toEqual(['1'])
    expect(await listTaskHistory(taskListId)).toEqual([])
    await updateTask(taskListId, planned, { status: 'completed' })
    const implementation = await createTaskForRun(
      taskListId,
      continuation.generationId,
      newTask('build implementation'),
    )
    expect(implementation).toBe('2')
    expect(await blockTask(taskListId, planned, implementation)).toBe(true)
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

  test('recognizes short approval and continuation turns', () => {
    for (const input of [
      'ok',
      'Okay!',
      'yes, continue',
      'Please proceed.',
      'go ahead',
      'I approve',
      'start implementation',
      'sounds good',
    ]) {
      expect(requestsContinueCurrentTaskList(input)).toBe(true)
    }
  })

  test('does not mistake a new request containing continuation language for approval', () => {
    for (const input of [
      'Continue improving the parser and add YAML support',
      'Okay, now build a different application',
      'Proceed with a new database migration after changing the schema',
    ]) {
      expect(requestsContinueCurrentTaskList(input)).toBe(false)
    }
  })

  test('recognizes corrective replies without treating new work as a revision', () => {
    for (const input of [
      'why did u remove it i said fix it',
      'Actually, keep the original animation',
      "no still get clutter specially after explosions also I don't like the mechanism of weapon upgrading and the type of levels and bullets",
      'No, it still shows my prompt as the task',
      "don't delete that function",
      'fix it please',
    ]) {
      expect(requestsRevisionOfCurrentTaskList(input)).toBe(true)
    }
    expect(
      requestsRevisionOfCurrentTaskList(
        'Build a new database migration and update the schema',
      ),
    ).toBe(false)
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
      getTaskListRunForCommand({
        value: 'ok',
        mode: 'prompt',
        uuid: 'approval-run' as never,
      }),
    ).toEqual({ generationId: 'approval-run', appendToCurrent: true })
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

  test('documents automatic interruption preservation and explicit append intent', () => {
    const createPrompt = getTaskCreatePrompt()
    expect(createPrompt).toContain('**addToCurrentList**')
    expect(createPrompt).toContain('an interruption preserves active work')
    expect(createPrompt).toContain('After an interruption, call TaskList')
  })
})
