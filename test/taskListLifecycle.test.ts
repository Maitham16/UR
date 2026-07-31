import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isTaskListFullyCompleted } from '../src/utils/tasks.js'
import type { Task } from '../src/utils/tasks.js'

const repoRoot = path.resolve(import.meta.dir, '..')

function task(id: string, status: Task['status']): Task {
  return {
    id,
    subject: `task ${id}`,
    description: '',
    status,
    blocks: [],
    blockedBy: [],
  } as unknown as Task
}

describe('completed-list detection', () => {
  test('a list where every task is completed is finished history', () => {
    expect(
      isTaskListFullyCompleted([task('1', 'completed'), task('2', 'completed')]),
    ).toBe(true)
  })

  test('an empty list is not completed — there is nothing to retire', () => {
    expect(isTaskListFullyCompleted([])).toBe(false)
  })

  test('any unfinished task keeps the list active', () => {
    for (const status of ['pending', 'in_progress'] as const) {
      expect(
        isTaskListFullyCompleted([task('1', 'completed'), task('2', status)]),
      ).toBe(false)
    }
  })

  test('a single completed task still counts as a finished list', () => {
    expect(isTaskListFullyCompleted([task('1', 'completed')])).toBe(true)
  })
})

describe('TaskCreate retires a finished list before adding', () => {
  const source = readFileSync(
    path.join(repoRoot, 'src/tools/TaskCreateTool/TaskCreateTool.ts'),
    'utf8',
  )

  test('the retire call runs before createTask', () => {
    // Otherwise the new task lands in the completed list and the progress
    // count starts wrong.
    const retireAt = source.indexOf('retireCompletedTaskList(taskListId)')
    const createAt = source.indexOf('await createTask(taskListId')
    expect(retireAt).toBeGreaterThan(-1)
    expect(createAt).toBeGreaterThan(-1)
    expect(retireAt).toBeLessThan(createAt)
  })

  test('it is awaited, not fired and forgotten', () => {
    expect(source).toContain('await retireCompletedTaskList(taskListId)')
  })
})

describe('retirement is conservative', () => {
  const source = readFileSync(path.join(repoRoot, 'src/utils/tasks.ts'), 'utf8')

  test('only a fully completed list is reset', () => {
    expect(source).toContain('if (!isTaskListFullyCompleted(tasks)) {')
    expect(source).toContain('return false')
  })

  test('adding to work in progress is left alone', () => {
    // "Add this to the current list" must keep working.
    expect(source).toContain('retireCompletedTaskList')
    expect(source).toContain("tasks.every(task => task.status === 'completed')")
  })

  test('the high-water mark still guards id reuse after a reset', () => {
    expect(source).toContain('writeHighWaterMark')
  })
})
