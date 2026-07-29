import { describe, expect, test } from 'bun:test'
import {
  findCurrentTask,
  findNextActionableTask,
} from '../src/components/Spinner/taskProgress.js'
import type { Task } from '../src/utils/tasks.js'

function task(
  id: string,
  status: Task['status'],
  blockedBy: string[] = [],
): Task {
  return {
    id,
    subject: `Task ${id}`,
    description: '',
    status,
    blocks: [],
    blockedBy,
  }
}

describe('spinner task progress', () => {
  test('shows only an in-progress task as current work', () => {
    const tasks = [
      task('3', 'failed'),
      task('2', 'skipped'),
      task('10', 'in_progress'),
      task('4', 'in_progress'),
    ]

    expect(findCurrentTask(tasks)?.id).toBe('4')
  })

  test('chooses the first numerically ordered pending task that can run', () => {
    const tasks = [
      task('10', 'pending'),
      task('2', 'pending', ['1']),
      task('1', 'in_progress'),
    ]

    expect(findNextActionableTask(tasks)?.id).toBe('10')
  })

  test('does not advertise a blocked task as next', () => {
    const tasks = [
      task('1', 'failed'),
      task('2', 'pending', ['1']),
    ]

    expect(findNextActionableTask(tasks)).toBeUndefined()
  })
})
